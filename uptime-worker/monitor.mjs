import { connect } from 'cloudflare:sockets';

const MINUTE = 60_000;
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export function initialState() {
  return { status: 'unknown', failures: 0, successes: 0, lastCheck: 0, downAt: null,
    sequence: 0, pending: [], lastDelivery: null, retryAt: 0 };
}

export function advance(saved, healthy, now, detail = '') {
  const s = structuredClone(saved);
  s.lastCheck = now;
  s.lastProbe = { healthy, detail };
  s.failures = healthy ? 0 : s.failures + 1;
  s.successes = healthy ? s.successes + 1 : 0;
  if (!healthy && s.failures === 1) s.failureStarted = now;
  if (!healthy && s.failures >= 3 && s.status !== 'down') {
    s.status = 'down'; s.downAt = s.failureStarted;
    s.pending.push({ id: ++s.sequence, kind: 'down', at: now, downAt: s.downAt, detail });
  }
  if (healthy && s.status === 'unknown') s.status = 'up';
  if (healthy && s.status === 'down' && s.successes >= 2) {
    s.status = 'up';
    s.pending.push({ id: ++s.sequence, kind: 'up', at: now, downAt: s.downAt, detail });
    s.downAt = null;
  }
  return s;
}

async function tcpProbe(host, port, kind, timeout = 8000) {
  let socket, reader, writer, timer;
  try {
    socket = connect({ hostname: host, port });
    const operation = async () => {
      await socket.opened;
      if (kind === 'http') {
        writer = socket.writable.getWriter();
        await writer.write(new TextEncoder().encode(`GET / HTTP/1.1\r\nHost: ${host}:${port}\r\nConnection: close\r\n\r\n`));
      }
      reader = socket.readable.getReader();
      let text = '';
      while (text.length < 8192) {
        const { value, done } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
        if (text.includes('\r\n')) break;
      }
      if (kind === 'ssh') return { healthy: text.startsWith('SSH-'), detail: text.startsWith('SSH-') ? 'SSH ตอบ' : 'SSH ไม่ตอบตามปกติ' };
      const status = Number(text.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/)?.[1]);
      return { healthy: status === 401, detail: status ? `Viewer HTTP ${status}` : 'Viewer ไม่ตอบ HTTP' };
    };
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), timeout);
    })]);
  } catch {
    return { healthy: false, detail: `${kind === 'ssh' ? 'SSH' : 'Viewer'} เชื่อมต่อไม่ได้/หมดเวลา` };
  } finally {
    clearTimeout(timer);
    try { reader?.releaseLock(); writer?.releaseLock(); } catch { /* close handles pending reads */ }
    try { await socket?.close(); } catch { /* already closed */ }
  }
}

async function probe(env) {
  if (!env.TARGET_HOST) throw new Error('TARGET_HOST is required');
  const viewer = await tcpProbe(env.TARGET_HOST, Number(env.TARGET_PORT || 8080), 'http');
  if (!viewer.healthy) {
    const ssh = await tcpProbe(env.TARGET_HOST, 22, 'ssh', 3000);
    viewer.detail += ` · ${ssh.detail}`;
  }
  return viewer;
}

export async function probeGame(env) {
  try {
    const response = await fetch(env.GAME_HEALTH_URL, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
    await response.body?.cancel();
    return { healthy: response.ok, detail: `Game HTTP ${response.status}` };
  } catch { return { healthy: false, detail: 'Game HTTP connection failed/timeout' }; }
}

function message(event, test = false, target = 'VPS / Live Viewer') {
  const time = (at) => new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(at));
  const duration = Math.max(0, Math.round((event.at - event.downAt) / MINUTE));
  const text = event.kind === 'down'
    ? `🚨 ${target} เข้าไม่ได้จากภายนอก\nตรวจไม่ผ่านติดกัน 3 รอบ (ทุก 1 นาที)\nเริ่มพบปัญหา ${time(event.downAt)}\n${event.detail}`
    : `✅ ${target} กลับมาเข้าถึงได้แล้ว\nตรวจผ่านติดกัน 2 รอบ\nช่วงที่ตรวจพบปัญหาประมาณ ${duration} นาที\n${event.detail}`;
  return (test ? '🧪 ทดสอบแจ้งล่ม/กลับมา — ไม่ได้ปิด VPS จริง\n\n' : '') + text + `\nตรวจโดย Cloudflare · ${time(event.at)} (ไทย)`;
}

async function send(env, text, silent = false) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text,
      disable_notification: silent, protect_content: true, link_preview_options: { is_disabled: true } }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw Object.assign(new Error(`Telegram ${body.error_code || response.status}`), {
    retryMs: (Number(body.parameters?.retry_after) || 60) * 1000,
  });
  return body.result.message_id;
}

async function init(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS uptime_state (id TEXT PRIMARY KEY, payload TEXT NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, owner TEXT)').run();
}
async function load(db, id) {
  const row = await db.prepare('SELECT payload FROM uptime_state WHERE id=?').bind(id).first();
  return row ? JSON.parse(row.payload) : initialState();
}
async function persist(db, id, owner, state) {
  const result = await db.prepare('UPDATE uptime_state SET payload=? WHERE id=? AND owner=?')
    .bind(JSON.stringify(state), id, owner).run();
  if (!result.meta.changes) throw new Error('Monitor lease lost');
}

async function check(env, channel = 'production') {
  const db = env.UPTIME_DB;
  await init(db);
  const now = Date.now(), owner = crypto.randomUUID();
  await db.prepare('INSERT OR IGNORE INTO uptime_state (id,payload) VALUES (?,?)').bind(channel, JSON.stringify(initialState())).run();
  const lease = await db.prepare('UPDATE uptime_state SET lease_until=?, owner=? WHERE id=? AND lease_until<?')
    .bind(now + 45_000, owner, channel, now).run();
  if (!lease.meta.changes) return { skipped: 'check already running' };
  try {
    let state = await load(db, channel);
    if (now - state.lastCheck < 50_000) return { skipped: 'checked recently' };
    const result = channel==='game' ? await probeGame(env) : await probe(env);
    state = advance(state, result.healthy, now, result.detail);
    await persist(db, channel, owner, state);
    if (state.pending.length && now >= state.retryAt) {
      const event = state.pending[0];
      try {
        const id = await send(env, message(event, false, channel==='game'?'Sigil Online':'VPS / Live Viewer'), event.kind === 'up');
        state.pending.shift(); state.retryAt = 0;
        state.lastDelivery = { at: Date.now(), kind: event.kind, messageId: id };
        state.deliveryError = null;
      } catch (error) {
        state.retryAt = Date.now() + Math.max(MINUTE, error.retryMs || MINUTE);
        state.deliveryError = 'Telegram delivery failed; queued for retry';
      }
      await persist(db, channel, owner, state);
    }
    console.log(JSON.stringify({ type: 'uptime-check', healthy: result.healthy, status: state.status,
      failures: state.failures, successes: state.successes, pending: state.pending.length }));
    return state;
  } finally {
    await db.prepare('UPDATE uptime_state SET lease_until=0,owner=NULL WHERE id=? AND owner=?').bind(channel, owner).run();
  }
}

async function selftest(env) {
  const db = env.UPTIME_DB, owner = crypto.randomUUID(), now = Date.now();
  await init(db);
  await db.prepare('INSERT OR IGNORE INTO uptime_state (id,payload) VALUES (?,?)')
    .bind('selftest', JSON.stringify({ started: now, productionUnchanged: true })).run();
  const lease = await db.prepare('UPDATE uptime_state SET lease_until=?,owner=? WHERE id=? AND lease_until<?')
    .bind(now + 45_000, owner, 'selftest', now).run();
  if (!lease.meta.changes) return { skipped: 'selftest already running' };
  try {
    const result = await load(db, 'selftest');
    if (result.done) return result;
    const live = await probe(env);
    if (!live.healthy) return { error: 'Live probe must pass before selftest' };
    let fixture = advance(initialState(), true, now - 5 * MINUTE);
    for (let i = 0; i < 3; i++) fixture = advance(fixture, false, now - (4 - i) * MINUTE, 'จำลอง timeout สำหรับทดสอบ');
    if (!result.downMessageId) {
      result.downMessageId = await send(env, message(fixture.pending[0], true), true);
      await persist(db, 'selftest', owner, result);
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    fixture.pending = [];
    for (let i = 0; i < 2; i++) fixture = advance(fixture, true, now - (1 - i) * MINUTE, live.detail);
    if (!result.upMessageId) {
      result.upMessageId = await send(env, message(fixture.pending[0], true), true);
    }
    result.done = Date.now();
    await persist(db, 'selftest', owner, result);
    return result;
  } finally {
    await db.prepare('UPDATE uptime_state SET lease_until=0,owner=NULL WHERE id=? AND owner=?').bind('selftest', owner).run();
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([check(env),...(env.GAME_HEALTH_URL?[check(env,'game')]:[])]));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, service: 'sigil-uptime-monitor' });
    if (!env.ADMIN_KEY || request.headers.get('authorization') !== `Bearer ${env.ADMIN_KEY}`) return json({ error: 'unauthorized' }, 401);
    if (!env.UPTIME_DB || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return json({ error: 'configuration incomplete' }, 503);
    if (url.pathname === '/admin/status' && request.method === 'GET') {
      await init(env.UPTIME_DB);
      return json({ production: await load(env.UPTIME_DB, 'production'), selftest: await load(env.UPTIME_DB, 'selftest'), game: await load(env.UPTIME_DB, 'game') });
    }
    if (url.pathname === '/admin/check' && request.method === 'POST') return json(await check(env));
    if (url.pathname === '/admin/test' && request.method === 'POST') return json(await selftest(env));
    return json({ error: 'not found' }, 404);
  },
};
