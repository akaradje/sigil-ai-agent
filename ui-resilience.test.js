'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const UI=require('./ui-resilience');
const healthy=()=>({name:'Hero',job:'Starweaver',lv:'Lv 59',jobLv:'Job 14',hp:[900,1000],mp:[700,900],gold:120000,crystals:5000,zone:'Field',exp:40,controls:[]});

test('sustained over-cap HP allows a bounded reload while gameplay remains blocked',()=>{
  const now=1800000000000,s={...healthy(),hp:[1050,1000]},m={gameTelemetry:{validated:true,checkedAt:now}};
  UI.update(m,s,now-30000);UI.update(m,s,now);
  assert.equal(UI.recoveryDue(m,s,now),true);assert.throws(()=>UI.assertReady(m.uiHealth,now),/Safe Idle/);
  m.uiRecovery={at:now,pending:true,history:[now]};assert.equal(UI.recoveryDue(m,s,now),false);
  m.gameTelemetry.checkedAt=now+600000;UI.update(m,s,now+600000);assert.equal(UI.recoveryDue(m,s,now+600000),true);
  m.uiRecovery={at:now+600000,pending:true,history:[now,now+600000]};
  m.gameTelemetry.checkedAt=now+1200000;UI.update(m,s,now+1200000);assert.equal(UI.recoveryDue(JSON.parse(JSON.stringify(m)),s,now+1200000),false);
});

test('HUD reload cannot bypass loading, missing fields, recent faults or unsettled purchases',()=>{
  const now=1800000000000;
  for(const change of [x=>{x.s.hp=null;},x=>{x.s.gold=null;},x=>{x.s.modalText='Buy?';},x=>{x.m.gameTelemetry.loading=true;},x=>{x.m.gameTelemetry.checkedAt=now-6000;},x=>{x.m.autonomy.purchase={status:'unknown'};},x=>{x.m.uiHealth.badSince=now-29999;}]){
    const x={s:{...healthy(),hp:[1050,1000]},m:{gameTelemetry:{validated:true,checkedAt:now}}};UI.update(x.m,x.s,now-30000);UI.update(x.m,x.s,now);change(x);
    assert.equal(UI.recoveryDue(x.m,x.s,now),false);
  }
});
test('fixed schema blocks an initially broken page and critical HP loss even below 30 percent',()=>{
  assert.equal(UI.assess(healthy()).blocked,false);
  const s=healthy();delete s.hp;assert.equal(UI.assess(s).blocked,true);
  assert.equal(UI.assess({}).blocked,true);
  Object.assign(s,healthy(),{zone:'',mp:null,gold:null});assert.equal(UI.assess(s).blocked,false);
  s.crystals=null;assert.equal(UI.assess(s).loss,0.4);assert.equal(UI.assess(s).blocked,true);
});
test('Safe Idle is immediate, notification waits for sustained failure, recovery is debounced and survives restart',()=>{
  let m={};UI.update(m,healthy(),1000);UI.update(m,{},2000);
  assert.equal(m.uiHealth.safeIdle,true);assert.throws(()=>UI.assertReady(m.uiHealth,2000),/Safe Idle/);
  assert.equal(m.autonomy.events.length,0);UI.update(m,{},17000);
  assert.equal(m.autonomy.events[0].type,'ui_changed');
  m=JSON.parse(JSON.stringify(m));UI.update(m,{},30000);assert.equal(m.autonomy.events.length,1);
  UI.update(m,healthy(),31000);UI.update(m,healthy(),40000);assert.equal(m.uiHealth.safeIdle,true);
  UI.update(m,healthy(),41000);assert.equal(m.uiHealth.safeIdle,false);
  assert.deepEqual(m.autonomy.events.map(e=>e.type),['ui_changed','ui_recovered']);
  assert.doesNotThrow(()=>UI.assertReady(m.uiHealth,41000));assert.throws(()=>UI.assertReady(m.uiHealth,52000));
});
test('unique visible Play permits reconnect without falsely declaring schema recovery',()=>{
  const m={};UI.update(m,{},1000);UI.update(m,{},16000);
  UI.update(m,{atCharSelect:true,controls:[{label:'▶ Play'}]},17000);
  assert.equal(m.uiHealth.login,true);assert.equal(m.uiHealth.safeIdle,true);
  assert.doesNotThrow(()=>UI.assertReady(m.uiHealth,17000));
  assert.equal(m.autonomy.events.length,1);
  assert.equal(UI.assess({atCharSelect:true,controls:[{label:'Play'},{label:'Play'}]}).login,false);
});
test('transient loading stops input but does not send an incident or recovery alert',()=>{
  const m={};UI.update(m,{},1000);UI.update(m,healthy(),2000);UI.update(m,healthy(),12000);
  assert.equal(m.uiHealth.safeIdle,false);assert.equal(m.autonomy.events.length,0);
});
test('HP bar timing censors switching, healing, missing targets and sampling gaps',()=>{
  const m={},s={...healthy(),target:'Mob',targetHP:'100 / 100'};
  UI.observeCombat(m,s,1000);UI.observeCombat(m,{...s,targetHP:'50 / 100'},2000);
  UI.observeCombat(m,{...s,targetHP:'0 / 100'},3000);
  assert.equal(m.combatTelemetry.current.count,1);assert.equal(m.combatTelemetry.current.medianSeconds,2);
  UI.observeCombat(m,s,4000);UI.observeCombat(m,{...s,target:'Other',targetHP:'0 / 100'},5000);
  UI.observeCombat(m,s,6000);UI.observeCombat(m,{...s,targetHP:'50 / 100'},7000);
  UI.observeCombat(m,{...s,targetHP:'90 / 100'},8000);UI.observeCombat(m,{...s,targetHP:'0 / 100'},9000);
  UI.observeCombat(m,s,10000);UI.observeCombat(m,{...s,targetHP:'0 / 100'},15000);
  UI.observeCombat(m,s,16000);UI.observeCombat(m,{...s,target:''},17000);UI.observeCombat(m,{...s,targetHP:'0 / 100'},18000);
  assert.equal(m.combatTelemetry.samples.length,1);
});
test('public target identity censors a same-name target switch',()=>{
  const m={},s={...healthy(),target:'Mob',targetIdentity:'one',targetHP:'100 / 100'};
  UI.observeCombat(m,s,1000);UI.observeCombat(m,{...s,targetHP:'50 / 100'},2000);
  UI.observeCombat(m,{...s,targetIdentity:'two',targetHP:'0 / 100'},3000);
  assert.equal(m.combatTelemetry.samples.length,0);
});
test('an expected position-recovery reload does not cause a false UI structure incident',()=>{
  const m={positionRecovery:{pending:true,at:1000}};
  UI.update(m,{},1000);UI.update(m,{},20000);
  assert.equal(m.uiHealth.safeIdle,true);assert.equal(m.autonomy.events.length,0);
  UI.update(m,{},92000);assert.equal(m.autonomy.events[0].type,'ui_changed');
});

test('a kill is measured when a different target takes over after damage',()=>{
 const mem={};const now=1800000000000;
 const s={name:'Hero',zone:'Field',target:'Bone Dragonling',targetHpRatio:1,targetHP:'100 / 100'};
 UI.observeCombat(mem,s,now);
 UI.observeCombat(mem,{...s,targetHpRatio:0.5,targetHP:'50 / 100'},now+1000);
 UI.observeCombat(mem,{...s,target:'Mudcroak',targetIdentity:'m2',targetHpRatio:1,targetHP:'80 / 80'},now+4000);
 assert.equal((mem.combatTelemetry.samples||[]).length,1);
 assert.equal(mem.combatTelemetry.samples[0].seconds,4);
 assert.equal(mem.combatTelemetry.samples[0].zone,'Field');
 assert.equal(mem.combatTelemetry.zones.Field.count,1);
 assert.equal(mem.combatTelemetry.zones.Field.medianSeconds,4);
 // A target that was never damaged is not a kill, and a missing target is censored.
 const mem2={};
 UI.observeCombat(mem2,s,now);
 UI.observeCombat(mem2,{...s,target:'Mudcroak',targetIdentity:'m2',targetHpRatio:1,targetHP:'80 / 80'},now+3000);
 assert.equal((mem2.combatTelemetry.samples||[]).length,0);
 const mem3={};
 UI.observeCombat(mem3,s,now);
 UI.observeCombat(mem3,{...s,targetHpRatio:0.5,targetHP:'50 / 100'},now+1000);
 UI.observeCombat(mem3,{...s,target:'',targetHpRatio:null,targetHP:''},now+4000);
 assert.equal((mem3.combatTelemetry.samples||[]).length,0);
});
