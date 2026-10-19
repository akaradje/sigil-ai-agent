'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const {healingView, healingTestView, readProjection, PAGE} = require('./viewer');
const NOW = Date.parse('2026-10-19T14:00:00Z');
const JOB = '12345678-1234-1234-1234-123456789abc';
const BEFORE = 'a'.repeat(64), AFTER = 'b'.repeat(64);
function deployment(phase = 'COMMITTED') {
  return {mode:'automatic-deployment', checkedAt:NOW, phase, jobId:JOB,
    active:{beforeBuild:BEFORE, candidateBuild:AFTER, files:['ui-resilience.js'], startedAt:NOW-120000, canaryMs:600000},
    events:[{id:1, jobId:JOB, status:phase, at:NOW-1000, beforeBuild:BEFORE, candidateBuild:AFTER}]};
}
function health(buildId = AFTER) { return {buildId, updatedAt:NOW-100, observedAt:NOW}; }
function testReport() {
  return {version:1, kind:'isolated-e2e', runId:JOB, startedAt:NOW-700000, checkedAt:NOW, finishedAt:NOW,
    stage:'PASSED', productionUnchanged:true, canaryElapsedMs:600001, deployment:deployment('ROLLED_BACK'), health:health(BEFORE),
    checks:Object.fromEntries(['baselineTests','candidateTests','canary','telegramCommit','guardRollback','telegramRollback','noDuplicateAlerts','productionUnchanged'].map(n=>[n,'PASSED'])),
    notifications:[{status:'COMMITTED',messageId:101,at:NOW-5000},{status:'ROLLED_BACK',messageId:102,at:NOW}]};
}

test('isolated test reports require ten-minute evidence, confirmed rollback and both Telegram receipts', () => {
  const report=testReport();assert.equal(healingTestView(report,NOW).stage,'PASSED');
  for(const changed of [{notifications:[]},{productionUnchanged:false},{canaryElapsedMs:1000},{health:health(AFTER)},
    {checks:{}},{finishedAt:NOW+60000},{notifications:[report.notifications[0],{...report.notifications[1],messageId:101}]}])
    assert.equal(healingTestView({...report,...changed},NOW).stage,'INCOMPLETE');
  assert.equal(healingTestView(report,NOW+3600000).stage,'PASSED'); // Finished results are historical evidence.
});

test('isolated test projection is separate, allowlisted and absent until a real report exists', () => {
  assert.deepEqual(healingTestView(null,NOW),{available:false});
  assert.equal(healingTestView({...testReport(),kind:'production'},NOW).available,false);
  const report={...testReport(),secret:'PRIVATE',control:{token:'PRIVATE'},notifications:[...testReport().notifications,{status:'unknown',messageId:103,at:NOW,secret:'PRIVATE'}]};
  const view=healingTestView(report,NOW);
  assert.equal(JSON.stringify(view).includes('PRIVATE'),false);assert.equal(view.notifications.length,2);
  assert.equal(healingView(deployment(),null,health(),NOW).current.kind,'patch');
});
test('quiet daily success requires suppressed alert evidence and cannot claim actual Telegram delivery',()=>{
  const report={...testReport(),notificationPolicy:'failed_runs_only',notifications:[],suppressedNotifications:['COMMITTED','ROLLED_BACK'],
    schedule:{enabled:true,hour:7,minute:0,timeZone:'Asia/Bangkok',nextRunAt:NOW+86400000},history:[{runId:JOB,stage:'PASSED',finishedAt:NOW,secret:'PRIVATE'}]};
  const view=healingTestView(report,NOW);assert.equal(view.stage,'PASSED');assert.deepEqual(view.notifications,[]);assert.equal(view.failureNotification,null);
  assert.equal(view.schedule.hour,7);assert.equal(view.history.length,1);assert.equal(JSON.stringify(view).includes('PRIVATE'),false);
  assert.equal(healingTestView({...report,suppressedNotifications:['COMMITTED']},NOW).stage,'INCOMPLETE');
  const failed=healingTestView({...report,stage:'FAILED'},NOW,[{runId:JOB,messageId:555,at:NOW,token:'PRIVATE'}]);
  assert.deepEqual(failed.failureNotification,{messageId:555,at:NOW});
});

test('dashboard distinguishes a canary, a verified patch and a confirmed restored build', () => {
  const canary = healingView(deployment('CANARY'), null, health(), NOW);
  assert.equal(canary.current.kind, 'canary'); assert.equal(canary.canary.elapsedMs, 120000);
  assert.equal(healingView(deployment(), null, health(), NOW).current.kind, 'patch');
  const rollback = healingView(deployment('ROLLED_BACK'), null, health(BEFORE), NOW);
  assert.equal(rollback.current.kind, 'restored'); assert.equal(rollback.current.buildId, BEFORE);
  assert.equal(healingView(deployment('ROLLED_BACK'), null, health(), NOW).current.kind, 'unconfirmed');
  assert.equal(healingView(deployment('ROLLBACK_FAILED'), null, health(BEFORE), NOW).current.kind, 'unconfirmed');
});

test('dashboard never presents stale, mismatched or missing health as an active successful patch', () => {
  assert.equal(healingView(deployment(), null, health(BEFORE), NOW).current.kind, 'unconfirmed');
  assert.equal(healingView(deployment(), null, null, NOW).current.buildId, null);
  assert.equal(healingView(deployment(), null, {...health(), observedAt:NOW-31000}, NOW).current.kind, 'unconfirmed');
  assert.equal(healingView({...deployment(), checkedAt:NOW-46000}, null, health(), NOW).fresh, false);
  assert.equal(healingView({...deployment(), checkedAt:NOW-46000}, null, health(), NOW).current.kind, 'unconfirmed');
  assert.equal(healingView(null, null, health(), NOW).current.kind, 'observed');
  assert.equal(healingView({...deployment(), phase:null, active:null, events:[]}, null, health(), NOW).current.kind, 'baseline');
});

test('dashboard allowlists public metadata, merges event times and handles older projection formats', () => {
  const d = deployment(); d.secret = 'PRIVATE'; d.active.source = 'PRIVATE'; d.active.files.push('../.env');
  d.events[0] = {...d.events[0], secret:'PRIVATE', reason:'PRIVATE\nraw error', files:['.env','ui-resilience.js']};
  d.events.push(null, {id:2, jobId:JOB, status:'<script>', at:NOW});
  const repair = {version:1, events:[{id:1, jobId:JOB, status:'VERIFYING', at:NOW-500}]};
  const view = healingView(d, repair, health(), NOW);
  assert.equal(view.events.length, 2); assert.equal(view.events[0].status, 'VERIFYING');
  assert.deepEqual(view.files, ['ui-resilience.js']); assert.deepEqual(view.events[1].files, ['ui-resilience.js']);
  assert.equal(JSON.stringify(view).includes('PRIVATE'), false); assert.equal(JSON.stringify(view).includes('.env'), false);
  const old = healingView({mode:'automatic-deployment', phase:'COMMITTED', checkedAt:NOW, events:[{id:1,jobId:JOB,status:'COMMITTED',at:NOW}]}, null, health(), NOW);
  assert.equal(old.current.kind, 'unconfirmed'); assert.equal(old.events.length, 1);
  assert.equal(healingView({...d, events:Array(41).fill(d.events[0])}, null, health(), NOW).available, false);
});

test('projection reader rejects malformed and oversized files without exposing raw contents', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigil-viewer-projection-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const file = path.join(dir, 'events.json');
  assert.equal(readProjection(file), null);
  fs.writeFileSync(file, 'not json PRIVATE'); assert.equal(readProjection(file), null);
  fs.writeFileSync(file, ' '.repeat(256*1024+1)); assert.equal(readProjection(file), null);
  assert.equal(readProjection(dir), null);
});

test('dashboard renders rollback history as text and never treats an elapsed canary as success', () => {
  const vm = require('node:vm'), elements = new Map();
  function node() { return {textContent:'', title:'', className:'', hidden:false, style:{}, children:[], setAttribute(){},
    replaceChildren(){this.children=[];}, append(...items){this.children.push(...items);}}; }
  const context = {$:id => {if(!elements.has(id))elements.set(id,node());return elements.get(id);},
    document:{createElement:node}, Date};
  const start = PAGE.indexOf('const healingLabels'), end = PAGE.indexOf('async function tickShot');
  vm.runInNewContext(PAGE.slice(start,end), context);
  const view = healingView(deployment('CANARY'), null, health(), NOW);
  view.canary.elapsedMs = 700000;
  view.events[0].reason = '<img src=x onerror=alert(1)>';
  context.renderHealing(view);
  assert.match(elements.get('healingCanaryText').textContent, /รอผลยืนยัน/);
  assert.match(elements.get('healingPatch').textContent, /ยังไม่ยืนยันสำเร็จ/);
  assert.match(elements.get('healingHistory').children[0].children[2].textContent, /<img/);
  context.renderHealing({available:false, fresh:false, events:[]});
  assert.equal(elements.get('healingBuild').textContent, 'ยังยืนยันไม่ได้');
  assert.equal(elements.get('healingCanary').hidden, true);
  context.renderHealingTest(healingTestView(testReport(),NOW));
  assert.equal(elements.get('healingTestState').textContent,'ทดสอบครบวงจรผ่าน');
  assert.match(elements.get('healingTestTelegram').textContent,/#101/);
  assert.match(elements.get('healingTestHistory').children[0].textContent,/\[TEST\]/);
  assert.equal(elements.get('healingBuild').textContent,'ยังยืนยันไม่ได้'); // Test renderer cannot overwrite live status.
});

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('viewer fails closed without a token', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigil-viewer-test-'));
  try {
    const child = spawn(process.execPath, [path.join(__dirname, 'viewer.js')], {
      env: { ...process.env, AGENT_DIR: dir, VIEWER_TOKEN: '' }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    const [code] = await once(child, 'exit');
    assert.notEqual(code, 0);
    assert.match(error, /Set VIEWER_TOKEN/);
  } finally { fs.rmdirSync(dir); }
});

test('viewer requires authentication, limits routes to read-only and sets privacy headers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigil-viewer-test-'));
  const token = crypto.randomBytes(32).toString('hex');
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, 'viewer.js')], {
    env: { ...process.env, AGENT_DIR: dir, VIEWER_TOKEN: token, VIEWER_PORT: String(port), VIEWER_HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch(base); ready = r.status === 401; if (ready) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal(ready, true);
    const denied = await fetch(base + '/?k=wrong');
    assert.equal(denied.status, 401);
    assert.equal((await fetch(base + '/self-healing.json')).status, 401);
    assert.equal((await fetch(base + '/self-healing-test.json')).status, 401);
    const page = await fetch(base + '/?k=' + token);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const cookie = page.headers.get('set-cookie').split(';')[0];
    const allowed = await fetch(base, { headers: { cookie } });
    assert.equal(allowed.status, 200);
    assert.match(await allowed.text(), /id="healingHistory"/);
    const post = await fetch(base, { method: 'POST', headers: { cookie } });
    assert.equal(post.status, 405);
    const control = await fetch(base + '/eval?expr=1', { headers: { cookie } });
    assert.equal(control.status, 404);
  } finally {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    fs.rmdirSync(dir);
  }
});

test('authenticated status endpoint reads the nested agent health and preserves history during an outage', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigil-viewer-history-'));
  const token = crypto.randomBytes(32).toString('hex'), port = await freePort(), agentPort = await freePort();
  let agentUp = true;
  const agent = require('node:http').createServer((req,res) => {
    if(!agentUp) {res.writeHead(503);return res.end();}
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({secret:'PRIVATE', selfHealing:{...health(BEFORE), updatedAt:Date.now()-100, observedAt:Date.now()}}));
  });
  await new Promise(resolve=>agent.listen(agentPort,'127.0.0.1',resolve));
  const file = path.join(dir, 'events.json');
  fs.writeFileSync(file, JSON.stringify({...deployment('ROLLED_BACK'), checkedAt:Date.now(), secret:'PRIVATE'}));
  const reportFile=path.join(dir,'e2e.json');fs.writeFileSync(reportFile,JSON.stringify(testReport()));
  const child = spawn(process.execPath, [path.join(__dirname, 'viewer.js')], {
    env:{...process.env, AGENT_DIR:dir, VIEWER_TOKEN:token, VIEWER_PORT:String(port), VIEWER_HOST:'127.0.0.1',
      AGENT_URL:`http://127.0.0.1:${agentPort}`, SELF_HEAL_STATUS_FILE:file, SELF_HEAL_REPAIR_FILE:path.join(dir,'missing.json'), SELF_HEAL_TEST_FILE:reportFile}, stdio:'ignore'});
  t.after(async () => {const exited=once(child,'exit');child.kill();await exited;await new Promise(resolve=>agent.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  const base = `http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<100;i++){try{ready=(await fetch(base)).status===401;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,30));}
  assert.equal(ready,true);
  const response = await fetch(base+'/self-healing.json', {headers:{cookie:'v='+token}});
  assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store');
  const status = await response.json();
  assert.equal(status.phase,'ROLLED_BACK'); assert.equal(status.current.kind,'restored');
  assert.equal(status.events[0].status,'ROLLED_BACK'); assert.equal(JSON.stringify(status).includes('PRIVATE'),false);
  agentUp = false;
  const offline = await (await fetch(base+'/self-healing.json', {headers:{cookie:'v='+token}})).json();
  assert.equal(offline.current.kind,'unconfirmed'); assert.equal(offline.events[0].status,'ROLLED_BACK');
  assert.equal((await fetch(base+'/self-healing.json',{method:'POST',headers:{cookie:'v='+token}})).status,405);
  const isolated=await (await fetch(base+'/self-healing-test.json',{headers:{cookie:'v='+token}})).json();
  assert.equal(isolated.stage,'PASSED');assert.equal(isolated.pipeline.phase,'ROLLED_BACK');
  assert.equal((await fetch(base+'/self-healing-test.json',{method:'POST',headers:{cookie:'v='+token}})).status,405);
});
