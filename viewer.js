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
if (require.main === module && (!TOKEN || TOKEN.length < (process.env.VIEWER_ALLOW_LEGACY_TOKEN==='1'?16:24))) throw new Error('Set VIEWER_TOKEN (at least 24 characters) before starting the viewer');

const DEPLOY_PHASES = new Set(['PREPARED','INSTALLING','STARTING','CANARY','COMMITTED','ROLLING_BACK','ROLLED_BACK','ROLLBACK_FAILED','SUPERSEDED']);
const REPAIR_PHASES = new Set(['REPAIRING','VERIFYING','READY_REVIEW','FAILED','INTERRUPTED','DEPLOYED','ROLLED_BACK']);
const EDITABLE = new Set(['game-intelligence.js','game-telemetry.js','ui-resilience.js']);
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x) ? x : null;
const jobId = x => typeof x === 'string' && /^[a-f0-9-]{36}$/.test(x) ? x : null;
const timestamp = x => Number.isSafeInteger(x) && x > 0 ? x : null;
const recent = (x, now, age) => timestamp(x) !== null && now - x >= -5000 && now - x < age;
const patchFiles = x => Array.isArray(x) ? [...new Set(x.filter(n => EDITABLE.has(n)))].slice(0, 3) : [];

// Read only the public projections, never private journals, patches or backups.
function readProjection(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const s = fs.fstatSync(fd);
    if (!s.isFile() || s.size > 256 * 1024) return null;
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } catch { return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function healingView(deployment, repair, health, now = Date.now()) {
  const d = deployment?.mode === 'automatic-deployment' && Array.isArray(deployment.events) && deployment.events.length <= 40 ? deployment : null;
  const r = repair?.version === 1 && Array.isArray(repair.events) && repair.events.length <= 40 ? repair : null;
  const phase = DEPLOY_PHASES.has(d?.phase) ? d.phase : null;
  const fresh = recent(d?.checkedAt, now, 45000);
  const running = digest(health?.buildId) && recent(health.updatedAt, now, 90000) && recent(health.observedAt, now, 30000);
  const a = d?.active;
  let kind = running ? 'observed' : 'unconfirmed';
  if (running && fresh && d?.phase == null && d?.active == null) kind = 'baseline';
  if (running && phase) {
    kind = !fresh ? 'unconfirmed' : phase === 'COMMITTED' && health.buildId === digest(a?.candidateBuild) ? 'patch' :
      phase === 'CANARY' && health.buildId === digest(a?.candidateBuild) ? 'canary' :
      phase === 'ROLLED_BACK' && health.buildId === digest(a?.beforeBuild) ? 'restored' : phase === 'SUPERSEDED' ? 'external' : 'unconfirmed';
  }
  const events = [];
  for (const [source, sourceEvents, allowed] of [['deployment', d?.events, DEPLOY_PHASES], ['repair', r?.events, REPAIR_PHASES]]) {
    for (const e of sourceEvents || []) {
      if (!e || !allowed.has(e.status) || !timestamp(e.at) || e.at > now + 5000 || !jobId(e.jobId) || !Number.isSafeInteger(e.id)) continue;
      events.push({source, id:e.id, jobId:e.jobId, status:e.status, at:e.at,
        beforeBuild:digest(e.beforeBuild), candidateBuild:digest(e.candidateBuild), files:patchFiles(e.files),
        reason:/^[A-Z][A-Z0-9_]{0,63}$/.test(e.reason || '') ? e.reason : null});
    }
  }
  events.sort((x, y) => y.at - x.at || y.id - x.id);
  const latestRepair = events.find(e => e.source === 'repair');
  const canary = phase === 'CANARY' && timestamp(a?.startedAt) && Number.isSafeInteger(a?.canaryMs) && a.canaryMs > 0 && a.canaryMs <= 3600000 ?
    {startedAt:a.startedAt, durationMs:a.canaryMs, elapsedMs:Math.max(0, now - a.startedAt)} : null;
  return {available:Boolean(d), fresh, checkedAt:timestamp(d?.checkedAt), mode:d ? 'automatic-deployment' : r?.mode === 'candidate-review' ? 'candidate-review' : null,
    phase, jobId:jobId(d?.jobId), latestRepair:latestRepair || null,
    current:{kind, buildId:running ? health.buildId : null, observedAt:running ? health.observedAt : null},
    candidateBuild:digest(a?.candidateBuild), files:patchFiles(a?.files), canary, events:events.slice(0, 30)};
}

async function healingStatus() {
  let health = null;
  try {
    const response = await fetch(AGENT + '/health', {signal:AbortSignal.timeout(1800)});
    if (response.ok) health = (await response.json()).selfHealing;
  } catch { /* The independent deployment journal remains useful when the agent is down. */ }
  return healingView(readProjection(process.env.SELF_HEAL_STATUS_FILE || '/run/sigil-self-healing/events.json'),
    readProjection(process.env.SELF_HEAL_REPAIR_FILE || '/run/sigil-self-healing/repair.json'), health);
}

const TEST_STAGES = new Set(['PREPARING','BASELINE','REPAIRING','VERIFYING','CANARY','COMMITTED','INJECTING_FAILURE','ROLLING_BACK','ROLLED_BACK','PASSED','FAILED']);
const TEST_CHECKS = ['baselineTests','candidateTests','canary','telegramCommit','guardRollback','telegramRollback','noDuplicateAlerts','productionUnchanged'];
function healingTestView(report, now = Date.now()) {
  if (report?.version !== 1 || report.kind !== 'isolated-e2e' || !jobId(report.runId) || !timestamp(report.startedAt)) return {available:false};
  const pipeline = healingView(report.deployment, report.repair, report.health, now);
  const notifications = (Array.isArray(report.notifications) ? report.notifications : []).filter(n =>
    ['COMMITTED','ROLLED_BACK'].includes(n?.status) && Number.isSafeInteger(n.messageId) && n.messageId > 0 && timestamp(n.at))
    .slice(-2).map(n => ({status:n.status, messageId:n.messageId, at:n.at}));
  const checks = TEST_CHECKS.map(name => ({name, status:['PASSED','FAILED'].includes(report.checks?.[name]) ? report.checks[name] : 'PENDING'}));
  const passed = report.stage === 'PASSED' && timestamp(report.finishedAt) && report.finishedAt >= report.startedAt && report.finishedAt <= now + 5000 && report.productionUnchanged === true &&
    Number.isFinite(report.canaryElapsedMs) && report.canaryElapsedMs >= 600000 &&
    checks.every(c => c.status === 'PASSED') && ['COMMITTED','ROLLED_BACK'].every(s => notifications.some(n => n.status === s)) &&
    new Set(notifications.map(n => n.messageId)).size === 2 && pipeline.phase === 'ROLLED_BACK' && digest(report.health?.buildId) === digest(report.deployment?.active?.beforeBuild) && digest(report.health?.buildId) !== null;
  return {available:true, runId:report.runId, startedAt:report.startedAt, finishedAt:timestamp(report.finishedAt),
    checkedAt:timestamp(report.checkedAt), fresh:recent(report.checkedAt, now, 45000),
    stage:passed ? 'PASSED' : report.stage === 'PASSED' ? 'INCOMPLETE' : TEST_STAGES.has(report.stage) ? report.stage : 'INCOMPLETE',
    productionUnchanged:report.productionUnchanged === true ? true : report.productionUnchanged === false ? false : null,
    checks, notifications, pipeline};
}

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
  .detail { margin-top:5px; font-size:12px; color:#a9b6cc; overflow-wrap:anywhere; }
  .bar { height:6px; background:#1b2130; border-radius:4px; overflow:hidden; margin-top:6px; }
  .bar > i { display:block; height:100%; }
  .hp > i { background:linear-gradient(90deg,#ff6b6b,#ff9f43); }
  .mp > i { background:linear-gradient(90deg,#4dabf7,#845ef7); }
  .exp > i { background:linear-gradient(90deg,#3ddc84,#a9e34b); }
  .job-exp > i { background:linear-gradient(90deg,#9775fa,#e599f7); }
  .exp-label { display:flex; justify-content:space-between; gap:8px; margin-top:8px; font-size:12px; color:#a9b6cc; }
  pre { margin:0; padding:10px 12px; font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;
        color:#a9b6cc; max-height:300px; overflow:auto; white-space:pre-wrap; word-break:break-word; }
  .badge { font-size:11px; padding:2px 8px; border-radius:999px; background:#1b2436; color:#9fb0c9; }
  .badge.llm { background:#12301f; color:#5be49b; }
  .badge.policy { background:#33260f; color:#ffc46b; }
  .healing-content { padding:12px; }
  .healing-head { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
  .healing-head b { font-size:16px; }
  .healing-meta { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:12px 0; }
  .healing-meta small { display:block; color:#7d8aa0; }
  .healing-meta code { overflow-wrap:anywhere; color:#b9c9e5; }
  #healingHistory { list-style:none; margin:8px 0 0; padding:0; max-height:260px; overflow:auto; }
  #healingHistory li { border-top:1px solid #1d2230; padding:8px 0; overflow-wrap:anywhere; }
  #healingHistory time { font-size:11px; color:#7d8aa0; display:block; }
  #healingHistory .detail { margin-top:2px; }
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
  <div style="display:flex;flex-direction:column;gap:14px;min-width:0;align-self:start">
  <div class="card">
    <h2>หน้าจอเกม · สด</h2>
    <img id="shot" alt="game screen" src="/shot.jpg">
  </div>
  <section class="card" aria-label="Self-Healing">
    <h2>Self-Healing · อัปเดตและ rollback</h2>
    <div class="healing-content">
      <div class="healing-head"><b id="healingState" role="status">กำลังอ่านสถานะ</b><span class="badge" id="healingMode">–</span></div>
      <div class="detail" id="healingFreshness">รอข้อมูลตัวตรวจ</div>
      <div class="healing-meta">
        <div><small>เวอร์ชันที่กำลังรัน · Build SHA</small><code id="healingBuild">–</code><div class="detail" id="healingPatch">ยังยืนยันไม่ได้</div></div>
        <div><small>งานแพตช์ล่าสุด</small><code id="healingJob">–</code><div class="detail" id="healingFiles">–</div></div>
      </div>
      <div id="healingCanary" hidden><div class="detail" id="healingCanaryText"></div><div class="bar mp" id="healingCanaryProgress" role="progressbar" aria-label="ทดสอบแพตช์ขณะรันจริง" aria-valuemin="0" aria-valuemax="100"><i id="healingCanaryBar" style="width:0%"></i></div></div>
      <div class="detail" id="healingRepair">–</div>
      <div class="detail">ประวัติล่าสุด · เวลาไทย</div>
      <ol id="healingHistory"><li class="detail">กำลังอ่านประวัติ</li></ol>
    </div>
  </section>
  <section class="card" id="healingTest" aria-label="ทดสอบ Self-Healing แบบแยก" hidden>
    <h2>ทดสอบระบบ · เอเจนต์จำลองแยกจากตัวละครจริง</h2>
    <div class="healing-content">
      <div class="healing-head"><b id="healingTestState" role="status">กำลังอ่านผลทดสอบ</b><span class="badge policy">ISOLATED TEST</span></div>
      <div class="detail">ผลด้านล่างเป็นการทดสอบบนสำเนาโค้ดและ process จำลอง ไม่ใช่การเปลี่ยนแพตช์ของตัวละคร</div>
      <div class="detail" id="healingTestRun"></div>
      <div class="detail" id="healingTestLive"></div>
      <div class="detail" id="healingTestProgress"></div>
      <div class="bar mp" id="healingTestBar" role="progressbar" aria-label="Canary ของเอเจนต์จำลอง" aria-valuemin="0" aria-valuemax="100" hidden><i id="healingTestFill" style="width:0%"></i></div>
      <div class="detail" id="healingTestChecks"></div>
      <div class="detail" id="healingTestTelegram"></div>
      <ol id="healingTestHistory" style="list-style:none;padding:0;margin:10px 0 0;max-height:220px;overflow:auto"></ol>
    </div>
  </section>
  </div>
  <div style="display:flex;flex-direction:column;gap:14px;min-width:0">
    <div class="card">
      <h2>สถานะตัวละคร</h2>
      <div class="grid">
        <div class="cell"><div class="k">Level</div><div class="v" id="lv">–</div>
          <div class="exp-label"><span>EXP</span><span id="expPercent">–</span></div>
          <div class="bar exp" id="expProgress" role="progressbar" aria-label="Level EXP" aria-valuemin="0" aria-valuemax="100" aria-valuetext="ยังไม่มีข้อมูล"><i id="expb" style="width:0%"></i></div></div>
        <div class="cell"><div class="k">Job</div><div class="v" id="jl">–</div>
          <div class="exp-label"><span>Job EXP</span><span id="jobExpPercent">–</span></div>
          <div class="bar job-exp" id="jobExpProgress" role="progressbar" aria-label="Job EXP" aria-valuemin="0" aria-valuemax="100" aria-valuetext="ยังไม่มีข้อมูล"><i id="jobExpb" style="width:0%"></i></div></div>
        <div class="cell"><div class="k">HP</div><div class="v" id="hp">–</div>
          <div class="bar hp"><i id="hpb" style="width:0%"></i></div></div>
        <div class="cell"><div class="k">MP</div><div class="v" id="mp">–</div>
          <div class="bar mp"><i id="mpb" style="width:0%"></i></div></div>
        <div class="cell"><div class="k">อันดับปัจจุบัน · เลเวล</div><div class="v" id="currentRank">–</div><div class="detail" id="rankAge">รอตารางอันดับสด</div></div>
        <div class="cell"><div class="k">ระยะห่างจาก Top 10</div><div class="v" id="top10Gap">–</div><div class="detail" id="top10ExpGap">รอตารางอันดับสด</div></div>
        <div class="cell"><div class="k">Gold</div><div class="v" id="gold">–</div></div>
        <div class="cell"><div class="k">Zone</div><div class="v" id="zone" style="font-size:14px">–</div></div>
        <div class="cell"><div class="k">Crystals</div><div class="v" id="crystals">–</div></div>
        <div class="cell"><div class="k">Inventory</div><div class="v" id="bag">–</div></div>
        <div class="cell"><div class="k">Autonomous mode</div><div class="v" id="mode" style="font-size:14px">–</div></div>
        <div class="cell"><div class="k">Level / refine cap</div><div class="v" id="cap">–</div></div>
        <div class="cell"><div class="k">Measured EXP / min</div><div class="v" id="expRate">–</div></div>
        <div class="cell"><div class="k">Estimated target bar time / samples</div><div class="v" id="ttk">–</div></div>
        <div class="cell"><div class="k">Resource hold</div><div class="v" id="resourceHold" style="font-size:14px">–</div></div>
        <div class="cell"><div class="k">Top 10 cutoff / trend</div><div class="v" id="catchup" style="font-size:14px">–</div></div>
        <div class="cell"><div class="k">ETA range · conditional estimate</div><div class="v" id="eta" style="font-size:14px">–</div></div>
        <div class="cell"><div class="k">Browser session age</div><div class="v" id="sessionAge" style="font-size:14px">–</div></div>
        <div class="cell" style="grid-column:1/-1"><div class="k">Strategy DNA</div><div class="v" id="dna" style="font-size:14px">–</div><pre id="dnaGenes"></pre></div>
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

function renderExp(value, text, labelId, barId, progressId) {
  const capped = String(text || '').toUpperCase().includes('MAX');
  const percent = capped ? 100 : Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  const label = capped ? 'MAX' : percent === null ? '–' : percent.toFixed(1) + '%';
  $(labelId).textContent = label;
  $(barId).style.width = (percent ?? 0) + '%';
  const progress = $(progressId);
  progress.setAttribute('aria-valuetext', percent === null ? 'ยังไม่มีข้อมูล' : label);
  if (percent === null) progress.removeAttribute('aria-valuenow');
  else progress.setAttribute('aria-valuenow', String(percent));
}

function renderRanking(c, levelText) {
  const ranked = Number.isInteger(c?.rank) && c.rank > 0;
  const age = Number.isFinite(c?.rankAt) && c.rankAt > 0 ? Date.now() - c.rankAt : null;
  const fresh = age !== null && age >= -60000 && age < 20 * 60000;
  $('currentRank').textContent = ranked ? '#' + c.rank + (fresh ? '' : ' (ล่าสุด)') : '–';
  $('rankAge').textContent = !ranked || age === null ? 'รอตารางอันดับสด' :
    (fresh ? 'อัปเดต ' : 'ข้อมูลเก่า · ') + Math.max(0, Math.floor(age / 60000)) + ' นาทีที่แล้ว';
  $('top10Gap').textContent = '–';
  $('top10ExpGap').textContent = 'รอตารางอันดับสด';
  if (!ranked || !fresh) return;
  if (c.rank <= 10) {
    $('top10Gap').textContent = 'อยู่ใน Top 10 แล้ว';
    $('top10ExpGap').textContent = 'อันดับ #' + c.rank;
    return;
  }
  const ownLevel = Number(String(levelText || '').match(/[0-9]+/)?.[0]);
  const levels = Number.isInteger(c.cutoff?.level) && ownLevel > 0 ? Math.max(0, c.cutoff.level - ownLevel) : null;
  $('top10Gap').textContent = 'อีก ' + (c.rank - 10) + ' อันดับ' + (levels > 0 ? ' · ' + levels + ' เลเวล' : '');
  const gap = c.gapExp;
  if (Array.isArray(gap) && gap.length === 2 && gap.every(n => Number.isFinite(n) && n >= 0) && gap[1] >= gap[0] && gap[1] > 0) {
    $('top10ExpGap').textContent = 'EXP ที่ขาดประมาณ ' + gap.map(n => Math.ceil(n).toLocaleString('en-US')).join('–') + ' · อันดับ 10 ไม่เผย %EXP';
  } else {
    $('top10ExpGap').textContent = levels === 0 ? 'เลเวลถึงเส้นตัดแล้ว · รอเกณฑ์ตัดสินอันดับ' : 'ยังไม่มีข้อมูลพอคำนวณ EXP ที่ขาด';
  }
}

const healingLabels = {PREPARED:'เตรียมติดตั้ง', INSTALLING:'กำลังติดตั้งแพตช์', STARTING:'กำลังเริ่มเวอร์ชันใหม่',
  CANARY:'ทดสอบแพตช์ขณะรันจริง', COMMITTED:'อัปเดตสำเร็จ · เฝ้าระวัง', ROLLING_BACK:'กำลังย้อนกลับ',
  ROLLED_BACK:'ย้อนกลับสำเร็จ', ROLLBACK_FAILED:'ย้อนกลับไม่สำเร็จ · ต้องตรวจสอบ', SUPERSEDED:'มีเวอร์ชันใหม่แทนแพตช์เดิม',
  REPAIRING:'กำลังสร้างแพตช์', VERIFYING:'กำลังทดสอบแพตช์', READY_REVIEW:'แพตช์รอการติดตั้ง',
  FAILED:'สร้างแพตช์ไม่สำเร็จ', INTERRUPTED:'งานซ่อมถูกขัดจังหวะ', DEPLOYED:'งานซ่อมติดตั้งสำเร็จ'};
function healingTime(at) {
  return at ? new Date(at).toLocaleString('th-TH', {timeZone:'Asia/Bangkok', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', second:'2-digit'}) : '–';
}
function renderHealing(j) {
  const latest = j.latestRepair;
  const repairing = latest && ['REPAIRING','VERIFYING'].includes(latest.status);
  const deploymentBusy = ['PREPARED','INSTALLING','STARTING','CANARY','ROLLING_BACK','ROLLBACK_FAILED'].includes(j.phase);
  $('healingState').textContent = !j.available ? 'อ่านสถานะ Self-Healing ไม่ได้' : !j.fresh ? 'ข้อมูล Self-Healing เก่า' :
    deploymentBusy ? healingLabels[j.phase] : repairing ? healingLabels[latest.status] : healingLabels[j.phase] || 'เฝ้าระวัง · ยังไม่มีแพตช์ใหม่';
  $('healingMode').textContent = j.mode === 'automatic-deployment' ? 'Auto deploy + rollback' : j.mode === 'candidate-review' ? 'รอตรวจแพตช์' : 'ยังไม่ทราบโหมด';
  $('healingMode').className = 'badge ' + (j.fresh && !['ROLLBACK_FAILED','ROLLING_BACK'].includes(j.phase) ? 'llm' : 'policy');
  $('healingFreshness').textContent = 'บันทึกตัวตรวจ: ' + healingTime(j.checkedAt) + (j.fresh ? ' · ข้อมูลล่าสุด' : ' · ยังยืนยันสถานะปัจจุบันไม่ได้');
  const current = j.current || {};
  $('healingBuild').textContent = current.buildId ? current.buildId.slice(0,12) : 'ยังยืนยันไม่ได้';
  $('healingBuild').title = current.buildId || '';
  const kinds = {baseline:'เวอร์ชันฐาน · ยังไม่มีแพตช์อัตโนมัติ', patch:'แพตช์ผ่านการทดสอบรันจริงแล้ว',
    canary:'เวอร์ชันทดลอง · ยังไม่ยืนยันสำเร็จ', restored:'ยืนยันว่าเริ่มเวอร์ชันก่อนแพตช์แล้ว', external:'เวอร์ชันที่อัปเดตภายหลัง', observed:'พบ Build ปัจจุบัน · ยังระบุแพตช์ไม่ได้', unconfirmed:'ยังยืนยันแพตช์ที่ใช้อยู่ไม่ได้'};
  $('healingPatch').textContent = kinds[current.kind] || kinds.unconfirmed;
  $('healingJob').textContent = j.jobId ? j.jobId.slice(0,8) : j.available ? 'ยังไม่มีงานติดตั้ง' : 'ยังไม่ทราบ';
  $('healingJob').title = j.jobId || '';
  $('healingFiles').textContent = (j.files || []).join(', ') || '–';
  $('healingRepair').textContent = latest ? 'งานซ่อมล่าสุด: ' + healingLabels[latest.status] + ' · ' + healingTime(latest.at) : 'ยังไม่มีงานซ่อมที่บันทึกไว้';
  const canary = j.canary;
  $('healingCanary').hidden = !canary;
  if (canary) {
    const percent = Math.max(0, Math.min(100, canary.elapsedMs / canary.durationMs * 100));
    $('healingCanaryBar').style.width = percent + '%';
    $('healingCanaryProgress').setAttribute('aria-valuenow', String(Math.round(percent)));
    $('healingCanaryText').textContent = Math.floor(canary.elapsedMs / 60000) + ' / ' + Math.round(canary.durationMs / 60000) + ' นาที · ' +
      (!j.fresh ? 'ข้อมูลเก่า · รอผลยืนยัน' : percent >= 100 ? 'รอผลยืนยันจากตัวตรวจ' : 'รอผ่านเกณฑ์สุขภาพก่อนยืนยันสำเร็จ');
  }
  const history = $('healingHistory'); history.replaceChildren();
  for (const e of (j.events || []).slice(0, 30)) {
    const row = document.createElement('li'), time = document.createElement('time'), title = document.createElement('div'), detail = document.createElement('div');
    time.textContent = healingTime(e.at); time.dateTime = new Date(e.at).toISOString();
    title.textContent = healingLabels[e.status] || e.status;
    const build = e.status === 'ROLLED_BACK' ? e.beforeBuild : e.candidateBuild;
    detail.className = 'detail';
    detail.textContent = 'งาน ' + e.jobId.slice(0,8) + (build ? ' · Build ' + build.slice(0,12) : '') + (e.reason ? ' · ' + e.reason : '');
    row.append(time, title, detail); history.append(row);
  }
  if (!history.children.length) {
    const empty = document.createElement('li'); empty.className = 'detail';
    empty.textContent = j.available ? 'ยังไม่มีประวัติอัปเดตหรือ rollback' : 'ยังอ่านประวัติไม่ได้'; history.append(empty);
  }
}
async function tickHealing() {
  try {
    const r = await fetch('/self-healing.json?t=' + Date.now(), {signal:AbortSignal.timeout(3500)});
    if (!r.ok) throw new Error('status unavailable');
    renderHealing(await r.json());
  } catch { renderHealing({available:false, fresh:false, current:{kind:'unconfirmed'}, events:[]}); }
}
function renderHealingTest(j) {
  $('healingTest').hidden = !j.available;
  if (!j.available) return;
  const labels = {PREPARING:'เตรียมการทดสอบ', BASELINE:'ทดสอบโค้ดเดิมใน sandbox', REPAIRING:'สร้างแพตช์ทดสอบ', VERIFYING:'ทดสอบแพตช์ใน sandbox',
    CANARY:'ทดสอบรันจริงกับเอเจนต์จำลอง', COMMITTED:'ทดสอบอัปเดตสำเร็จ', INJECTING_FAILURE:'จำลองข้อผิดพลาดหลังอัปเดต',
    ROLLING_BACK:'กำลังทดสอบย้อนกลับ', ROLLED_BACK:'ทดสอบย้อนกลับสำเร็จ', PASSED:'ทดสอบครบวงจรผ่าน', FAILED:'ทดสอบไม่ผ่าน · ต้องตรวจสอบ', INCOMPLETE:'หลักฐานทดสอบยังไม่ครบ'};
  $('healingTestState').textContent = !j.finishedAt && !j.fresh ? 'ข้อมูลทดสอบเก่า · รอยืนยันผล' : labels[j.stage] || labels.INCOMPLETE;
  $('healingTestRun').textContent = 'รอบ ' + j.runId.slice(0,8) + ' · เริ่ม ' + healingTime(j.startedAt) + (j.finishedAt ? ' · จบ ' + healingTime(j.finishedAt) : '');
  $('healingTestLive').textContent = j.productionUnchanged === true ? 'ยืนยัน process / Build ของเอเจนต์จริงคงเดิมตลอดรอบทดสอบ' : j.productionUnchanged === false ? 'ตรวจพบการเปลี่ยนแปลงของเอเจนต์จริง · ตรวจสอบผล' : 'กำลังเก็บหลักฐานความต่อเนื่องของเอเจนต์จริง';
  const c = j.pipeline?.canary;
  $('healingTestBar').hidden = !c || Boolean(j.finishedAt);
  if (c) {
    const percent = Math.min(100, Math.max(0, c.elapsedMs / c.durationMs * 100));
    $('healingTestFill').style.width = percent + '%'; $('healingTestBar').setAttribute('aria-valuenow', String(Math.round(percent)));
  }
  $('healingTestProgress').textContent = c ? 'Canary: ' + Math.floor(c.elapsedMs/60000) + ' / ' + Math.round(c.durationMs/60000) + ' นาที · รอผลยืนยันจากตัวตรวจ' : 'สถานะสำเนาทดสอบ: ' + (healingLabels[j.pipeline?.phase] || labels[j.stage] || '–');
  const checkLabels = {baselineTests:'เทสต์โค้ดเดิม',candidateTests:'เทสต์แพตช์',canary:'Canary',telegramCommit:'TG อัปเดต',guardRollback:'Guard ย้อนกลับ',telegramRollback:'TG rollback',noDuplicateAlerts:'ไม่แจ้งซ้ำ',productionUnchanged:'เอเจนต์จริงคงเดิม'};
  $('healingTestChecks').textContent = (j.checks || []).map(c => (c.status === 'PASSED' ? '✓ ' : c.status === 'FAILED' ? '✗ ' : '… ') + checkLabels[c.name]).join(' · ');
  $('healingTestTelegram').textContent = (j.notifications || []).length ? 'Telegram รับข้อความแล้ว: ' + j.notifications.map(n => (n.status === 'COMMITTED' ? 'อัปเดต' : 'rollback') + ' #' + n.messageId + ' · ' + healingTime(n.at)).join(' / ') : 'ยังไม่มีข้อความ Telegram ที่ยืนยันการส่ง';
  const history = $('healingTestHistory'); history.replaceChildren();
  for (const e of (j.pipeline?.events || []).slice(0, 16)) {
    const row = document.createElement('li'); row.className = 'detail';
    row.textContent = healingTime(e.at) + ' · [TEST] ' + (healingLabels[e.status] || e.status) + (e.reason ? ' · ' + e.reason : ''); history.append(row);
  }
}
async function tickHealingTest() {
  try {
    const r = await fetch('/self-healing-test.json?t=' + Date.now(), {signal:AbortSignal.timeout(3500)});
    if (!r.ok) throw new Error('test report unavailable');
    renderHealingTest(await r.json());
  } catch { if (!$('healingTest').hidden) $('healingTestState').textContent = 'อ่านผลทดสอบไม่ได้ · รอยืนยัน'; }
}

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
    $('mode').textContent=j.availability?.status==='down'?'พักรอเซิร์ฟเวอร์':j.strategy?.uiHealth?.safeIdle?'Safe Idle · ตรวจพบ UI เปลี่ยน':a.mode||'ยังไม่เปิด autonomy';
    $('cap').textContent=(a.cap?.level??'?')+' / +'+(a.catalog?.refineMax??'?');
    $('expRate').textContent=a.expPerMinute??'กำลังวัด';
    const t=j.strategy?.combatTelemetry?.current;
    $('ttk').textContent=t?.count?t.medianSeconds+'s / '+t.count:'รอหลอดเลือดครบ';
    const hold=a.resourceHold;
    $('resourceHold').textContent=hold?.active?(hold.awaitingCatalog?'พักอุปกรณ์รอง · รอตรวจสูตรใหม่':'พักอุปกรณ์รองก่อน Lv'+hold.nextLevel)+' · พบ '+(hold.unlocks?.length||0)+' รายการปลดล็อก':'ใช้นโยบายอัปเกรดปกติ';
    const c=j.strategy?.catchUp?.current,trend={waiting:'รอข้อมูล',uncertain:'ยังแยกความเร็วคู่แข่งไม่ได้',closing:'กำลังตีตื้น',falling:'คู่แข่งโตเร็วกว่า',flat:'EXP ตัวเรายังไม่เพิ่ม',top10:'ติด Top 10 แล้ว','cap-tie':'ต้องตรวจเกณฑ์เสมอที่เพดาน'};
    renderRanking(c, s.lv);
    const fresh=c&&Date.now()-c.rankAt<20*60000;
    $('catchup').textContent=fresh&&c.cutoff?c.cutoff.name+' Lv'+c.cutoff.level+' · '+trend[c.status]+' · ข้อมูล '+Math.floor((Date.now()-c.rankAt)/60000)+' นาที':'รอตารางอันดับสด';
    const eta=fresh&&(c.etaMovingMinutes||c.etaStaticMinutes);
    $('eta').textContent=eta?eta.map(n=>n>10080?'>7 วัน':Math.ceil(n)+' นาที').join('–')+(c.etaMovingMinutes?' · หากอัตราโตคงเดิม':' · ถ้าเส้นตัดหยุดโต'):'ข้อมูลไม่พอคำนวณ';
    const session=j.strategy?.sessionHygiene;
    $('sessionAge').textContent=Number.isFinite(session?.ageHours)?session.ageHours.toFixed(1)+' ชม. · '+(session.pending?'กำลังกู้เซสชัน':'รอจบธุระในเมืองเมื่อครบอายุ'):'รอข้อมูลอายุหน้าเกม';
    const dna=j.strategy?.dna;
    const dnaMode={waiting:'รอบริบทฟาร์ม',baseline:'เก็บ baseline',experiment:'ทดลองหนึ่งยีน',elite:'ใช้ Elite','hyper-validation':'เร่งตรวจกลยุทธ์'};
    $('dna').textContent=dna?.enabled?'รุ่น '+dna.generation+' · '+(dna.needsApply?'รอยืนยันค่าจากเกม':dnaMode[dna.mode]||dna.mode)+' · เก็บรอบ '+dna.windowMinutes+' นาที · '+dna.windows+' ผลวัด · Fitness '+(dna.windows?dna.fitness.toFixed(4):'ยังไม่มีผล')+' · ภูมิคุ้มกัน '+dna.immunityCount:(dna?.issue||'ยังไม่เปิด DNA');
    $('dnaGenes').textContent=dna?.enabled?JSON.stringify(dna.genes,null,2):'';
    $('budget').textContent=(a.premium?.spent||0)+' / '+(a.premium?.reserved||0);
    $('craft').textContent=a.goal?a.goal.name+' · '+(a.craftProgress??0)+'% ของวัตถุดิบ':a.gearCapped?'อุปกรณ์ถึงเพดานที่ตรวจแล้ว':'ยังไม่มีสูตรเป้าหมาย';
    $('craftbar').style.width=Math.max(0,Math.min(100,a.craftProgress||0))+'%';
    $('materials').textContent=(a.goal?.missing||[]).map(m=>m.id+': '+m.have+'/'+m.need).join('\\n')+(a.blocked?'\\n'+a.blocked:'');
    $('lv').textContent = s.lv || '–';
    $('jl').textContent = s.jobLv || '–';
    renderExp(s.exp, s.expText, 'expPercent', 'expb', 'expProgress');
    renderExp(s.jobExp, s.jobExpText, 'jobExpPercent', 'jobExpb', 'jobExpProgress');
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

tickShot(); tickState(); tickText(); tickHealing(); tickHealingTest();
setInterval(tickShot, 1200);
setInterval(tickState, 3000);
setInterval(tickText, 5000);
setInterval(tickHealing, 5000);
setInterval(tickHealingTest, 5000);
</script>
</body></html>`;

function authed(req, url) {
  if (!TOKEN) return false;
  const q = url.searchParams.get('k');
  if (q === TOKEN) return true;
  const cookie = req.headers.cookie || '';
  return cookie.split(';').some((c) => c.trim() === 'v=' + TOKEN);
}

if (require.main === module) http.createServer((req, res) => {
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
  if (url.pathname === '/self-healing.json') {
    return healingStatus().then(status => {
      res.writeHead(200, {'content-type':'application/json; charset=utf-8'});
      res.end(JSON.stringify(status));
    }).catch(() => { res.writeHead(503); res.end('status unavailable'); });
  }
  if (url.pathname === '/self-healing-test.json') {
    res.writeHead(200, {'content-type':'application/json; charset=utf-8'});
    return res.end(JSON.stringify(healingTestView(readProjection(process.env.SELF_HEAL_TEST_FILE || '/var/lib/sigil-self-healing-reports/e2e.json'))));
  }
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
module.exports = {healingView, healingTestView, readProjection, PAGE};
