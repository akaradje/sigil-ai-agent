/**
 * Sigil live viewer — read-only window into the bot.
 *
 * Serves one HTML page that shows the game screen, the character state and the AI's log.
 * There is deliberately no endpoint that can act: the only routes are GETs that proxy read-only
 * data from the harness (:4799) and the agent (:4801). Access needs a token so the URL is not public.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const HARNESS = process.env.HARNESS || 'http://127.0.0.1:4799';
const AGENT = process.env.AGENT_URL || 'http://127.0.0.1:4801';
const DIR = process.env.AGENT_DIR || __dirname;
const PORT = Number(process.env.VIEWER_PORT || 8080);
const TOKEN_FILE = path.join(DIR, 'viewer-token.txt');
const TOKEN = (process.env.VIEWER_TOKEN || (fs.existsSync(TOKEN_FILE) ? fs.readFileSync(TOKEN_FILE, 'utf8') : '')).trim();
if (!TOKEN || TOKEN.length < (process.env.VIEWER_ALLOW_LEGACY_TOKEN==='1'?16:24)) throw new Error('Set VIEWER_TOKEN (at least 24 characters) before starting the viewer');

function proxy(base, p, res, type) {
  http.get(base + p, { timeout: 25000 }, (r) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => {
      const body = Buffer.concat(chunks);
      res.writeHead(r.statusCode === 200 ? 200 : 502, {
        'content-type': type,
        'cache-control': 'no-store',
        'content-length': body.length,
      });
      res.end(body);
    });
  }).on('error', (e) => {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('upstream error: ' + e.message);
  });
}

const PAGE = `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ExampleHero · live</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#0b0d12; color:#e8ecf4;
         font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Thai",sans-serif; }
  header { display:flex; align-items:center; gap:12px; padding:10px 16px;
           border-bottom:1px solid #1d2230; background:#0f131b; position:sticky; top:0; z-index:5; }
  header b { font-size:15px; letter-spacing:.2px; }
  .dot { width:8px; height:8px; border-radius:50%; background:#3ddc84; box-shadow:0 0 8px #3ddc84; }
  .dot.off { background:#ff5c5c; box-shadow:0 0 8px #ff5c5c; }
  main { display:grid; grid-template-columns: minmax(0,1.55fr) minmax(320px,1fr); gap:14px; padding:14px; }
  @media (max-width: 980px) { main { grid-template-columns: 1fr; } }
  .card { background:#111621; border:1px solid #1d2230; border-radius:12px; overflow:hidden; }
  .card h2 { margin:0; padding:9px 12px; font-size:12px; font-weight:600; letter-spacing:.6px;
             text-transform:uppercase; color:#8b97ad; border-bottom:1px solid #1d2230; background:#0f131b; }
  #shot { display:block; width:100%; height:auto; background:#000; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:1px; background:#1d2230; }
  .cell { background:#111621; padding:10px 12px; }
  .cell .k { font-size:11px; color:#7d8aa0; text-transform:uppercase; letter-spacing:.5px; }
  .cell .v { font-size:17px; font-weight:650; margin-top:2px; }
  .bar { height:6px; background:#1b2130; border-radius:4px; overflow:hidden; margin-top:6px; }
  .bar > i { display:block; height:100%; }
  .hp > i { background:linear-gradient(90deg,#ff6b6b,#ff9f43); }
  .mp > i { background:linear-gradient(90deg,#4dabf7,#845ef7); }
  pre { margin:0; padding:10px 12px; font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;
        color:#a9b6cc; max-height:300px; overflow:auto; white-space:pre-wrap; word-break:break-word; }
  .badge { font-size:11px; padding:2px 8px; border-radius:999px; background:#1b2436; color:#9fb0c9; }
  .badge.llm { background:#12301f; color:#5be49b; }
  .badge.policy { background:#33260f; color:#ffc46b; }
  footer { padding:10px 16px 24px; color:#5d6879; font-size:12px; }
</style></head>
<body>
<header>
  <span class="dot" id="dot"></span>
  <b id="character">Sigil · live</b>
  <span class="badge" id="brain">…</span>
  <span class="badge" id="age">–</span>
  <span style="margin-left:auto;color:#5d6879;font-size:12px">read-only</span>
</header>
<main>
  <div class="card">
    <h2>หน้าจอเกม · สด</h2>
    <img id="shot" alt="game screen" src="/shot.jpg">
  </div>
  <div style="display:flex;flex-direction:column;gap:14px;min-width:0">
    <div class="card">
      <h2>สถานะตัวละคร</h2>
      <div class="grid">
        <div class="cell"><div class="k">Level</div><div class="v" id="lv">–</div></div>
        <div class="cell"><div class="k">Job</div><div class="v" id="jl">–</div></div>
        <div class="cell"><div class="k">HP</div><div class="v" id="hp">–</div>
          <div class="bar hp"><i id="hpb" style="width:0%"></i></div></div>
        <div class="cell"><div class="k">MP</div><div class="v" id="mp">–</div>
          <div class="bar mp"><i id="mpb" style="width:0%"></i></div></div>
        <div class="cell"><div class="k">Gold</div><div class="v" id="gold">–</div></div>
        <div class="cell"><div class="k">Zone</div><div class="v" id="zone" style="font-size:14px">–</div></div>
        <div class="cell"><div class="k">Crystals</div><div class="v" id="crystals">–</div></div>
        <div class="cell"><div class="k">Inventory</div><div class="v" id="bag">–</div></div>
        <div class="cell"><div class="k">Autonomous mode</div><div class="v" id="mode" style="font-size:14px">–</div></div>
        <div class="cell"><div class="k">Level / refine cap</div><div class="v" id="cap">–</div></div>
        <div class="cell"><div class="k">Measured EXP / min</div><div class="v" id="expRate">–</div></div>
        <div class="cell"><div class="k">Crystal budget used / reserved</div><div class="v" id="budget">–</div></div>
        <div class="cell" style="grid-column:1/-1"><div class="k">Craft materials</div><div class="v" id="craft" style="font-size:14px">–</div><div class="bar mp"><i id="craftbar" style="width:0%"></i></div><pre id="materials"></pre></div>
        <div class="cell" style="grid-column:1/-1"><div class="k">Quest</div>
          <div class="v" id="quest" style="font-size:14px">–</div></div>
      </div>
    </div>
    <div class="card">
      <h2>AI กำลังคิดอะไร</h2>
      <pre id="log">…</pre>
    </div>
    <div class="card">
      <h2>บันทึกของ AI (diary)</h2>
      <pre id="diary">…</pre>
    </div>
  </div>
</main>
<footer>หน้านี้อ่านอย่างเดียว — ไม่มีปุ่มสั่งการใด ๆ · ภาพรีเฟรชทุก 1.2 วินาที</footer>
<script>
const $ = (id) => document.getElementById(id);
let lastShot = 0, fails = 0;

async function tickShot() {
  const img = $('shot');
  const url = '/shot.jpg?t=' + Date.now();
  const probe = new Image();
  probe.onload = () => {
    img.src = url;
    fails = 0;
    $('dot').classList.remove('off');
    $('age').textContent = 'อัปเดต ' + new Date().toLocaleTimeString('th-TH');
  };
  probe.onerror = () => {
    fails++;
    if (fails > 2) $('dot').classList.add('off');
  };
  probe.src = url;
}

async function tickState() {
  try {
    const r = await fetch('/state.json?t=' + Date.now());
    const j = await r.json();
    const s = j.state || {};
    const b = j.brain || {};
    const a=j.strategy?.autonomy||{};
    $('character').textContent=s.name||'Sigil · live';
    $('crystals').textContent=s.crystals??'–';
    $('bag').textContent=a.bagUsage?a.bagUsage.join(' / '):'ยังไม่ตรวจ';
    $('mode').textContent=j.availability?.status==='down'?'พักรอเซิร์ฟเวอร์':a.mode||'ยังไม่เปิด autonomy';
    $('cap').textContent=(a.cap?.level??'?')+' / +'+(a.catalog?.refineMax??'?');
    $('expRate').textContent=a.expPerMinute??'กำลังวัด';
    $('budget').textContent=(a.premium?.spent||0)+' / '+(a.premium?.reserved||0);
    $('craft').textContent=a.goal?a.goal.name+' · '+(a.craftProgress??0)+'% ของวัตถุดิบ':a.gearCapped?'อุปกรณ์ถึงเพดานที่ตรวจแล้ว':'ยังไม่มีสูตรเป้าหมาย';
    $('craftbar').style.width=Math.max(0,Math.min(100,a.craftProgress||0))+'%';
    $('materials').textContent=(a.goal?.missing||[]).map(m=>m.id+': '+m.have+'/'+m.need).join('\\n')+(a.blocked?'\\n'+a.blocked:'');
    $('lv').textContent = s.lv || '–';
    $('jl').textContent = s.jobLv || '–';
    $('hp').textContent = s.hp ? s.hp[0] + ' / ' + s.hp[1] : '–';
    $('mp').textContent = s.mp ? s.mp[0] + ' / ' + s.mp[1] : '–';
    if (s.hp && s.hp[1]) $('hpb').style.width = Math.max(0, Math.min(100, s.hp[0] / s.hp[1] * 100)) + '%';
    if (s.mp && s.mp[1]) $('mpb').style.width = Math.max(0, Math.min(100, s.mp[0] / s.mp[1] * 100)) + '%';
    $('gold').textContent = s.gold ? '◆ ' + s.gold : '–';
    $('zone').textContent = s.zone || '–';
    $('quest').textContent = s.quest || '–';
    const el = $('brain');
    if (b.ready) { el.textContent = 'LLM'; el.className = 'badge llm'; }
    else { el.textContent = 'policy (LLM รอ)'; el.className = 'badge policy'; }
  } catch (e) { /* keep last */ }
}

async function tickText() {
  try {
    const [l, d] = await Promise.all([
      fetch('/log.txt?t=' + Date.now()).then((x) => x.text()),
      fetch('/diary.txt?t=' + Date.now()).then((x) => x.text()),
    ]);
    $('log').textContent = l.split('\\n').slice(-14).join('\\n');
    $('diary').textContent = d.split('\\n').slice(-12).join('\\n');
  } catch (e) { /* ignore */ }
}

tickShot(); tickState(); tickText();
setInterval(tickShot, 1200);
setInterval(tickState, 3000);
setInterval(tickText, 5000);
</script>
</body></html>`;

function authed(req, url) {
  if (!TOKEN) return false;
  const q = url.searchParams.get('k');
  if (q === TOKEN) return true;
  const cookie = req.headers.cookie || '';
  return cookie.split(';').some((c) => c.trim() === 'v=' + TOKEN);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.writeHead(405); return res.end('method not allowed'); }
  if (!authed(req, url)) {
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
    return res.end('<body style="font:16px sans-serif;padding:40px">ลิงก์ไม่ถูกต้อง — ต้องมี ?k=token</body>');
  }

  // remember the token so the sub-resources load without repeating it
  if (url.searchParams.get('k') === TOKEN) {
    res.setHeader('Set-Cookie', 'v=' + TOKEN + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800');
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(PAGE);
  }
  if (url.pathname === '/shot.jpg') return proxy(HARNESS, '/screenshot', res, 'image/jpeg');
  if (url.pathname === '/state.json') return proxy(AGENT, '/state', res, 'application/json');
  if (url.pathname === '/log.txt') {
    try {
      const t = fs.readFileSync(path.join(DIR, 'agent.log'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(t.split('\n').slice(-60).join('\n'));
    } catch { res.writeHead(200); return res.end(''); }
  }
  if (url.pathname === '/diary.txt') {
    try {
      const t = fs.readFileSync(path.join(DIR, 'agent-diary.md'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(t.split('\n').slice(-80).join('\n'));
    } catch { res.writeHead(200); return res.end(''); }
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}).listen(PORT, process.env.VIEWER_HOST || '127.0.0.1', () => console.log('viewer on ' + PORT));
