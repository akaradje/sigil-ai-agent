'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AlertEngine, normalize, quietHours, telegram, levelRanking } = require('./telegram-alerts');
const MIN = 60_000;
const start = Date.parse('2026-10-19T01:00:00Z');
function sample(change = {}, brain = {}) {
  return { agent: { cycle: 10, paused: false, brain: { llmOk: 100, llmFail: 0, llmDownUntil: 0, ...brain },
    buttons: [], state: { name: 'ExampleHero', job: 'Mage', lv: 'Lv 41', jobLv: 'Job 36',
      hp: [100, 200], mp: [40, 100], gold: '30,000', quest: 'Hunt Crab 1/15',
      autoQuestRunning: true, ...change } }, supervisorOk: true, viewerOk: true };
}
function keys(e) { return e.db.pending.map((v) => v.key); }
test('DNA promotions report measured metrics once, not a fabricated EXP improvement for saved potions',()=>{
  const e=new AlertEngine({},start),s=sample();s.agent.strategy={autonomy:{events:[{id:1,type:'dna_evolved',detail:{metric:'potions',gainPercent:30,map:'field',generation:2}}]}};
  e.observe(s,start);assert.ok(e.db.pending.some(p=>/ใช้ยาลดลง 30%/.test(p.text)));assert.equal(e.db.pending.some(p=>/EXP\/min เพิ่ม/.test(p.text)),false);
  e.acknowledge([...e.db.pending]);const restored=new AlertEngine(JSON.parse(JSON.stringify(e.db)),start+MIN);restored.observe(s,start+MIN);
  assert.equal(restored.db.pending.filter(p=>p.key.startsWith('autonomy:')).length,0);
});
test('catch-up trend notifications need two fresh leaderboard samples and survive restart without repeats',()=>{
  let e=new AlertEngine({},start),s=sample();
  const set=(status,at)=>{s.agent.strategy={catchUp:{character:s.agent.state.name,current:{status,at,rankAt:at,cutoff:{name:'Rival',level:66},etaMovingMinutes:status==='closing'?[80,120]:null}}};};
  set('uncertain',start);e.observe(s,start);assert.equal(e.db.pending.length,0);
  set('closing',start+20*MIN);e.observe(s,start+20*MIN);assert.equal(e.db.pending.filter(p=>p.key.startsWith('catchup:')).length,0);
  set('closing',start+25*MIN);e.observe(s,start+25*MIN);assert.equal(e.db.pending.filter(p=>p.key.startsWith('catchup:')).length,1);
  assert.ok(e.db.pending.some(p=>/กำลังตีตื้น/.test(p.text)));
  e.acknowledge([...e.db.pending]);e=new AlertEngine(JSON.parse(JSON.stringify(e.db)),start+30*MIN);
  set('closing',start+30*MIN);e.observe(s,start+30*MIN);assert.equal(e.db.pending.filter(p=>p.key.startsWith('catchup:')).length,0);
});
test('session refresh has one durable completion event and a stuck-refresh incident',()=>{
  const e=new AlertEngine({},start),s=sample();s.agent.strategy={sessionHygiene:{pending:{at:start}},autonomy:{events:[{id:1,type:'session_refreshing',detail:{}}]}};
  e.observe(s,start);assert.ok(e.db.pending.some(p=>/กำลังรีเฟรชเซสชัน/.test(p.text)));
  e.observe(s,start+3*MIN);assert.ok(e.db.pending.some(p=>p.incident==='session-refresh'));
  s.agent.strategy.sessionHygiene.pending=null;s.agent.strategy.autonomy.events.push({id:2,type:'session_refreshed',detail:{}});
  e.observe(s,start+4*MIN);assert.ok(e.db.pending.some(p=>/รีเฟรชเซสชันสำเร็จ/.test(p.text)));
  assert.equal(e.db.pending.filter(p=>p.incident==='session-refresh').length,0);
});
test('UI incident reaches the outbox even when player name is unreadable, and recovery is deduplicated',()=>{
  const e=new AlertEngine({},start),s=sample({name:''});
  s.agent.strategy={uiHealth:{safeIdle:true,character:'ExampleHero'},autonomy:{events:[{id:1,type:'ui_changed',detail:{missing:['hp','level']}}]}};
  e.observe(s,start);assert.match(e.db.pending[0].text,/UI Structure Changed/);
  e.acknowledge([...e.db.pending]);
  const restored=new AlertEngine(JSON.parse(JSON.stringify(e.db)),start+MIN);restored.observe(s,start+MIN);assert.equal(restored.db.pending.length,0);
  s.agent.state.name='ExampleHero';s.agent.strategy.autonomy.events.push({id:2,type:'ui_recovered',detail:{}});
  restored.observe(s,start+MIN+1000);assert.ok(restored.db.pending.some(p=>/อ่าน UI ได้ครบ/.test(p.text)));
});
test('verified autonomy events persist across restarts without duplicate or inferred claims',()=>{
  const e=new AlertEngine({},start),s=sample();s.agent.strategy={autonomy:{events:[],mode:'leveling'}};
  e.observe(s,start);assert.equal(keys(e).some(k=>k.startsWith('autonomy:')),false);
  s.agent.strategy.autonomy.events=[{id:1,type:'cbt_claimed',detail:{crystals:5000,vip:'VIP3'}},{id:2,type:'cap_expanded',detail:{from:99,to:120}}];
  e.observe(s,start+1000);const pending=e.db.pending.filter(x=>x.key.startsWith('autonomy:'));assert.equal(pending.length,2);
  e.acknowledge(pending);const restarted=new AlertEngine(JSON.parse(JSON.stringify(e.db)),start+2000);restarted.observe(s,start+3000);
  assert.equal(restarted.db.pending.filter(x=>x.key.startsWith('autonomy:')).length,0);
});
test('managed material farming does not produce a false Auto Quest stopped alert',()=>{
  const e=new AlertEngine({},start),s=sample({autoQuestRunning:false});s.agent.strategy={autonomy:{farm:{map:'field'},events:[]}};
  e.observe(s,start);e.observe(s,start+10*MIN);assert.equal(keys(e).some(k=>k.includes('incident:auto')),false);
});
function ranked(rank, at, change = {}) {
  const s = sample(change);
  s.agent.strategy = { rank: { kind: 'lv', character: s.agent.state.name, at,
    rows: [{ own: true, text: `${rank}\n${s.agent.state.name}\nMage Lv 51\nLv 51` }] } };
  return s;
}

test('historical death text cannot produce a death notification', () => {
  const s = sample({ dead: true });
  assert.equal(normalize(s.agent).dead, false);
  s.agent.state.hp = [0, 200];
  assert.equal(normalize(s.agent).dead, true);
  s.agent.state.hp = [100, 200]; s.agent.buttons = ['Revive Here'];
  assert.equal(normalize(s.agent).dead, true);
});

test('temporary outage is quiet; sustained outage alerts once and recovers once', () => {
  const e = new AlertEngine({}, start);
  e.observe(sample(), start);
  e.observe({ agent: null }, start + 1000);
  e.observe(sample(), start + 70_000);
  assert.deepEqual(keys(e), []);
  e.observe({ agent: null }, start + 100_000);
  e.observe({ agent: null }, start + 190_000);
  e.observe({ agent: null }, start + 220_000);
  assert.deepEqual(keys(e), ['incident:agent']);
  e.acknowledge([...e.db.pending]);
  e.observe(sample(), start + 250_000);
  assert.deepEqual(keys(e), ['recovered:agent']);
  e.acknowledge([...e.db.pending]);
  e.observe(sample(), start + 280_000);
  assert.deepEqual(keys(e), []);
});

test('undelivered stale alerts are removed without recovery spam', () => {
  const e = new AlertEngine({}, start);
  e.observe({ agent: null }, start);
  e.observe({ agent: null }, start + 90_000);
  assert.equal(e.db.pending.length, 1);
  e.observe(sample(), start + 100_000);
  assert.deepEqual(keys(e), []);
});

test('state persistence deduplicates incident across monitor restarts', () => {
  let e = new AlertEngine({}, start);
  e.observe({ agent: null }, start);
  e.observe({ agent: null }, start + 90_000);
  e.acknowledge([...e.db.pending]);
  e = new AlertEngine(JSON.parse(JSON.stringify(e.db)), start + 120_000);
  e.observe({ agent: null }, start + 150_000);
  assert.deepEqual(keys(e), []);
});

test('LLM retry readiness is not recovery; successful model call is', () => {
  const e = new AlertEngine({}, start);
  e.observe(sample(), start);
  e.observe(sample({}, { llmFail: 1, llmDownUntil: start + 60_000 }), start + 30_000);
  for (let t = 60_000; t <= 330_000; t += 30_000) e.observe(sample({}, { llmFail: 1 }), start + t);
  assert.ok(keys(e).includes('incident:llm'));
  e.acknowledge([...e.db.pending]);
  e.observe(sample({}, { llmFail: 1 }), start + 360_000);
  assert.ok(!keys(e).includes('recovered:llm'));
  e.observe(sample({}, { llmFail: 1, llmOk: 101 }), start + 390_000);
  assert.ok(keys(e).includes('recovered:llm'));
});

test('job-cap, job-change and five-level milestones do not notify every tick', () => {
  const e = new AlertEngine({}, start);
  e.observe(sample(), start);
  e.observe(sample({ lv: 'Lv 45', jobLv: 'Job 40' }), start + 30_000);
  e.observe(sample({ lv: 'Lv 45', jobLv: 'Job 40' }), start + 60_000);
  assert.equal(keys(e).filter((v) => v === 'level:9').length, 1);
  assert.equal(keys(e).filter((v) => v === 'incident:jobcap').length, 1);
  e.acknowledge([...e.db.pending]);
  e.observe(sample({ lv: 'Lv 45', job: 'Starweaver', jobLv: 'Job 1' }), start + 90_000);
  assert.ok(keys(e).includes('job:Starweaver'));
  assert.ok(!keys(e).includes('recovered:jobcap'));
});

test('gold unknown is not zero, and low-gold hysteresis prevents flapping', () => {
  const e = new AlertEngine({}, start);
  e.observe(sample({ gold: null }), start);
  e.observe(sample({ gold: '2,900' }), start + 30_000);
  e.observe(sample({ gold: '2,950' }), start + 90_000);
  assert.ok(keys(e).includes('incident:gold'));
  e.acknowledge([...e.db.pending]);
  e.observe(sample({ gold: '3,100' }), start + 120_000);
  assert.ok(!keys(e).includes('recovered:gold'));
  e.observe(sample({ gold: '8,100' }), start + 150_000);
  assert.ok(keys(e).includes('recovered:gold'));
});

test('quest progress prevents a stall even when level does not change', () => {
  const e = new AlertEngine({}, start);
  for (let t = 0; t <= 40 * MIN; t += 30_000) {
    const s = sample({ quest: `Hunt Crab ${Math.floor(t / (5 * MIN))}/15` });
    s.agent.cycle += Math.floor(t / MIN);
    e.observe(s, start + t);
  }
  assert.ok(!keys(e).includes('incident:stall'));
});

test('a real plateau and stuck AI cycle are detected with configured delays', () => {
  const e = new AlertEngine({}, start);
  for (let t = 0; t <= 30 * MIN; t += 30_000) e.observe(sample(), start + t);
  assert.ok(keys(e).includes('incident:cycle'));
  assert.ok(keys(e).includes('incident:stall'));
});

test('four-hour summary survives restart and is deduplicated', () => {
  let e = new AlertEngine({}, start);
  e.observe(sample(), start);
  e = new AlertEngine(JSON.parse(JSON.stringify(e.db)), start + MIN);
  e.observe(sample({ gold: '31,234' }), start + 4 * 60 * MIN);
  e.observe(sample({ gold: '31,234' }), start + 4 * 60 * MIN + 30_000);
  assert.equal(keys(e).filter((v) => v === 'summary').length, 1);
  assert.match(e.db.pending.find((v) => v.key === 'summary').text, /\+1,234/);
});

test('quiet hours use Bangkok time with exact boundary handling', () => {
  assert.equal(quietHours(Date.parse('2026-10-19T15:59:00Z')), false);
  assert.equal(quietHours(Date.parse('2026-10-19T16:00:00Z')), true);
  assert.equal(quietHours(Date.parse('2026-10-20T00:59:00Z')), true);
  assert.equal(quietHours(Date.parse('2026-10-20T01:00:00Z')), false);
});

test('Telegram rate limit is respected and credentials never appear in errors', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ ok: false, error_code: 429, parameters: { retry_after: 120 } }) });
    await assert.rejects(telegram('secret-test-token', 'sendMessage', {}), (error) => {
      assert.equal(error.retryMs, 120_000);
      assert.ok(!error.message.includes('secret-test-token'));
      return true;
    });
    global.fetch = async () => { throw new Error('secret-test-token'); };
    await assert.rejects(telegram('secret-test-token', 'sendMessage', {}), (error) => !error.message.includes('secret-test-token'));
  } finally { global.fetch = original; }
});

test('Starweaver eligibility and quest text are not class-change success', () => {
  const e = new AlertEngine({}, start);
  e.observe(sample({ jobLv: 'Job 40 MAX', quest: 'Starweaver Quest: Chrono Gear 0/1' }), start);
  assert.ok(!keys(e).includes('job:Starweaver'));
});

test('Starweaver success is detected across agent restart and persisted without repeats', () => {
  let e = new AlertEngine({}, start);e.observe(sample(), start);
  const changed = sample({ job: 'Starweaver', jobLv: 'Job 1' }, { llmOk: 0 });changed.agent.cycle=1;
  e.observe(changed,start+MIN);
  assert.equal(keys(e).filter(k=>k==='job:Starweaver').length,1);
  e = new AlertEngine(JSON.parse(JSON.stringify(e.db)),start+2*MIN);
  e.observe(changed,start+2*MIN);
  assert.equal(keys(e).filter(k=>k==='job:Starweaver').length,1);
  e.acknowledge([...e.db.pending]);e.observe(changed,start+3*MIN);
  assert.ok(!keys(e).includes('job:Starweaver'));
});

test('first valid observation already in Starweaver reports confirmed success once', () => {
  const e = new AlertEngine({},start);e.observe(sample({job:'Starweaver'}),start);
  assert.equal(keys(e).filter(k=>k==='job:Starweaver').length,1);
});

test('rank baseline is quiet; improvement and Top10 crossing each produce one event', () => {
  const e = new AlertEngine({},start);
  e.observe(ranked(13,start),start);assert.deepEqual(keys(e),[]);
  e.observe(ranked(12,start+MIN),start+MIN);
  assert.equal(e.db.pending.length,1);assert.match(e.db.pending[0].text,/13 → 12/);
  e.acknowledge([...e.db.pending]);
  e.observe(ranked(9,start+2*MIN),start+2*MIN);
  assert.equal(e.db.pending.length,1);assert.match(e.db.pending[0].text,/ติด Top 10/);assert.match(e.db.pending[0].text,/12 → 9/);
});

test('same cached rank, out-of-order snapshot and restart cannot duplicate improvement', () => {
  let e=new AlertEngine({},start);e.observe(ranked(13,start),start);
  e.observe(ranked(11,start+MIN),start+MIN);
  e=new AlertEngine(JSON.parse(JSON.stringify(e.db)),start+2*MIN);
  e.observe(ranked(11,start+MIN),start+2*MIN);assert.equal(e.db.pending.length,1);
  e.acknowledge([...e.db.pending]);
  e.observe(ranked(13,start),start+3*MIN);
  e.observe(ranked(11,start+4*MIN),start+4*MIN);assert.equal(e.db.pending.length,0);
});

test('declines are silent; later improvement and Top10 re-entry are reported', () => {
  const e=new AlertEngine({},start);e.observe(ranked(10,start),start);e.acknowledge([...e.db.pending]);
  e.observe(ranked(12,start+MIN),start+MIN);assert.equal(e.db.pending.length,0);
  e.observe(ranked(10,start+2*MIN),start+2*MIN);assert.match(e.db.pending[0].text,/ติด Top 10/);
  e.acknowledge([...e.db.pending]);e.observe(ranked(8,start+3*MIN),start+3*MIN);
  assert.match(e.db.pending[0].text,/10 → 8/);assert.match(e.db.pending[0].text,/อยู่ใน Top 10/);
});

test('missing, stale, wrong-character or wrong-category rankings are ignored', () => {
  const s=ranked(13,start);assert.equal(levelRanking(s.agent,start).rank,13);
  assert.equal(levelRanking(s.agent,start+21*MIN),null);
  assert.equal(levelRanking(s.agent,start-2*MIN),null);
  s.agent.strategy.rank.kind='gold';assert.equal(levelRanking(s.agent,start),null);
  s.agent.strategy.rank.kind='lv';s.agent.strategy.rank.character='Other';assert.equal(levelRanking(s.agent,start),null);
  s.agent.strategy.rank.character='ExampleHero';s.agent.strategy.rank.rows=[];assert.equal(levelRanking(s.agent,start),null);
  s.agent.strategy.rank.rows=[{own:true,text:'1\nOther\nLv 99'}];assert.equal(levelRanking(s.agent,start),null);
});

test('medal positions are parsed as actual top-three ranks', () => {
  for(const [medal,rank] of [['🥇',1],['🥈',2],['🥉',3]]) assert.equal(levelRanking(ranked(medal,start).agent,start).rank,rank);
});
