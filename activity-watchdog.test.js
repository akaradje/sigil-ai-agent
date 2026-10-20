'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),W=require('./activity-watchdog');
const NOW=1800000000000,MIN=60000;
function rig(mode='combat'){
  const catalog={maps:[{id:'field',name:'Field'},{id:'town',name:'Town',town:true}]};
  const s={name:'Hero',job:'Mage',lv:'Lv 79',jobLv:'Job 49',hp:[900,1000],hpPotions:30,mpPotions:30,exp:10,jobExp:20,zone:mode==='town'?'Town':'Field',autoHunt:''};
  const mem={uiHealth:{safeIdle:false},autonomy:{events:[],sequence:0,bagUsage:[50,100],farm:mode==='town'?null:{map:'field'}},development:{},gameTelemetry:{}};
  if(mode==='mine'){mem.development.excursion={kind:'mine',map:'field'};mem.autonomy.goal={missing:[{id:'mithril'}]};mem.development.activityResource={map:'field',level:19,exp:100,materials:{mithril:0,unrelated:1}};}
  if(mode==='travel')mem.autonomy.resume={map:'town',mode:'farm'};
  let now=NOW;const tick=(elapsed=0,options={})=>{now=NOW+elapsed;Object.assign(mem.gameTelemetry,{validated:true,checkedAt:now,x:100,y:100,...options.telemetry});if(mem.development.activityResource)mem.development.activityResource.at=now;return W.observe(mem,s,catalog,options,now);};
  const until=end=>{for(let t=0;t<=end;t+=5000)tick(t);};
  return {mem,s,catalog,tick,until,take:()=>W.take(mem,s,now),get now(){return now;}};
}
test('AUTO off and fresh stationary observations queue recovery after three minutes, not one cooldown',()=>{
  const r=rig();r.until(170000);assert.equal(r.mem.activityWatchdog.pending,undefined);r.tick(180000);assert.equal(r.take(),'resume');assert.equal(r.mem.activityWatchdog.status,'verifying');
  assert.equal(r.mem.autonomy.events.at(-1).type,'activity_recovery');
});
test('actual damage or EXP growth prevents idle recovery even without level changes',()=>{
  for(const signal of ['damage','exp']){const r=rig();for(let t=0;t<=10*MIN;t+=10000){if(signal==='damage')r.mem.combatTelemetry={lastDamage:{zone:'Field',at:NOW+t}};else r.s.exp+=0.01;r.tick(t);}assert.equal(r.mem.activityWatchdog.pending,null);}
});

test('class watchdog measures the quest objective instead of unrelated EXP, loot or trash damage',()=>{
 const r=rig();r.s.job='Starweaver';r.s.jobQuestProgress='Sage Quest Hunt Ignar the Flame Tyrant 0/1';r.s.target='Storm Narwhal';r.mem.classAdvancement={character:r.s.name,from:r.s.job,to:'sage'};
 for(let t=0;t<=3*MIN;t+=5000){r.s.exp++;r.mem.combatTelemetry={lastDamage:{zone:r.s.zone,at:NOW+t}};r.tick(t);}
 assert.equal(r.mem.activityWatchdog.status,'recovery-pending');assert.equal(r.mem.activityWatchdog.incident.reason,'CLASS_OBJECTIVE_STALLED');assert.equal(r.take(),null);
 r.s.target='Lv 66 Ignar the Flame Tyrant';r.mem.combatTelemetry.lastDamage.at=NOW+190000;r.tick(190000);assert.equal(r.mem.activityWatchdog.status,'productive');assert.equal(r.mem.activityWatchdog.pending,null);
 r.s.jobQuestProgress='Sage Quest Hunt Ignar the Flame Tyrant 1/1';r.tick(200000);assert.equal(r.mem.activityWatchdog.status,'productive');
 r.s.job='Sage';r.tick(210000);assert.equal(r.mem.activityWatchdog.status,'productive');
});
test('mining EXP is progress; unrelated passive loot and input timestamps cannot hide a stalled mine',()=>{
  for(const productive of [false,true]){const r=rig('mine');for(let t=0;t<=5*MIN;t+=10000){const d=r.mem.development;d.excursion.inputAt=NOW+t;d.activityResource.materials.unrelated++;if(productive)d.activityResource.exp++;r.tick(t);}assert.equal(r.mem.activityWatchdog.pending?.action,productive?undefined:'resume');}
});
test('stale mining telemetry and observation gaps cannot manufacture five minutes of mining evidence',()=>{
  const r=rig('mine');r.tick(0);r.tick(300000);assert.equal(r.mem.activityWatchdog.pending,undefined);
  delete r.mem.development.activityResource;r.tick(310000);assert.equal(r.mem.activityWatchdog.status,'suspended');
});
test('town phase changes and clicks are not progress, while verified sales and restock are',()=>{
  for(const productive of [false,true]){const r=rig('town');r.mem.autonomy.trip={kind:'shop',sales:0};for(let t=0;t<=5*MIN;t+=10000){r.mem.autonomy.trip.kind=t%20000?'shop':'forge';r.mem.autonomy.trip.progressAt=NOW+t;if(productive)r.mem.autonomy.trip.sales++;r.tick(t);}assert.equal(r.mem.activityWatchdog.pending?.action,productive?undefined:'resume');}
});
test('travel distinguishes genuine movement from jitter against a wall',()=>{
  for(const moving of [false,true]){const r=rig('travel');for(let t=0;t<=3*MIN;t+=5000)r.tick(t,{telemetry:{x:100+(moving?t/100:t%20000?2:0)}});assert.equal(r.mem.activityWatchdog.pending?.action,moving?undefined:'resume');}
});
test('pause, outage, reload and loading do not count as unattended gameplay stalls',()=>{
  for(const reason of ['paused','offline','loading','reload']){const r=rig();for(let t=0;t<=5*MIN;t+=10000){if(reason==='reload')r.mem.uiRecovery={pending:true,at:NOW+t};r.tick(t,{paused:reason==='paused',offline:reason==='offline',telemetry:{loading:reason==='loading'}});}assert.equal(r.mem.activityWatchdog.status,'suspended');assert.equal(r.mem.activityWatchdog.pending,undefined);}
});
test('recovery is confirmed only by observed outcomes, never by toggling AUTO or returning OK',()=>{
  const r=rig();r.until(3*MIN);assert.equal(r.take(),'resume');r.s.autoHunt='on';r.mem.autonomy.lastResult={ok:true,at:r.now};r.tick(190000);
  assert.equal(r.mem.autonomy.events.filter(e=>e.type==='activity_recovered').length,0);
  r.s.exp=11;r.tick(200000);assert.equal(r.mem.autonomy.events.filter(e=>e.type==='activity_recovered').length,1);r.s.exp=12;r.tick(210000);assert.equal(r.mem.autonomy.events.filter(e=>e.type==='activity_recovered').length,1);
});
test('unproductive recovery escalates through reload and restart, with a durable hourly limit',()=>{
  const r=rig();r.until(3*MIN);assert.equal(r.take(),'resume');for(let t=190000;t<=300000;t+=10000)r.tick(t);assert.equal(r.take(),'reload');
  for(let t=310000;t<=580000;t+=5000)r.tick(t);assert.equal(r.take(),'restart');
  r.mem.activityWatchdog=JSON.parse(JSON.stringify(r.mem.activityWatchdog));for(let t=590000;t<=700000;t+=5000)r.tick(t);
  assert.equal(r.mem.activityWatchdog.status,'escalated');assert.equal(r.take(),null);assert.equal(r.mem.activityWatchdog.history.length,3);
});
test('unsettled purchases and sales prevent recovery input without releasing reservations',()=>{
  for(const field of ['purchase','saleIntent']){const r=rig();r.until(3*MIN);r.mem.autonomy[field]={status:field==='purchase'?'unknown':'confirming'};assert.equal(r.take(),null);assert.ok(r.mem.activityWatchdog.pending);assert.equal(r.mem.activityWatchdog.history.length,0);}
});
test('hung-cycle restart is independent of HTTP activity and respects pauses and a persisted limit',()=>{
  const m={autonomy:{events:[],sequence:0}},v={busy:true,startedAt:NOW,paused:false,offline:false};assert.equal(W.cycleHung(m,v,NOW+149999),false);assert.equal(W.cycleHung(m,v,NOW+150000),true);
  assert.equal(W.cycleHung(m,{...v,paused:true},NOW+150000),false);W.reserveRestart(m,NOW+150000);assert.equal(W.cycleHung(JSON.parse(JSON.stringify(m)),v,NOW+300000),false);
});

test('resource recovery yields the stalled excursion to the existing controller and persists backoff first',async()=>{
  const r=rig('mine');r.until(5*MIN);const action=r.take(),calls=[];
  await W.recover(r.mem,r.s,action,{executor:{close:async()=>calls.push('close')},development:{run:async task=>{assert.equal(r.mem.development.excursion.stalled,true);assert.ok(r.mem.development.resourceBackoffUntil>r.now);calls.push(task);}},autonomy:{run:async()=>assert.fail('resource owns recovery')},persist:()=>calls.push('save'),now:()=>r.now});
  assert.deepEqual(calls,['close','save','growth_materials']);assert.equal(r.mem.activityWatchdog.status,'verifying');assert.equal(r.mem.autonomy.events.some(e=>e.type==='activity_recovered'),false);
});

test('resume uses existing town/return/farm controllers, and reload/restart never issue a gameplay workflow',async()=>{
  for(const [mode,expected] of [['town','town'],['travel','autonomy_wait'],['combat','autonomy_wait']]){
    const r=rig(mode);if(mode==='town')r.mem.autonomy.trip={kind:'shop'};if(mode==='combat')r.mem.autonomy.farm.name='Field';const calls=[];
    await W.recover(r.mem,r.s,'resume',{executor:{close:async()=>calls.push('close')},autonomy:{run:async t=>calls.push(t)},persist:()=>{},policy:{},now:()=>r.now});assert.deepEqual(calls,['close',expected]);
  }
  for(const action of ['reload','restart']){const calls=[];await W.recover({}, {},action,{executor:{close:async()=>calls.push('close')},[action]:async()=>calls.push(action)});assert.deepEqual(calls,['close',action]);}
});

test('context switches and reload grace cannot claim recovery without fresh productive evidence',()=>{
  const r=rig();r.until(3*MIN);r.take();r.s.zone='Town';r.tick(190000);assert.equal(r.mem.activityWatchdog.status,'verifying');assert.equal(r.mem.autonomy.events.some(e=>e.type==='activity_recovered'),false);
});
