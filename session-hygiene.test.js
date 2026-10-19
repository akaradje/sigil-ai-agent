'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const H=require('./session-hygiene'),A=require('./autonomy');
const now=1800000000000,HOUR=3600000;
const catalog=()=>({levelCap:99,gear:[],jobs:{},maps:[{id:'town',name:'Town',town:true}],expByLevel:{}});
const state=()=>({name:'Hero',lv:'Lv 60',job:'Starweaver',zone:'Town',hp:[900,1000],hpPotions:30,mpPotions:30,controls:[],offscreen:[]});
function rig(){const m={},a=A.init(m);H.observe(m,{sessionStartedAt:now-7*HOUR},now);
  m.gameTelemetry={map:'town',validated:true,positionFault:false,checkedAt:now};m.uiHealth={safeIdle:false};
  a.trip={phase:'return',at:now,returnMap:'field',returnMode:'mq',hygiene:{ready:true,readyAt:now,bagUsage:[70,100]}};return m;}
test('session age uses browser time origin and survives a Node process restart',()=>{
  let m={};assert.equal(H.due(m,now),false);H.observe(m,{sessionStartedAt:now-7*HOUR},now);
  m=JSON.parse(JSON.stringify(m));assert.equal(H.due(m,now),true);assert.equal(m.sessionHygiene.ageHours,7);
  H.observe(m,{sessionStartedAt:now+100000},now);assert.equal(m.sessionHygiene.startedAt,now-7*HOUR);
});
test('refresh is permitted only after verified town services, with no combat, modal or uncertain spending',()=>{
  const m=rig(),s=state();assert.equal(H.eligible(m,s,catalog(),now),true);
  for(const patch of [{target:'Monster'},{autoQuestRunning:true},{autoHunt:'on'},{panelOpen:true},{modalText:'Confirm'},{mpPotions:0},{hp:[0,1000]}])
    assert.equal(H.eligible(m,{...s,...patch},catalog(),now),false);
  m.autonomy.purchase={status:'unknown'};assert.equal(H.eligible(m,s,catalog(),now),false);delete m.autonomy.purchase;
  m.autonomy.trip.hygiene.bagUsage=[95,100];assert.equal(H.eligible(m,s,catalog(),now),false);
  m.autonomy.trip.hygiene.bagUsage=[70,100];m.gameTelemetry.map='field';assert.equal(H.eligible(m,s,catalog(),now),false);
});
test('reload intent is persisted before refresh and resumed route survives restart without another refresh',()=>{
  let m=rig();H.prepare(m,now);m=JSON.parse(JSON.stringify(m));
  assert.equal(m.autonomy.trip,null);assert.equal(m.autonomy.resume.map,'field');assert.equal(H.due(m,now+HOUR),false);
  assert.equal(H.completed(m,{...state(),autoQuestRunning:true},now+10000),false);
  H.observe(m,{sessionStartedAt:now+1000},now+10000);
  assert.equal(H.completed(m,state(),now+10000),false);
  assert.equal(H.completed(m,{...state(),autoQuestRunning:true},now+10000),true);
  assert.equal(H.due(m,now+HOUR),false);
});
test('a town return verifies a complete fresh bag before marking refresh ready',async()=>{
  const m=rig();delete m.autonomy.trip.hygiene;let panel=null;
  const c=A.createController({mem:m,getCatalog:catalog,policy:{goldReserve:100000},now:()=>now,
    observe:async()=>({...state(),panel,panelOpen:!!panel,inventoryComplete:panel==='bag',bagUsage:panel==='bag'?[70,100]:null,inventoryItems:{}}),
    open:async p=>{panel=p;},close:async()=>{panel=null;},click:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('town');assert.equal(m.autonomy.trip.hygiene.ready,true);assert.deepEqual(m.autonomy.trip.hygiene.bagUsage,[70,100]);assert.equal(panel,null);
});
test('an unserviceable full bag defers optional refresh and returns to gameplay',async()=>{
  const m=rig();m.autonomy.trip.returnMap=null;m.autonomy.trip.hygiene={started:now,storageTried:true,shopAttempts:0};let panel=null;
  const c=A.createController({mem:m,getCatalog:catalog,policy:{goldReserve:100000},now:()=>now,
    observe:async()=>({...state(),panel,inventoryComplete:panel==='bag',bagUsage:[100,100],inventoryItems:{}}),
    open:async p=>{panel=p;},close:async()=>{panel=null;},click:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('town');assert.equal(m.autonomy.trip,null);assert.ok(m.autonomy.resume);assert.match(m.sessionHygiene.deferred,/Bag/);
});
