'use strict';

// Read-only observer. It never calls game controls or consumes Telegram updates.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const MIN = 60_000;
const HOUR = 60 * MIN;
const num = (v) => {
  if (v == null || v === '') return null;
  const match = String(v).replaceAll(',', '').match(/\d+/);
  return match ? Number(match[0]) : null;
};

function readEnv(file) {
  const result = {};
  if (!fs.existsSync(file)) return result;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) result[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return result;
}

function normalize(agent) {
  const s = agent?.state;
  if (!s || !s.name || num(s.lv) == null) return null;
  // Existing perception can match old death messages in chat. Require current evidence.
  const reviveVisible = (agent.buttons || []).some((v) => /^(?:Revive Here|Back to Cathedral|Revive\b)/i.test(v));
  const dead = Boolean(s.dead && (s.hp?.[0] === 0 || reviveVisible));
  return {
    name: s.name, job: s.job, lv: num(s.lv), jl: num(s.jobLv),
    gold: num(s.gold), hp: s.hp, mp: s.mp, zone: s.zone, quest: s.quest,exp:s.exp,
    dead, disconnected: Boolean(s.disconnected || s.atCharSelect),
    auto: Boolean(s.autoQuestRunning), paused: Boolean(agent.paused),
    cycle: agent.cycle, brain: agent.brain || {},
  };
}

function statusText(s) {
  if (!s) return 'อ่านสถานะเกมไม่ได้ในขณะนี้';
  return `${s.name} · ${s.job || '?'} Lv ${s.lv} / Job ${s.jl ?? '?'}\n` +
    `Gold ${s.gold == null ? '?' : s.gold.toLocaleString('en-US')} · ${s.zone || '?'}\n` +
    `เควส: ${s.quest || 'ไม่พบข้อมูล'}`;
}

function levelRanking(agent, now = Date.now()) {
  const r = agent?.strategy?.rank;
  const name = agent?.state?.name;
  // Only a recent, explicitly selected level leaderboard for this character is evidence.
  if (!r || r.kind !== 'lv' || r.character !== name || !name ||
      !Number.isFinite(r.at) || now - r.at > 20 * MIN || r.at > now + MIN) return null;
  const own = (Array.isArray(r.rows) ? r.rows : []).filter(row => row.own === true);
  if (own.length !== 1) return null;
  const lines = String(own[0].text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (lines[1] !== name) return null;
  const rank = ({ '🥇': 1, '🥈': 2, '🥉': 3 })[lines[0]] || (/^[1-9]\d*$/.test(lines[0]) ? Number(lines[0]) : null);
  if (!Number.isSafeInteger(rank) || rank < 1) return null;
  return { name, rank, at: r.at };
}

class AlertEngine {
  constructor(saved = {}, now = Date.now()) {
    this.db = { version: 1, incidents: {}, pending: [], sequence: 0,
      lastSummary: now, summaryBase: null, deaths: [], goldSamples: [], ...saved };
  }
  enqueue(key, text, critical = false, incident = null) {
    if (this.db.pending.some((e) => e.key === key)) return;
    if (this.db.pending.length >= 80) this.db.pending.shift();
    this.db.pending.push({ id: ++this.db.sequence, key, text, critical, incident });
  }
  condition(key, active, now, delay, text, critical = false, recovery = true) {
    let issue = this.db.incidents[key];
    if (!active) {
      if (issue) {
        this.db.pending = this.db.pending.filter((e) => e.incident !== key);
        if (issue.delivered && recovery) this.enqueue(`recovered:${key}`, `✅ กลับมาปกติ: ${issue.title}`);
        delete this.db.incidents[key];
      }
      return;
    }
    if (!issue) issue = this.db.incidents[key] = { since: now, title: text, queued: false, delivered: false };
    if (!issue.queued && now - issue.since >= delay) {
      this.enqueue(`incident:${key}`, text, critical, key);
      issue.queued = true;
    }
  }
  acknowledge(events) {
    const ids = new Set(events.map((e) => e.id));
    for (const e of events) {
      if (e.incident && this.db.incidents[e.incident]) this.db.incidents[e.incident].delivered = true;
    }
    this.db.pending = this.db.pending.filter((e) => !ids.has(e.id));
  }
  observeRanking(agent, now) {
    const r = levelRanking(agent, now);
    if (!r) return;
    const previous = this.db.levelRanking;
    if (previous?.name === r.name && r.at <= previous.at) return;
    if (!previous || previous.name !== r.name) {
      if (r.rank <= 10) this.enqueue(`rank:${r.name}:${r.at}`, `🏆 ยืนยันติด Top 10 ด้านเลเวลแล้ว!\n${r.name} อันดับ ${r.rank}`);
    } else if (r.rank < previous.rank) {
      const enteredTop10 = previous.rank > 10 && r.rank <= 10;
      this.enqueue(`rank:${r.name}:${r.at}`, `${enteredTop10 ? '🏆 ติด Top 10 ด้านเลเวลแล้ว!' : '📈 อันดับด้านเลเวลดีขึ้น!'}\n` +
        `${r.name}: อันดับ ${previous.rank} → ${r.rank}${r.rank <= 10 && !enteredTop10 ? ' · อยู่ใน Top 10' : ''}`);
    }
    // Declines update the baseline silently, so a later genuine recovery can be reported.
    this.db.levelRanking = r;
  }
  observeAutonomy(agent) {
    const a=agent?.strategy?.autonomy;if(!a)return;
    const d=this.db;d.autonomySeen ||= {};
    const character=agent.state?.name||agent.strategy?.uiHealth?.character;if(!character)return;
    const cursor=d.autonomySeen[character]||0;
    const types={
      position_invalid:()=>`⚠️ ตำแหน่งตัวละครอยู่นอกขอบแผนที่ต่อเนื่อง กำลังกู้ด้วยการโหลดหน้าเกมใหม่`,
      position_recovered:()=>`✅ โหลดเกมใหม่และตรวจพบตำแหน่งกลับเข้าแผนที่แล้ว กลับมาเล่นต่อ`,
      ui_changed:e=>`⚠️ UI Structure Changed: เข้าสู่ Safe Idle หยุดคำสั่งใช้ทรัพยากร คงการฟาร์มเดิมที่เกมกำลังรัน · อ่านไม่ได้: ${(e.missing||[]).join(', ')}`,
      ui_recovered:()=>`✅ อ่าน UI ได้ครบตามเกณฑ์ต่อเนื่องแล้ว กลับมาควบคุมเกมอัตโนมัติ`,
      cbt_claimed:e=>`🎁 รับของขวัญ CBT สำเร็จ: +${e.crystals} คริสตัล · ${e.vip||'ตรวจ VIP จากเกม'}`,
      cap_expanded:e=>`🚀 ตรวจพบเพดานเลเวลใหม่ ${e.from} → ${e.to} กำลังกลับเข้าสู่ลูปพัฒนา`,
      catalog_changed:e=>`🔄 ข้อมูลเกมเปลี่ยน กำลังวิเคราะห์สูตรใหม่ · Lv cap ${e.levelCap??'?'} / refine +${e.refineMax}`,
      gear_crafted:e=>`⚒ ${e.kind==='upgrade'?'อัปขั้น':'คราฟต์'} ${e.name} สำเร็จ${e.topTier?' · เทียร์สูงสุดที่พบในข้อมูลแพตช์':''}`,
      refine_max:e=>`✨ ${e.name} ตีบวกถึง +${e.cap} ตามเพดานปัจจุบันแล้ว`,
      capacity_bought:e=>`🎒 เพิ่มช่อง ${e.id} สำเร็จ ใช้ ${e.cost} คริสตัล`,
    };
    for(const e of (a.events||[]).filter(e=>Number.isSafeInteger(e.id)&&e.id>cursor).sort((x,y)=>x.id-y.id)) {
      if(types[e.type])this.enqueue(`autonomy:${character}:${e.id}`,types[e.type](e.detail||{}));
      d.autonomySeen[character]=e.id;
    }
  }
  observe(sample, now = Date.now()) {
    const d = this.db;
    // Schema incidents must still reach Telegram when the HUD name cannot be read.
    this.observeAutonomy(sample.agent);
    const s = normalize(sample.agent);
    this.condition('agent', !s, now, 90_000, '🚨 อ่านสถานะบอต/เกมไม่ได้เกิน 90 วินาที', true);
    if (sample.supervisorOk != null) this.condition('supervisor', !sample.supervisorOk, now, 90_000,
      '🚨 ตัวดูแลเกมไม่ตอบเกิน 90 วินาที', true);
    if (sample.viewerOk != null) this.condition('viewer', !sample.viewerOk, now, 90_000,
      '⚠️ หน้า Live Viewer ไม่ตอบเกิน 90 วินาที');
    if (!s) return null;
    const last = d.last;
    // Do not credit time during an observation outage toward a gameplay stall.
    if (!last || now - (d.observedAt || 0) > 2 * MIN) {
      d.progressAt = now; d.cycleAt = now; d.llmFailureAt = null;
    }
    d.observedAt = now;
    this.condition('disconnect', s.disconnected, now, 90_000,
      '🚨 เกมหลุด/ค้างหน้าเลือกตัวละครเกิน 90 วินาที', true);
    this.condition('paused', s.paused, now, 2 * MIN, '⚠️ AI ถูกพักเกิน 2 นาที');
    this.condition('dead', s.dead, now, 90_000, '🚨 ตัวละครล้มและยังฟื้นไม่ได้เกิน 90 วินาที', true);
    const autonomous=sample.agent?.strategy?.autonomy;
    const managed=Boolean(autonomous?.trip||autonomous?.farm||autonomous?.resume||sample.agent?.strategy?.uiHealth?.safeIdle||sample.agent?.strategy?.gameTelemetry?.positionFault||sample.agent?.availability?.status==='down');
    this.condition('auto', !s.auto && !managed && !s.disconnected && !s.dead && !s.paused, now, 2 * MIN,
      '⚠️ Auto Quest หยุดเกิน 2 นาที');
    if (s.dead && !last?.dead) d.deaths.push(now);
    d.deaths = d.deaths.filter((t) => t >= now - 10 * MIN);
    this.condition('deaths', d.deaths.length >= 3, now, 0,
      '🚨 พบการล้มอย่างน้อย 3 ครั้งใน 10 นาที ควรตรวจพื้นที่ฟาร์มและยาฟื้นฟู', true);
    if (!last || s.cycle !== last.cycle || s.paused) d.cycleAt = now;
    this.condition('cycle', !s.paused && now - d.cycleAt >= 15 * MIN, now, 0,
      '🚨 AI ไม่จบรอบการทำงานใหม่เกิน 15 นาที', true);
    const b = s.brain;
    const restarted = last && (s.cycle < last.cycle || b.llmOk < last.brain.llmOk || b.llmFail < last.brain.llmFail);
    if (restarted || (last && b.llmOk > last.brain.llmOk)) d.llmFailureAt = null;
    if ((!last && b.llmFail > 0 && b.llmDownUntil > now) || (last && b.llmFail > last.brain.llmFail)) {
      d.llmFailureAt ??= now;
    }
    // brain.ready means retry is allowed, not that a model call succeeded.
    this.condition('llm', d.llmFailureAt != null && now - d.llmFailureAt >= 5 * MIN,
      now, 0, '⚠️ LLM เรียกใช้งานไม่สำเร็จต่อเนื่องเกิน 5 นาที บอตอาจใช้ policy สำรอง');
    const previousJob = d.lastKnownJob || last?.job;
    if (s.job === 'Starweaver') {
      d.starweaverMilestones ||= {};
      if (!d.starweaverMilestones[s.name]) {
        this.enqueue('job:Starweaver', `🎉 เปลี่ยนเป็น Starweaver สำเร็จแล้ว!\n${s.name} · Lv ${s.lv} / Job ${s.jl ?? '?'}`);
        d.starweaverMilestones[s.name] = true;
      }
    } else if (s.job && previousJob && s.job !== previousJob) {
      this.enqueue(`job:${s.job}`, `🎉 เปลี่ยนอาชีพสำเร็จ: ${previousJob} → ${s.job}`);
    }
    if (s.job) d.lastKnownJob = s.job;
    this.observeRanking(sample.agent, now);
    this.condition('autonomy-blocked',Boolean(autonomous?.blocked),now,5*MIN,`⚠️ งานอัตโนมัติต้องตรวจเพิ่ม: ${autonomous?.blocked||''}`);
    if (last && !restarted) {
      if (s.lv > last.lv && Math.floor(s.lv / 5) > Math.floor(last.lv / 5)) {
        this.enqueue(`level:${Math.floor(s.lv / 5)}`, `🎉 ถึง Lv ${s.lv} แล้ว`);
      }
    }
    const cap = autonomous?.cap?.jobCap ?? { Novice: 10, Mage: 40, Starweaver: 50 }[s.job];
    this.condition('jobcap', Boolean(cap && s.jl >= cap), now, 0,
      `✨ ${s.job} Job ${s.jl}: ถึงเกณฑ์เปลี่ยนอาชีพแล้ว`, false, false);
    if (!last || s.lv !== last.lv || s.jl !== last.jl || s.job !== last.job || s.exp!==last.exp ||
        (s.quest && s.quest !== last.quest) || s.disconnected || s.paused) d.progressAt = now;
    this.condition('stall', !managed && !s.disconnected && !s.paused && now - d.progressAt >= 30 * MIN,
      now, 0, '⚠️ เลเวล/Job/ความคืบหน้าเควสไม่เปลี่ยนเกิน 30 นาที');
    if (s.gold != null) {
      // Hysteresis prevents repeated alerts around the low-gold threshold.
      this.condition('gold', s.gold < (d.incidents.gold ? 8000 : 3000), now, MIN,
        '⚠️ Gold ต่ำกว่า 3,000 ควรตรวจค่ายาและต้นทุนฟาร์ม');
      d.goldSamples.push({ t: now, value: s.gold });
      d.goldSamples = d.goldSamples.filter((v) => v.t >= now - 15 * MIN);
      const first = d.goldSamples[0];
      const drop = first && now - first.t >= 10 * MIN && first.value - s.gold >= Math.max(5000, first.value * 0.2);
      this.condition('gold-drop', Boolean(drop), now, MIN,
        '⚠️ Gold ลดอย่างน้อย 20% และ 5,000 ภายในช่วง 15 นาที อาจเป็นค่าใช้จ่ายหรือการซื้อของ');
    }
    d.summaryBase ||= { lv: s.lv, jl: s.jl, job: s.job, gold: s.gold };
    if (now - d.lastSummary >= 4 * HOUR) {
      const base = d.summaryBase;
      const gain = s.gold != null && base.gold != null ? s.gold - base.gold : null;
      this.enqueue('summary', `📊 สรุป 4 ชั่วโมง\nLv ${base.lv} → ${s.lv} · ${base.job} Job ${base.jl} → ${s.job} Job ${s.jl}\n` +
        `Gold เปลี่ยน ${gain == null ? '?' : (gain >= 0 ? '+' : '') + gain.toLocaleString('en-US')}`);
      d.lastSummary = now;
      d.summaryBase = { lv: s.lv, jl: s.jl, job: s.job, gold: s.gold };
    }
    d.last = s;
    return s;
  }
}

function quietHours(now = Date.now()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hourCycle: 'h23' }).format(now));
  return hour >= 23 || hour < 8;
}

async function telegram(token, method, body) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw Object.assign(new Error('Telegram network/timeout error'), { retryMs: MIN });
  }
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`Telegram HTTP ${response.status}`); }
  if (!response.ok || !payload.ok) {
    throw Object.assign(new Error(`Telegram API error ${payload.error_code || response.status}`), {
      retryMs: (Number(payload.parameters?.retry_after) || 60) * 1000,
    });
  }
  return payload.result;
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('Upstream unavailable');
  return response.json();
}

async function collect() {
  const settled = await Promise.allSettled([
    getJson('http://127.0.0.1:4801/state'),
    getJson('http://127.0.0.1:4800/state'),
    fetch('http://127.0.0.1:8080/', { signal: AbortSignal.timeout(5000) }),
  ]);
  return {
    agent: settled[0].status === 'fulfilled' ? settled[0].value : null,
    supervisorOk: settled[1].status === 'fulfilled' && Boolean(settled[1].value?.state?.name),
    viewerOk: settled[2].status === 'fulfilled' && [200, 401].includes(settled[2].value.status),
  };
}

function save(file, db) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(db), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

async function main() {
  const dir = process.env.SIGIL_DIR || __dirname;
  const stateFile = path.join(dir, 'telegram-alerts-state.json');
  let saved = {};
  if (fs.existsSync(stateFile)) saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const engine = new AlertEngine(saved);
  let validated = '', nextSendAt = 0, failures = 0;
  const health = { configured: false, validated: false, lastPoll: null, lastSent: null, lastMessageId: null, error: null };
  function config() {
    return { ...readEnv(path.join(dir, '.env')), ...readEnv(path.join(dir, 'telegram.env')), ...process.env };
  }
  function viewerLink() {
    // A clean authenticated viewer URL can be supplied privately. No access token in notifications.
    const value = config().VIEWER_PUBLIC_URL;
    if (!value) return null;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
      return url.href;
    } catch { return null; }
  }
  async function tick(checkOnly = false) {
    const cfg = config();
    const token = cfg.TELEGRAM_BOT_TOKEN, chat = cfg.TELEGRAM_CHAT_ID;
    health.configured = Boolean(token && chat);
    if (!health.configured) { health.error = 'Missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID'; return; }
    const fingerprint = crypto.createHash('sha256').update(`${token}:${chat}`).digest('hex');
    if (validated !== fingerprint && Date.now() < nextSendAt && !checkOnly) return;
    if (validated !== fingerprint) {
      health.validated = false;
      const me = await telegram(token, 'getMe', {});
      const recipient = await telegram(token, 'getChat', { chat_id: chat });
      if (recipient.type !== 'private') throw new Error('Recipient must be a private Telegram chat');
      validated = fingerprint;
      health.validated = true;
      health.bot = me.username;
      health.error = null;
    }
    const sample = await collect();
    const current = engine.observe(sample);
    health.lastPoll = new Date().toISOString();
    health.gameReadable = Boolean(current);
    health.levelRanking = engine.db.levelRanking || null;
    health.starweaverNotified = Boolean(current && engine.db.starweaverMilestones?.[current.name]);
    if (checkOnly) { console.log(JSON.stringify({ ...health, pending: engine.db.pending.length })); return; }
    if (engine.db.welcomed !== fingerprint) {
      // A changed recipient must never inherit queued messages from the previous chat.
      if (engine.db.welcomed) engine.db.pending = [];
      engine.enqueue('welcome', '✅ Sigil เปิดแจ้งเตือนแล้ว\nปัญหาค้าง / เปลี่ยนอาชีพ / Lv ทุก 5 เลเวล / สรุปทุก 4 ชั่วโมง\n23:00–08:00 เวลาไทย: เฉพาะเรื่องเร่งด่วนมีเสียง');
    }
    save(stateFile, engine.db);
    if (Date.now() < nextSendAt) return;
    const events = [...engine.db.pending].sort((a, b) => Number(b.critical) - Number(a.critical)).slice(0, 4);
    if (!events.length) return;
    const urgent = events.some((e) => e.critical);
    const timestamp = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }).format(new Date());
    const body = {
      chat_id: chat,
      text: (events.map((e) => e.text).join('\n\n') + '\n\n' + statusText(current) + `\n🕒 ${timestamp} (ไทย)`).slice(0, 3900),
      disable_notification: !urgent && (quietHours() || events.every((e) => e.key === 'summary' || e.key.startsWith('recovered:'))),
      link_preview_options: { is_disabled: true }, protect_content: true,
    };
    const link = viewerLink();
    if (link) body.reply_markup = { inline_keyboard: [[{ text: 'ดูสด · อ่านอย่างเดียว', url: link }]] };
    const sent = await telegram(token, 'sendMessage', body);
    engine.acknowledge(events);
    if (events.some((e) => e.key === 'welcome')) engine.db.welcomed = fingerprint;
    save(stateFile, engine.db);
    failures = 0; nextSendAt = 0; health.error = null;
    health.lastSent = new Date().toISOString(); health.lastMessageId = sent.message_id;
    console.log(`${health.lastSent} Telegram delivered ${events.map((e) => e.key).join(',')} message_id=${sent.message_id}`);
  }
  async function guardedTick() {
    try { await tick(); }
    catch (error) {
      failures++;
      nextSendAt = Date.now() + Math.max(error.retryMs || 0, Math.min(15 * MIN, 30_000 * 2 ** Math.min(failures, 5)));
      health.error = error.message;
      console.error(`${new Date().toISOString()} ${error.message}; retry delayed`);
    }
  }
  if (process.argv.includes('--check')) { await tick(true); return; }
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/health') { res.writeHead(404); return res.end(); }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ...health, pending: engine.db.pending.length }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4802, '127.0.0.1', resolve); });
  console.log(`${new Date().toISOString()} read-only Telegram observer started`);
  async function loop() { await guardedTick(); setTimeout(loop, 30_000); }
  await loop();
}

module.exports = { AlertEngine, normalize, statusText, quietHours, readEnv, telegram, levelRanking };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
