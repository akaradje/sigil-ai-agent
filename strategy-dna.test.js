'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const D=require('./strategy-dna');
const NOW=1800000000000,MIN=60000;
const catalog=()=>({fingerprint:'patch1',expByLevel:Object.fromEntries(Array.from({length:101},(_,i)=>[i+1,100000000])),
  maps:[{id:'field',name:'Field'},{id:'town',name:'Town',town:true}],monsters:[{id:'mob',drops:[['rare',0.01]]}]});
const state=()=>({name:'Hero',job:'Starweaver',lv:'Lv 60',jobLv:'Job 20',zone:'Field',exp:10,gold:1000000,hp:[950,1000],hpPotions:1000,mpPotions:1000,autoQuestRunning:true});
function rig(random=()=>0.3){let saved=null;const store={load:()=>saved&&structuredClone(saved),save:d=>{saved=structuredClone(d);}};
  const e=new D.Engine({store,random,now:NOW}),m={autonomy:{worn:[{slot:'weapon',uid:'one',text:'Staff +2'}]},uiHealth:{safeIdle:false}},s=state(),c=catalog();
  const t={map:'field',x:100,y:100,validated:true};e.observe(s,m,c,t,NOW);e.applied(true,NOW);return {e,m,s,c,t,store,getSaved:()=>saved};}
function runWindow(r,at,rate=1000){r.e.observe(r.s,r.m,r.c,r.t,at);
  for(let elapsed=15000;elapsed<=15*MIN;elapsed+=15000){r.s.exp+=rate*0.25/r.c.expByLevel[60]*100;r.s.gold+=25;r.e.observe(r.s,r.m,r.c,r.t,at+elapsed);}
  return at+15*MIN;
}
function readyTrial(){const r=rig();let at=runWindow(r,NOW);at=runWindow(r,at+15000);
  assert.equal(r.e.view(at).needsApply,true);assert.equal(r.e.active().phase,'experiment');r.e.applied(true,at);return {...r,at};}
test('genome validator ignores extra permissions, keeps fixed spending limits and clamps native values',()=>{
  const g=D.genes({hpPotionThreshold:0,bagReturnThreshold:0.99,ttkToleranceSec:900,skillScope:'arbitrary',craftPriorityBias:'UNLIMITED',crystalBudget:99999});
  assert.deepEqual(g,{...D.DEFAULT,ttkToleranceSec:6});assert.equal('crystalBudget' in g,false);
});
test('other tools cannot silently alter the measured native genome or disable potion protection',()=>{
  const m={dna:{genes:D.DEFAULT}};
  assert.equal(D.nativeControl({act:'aopt',k:'hp',v:'40'},m).allowed,false);
  assert.equal(D.nativeControl({act:'aopt',k:'stopNoPot',v:'false'},m).allowed,false);
  assert.equal(D.nativeControl({act:'ahot',label:'Hotbar only'},m).allowed,false);
  assert.equal(D.nativeControl({act:'aopt',k:'hp',v:'60'},m).allowed,true);
});
test('defensive all-learned recovery is permitted but invalidates a hotbar trial',()=>{
  assert.deepEqual(D.nativeControl({act:'ahot',label:'All learned'},{dna:{genes:{skillScope:'HOTBAR'}}}),{allowed:true,invalidate:true});
});
test('crossover and mutation alter at most one supported locus',()=>{
  for(const rand of [0,0.3,0.6,0.99]){
    const g=D.offspring(D.DEFAULT,{...D.DEFAULT,skillScope:'HOTBAR'},()=>rand,true);
    assert.equal(Object.keys(g).filter(k=>g[k]!==D.DEFAULT[k]).length,1);
    assert.ok([0.4,0.6].includes(g.hpPotionThreshold));assert.ok(g.bagReturnThreshold<=0.95);
  }
});
test('contextual UCB explores untried strategies but never quarantined arms',()=>{
  const a=D.arm(D.DEFAULT),b=D.arm({...D.DEFAULT,bagReturnThreshold:0.9});D.record(a,{score:1});
  assert.equal(D.select([a,b],1,NOW).id,b.id);b.blockedUntil=NOW+MIN;assert.equal(D.select([a,b],1,NOW).id,a.id);
});
test('fitness includes wall-clock downtime, net gold and restock-adjusted potion consumption',()=>{
  const w={at:NOW,exp:100,gold:1000,hpPots:100,mpPots:50,hpBought:0,mpBought:0,rare:2,deaths:0,stuckMinutes:0,expStep:10000,covered:1800,field:1200,minHp:0.6};
  const r=D.fitness(w,{exp:3100,gold:4000,hpPots:110,mpPots:45,hpBought:20,mpBought:0},NOW+30*MIN);
  assert.equal(r.expRate,100);assert.equal(r.goldRate,100);assert.equal(r.potionRate,0.5);assert.equal(r.fieldFraction,2/3);
  assert.equal(D.fitness(w,{exp:3100,gold:4000},NOW),null);
});
test('no fitness window begins before native settings have been verified',()=>{
  const r=rig();r.e.db.active.needsApply=true;r.e.observe(r.s,r.m,r.c,r.t,NOW+MIN);
  assert.equal(r.e.db.active.window,null);r.e.applied(true,NOW+MIN);r.e.observe(r.s,r.m,r.c,r.t,NOW+MIN+15000);assert.ok(r.e.db.active.window);
});
test('two baseline windows select a bounded one-gene trial, not a fabricated elite',()=>{
  const r=readyTrial();assert.equal(r.e.active().generation,0);assert.equal(r.e.desired().ttkToleranceSec,3.8);
  assert.equal(r.e.events().some(e=>e.type==='dna_evolved'),false);
});
test('two repeat windows with a measured improvement promote the elite and emit the measured delta',()=>{
  const r=readyTrial();let at=runWindow(r,r.at+15000,1200);at=runWindow(r,at+15000,1200);
  const event=r.e.events().find(e=>e.type==='dna_evolved');assert.ok(event);assert.equal(event.detail.gainPercent,20);
  assert.equal(r.e.active().generation,1);assert.equal(r.e.active().arms[r.e.active().elite].genes.ttkToleranceSec,3.8);
});
test('performance regression rolls back before completing the trial and persists quarantine',()=>{
  const r=readyTrial(),elite=r.e.active().elite;r.e.observe(r.s,r.m,r.c,r.t,r.at+15000);
  for(let n=1;n<=20;n++){r.s.exp+=100*0.25/100000000*100;r.e.observe(r.s,r.m,r.c,r.t,r.at+15000+n*15000);}
  assert.equal(r.e.db.active.current,elite);assert.equal(r.e.view().needsApply,true);assert.ok(r.e.events().some(e=>e.type==='dna_rollback'));
});
test('death aborts a trial immediately, records a deduplicated coordinate and restores elite genes',()=>{
  const r=readyTrial();r.s.dead=true;r.s.hp=[0,1000];
  r.e.guard(r.s,r.m,r.c,r.t,r.at+1000);r.e.guard(r.s,r.m,r.c,r.t,r.at+2000);
  assert.equal(r.e.db.active.current,r.e.active().elite);assert.equal(r.e.db.immunity.length,1);assert.equal(r.e.db.immunity[0].count,1);
});
test('agent restart retains elite/immunity but cannot continue an unobserved trial window',()=>{
  const r=readyTrial();r.e.quarantine('outside',r.s,r.m,r.c,r.t,r.at);r.e.save(r.at,true);
  const fresh=new D.Engine({store:r.store,now:r.at+1000});assert.equal(fresh.db.active.current,fresh.active().elite);
  assert.equal(fresh.db.active.window,null);assert.equal(fresh.view().needsApply,true);assert.equal(fresh.db.immunity.length,1);
});
test('restoring an older checkpoint cannot reuse event IDs already transferred to Telegram',()=>{
  const r=rig();r.e.save(NOW,true);
  const fresh=new D.Engine({store:r.store,now:NOW+1000,lastEventStore:r.e.db.identity,lastEventId:20});
  fresh.emit('dna_drift',{},NOW+1000);assert.equal(fresh.events()[0].id,21);
});
test('browser refresh discards the old trial window and requires native settings verification again',()=>{
  const r=readyTrial();r.e.guard(r.s,r.m,r.c,{...r.t,sessionStartedAt:NOW-1000},r.at);
  r.e.guard(r.s,r.m,r.c,{...r.t,sessionStartedAt:r.at+1000},r.at+2000);
  assert.equal(r.e.db.active.current,r.e.active().elite);assert.equal(r.e.view().needsApply,true);assert.equal(r.e.db.active.window,null);
});
test('position hazards before the first field context still persist as private immunity memory',()=>{
  const r=rig();r.e.db.active=null;r.e.guard(r.s,r.m,r.c,{...r.t,map:'town',positionFault:true,x:10000},NOW);
  assert.equal(r.e.db.immunity.length,1);assert.equal(r.e.db.immunity[0].map,'town');
});
test('verified cap stockpiling can collect fitness without an EXP percentage or a false EXP stall',()=>{
  const r=rig();r.s.lv='Lv 99';r.s.exp=null;r.m.autonomy.cap={atCap:true};
  r.e.observe(r.s,r.m,r.c,r.t,NOW+1000);r.e.applied(true,NOW+1000);
  r.e.observe(r.s,r.m,r.c,r.t,NOW+2000);
  for(let i=1;i<=24;i++){r.s.gold+=10;r.e.observe(r.s,r.m,r.c,r.t,NOW+2000+i*15000);}
  assert.ok(r.e.db.active.window);assert.equal(r.e.db.active.window.stuckMinutes,0);
});
test('sampling gaps, managed town time and UI faults cannot manufacture a successful genome',()=>{
  const r=readyTrial();r.e.observe(r.s,r.m,r.c,r.t,r.at+15000);r.e.observe(r.s,r.m,r.c,r.t,r.at+MIN+15000);
  assert.equal(r.e.db.active.current,r.e.active().elite);assert.equal(r.e.events().some(e=>e.type==='dna_evolved'),false);
  r.m.uiHealth.safeIdle=true;r.e.observe(r.s,r.m,r.c,r.t,r.at+2*MIN);assert.equal(r.e.db.active.window,null);
});
test('patch/bracket changes open a new context and speed validation without expanding gene bounds',()=>{
  const r=rig();r.e.observe(r.s,r.m,r.c,r.t,NOW);const old=r.e.view(NOW).context;
  r.c.fingerprint='patch2';r.s.lv='Lv 70';r.e.observe(r.s,r.m,r.c,r.t,NOW+15000);
  assert.notEqual(r.e.view().context,old);assert.equal(r.e.view(NOW+15000).mode,'hyper-validation');assert.deepEqual(r.e.desired(),D.DEFAULT);
});
test('repeated coordinate failures exclude optional map trials only for their patch and TTL',()=>{
  const r=rig();r.e.quarantine('outside',r.s,r.m,r.c,r.t,NOW);r.e.quarantine('outside',r.s,r.m,r.c,r.t,NOW+11*MIN);
  assert.deepEqual(r.e.view(NOW+11*MIN).avoidMaps,['field']);assert.deepEqual(r.e.view(NOW+7*60*MIN).avoidMaps,[]);
  r.e.active().data.patch='new';assert.deepEqual(r.e.view(NOW+11*MIN).avoidMaps,[]);
});
test('trial native configuration waits for high HP and adequate potions',()=>{
  const r=readyTrial();r.e.db.active.needsApply=true;assert.equal(r.e.canApply(r.m,r.s,r.at),true);
  assert.equal(r.e.canApply(r.m,{...r.s,hp:[500,1000]},r.at),false);assert.equal(r.e.canApply(r.m,{...r.s,mpPotions:0},r.at),false);
});
test('atomic private store recovers previous valid memory after a corrupt write',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sigil-dna-test-')),file=path.join(dir,'dna-memory.json');
  t.after(()=>{for(const n of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,n));fs.rmdirSync(dir);});
  const r=rig(),store=new D.FileStore(file);store.save(r.e.db);store.save({...r.e.db,sequence:3});fs.writeFileSync(file,'{broken');
  assert.equal(store.load().sequence,0);assert.equal(D.readSummary(file).generation,0);
});
