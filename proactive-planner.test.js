'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),P=require('./proactive-planner'),DNA=require('./strategy-dna');
const MIN=60000,NOW=200*MIN;
test('verified activity escalation creates one repair opportunity; pending or stale suspicions do not',()=>{
 const {s,m,catalog}=fixture();m.activityWatchdog={status:'recovery-pending',incident:{id:1,reason:'COMBAT_IDLE'},evidence:{at:NOW,samples:40,durationSec:600,map:'field',mode:'combat',attempts:3}};
 P.update(m,s,catalog,NOW);a.equal(P.init(m).opportunities.length,0);
 m.activityWatchdog.status='escalated';P.update(m,s,catalog,NOW);P.update(m,s,catalog,NOW);a.equal(P.init(m).opportunities.filter(o=>o.reason==='VERIFIED_ACTIVITY_STALL').length,1);
 P.init(m).opportunities=[];m.activityWatchdog.evidence.at=NOW-61*MIN;P.update(m,s,catalog,NOW);a.equal(P.init(m).opportunities.length,0);
});
function fixture(){const catalog={fingerprint:'patch',levelCap:100,jobs:{mage:{line:['mage'],weapon:'staff'}},gear:[],maps:[],expByLevel:Object.fromEntries(Array.from({length:101},(_,i)=>[i,100]))};
 return {s:{name:'test',job:'Mage',lv:'Lv 76',zone:'Field',exp:20,gold:100000,hp:[100,100],hpPotions:50,mpPotions:50},m:{gameTelemetry:{validated:true,checkedAt:NOW},autonomy:{bagUsage:[0,100]},equipment:{power:100},cognitive:{workingMemory:{learningPhase:'waiting-for-combat'}}},catalog};}
test('two minute cold-start probe respects fresh telemetry, work ownership, health, potions and cooldown',()=>{
 const {s,m,catalog}=fixture();P.update(m,s,catalog,NOW);m.gameTelemetry.checkedAt=NOW+2*MIN;P.update(m,s,catalog,NOW+2*MIN);
 a.equal(P.probeDue(m,s,catalog,NOW+2*MIN),true);
 for(const section of ['trip','resume','resourceHold']){m.autonomy[section]=section==='resourceHold'?{active:true}:{at:NOW};a.equal(P.probeDue(m,s,catalog,NOW+2*MIN),false);delete m.autonomy[section];}
 m.development={excursion:{kind:'mine'}};a.equal(P.probeDue(m,s,catalog,NOW+2*MIN),false);delete m.development;
 for(const patch of [{dead:true},{panelOpen:true},{autoQuestRunning:true},{hpPotions:0},{hp:[30,100]}])a.equal(P.probeDue(m,{...s,...patch},catalog,NOW+2*MIN),false);
 a.equal(P.probeDue(m,s,catalog,NOW+3*MIN),false);
 P.init(m).lastProbe=NOW+2*MIN;a.equal(P.probeDue(m,s,catalog,NOW+2*MIN),false);
});
test('only thirty minutes of continuous observed combat with comparable EXP/power establishes plateau',()=>{
 const {s,m,catalog}=fixture();for(let i=0;i<=30;i++){const now=NOW+i*MIN;m.gameTelemetry.checkedAt=now;m.combatTelemetry={lastDamage:{zone:s.zone,at:now}};P.update(m,s,catalog,now);}
 a.equal(P.init(m).opportunities.filter(x=>x.reason==='VERIFIED_GROWTH_PLATEAU').length,1);
 const other=fixture();for(let i=0;i<=35;i++){const now=NOW+i*MIN;other.m.gameTelemetry.checkedAt=now;P.update(other.m,other.s,catalog,now);}a.equal(P.init(other.m).opportunities.length,0);
 s.lv='Lv 77';P.update(m,s,catalog,NOW+31*MIN);a.equal(P.init(m).samples.length,0);
});
test('real cap stockpiles compatible top recipes only; unknown caps and incomplete gear never qualify',()=>{
 const {s,m,catalog}=fixture();catalog.gear=[{id:'staff',lv:80,tier:5,line:'mage',fam:'staff',craft:{gold:100,mats:{ore:3}}},{id:'sword',lv:80,tier:5,line:'knight',fam:'sword',craft:{gold:100,mats:{other:3}}}];
 a.equal(DNA.stockpilePlan(catalog,s,m),null);s.lv='Lv 100';m.autonomy.gearCapped=true;m.autonomy.inventory={items:{ore:1}};
 const plan=DNA.stockpilePlan(catalog,s,m);a.equal(plan.kind,'stockpile');a.deepEqual(plan.cost.mats,{ore:6});a.equal(plan.missing[0].missing,5);
 catalog.levelCap=null;a.equal(DNA.stockpilePlan(catalog,s,m),null);
});
test('a combat window interrupted by managed work cannot establish a plateau',()=>{
 const {s,m,catalog}=fixture();for(let i=0;i<=40;i++){const now=NOW+i*MIN;m.gameTelemetry.checkedAt=now;m.combatTelemetry={lastDamage:{zone:s.zone,at:now}};
  m.autonomy.trip=i===20?{kind:'shop'}:null;P.update(m,s,catalog,now);}
 a.equal(P.init(m).opportunities.length,0);
});
test('due combat probes precede ordinary pet/rank/configuration work but never safety, earned points, tame offers or a full bag',()=>{
 const {s,m,catalog}=fixture();P.init(m).idleSince=NOW-2*MIN;
 a.equal(P.prioritizeProbe(m,s,catalog,{planned:'configure',growth:'pets'},NOW),true);
 for(const planned of ['revive','survive','class','stats','skills'])a.equal(P.prioritizeProbe(m,s,catalog,{planned,growth:'pets'},NOW),false);
 a.equal(P.prioritizeProbe(m,s,catalog,{planned:'configure',growth:'tame'},NOW),false);
 m.autonomy.bagUsage=[95,100];a.equal(P.probeDue(m,s,catalog,NOW),false);
});
