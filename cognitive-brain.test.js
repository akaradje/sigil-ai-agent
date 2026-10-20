'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {CognitiveBrain,validState,rankFarmingOptions,learningFarmingOptions}=require('./cognitive-brain');
const NOW=1800000000000;
function rig(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sigil-cognition-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let now=NOW;
  const options={repoDir:dir,memoryFile:path.join(dir,'.agi-brain-memory.json'),now:()=>now};
  return {dir,options,brain:new CognitiveBrain(options),advance:ms=>now+=ms};
}
function session() {
  const catalog={fingerprint:'patch-one',maps:[{id:'field',name:'Field'},{id:'field2',name:'Field Two'},{id:'town',name:'Town',town:true}],
    expByLevel:{1:1000,2:1200}};
  const mem={autonomy:{worn:[{slot:'weapon',uid:'staff',text:'Staff'}]},uiHealth:{safeIdle:false},
    dna:{genes:{skillScope:'ALL_LEARNED'},needsApply:false},
    nativeCombatProfile:{character:'Hero',job:'Mage',genes:{skillScope:'ALL_LEARNED'},at:NOW},
    gameTelemetry:{validated:true,map:'field',checkedAt:NOW,x:12,y:15}};
  const s={name:'Hero',job:'Mage',jobLv:'1',lv:'1',zone:'Field',hp:[900,1000],exp:0,gold:1000,
    hpPotions:30,mpPotions:30,autoHunt:'on'};
  return {catalog,mem,s};
}
function tick(r,f,ms,patch={}) {
  const now=r.advance(ms);f.mem.gameTelemetry.checkedAt=now;
  Object.assign(f.s,patch);
  if(f.damageObserved!==false)(f.mem.combatTelemetry ||= {}).lastDamage={zone:f.s.zone,at:now};
  r.brain.observe(f.s,f.mem,f.catalog,now);return now;
}
function warm(r,f) {
  tick(r,f,0);for(let i=0;i<6;i++)tick(r,f,10000);
}

test('perception chooses survival, learns map/mastery and retains actual transitions and repeated hazards',t=>{
  const {brain}=rig(t);
  const wm=brain.perceive({mapName:'Molten Throne',hp:250,maxHp:1000,nearbyEnemies:6});
  assert.ok(wm.immediateThreatLevel>0.6);
  assert.equal(brain.selectOptimalSkill().skillId,'kite_and_sustain');
  for(let i=0;i<6;i++)brain.recordExperience({mapName:'Molten Throne',skillId:'burst_aoe_pull',expGained:180,goldGained:500,
    durationSec:60,ttkSec:2.1,potionsUsed:1,state:{hpRatio:1},action:{skillId:'burst_aoe_pull'},nextState:{hpRatio:0.9}});
  assert.ok(brain.state.masteryIndex>1);
  assert.equal(brain.state.semanticWorldModel.maps['Molten Throne'].avgExpPerMin,180);
  assert.deepEqual(brain.state.episodic.recentTransitions[0].nextState,{hpRatio:0.9});
  for(const x of [44.2,44.4])brain.recordExperience({stuck:true,position:{x,y:89}});
  assert.equal(brain.isHazardPosition('Molten Throne',{x:44,y:89}),true);
  assert.equal(brain.isHazardPosition('Molten Throne',{}),false);
  assert.equal(brain.isHazardPosition('Molten Throne',{x:44,y:89},'other-patch'),false);
  brain.consolidateMemory();assert.ok(fs.existsSync(brain.memoryFile));
  assert.equal(validState(brain.state),true);
});

test('UCB learns context-specific normalized rewards and continues exploration',t=>{
  const {brain}=rig(t),ids=['burst_aoe_pull','single_target_snipe'];
  for(let i=0;i<40;i++)brain.recordExperience({skillId:ids[0],contextKey:'A',expGained:1e6});
  assert.equal(brain.selectOptimalSkill({contextKey:'A',skillIds:ids,threatLevel:0.3}).skillId,ids[1]);
  for(let i=0;i<10;i++)brain.recordExperience({skillId:ids[1],contextKey:'B',expGained:1e6});
  assert.equal(brain.state.proceduralSkills[ids[0]].contexts.B,undefined);
  assert.equal(brain.state.proceduralSkills[ids[1]].contexts.A,undefined);
});

test('predictions penalize dangerous maps, allow explicit curiosity and isolate contexts',t=>{
  const {brain}=rig(t);
  brain.recordExperience({mapName:'Abyssal Pit',expGained:50,died:true});
  assert.equal(brain.predictBestFarmingZone(['Abyssal Pit','New']).mapName,'New');
  assert.equal(brain.predictBestFarmingZone(['Abyssal Pit'],{contextKey:'other'}).isExploration,true);
  assert.equal(brain.predictBestFarmingZone([]),null);
});

test('consolidation creates measurable curriculum once and does not invent macro upgrades',t=>{
  const {brain}=rig(t);brain.recordExperience({mapName:'Field',skillId:'burst_aoe_pull',expGained:200,ttkSec:2});
  const params=JSON.stringify(brain.state.proceduralSkills.burst_aoe_pull.params);
  brain.consolidateMemory();const curriculum=JSON.stringify(brain.state.activeCurriculum);
  assert.equal(brain.state.activeCurriculum.targetValue,210);
  brain.consolidateMemory();assert.equal(JSON.stringify(brain.state.activeCurriculum),curriculum);
  assert.equal(JSON.stringify(brain.state.proceduralSkills.burst_aoe_pull.params),params);
});

test('atomic persistence reloads memory and recovers last valid backup from corrupt or malformed state',t=>{
  const r=rig(t),b=r.brain;
  b.recordExperience({expGained:100});b.save();
  b.recordExperience({expGained:200});b.save();
  assert.equal(new CognitiveBrain(r.options).state.totalTicksPlayed,2);
  fs.writeFileSync(b.memoryFile,'{"version":1,"proceduralSkills":null}');
  const recovered=new CognitiveBrain(r.options);assert.equal(recovered.state.totalTicksPlayed,1);
  recovered.save();assert.ok(validState(JSON.parse(fs.readFileSync(b.memoryFile))));
  assert.equal(fs.readdirSync(r.dir).some(f=>f.endsWith('.tmp')),false);
});

test('invalid schemas fall back without crashing and non-finite measurements cannot poison persistence',t=>{
  const r=rig(t);
  for(const content of ['null','[]','{"version":9}','{"version":1}']) {
    fs.writeFileSync(r.brain.memoryFile,content);
    assert.equal(new CognitiveBrain(r.options).state.totalTicksPlayed,0);
  }
  r.brain.perceive({mapName:'Field',hp:NaN,maxHp:10,nearbyEnemies:Infinity});
  r.brain.recordExperience({expGained:Infinity,goldGained:NaN,ttkSec:NaN,durationSec:NaN});
  r.brain.save();assert.equal(validState(r.brain.state),true);
});

test('memory bounds cap transitions, world contexts and hazards',t=>{
  const r=rig(t);r.brain.maxRecentEpisodes=5;
  for(let i=0;i<300;i++) {
    r.advance(1);r.brain.recordExperience({mapName:'Field '+i,expGained:10,stuck:true,position:{x:i,y:i}});
  }
  assert.equal(r.brain.state.episodic.recentTransitions.length,5);
  assert.equal(Object.keys(r.brain.state.semanticWorldModel.maps).length,128);
  assert.equal(Object.keys(r.brain.state.episodic.hazardMemories).length,256);
});

test('sampler uses cumulative EXP across level-up, native profile attribution and positive elapsed time',t=>{
  const r=rig(t),f=session();f.s.lv='2';f.catalog.expByLevel[3]=1400;warm(r,f);
  for(let i=1;i<=6;i++)tick(r,f,10000,{exp:i*10,gold:1000+i*10});
  assert.equal(r.brain.state.totalTicksPlayed,1);
  const e=r.brain.state.episodic.recentTransitions[0];
  assert.equal(e.expPerMin,720);assert.equal(e.skillId,'native_all_learned');
  assert.equal(e.state.hpRatio,0.9);assert.equal(e.nextState.hpRatio,0.9);
  for(let i=1;i<=6;i++)tick(r,f,10000,{lv:i===6?'3':'2',exp:i===6?10:60+i*5});
  assert.equal(r.brain.state.totalTicksPlayed,2);
  assert.equal(r.brain.state.episodic.recentTransitions[1].expPerMin,620);
});

test('death episodes are attributed to the previous quest even when native routing stops; polling cannot inflate hazards',t=>{
  const r=rig(t),f=session();f.s.autoQuestRunning=true;tick(r,f,0);
  tick(r,f,1000,{dead:true,hp:[0,1000],autoQuestRunning:false,autoHunt:'',exp:0});
  for(let i=0;i<5;i++)tick(r,f,1000);
  assert.equal(r.brain.state.totalTicksPlayed,1);
  assert.equal(r.brain.state.episodic.recentTransitions[0].died,true);
  assert.equal(r.brain.state.episodic.recentTransitions[0].skillId,'native_quest');
  assert.equal(Object.values(r.brain.state.episodic.hazardMemories)[0].count,1);
  tick(r,f,1000,{dead:false,hp:[900,1000],autoQuestRunning:true});
  tick(r,f,1000,{dead:true,hp:[0,1000],autoQuestRunning:false});
  assert.equal(Object.values(r.brain.state.episodic.hazardMemories)[0].count,2);
});

test('gaps, panels, reloads, stale positions, character changes and patch changes invalidate learning windows',t=>{
  for(const change of ['gap','panel','loading','stale','character','patch','genes','missing-exp']) {
    const r=rig(t),f=session();tick(r,f,0);
    for(let i=0;i<4;i++)tick(r,f,10000,{exp:i+1});
    if(change==='gap')tick(r,f,11000,{exp:10});
    if(change==='panel')tick(r,f,1000,{panelOpen:true});
    if(change==='loading'){f.mem.gameTelemetry.loading=true;tick(r,f,1000);}
    if(change==='stale'){f.mem.gameTelemetry.checkedAt=NOW;r.brain.observe(f.s,f.mem,f.catalog,r.advance(1000));}
    if(change==='character')tick(r,f,1000,{name:'Other'});
    if(change==='patch'){f.catalog.fingerprint='new';tick(r,f,1000);}
    if(change==='genes'){f.mem.dna.needsApply=true;tick(r,f,1000);}
    if(change==='missing-exp')tick(r,f,1000,{exp:null});
    if(['gap','panel','loading','stale','genes','missing-exp'].includes(change))assert.equal(r.brain.window?.at===NOW,false,change);
    else assert.ok(!r.brain.window||r.brain.window.at!==NOW,change);
    assert.equal(r.brain.state.totalTicksPlayed,0,change);
  }
});

test('ranking only changes fully measured eligible routes and never inserts an unknown map',()=>{
  const options=[{id:'a',name:'A'},{id:'b',name:'B'}];
  const view={enabled:true,mapPredictions:[{mapName:'A',durationSec:120,predictedUtility:10},
    {mapName:'B',durationSec:120,predictedUtility:100},{mapName:'UNSAFE',durationSec:120,predictedUtility:1e6}]};
  assert.deepEqual(rankFarmingOptions(options,view).map(m=>m.id),['b','a']);
  view.mapPredictions[1].durationSec=60;
  assert.deepEqual(rankFarmingOptions(options,view),options);
  view.enabled=false;assert.deepEqual(rankFarmingOptions(options,view),options);
});

test('cold-start routes exclude beginner, overlevelled, town and DNA-quarantined maps before prediction',t=>{
  const {brain}=rig(t);
  const catalog={maps:[{id:'town',name:'Town',town:true,monsters:[]},
    ...['beginner','near','hot','too-high','boss'].map(id=>({id,name:id,monsters:[{id}]}))],
    monsters:[{id:'beginner',lv:5,hp:1,exp:1000,drops:[]},{id:'near',lv:55,hp:100,exp:10,drops:[]},
      {id:'hot',lv:62,hp:100,exp:10,drops:[]},{id:'too-high',lv:70,hp:1,exp:1000,drops:[]},
      {id:'boss',lv:60,hp:100,exp:100,drops:[],boss:true}]};
  const eligible=learningFarmingOptions(catalog,{lv:'Lv 60',job:'Starweaver'},{dna:{avoidMaps:['hot']}});
  assert.deepEqual(eligible.map(m=>m.id),['near']);
  assert.equal(brain.predictBestFarmingZone(eligible.map(m=>m.name)).mapName,'near');
  assert.deepEqual(learningFarmingOptions(catalog,{lv:'unknown'}),[]);
});

test('warm-up discards the first 60 seconds and then measures a fresh full minute',t=>{
  const r=rig(t),f=session();tick(r,f,0);
  for(let i=1;i<=6;i++)tick(r,f,10000,{exp:i*10});
  assert.equal(r.brain.state.totalTicksPlayed,0);
  assert.equal(r.brain.workingMemory.learningPhase,'measuring');
  assert.equal(r.brain.window.at,NOW+60000);
  for(let i=1;i<=5;i++)tick(r,f,10000,{exp:60+i});
  tick(r,f,9999,{exp:66});assert.equal(r.brain.state.totalTicksPlayed,0);
  tick(r,f,1);
  assert.equal(r.brain.state.totalTicksPlayed,1);
  assert.equal(r.brain.state.episodic.recentTransitions[0].expPerMin,60);
});

test('AUTO running without observed target damage cannot finish warm-up',t=>{
  const r=rig(t),f=session();f.damageObserved=false;tick(r,f,0);
  for(let i=0;i<18;i++)tick(r,f,10000,{exp:10});
  assert.equal(r.brain.state.totalTicksPlayed,0);assert.equal(r.brain.window,null);
  assert.equal(r.brain.workingMemory.learningPhase,'waiting-for-combat');
  f.damageObserved=true;tick(r,f,1000);assert.equal(r.brain.workingMemory.warmupRemainingSec,60);
});

test('map/profile changes, damage gaps and unavailable telemetry restart the entire warm-up',t=>{
  for(const change of ['map','profile','damage-gap','loading','clock-gap']) {
    const r=rig(t),f=session();warm(r,f);tick(r,f,10000,{exp:5});
    if(change==='map'){f.mem.gameTelemetry.map='field2';f.s.zone='Field Two';}
    if(change==='profile')f.mem.nativeCombatProfile.genes.skillScope='HOTBAR';
    if(change==='damage-gap'){f.damageObserved=false;tick(r,f,10000);}
    if(change==='loading'){f.mem.gameTelemetry.loading=true;tick(r,f,1000);f.mem.gameTelemetry.loading=false;}
    const now=tick(r,f,change==='clock-gap'?11000:1000);
    if(change!=='damage-gap') {
      assert.equal(r.brain.warmup.since,now,change);
      assert.equal(r.brain.workingMemory.warmupRemainingSec,60,change);
    }else assert.equal(r.brain.warmup,null);
    assert.equal(r.brain.window,null,change);assert.equal(r.brain.state.totalTicksPlayed,0,change);
  }
});

test('confirmed position faults after a censored window are remembered once without fictional skill credit',t=>{
  const r=rig(t),f=session();tick(r,f,0);
  f.mem.gameTelemetry.positionFault=true;tick(r,f,1000);
  for(let i=0;i<30;i++)tick(r,f,1000);
  f.mem.gameTelemetry.confirmed=true;tick(r,f,1000);tick(r,f,1000);
  assert.equal(r.brain.state.totalTicksPlayed,1);
  const e=r.brain.state.episodic.recentTransitions[0];
  assert.equal(e.stuck,true);assert.equal(e.skillId,null);
  assert.equal(r.brain.state.proceduralSkills.native_all_learned.uses,0);
});

test('an unverified native configuration earns no skill mastery',t=>{
  const r=rig(t),f=session();delete f.mem.nativeCombatProfile;tick(r,f,0);
  for(let i=1;i<=7;i++)tick(r,f,10000,{exp:i*10});
  assert.equal(r.brain.state.totalTicksPlayed,0);
  assert.equal(r.brain.workingMemory.activeSkillId,null);
});

test('town consolidation requires serviced, verified inventory and runs once per new experience',t=>{
  const {brain}=rig(t),f=session(),H=require('./session-hygiene');
  brain.recordExperience({expGained:100});f.s.zone='Town';f.s.autoHunt='';
  f.mem.gameTelemetry.map='town';f.mem.autonomy.trip={phase:'return'};
  assert.equal(H.consolidateTown(f.mem,f.s,f.catalog,brain,NOW),null);
  f.mem.autonomy.bagUsage=[50,100];
  assert.ok(H.consolidateTown(f.mem,f.s,f.catalog,brain,NOW));
  assert.equal(H.consolidateTown(f.mem,f.s,f.catalog,brain,NOW),null);
  brain.recordExperience({expGained:100});f.s.target='Monster';
  assert.equal(H.consolidateTown(f.mem,f.s,f.catalog,brain,NOW),null);
});

test('failed persistence is observable and leaves no partially written main file',t=>{
  const r=rig(t);r.brain.memoryFile=path.join(r.dir,'blocked','memory.json');
  fs.writeFileSync(path.join(r.dir,'blocked'),'not a directory');
  assert.throws(()=>r.brain.save());
  assert.equal(fs.readFileSync(path.join(r.dir,'blocked'),'utf8'),'not a directory');
});
