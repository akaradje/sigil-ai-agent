'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('./autonomy');
const C=require('./game-catalog');
const {createAvailability}=require('./server-availability');
const clock=1800000000000;

test('reconnect preparation and essential town work claim the queue before optional development reviews',()=>{
  const c=catalog(),m={};
  for(const task of ['cbt','town_shop','town_storage','town_rest'])assert.equal(A.ownsWorkflow(m,state(),c,task),true);
  for(const task of ['inventory','equipment']){assert.equal(A.ownsWorkflow(m,state({zone:'Town'}),c,task),true);assert.equal(A.ownsWorkflow(m,state(),c,task),false);}
  m.autonomy={resume:{map:'field'}};assert.equal(A.ownsWorkflow(m,state(),c,'autonomy_wait'),true);assert.equal(A.ownsWorkflow(m,state(),c,null),false);
});
test('the final reserved wing ore is never refined away or topped up merely to fund optional refinement',async()=>{
  const m={},a=A.init(m),c=catalog();c.gear.push({id:'wing',name:'Arcane Wing',slot:'wing',tier:5,lv:50,craft:{gold:700000,mats:{mithril:8,sigil_ore:10}}});
  a.wingPriority=true;a.powerProgression=true;a.inventory={items:{sigil_ore:10},gear:[]};a.worn=[{uid:'w',slot:'weapon',text:'Void Staff'}];a.trip={kind:'forge',phase:'town',at:clock,salesDone:true,advancedChecked:true};const spending=[];
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{goldReserve:100000,powerProgression:true,wingPriority:true},now:()=>clock,
    observe:async()=>state({zone:'Town',panel:'smith',gold:900000,hpPotions:25,mpPotions:25,smithRows:[{act:'refine',key:'w',worn:true,refine:0,chance:100,disabled:false,max:false,costText:'400 G',name:'Void Staff'}],controls:[{act:'smtab',key:'refine'},{act:'refine',key:'w'}]}),
    click:async x=>{if(['refine','buy'].includes(x.act))spending.push(x);},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('town');assert.equal(a.lastResult.ok,true,a.lastResult.error);assert.deepEqual(spending,[]);assert.equal(a.inventory.items.sigil_ore,10);
});
test('supplied wing focus departs directly from town instead of taking an EXP-map detour',async()=>{
  const m={},a=A.init(m),c=catalog();c.gear.push({id:'wing',name:'Arcane Wing',slot:'wing',tier:5,lv:50,craft:{gold:700000,mats:{mithril:8}}});
  a.wingPriority=true;a.powerProgression=true;a.inventory={items:{},gear:[]};a.worn=[{uid:'w',slot:'weapon',text:'Void Staff'}];a.trip={kind:'shop',phase:'return',returnMap:'field',returnMode:'farm',at:clock,salesDone:true,salePolicyVersion:2};const keys=[];
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{goldReserve:100000,wingPriority:true},now:()=>clock,observe:async()=>state({zone:'Town',hpPotions:25,mpPotions:25,gold:900000,autoHunt:''}),key:async k=>keys.push(k),click:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('town');assert.equal(a.lastResult.ok,true,a.lastResult.error);assert.equal(a.trip,null);assert.equal(a.resume,null);assert.equal(a.returnMap,'field');assert.deepEqual(keys,[]);assert.equal(a.townVisit.servicedAt,clock);
});
test('bounded town inspections reach ordinary surplus before retained option pieces can monopolize the quota',async()=>{
  const m={},a=A.init(m),c=catalog();c.gear.push({id:'armor',name:'Test Armor',slot:'armor',tier:5,lv:55,stats:{def:30}});
  a.worn=[{uid:'w',slot:'armor',text:'+5 Test Armor'}];a.trip={kind:'shop',phase:'town',at:clock,salesDone:false,salePolicyVersion:2,storageScanned:true};
  let panel='shop',selected=null,modal=false,gold=200000,sold=[],seen=[],items=[{uid:'rolled',text:'Test Armor',protected:false,rarity:2},{uid:'plain',text:'Test Armor',protected:false,rarity:1}];
  const observe=async()=>state({zone:'Town',panel,gold,inventoryComplete:true,inventoryItems:{},inventoryGear:items,
    panelText:'In Bag\nTest Armor\nRefine +0/15'+(selected==='rolled'?'\n✦ DEF +1':''),modalText:modal?'Sell equipment Test Armor for 500 G?':'',
    controls:[...items.map(g=>({act:'isel',key:'g:'+g.uid})),...(selected?[{act:'isellg',key:selected,label:'Sell 500 G'}]:[]),...(modal?[{label:'Sell'}]:[])]});
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{sellSurplus:true,goldReserve:100000},now:()=>clock,observe,
    click:async x=>{if(x.act==='isel'){selected=x.key.slice(2);seen.push(selected);}if(x.act==='isellg')modal=true;if(x.label==='Sell'){sold.push(selected);items=items.filter(g=>g.uid!==selected);gold+=500;modal=false;selected=null;}},open:async p=>{panel=p;},close:async()=>{panel=null;},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('town');assert.equal(a.lastResult.ok,true,a.lastResult.error);assert.equal(seen[0],'plain');assert.deepEqual(sold,['plain']);assert.equal(items[0].uid,'rolled');
});
test('refinement value uses live chance and class stats rather than the lowest plus alone',()=>{
  const c=catalog();c.gear[1].refinement=Array.from({length:16},(_,r)=>({ore:1,bonus:{atk:r*6,matk:r*6}}));
  c.gear.push({id:'ring',name:'Test Ring',slot:'ring',tier:5,lv:55,refinement:Array.from({length:16},(_,r)=>({ore:1,bonus:{mdef:r}}))});
  const rows=[{key:'ring',name:'Test Ring',refine:0,chance:100,costText:'400 G'},{key:'staff',name:'Void Staff',refine:5,chance:50,costText:'5400 G'}];
  const worn=[{uid:'ring',text:'Test Ring'},{uid:'staff',text:'Void Staff'}];
  assert.equal(A.refineCandidates(c,state(),worn,rows)[0].key,'staff');
  rows[1].chance=1;assert.equal(A.refineCandidates(c,state(),worn,rows)[0].key,'ring');
  assert.equal(A.wingReserve({wingPriority:true,goal:{slot:'wing',cost:{gold:700000}}},100000),800000);
});
test('wing success is measured only after the exact crafted wing is equipped, once across restart',async()=>{
  const m={},a=A.init(m),c=catalog();c.gear.push({id:'wing',name:'Arcane Wing',slot:'wing',tier:5,lv:50,stats:{matk:15}});
  a.wingCraft={target:'wing',name:'Arcane Wing',status:'crafted'};a.trip={kind:'forge',phase:'town',at:clock,salesDone:true};
  let panel=null,equipped=false;
  const beforeWorn=[{slot:'weapon',uid:'w',text:'Void Staff'}];
  const observe=async()=>state({panel,panelOpen:true,inventoryComplete:true,inventoryItems:{},inventoryGear:[{uid:'new',text:'Arcane Wing'}],
    worn:equipped?[...beforeWorn,{slot:'wing',uid:'new',text:'Arcane Wing'}]:beforeWorn,
    panelText:['Hero','Starweaver','Lv 57','Gear Power',equipped?'145':'100'].join('\n'),
    controls:[{act:'isel',key:'g:new'},{act:'iequip',key:'new'}]});
  const args={mem:m,getCatalog:()=>c,policy:{goldReserve:100000},now:()=>clock,observe,click:async x=>{if(x.act==='iequip')equipped=true;},open:async p=>{panel=p;},close:async()=>{panel=null;},sleep:async()=>{},save:()=>{},log:()=>{}};
  await A.createController(args).run('town');assert.equal(a.lastResult.ok,true,a.lastResult.error);
  assert.equal(a.wingCraft.delta,45);assert.equal(a.wingCraft.status,'equipped');assert.equal(a.events.filter(e=>e.type==='wing_completed').length,1);
  const restored=JSON.parse(JSON.stringify(m));await A.createController({...args,mem:restored}).run('town');
  assert.equal(restored.autonomy.events.filter(e=>e.type==='wing_completed').length,1);
});
test('a legendary candidate is surplus when the worn gear in that slot is at least as strong',()=>{
  const c=catalog(),worn=[{uid:'w',slot:'weapon',text:'Void Staff'}];
  const base={uid:'x',text:'Void Staff',protected:false,equipped:false,better:false};
  for(const rarity of [2,3,4])assert.equal(A.surplusGear(c,state({inventoryComplete:true,inventoryGear:[{...base,rarity}]}),worn).length,1);
  // The bar moves with the worn gear: a better worn piece keeps the same bag
  // piece alive, a weaker one turns it into surplus.
  assert.equal(A.surplusGear(c,state({inventoryComplete:true,inventoryGear:[{...base,rarity:3}]}),[{uid:'w',slot:'weapon',text:'Cinder Staff'}]).length,0);
});
test('ordinary option armor is sold only with the same base, no stat gain and native inferior evidence',()=>{
  const c=catalog();c.gear.push({id:'armor',name:'Test Armor',slot:'armor',tier:5,lv:55,stats:{def:30}});
  const item={uid:'x',text:'Test Armor',protected:false,rarity:2},worn=[{uid:'w',slot:'armor',text:'+5 Test Armor [1]'}],s=state({inventoryComplete:true,inventoryGear:[item]});
  const detail='Test Armor [1]\nRefine +0/15\n✦ DEF +5\nCompared with worn:\n▼ Worse than worn\nDEF ▼ 10';
  assert.equal(A.surplusDetail(c,s,worn,item,detail),null);
  assert.ok(A.surplusDetail(c,s,worn,item,detail+'\nMATK ▲ 1'));
  assert.ok(A.surplusDetail(c,s,worn,item,detail.replace('✦ DEF','🃏 Card\n✦ DEF')));
  // The colour does not protect a piece the game proves is the worse one.
  assert.equal(A.surplusDetail(c,s,worn,{...item,rarity:3},detail),null);
});
test('DNA can service a bag earlier but cannot buy capacity below the existing spending boundary',()=>{
  const m={},a=A.init(m);a.cbt={claimed:true};a.last.inventory=clock;a.last.equipment=clock;a.last.forge=clock;a.last.farm=clock;a.bagUsage=[90,100];
  m.dna={genes:{bagReturnThreshold:0.9}};
  assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:30}),catalog(),clock,{enabled:true,crystalBudget:5000}),'town_storage');
  m.dna.genes.bagReturnThreshold=0.99;assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:30}),catalog(),clock,{enabled:true,crystalBudget:5000}),null);
});
test('near-bracket hold skips optional forge trips but keeps emergency supplies and farming available',()=>{
  const m={},a=A.init(m);a.cbt={claimed:true};a.last.inventory=clock;a.last.equipment=clock;a.last.farm=clock;
  a.resourceHold={active:true};a.goal={slot:'cape',missing:[]};
  assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:30}),catalog(),clock,{enabled:true}),null);
  assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:0}),catalog(),clock,{enabled:true}),'town_shop');
  a.goal.slot='weapon';assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:30}),catalog(),clock,{enabled:true}),'town_forge');
  a.goal={slot:'cape',missing:[{id:'ore'}]};a.farm={map:'field',started:clock};
  assert.equal(A.chooseTask(m,state(),catalog(),clock,{enabled:true}),'finish_farm');
  a.farm=null;a.last.farm=0;assert.notEqual(A.chooseTask(m,state(),catalog(),clock,{enabled:true}),'farm');
});
test('95 percent bag threshold and proactive potion restock keep a cooldown',()=>{
  const m={},a=A.init(m);a.cbt={claimed:true};a.last.inventory=clock;a.last.equipment=clock;a.last.forge=clock;a.last.farm=clock;
  a.bagUsage=[94,100];const policy={enabled:true,crystalBudget:0};
  assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:30}),catalog(),clock,policy),null);
  a.bagUsage=[95,100];assert.equal(A.chooseTask(m,state(),catalog(),clock,policy),'town_storage');
  a.bagUsage=[50,100];assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:10}),catalog(),clock,policy),'town_shop');
  a.last.town_shop=clock;assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:10}),catalog(),clock,policy),null);
  m.uiHealth={safeIdle:true};a.bagUsage=[100,100];assert.equal(A.chooseTask(m,state(),catalog(),clock,policy),null);
});

test('a completed town visit with remaining bag space cannot immediately request the same sales again',()=>{
  const m={},a=A.init(m),c=catalog();a.cbt={claimed:true};a.last.inventory=clock;a.last.equipment=clock;a.last.forge=clock;a.last.farm=clock;
  a.bagUsage=[125,130];a.townVisit={active:true,servicedAt:clock-1000};
  const s=state({zone:'Town',hpPotions:30,mpPotions:30}),p={enabled:true,sellSurplus:true,levelingFocus:true,crystalBudget:0};
  assert.equal(A.chooseTask(m,s,c,clock,p),null);
  a.last.farm=0;assert.equal(A.chooseTask(m,s,c,clock,p),'farm');
  assert.equal(A.chooseTask(m,{...s,zone:'Field'},c,clock,p),'town_shop');
  a.bagUsage=[130,130];assert.equal(A.chooseTask(m,s,c,clock,p),'town_shop');
  a.bagUsage=[125,130];assert.equal(A.chooseTask(m,{...s,hpPotions:0},c,clock,p),'town_shop');
});
test('higher-map trials require repeated short bars, measured baseline, survival and available potions',()=>{
  const c=catalog();c.maps.push({id:'higher',name:'Higher',monsters:[{id:'next'}]});c.monsters.push({id:'next',lv:60,hp:1500,exp:200,drops:[]});
  const m={},a=A.init(m);a.farmRates.field={expPerMinute:10000,minutes:3,at:clock};
  m.combatTelemetry={current:{zone:'Field',count:5,medianSeconds:3,at:clock}};
  const s=state({hpPotions:30,mpPotions:30});assert.equal(A.trialOption(m,s,c,clock).id,'higher');
  assert.equal(A.trialOption(m,{...s,hp:[500,1000]},c,clock),null);
  assert.equal(A.trialOption(m,{...s,mpPotions:undefined},c,clock),null);
  m.combatTelemetry.current.count=1;assert.equal(A.trialOption(m,s,c,clock),null);m.combatTelemetry.current.count=5;
  a.farmTrials={higher:{at:clock}};assert.equal(A.trialOption(m,s,c,clock),null);
});
test('worse measured trial or a low-HP episode queues return, even after HP recovers',()=>{
  const m={},a=A.init(m);a.cbt={claimed:true};a.farm={trial:true,map:'field',started:clock-4*60000,baseline:10000};
  a.farmRates.field={expPerMinute:5000,minutes:3,at:clock};
  assert.equal(A.chooseTask(m,state(),catalog(),clock,{enabled:true}),'finish_farm');
  a.farmRates.field.expPerMinute=12000;
  A.update(m,state({hp:[350,1000]}),catalog(),clock);A.update(m,state(),catalog(),clock+1000);
  assert.equal(A.chooseTask(m,state(),catalog(),clock+1000,{enabled:true}),'finish_farm');
});
test('town and overlay time cannot contaminate measured farming EXP',()=>{
  const m={};A.update(m,state(),catalog(),clock);A.update(m,state({panelOpen:true,exp:50}),catalog(),clock+60000);
  assert.equal(m.autonomy.expSample,null);assert.equal(m.autonomy.expPerMinute,undefined);
});
test('a failed town return cannot leave native quest routing idle forever',async()=>{
  const m={},a=A.init(m);a.resume={map:'field',mode:'mq',at:clock-90000};let running=false;
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',autoQuestRunning:running,controls:[{aq:'mq'}]}),click:async()=>{running=true;},
    close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('autonomy_wait');assert.equal(running,true);assert.equal(a.resume,null);
});
test('quest return does not report success until native auto quest is observed running',async()=>{
  const m={},a=A.init(m);a.resume={map:'field',mode:'mq',at:clock};
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{goldReserve:100000},now:()=>clock,
    observe:async()=>state({autoQuestRunning:false,controls:[{aq:'mq'}]}),click:async()=>{},
    close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('autonomy_wait');assert.ok(a.resume);assert.equal(a.lastResult.ok,false);
});
function catalog(extra={}) {return {levelCap:99,capSource:'public-ui-definition',refineMax:15,refineSafe:10,fingerprint:'version-a',at:clock,
  jobs:{starweaver:{weapon:'staff',line:['mage','starweaver'],jobCap:50}},
  gear:[{id:'staff4',name:'Cinder Staff',slot:'weapon',fam:'staff',tier:4,lv:40,stats:{matk:40},upgrade:{to:'staff5',gold:5000,mats:{shard:10}}},
    {id:'staff5',name:'Void Staff',slot:'weapon',fam:'staff',tier:5,lv:55,stats:{matk:55},craft:{gold:9000,mats:{shard:15}}},
    {id:'blade5',name:'Void Blade',slot:'weapon',fam:'blade',tier:5,lv:55,stats:{atk:100},craft:{gold:1,mats:{shard:1}}}],
  items:{shard:{name:'Shard'}},maps:[{id:'town',name:'Town',town:true,monsters:[]},{id:'field',name:'Field',monsters:[{id:'mob'}]}],
  monsters:[{id:'mob',lv:58,hp:1000,exp:100,drops:[['shard',0.4]]}],expByLevel:{57:1000000,58:1200000},...extra};}
function state(extra={}) {return {name:'Hero',job:'Starweaver',lv:'Lv 57',hp:[900,1000],exp:10,gold:120000,crystals:5000,zone:'Field',controls:[],offscreen:[],autoHunt:'on',autoQuestMode:'mq',...extra};}

test('idle combat probe selects a normal level-band target and verifies AUTO without touching an active resource trip',async()=>{
 const mem={},a=A.init(mem),c=catalog();c.maps[1].monsters[0].n=10;c.monsters[0].name='Test Mob';
 a.bagUsage=[0,100];mem.gameTelemetry={validated:true,checkedAt:clock};mem.proactive={idleSince:clock-120000,lastProbe:0,probeAttempts:0};
 let hunting=false,panel=null;const clicks=[];
 const controls=[{act:'atab',key:'hunt'},{act:'aopt',k:'target',v:'mob',on:true},{act:'aopt',k:'prio',v:'near',on:true},{id:'autoBtn'}];
 const controller=A.createController({mem,getCatalog:()=>c,now:()=>clock,policy:{proactive:true,goldReserve:100000},
  observe:async()=>state({autoHunt:hunting?'on':'',hpPotions:50,mpPotions:50,panel,controls}),
  click:async x=>{clicks.push(x);if(x.id==='autoBtn')hunting=true;},open:async p=>{panel=p;},close:async()=>{panel=null;},sleep:async()=>{},save:()=>{},log:()=>{}});
 await controller.run('combat_probe');assert.equal(a.lastResult.ok,true,a.lastResult.error);assert.equal(hunting,true);assert.equal(a.farm.target,'mob');assert.equal(a.farm.probe,true);
 const n=clicks.length;mem.development={excursion:{kind:'mine'}};await controller.run('combat_probe');assert.equal(clicks.length,n);
});

test('cognitive risk-adjusted ranking influences measured farm choices without admitting excluded routes',async()=>{
  const m={},a=A.init(m),c=catalog();
  c.maps.push({id:'second',name:'Second Field',monsters:[{id:'mob'}]});
  a.farmRates={field:{expPerMinute:1000,minutes:3,at:clock},second:{expPerMinute:800,minutes:3,at:clock}};
  m.cognitive={enabled:true,mapPredictions:[{mapName:'Field',durationSec:180,predictedUtility:1},
    {mapName:'Second Field',durationSec:180,predictedUtility:100},{mapName:'Unsafe',durationSec:180,predictedUtility:1e6}]};
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{goldReserve:100000},now:()=>clock,
    observe:async()=>state(),close:async()=>{},key:async()=>{},click:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('farm');assert.equal(a.farm.map,'second');
  a.farm=null;m.dna={avoidMaps:['second']};
  await ctl.run('farm');assert.equal(a.farm.map,'field');
});
test('power progression services ready secondary gear while pursuing the level leaderboard',()=>{
  const m={},a=A.init(m);a.cbt={claimed:true};a.last.inventory=clock;a.last.equipment=clock;a.last.farm=clock;
  a.goal={slot:'armor',missing:[]};
  assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:30}),catalog(),clock,{enabled:true,levelingFocus:true,powerProgression:true}),'town_forge');
  a.resourceHold={active:true};assert.notEqual(A.chooseTask(m,state({hpPotions:30,mpPotions:30}),catalog(),clock,{enabled:true,levelingFocus:true,powerProgression:true}),'town_forge');
});
test('wing plans respect high-class requirements and prioritize a missing usable wing',()=>{
  const c=catalog();c.jobs.starweaver.jobTier=2;c.gear.push({id:'wing',name:'Arcane Wing',slot:'wing',line:'mage',jt:2,tier:5,lv:50,stats:{matk:15},craft:{gold:700000,mats:{ore:8}}},{id:'highwing',name:'High Wing',slot:'wing',line:'mage',jt:3,tier:5,lv:50,stats:{matk:30},craft:{gold:1,mats:{}}});
  const a={inventory:{items:{shard:15},gear:[]},worn:[{slot:'weapon',uid:'w',text:'Void Staff'}],crafted:{},powerProgression:true};
  assert.equal(A.progressionGoal(c,state({gold:900000}),a,100000).target,'wing');
  a.inventory.items.ore=8;assert.equal(A.progressionGoal(c,state({gold:900000}),a,100000).target,'wing');
});
test('equipped refinement batches two bounded steps without re-equipping after each step',async()=>{
  const m={},a=A.init(m);a.worn=[{slot:'weapon',uid:'w',text:'Void Staff'}];a.trip={kind:'forge',phase:'town',at:clock,advancedChecked:true,salesDone:true};
  let r=0,gold=200000;
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{powerProgression:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',panel:'smith',gold,controls:[{act:'smtab',key:'refine'},{act:'refine',key:'w'}],smithRows:[{act:'refine',key:'w',worn:true,refine:r,chance:100,disabled:false,max:false,costText:'400 G',name:'Void Staff'}],forgeResult:r?'Refined':''}),
    click:async c=>{if(c.act==='refine'){r++;gold-=400;}},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('town');assert.equal(a.lastResult.ok,true);assert.equal(r,2);assert.equal(a.trip.powerActions,2);assert.equal(a.trip.powerSpent,800);assert.notEqual(a.gearPending,true);
});
test('completed surplus sales can release bounded bag capacity for power progression',async()=>{
  const m={},a=A.init(m);a.bagUsage=[95,100];a.trip={kind:'shop',phase:'town',at:clock,salePolicyVersion:2,salesDone:true,storageScanned:true};
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{powerProgression:true,sellSurplus:true,crystalBudget:5000,goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',panel:'shop',hpPotions:30,mpPotions:30,panelText:'Return Scroll have 10\nFocus Tonic have 5',controls:[]}),click:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('town');assert.equal(a.trip.kind,'capacity');assert.equal(a.trip.progressAt,clock);
});
test('spent crystal allowance does not expand; ready forge work precedes an optional bank audit',async()=>{
  const m={},a=A.init(m);a.bagUsage=[95,100];a.premium.reserved=5000;a.trip={kind:'shop',phase:'town',at:clock,salePolicyVersion:2,salesDone:true};a.storageUsage=[40,100];
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{powerProgression:true,sellSurplus:true,crystalBudget:5000,goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',panel:'shop',hpPotions:30,mpPotions:30,panelText:'Return Scroll have 10\nFocus Tonic have 5',controls:[]}),click:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('town');assert.equal(a.trip.kind,'forge');assert.equal(a.premium.reserved,5000);
  a.bagUsage=[70,100];a.trip={kind:'shop',phase:'town',at:clock,salePolicyVersion:2,salesDone:true};
  await c.run('town');assert.equal(a.trip.kind,'forge');
});

test('character cap is dynamic; job mastery and zero progress do not imply character cap',()=>{
  assert.equal(C.resolveCap(state({jobExpText:'JOB MASTER',expText:'EXP 0%'}),null).atCap,false);
  assert.equal(C.resolveCap(state({expText:'EXP MAX'}),null).atCap,true);
  assert.equal(C.resolveCap(state({lv:'Lv 105'}),catalog({levelCap:120})).atCap,false);
  assert.equal(C.resolveCap(state({lv:'Lv 120'}),catalog({levelCap:120})).atCap,true);
});
test('reject incomplete/invalid public catalogs and negative recipe costs',()=>{
  assert.throws(()=>C.validateCatalog({}));assert.throws(()=>C.validateCatalog(catalog({levelCap:Infinity})));
  const c=catalog();c.gear[0].upgrade.gold=-1;assert.throws(()=>C.validateCatalog(c));
  assert.equal(C.validateCatalog(catalog()).fingerprint.length,64);
});
test('cap expansion invalidates a stale plan and emits one durable expansion event',()=>{
  const m={};A.catalogChanged(m,catalog());m.autonomy.goal={target:'old'};
  A.catalogChanged(m,catalog({levelCap:120,fingerprint:'b'}));
  assert.equal(m.autonomy.goal,null);assert.equal(m.autonomy.events.filter(e=>e.type==='cap_expanded').length,1);
  A.catalogChanged(m,catalog({levelCap:120,fingerprint:'b'}));assert.equal(m.autonomy.events.length,2);
});
test('resource analysis separates deficits and gold, excludes unsafe drop maps',()=>{
  assert.deepEqual(C.bottlenecks({gold:100,mats:{shard:10}},{shard:3},20).map(m=>[m.id,m.missing]),[['shard',7],['gold',80]]);
  assert.equal(C.farmOptions(catalog(),state(),[{id:'shard'}])[0].id,'field');
  const c=catalog();c.monsters[0].lv=90;assert.equal(C.farmOptions(c,state(),[{id:'shard'}]).length,0);
});
test('upgrade preserves owned identity and reserves gold before planning a craft',()=>{
  const a=A.init({});a.inventory={items:{shard:10},gear:[]};a.worn=[{uid:'owned',slot:'weapon',text:'+4 Cinder Staff'}];
  const goal=A.progressionGoal(catalog(),state(),a,100000);
  assert.equal(goal.kind,'upgrade');assert.equal(goal.uid,'owned');assert.equal(goal.missing.length,0);
  assert.equal(A.progressionGoal(catalog(),state({gold:102000}),a,100000).missing[0].id,'gold');
});
test('filtered inventory cannot erase a complete snapshot or invent material deficits',()=>{
  const m={};const a=A.init(m);a.inventory={items:{shard:10},gear:[]};
  A.update(m,state({panel:'bag',inventoryComplete:false,inventoryItems:{}}),catalog(),clock);
  assert.equal(a.inventory.items.shard,10);
});
test('measured EXP/min handles an actual level crossing without mixing different zones',()=>{
  const m={};A.update(m,state({exp:90}),catalog(),clock);
  A.update(m,state({lv:'Lv 58',exp:10}),catalog(),clock+60000);
  assert.equal(m.autonomy.expPerMinute,220000);
  A.update(m,state({lv:'Lv 58',exp:20,zone:'Other'}),catalog(),clock+120000);
  assert.equal(m.autonomy.expPerMinute,220000);
});
test('town return and material farm ownership are not overridden by a new quest',()=>{
  const m={};const a=A.init(m);a.cbt={claimed:true};a.resume={map:'field'};
  assert.equal(A.chooseTask(m,state(),catalog(),clock,{enabled:true}),'autonomy_wait');
  a.resume=null;a.trip={kind:'forge'};assert.equal(A.chooseTask(m,state(),catalog(),clock,{enabled:true}),'town');
});
test('low HP without any HP potion chooses town recovery instead of an empty potion loop',()=>{
  assert.equal(A.chooseTask({},state({hp:[50,1000],hpPotions:0}),catalog(),clock,{enabled:true}),'town_rest');
});
test('at level cap a verified complete gear set switches to stockpiling and keeps choosing work',()=>{
  const m={},a=A.init(m);a.gearCapped=true;a.cbt={claimed:true};a.last.inventory=clock;a.last.equipment=clock;a.last.forge=clock;
  A.update(m,state({lv:'Lv 99',expText:'EXP MAX'}),catalog(),clock);
  assert.equal(a.mode,'stockpiling');assert.equal(A.chooseTask(m,state({lv:'Lv 99'}),catalog(),clock,{enabled:true}),'farm');
});
function premiumRig({ambiguous=false,budget=5000}={}) {
  const m={},a=A.init(m);a.bagUsage=[59,60];let panel=null,modal='',crystals=5000,owned=0;const snapshots=[],clicks=[];
  const controller=A.createController({mem:m,getCatalog:()=>catalog(),policy:{crystalBudget:budget,goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',panel,crystals,modalText:modal,premiumRows:[{id:'bag',price:150,owned,disabled:false}],
      controls:modal?[{label:'Buy'}]:[{act:'crtab',key:'shop'},{act:'crbuy',key:'bag'}]}),
    click:async c=>{clicks.push(c);if(c.act==='crbuy')modal='Confirm purchase 150';if(c.label==='Buy'){modal='';if(!ambiguous){crystals-=150;owned+=10;}}},
    open:async p=>{panel=p;},close:async()=>{panel=null;modal='';},sleep:async()=>{},save:()=>snapshots.push(structuredClone(a)),log:()=>{}});
  return {m,a,controller,snapshots,clicks};
}
test('capacity spending is reserved before clicking, verified, and survives restart',async()=>{
  const r=premiumRig();await r.controller.run('capacity');assert.equal(r.a.purchase.status,'confirmed');assert.equal(r.a.premium.spent,150);
  assert.ok(r.snapshots.some(a=>a.purchase?.status==='reserved'&&a.premium.reserved===150));
  const restored=JSON.parse(JSON.stringify(r.m));assert.equal(A.init(restored).premium.reserved,150);
});
test('ambiguous capacity acknowledgement retains budget and blocks automatic retry',async()=>{
  const r=premiumRig({ambiguous:true});await r.controller.run('capacity');assert.equal(r.a.purchase.status,'unknown');assert.equal(r.a.premium.reserved,150);
  assert.equal(r.a.premium.spent,0);assert.equal(r.a.events.length,0);
  assert.notEqual(A.chooseTask(r.m,state(),catalog(),clock,{enabled:true}),'capacity');
});
test('capacity spending cannot exceed the remaining budget or buy other products',async()=>{
  const r=premiumRig({budget:100});await r.controller.run('capacity');assert.equal(r.clicks.filter(c=>c.act==='crbuy').length,0);
});

test('verified sales on a full-bag visit may buy headroom within the original budget, once',async()=>{
  for(const completed of [false,true]){
    const r=premiumRig();r.a.bagUsage=[94,100];r.a.storageUsage=[100,100];
    r.a.trip={kind:'capacity',phase:'town',at:clock,bagAtArrival:[99,100],salesDone:completed,salePolicyVersion:2};
    await r.controller.run('town');
    assert.equal(r.a.premium.spent,completed?150:0);assert.equal(r.a.trip.capacityServiced,true);
    if(completed){assert.equal(r.a.purchase.id,'bag');assert.equal(r.a.purchase.status,'confirmed');}
  }
  const r=premiumRig({budget:100});r.a.bagUsage=[94,100];r.a.trip={kind:'capacity',phase:'town',at:clock,bagAtArrival:[99,100],salesDone:true};
  await r.controller.run('town');assert.equal(r.a.premium.spent,0);assert.equal(r.clicks.filter(c=>c.act==='crbuy').length,0);
});
test('pre-dispatch action-budget rejection releases only the unspent reservation',async()=>{
  const m={},a=A.init(m);a.bagUsage=[59,60];
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{crystalBudget:5000,goldReserve:100000},now:()=>clock,
    observe:async()=>state({premiumRows:[{id:'bag',price:150,owned:0}],controls:[{act:'crtab',key:'shop'},{act:'crbuy',key:'bag'}]}),
    click:async c=>{if(c.act==='crbuy')throw Object.assign(Error('cooling'),{code:'ACTION_BUDGET'});},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('capacity');assert.equal(a.premium.reserved,0);assert.equal(a.purchase.status,'cancelled-before-input');
});
test('already-claimed CBT gift does not send a false new-claim event',async()=>{
  const m={};const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{goldReserve:100000},now:()=>clock,
    observe:async()=>state({panel:'cbt',cbtClaimed:true,controls:[{id:'cbtPill'}]}),click:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('cbt');assert.equal(m.autonomy.cbt.claimed,true);assert.equal(m.autonomy.events.length,0);
});
test('forge requires current materials, an acknowledgement and the matching gold debit',async()=>{
  for(const debit of [false,true]) {
    const m={},a=A.init(m);a.inventory={items:{shard:10},gear:[]};a.worn=[{slot:'weapon',uid:'owned',text:'Cinder Staff'}];a.trip={kind:'forge',at:clock,returnMap:'field',phase:'town'};
    let gold=120000,clicked=0;const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{goldReserve:100000},now:()=>clock,
      observe:async()=>state({zone:'Town',panel:'smith',gold,forgeResult:'Void Staff crafted',
        controls:[{act:'smtab',key:'up'},{act:'upg',key:'owned'}],smithRows:[{act:'upg',key:'owned',gold:5000,mats:[{id:'shard',have:10,need:10}]}]}),
      click:async x=>{if(x.act==='upg'){clicked++;if(debit)gold-=5000;}},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
    await c.run('town');assert.equal(clicked,1);assert.equal(a.events.some(e=>e.type==='gear_crafted'),debit);
    if(!debit)assert.equal(a.lastResult.ok,false);
  }
});
test('availability pauses only after three failures and resumes after two successes',async()=>{
  let ok=false;const h=createAvailability({url:'https://game.example.test',fetchImpl:async()=>({ok}),now:()=>clock});
  await h.probe();await h.probe();assert.equal(h.blocked(),false);await h.probe();assert.equal(h.blocked(),true);
  ok=true;await h.probe();assert.equal(h.blocked(),true);await h.probe();assert.equal(h.blocked(),false);
});

test('leveling focus defers secondary forge detours but preserves supplies, ready weapons and cap progression',()=>{
  const m={},a=A.init(m);a.cbt={claimed:true};a.last.inventory=clock;a.last.equipment=clock;a.last.farm=clock;
  a.goal={slot:'armor',missing:[]};const p={enabled:true,levelingFocus:true};
  assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:30}),catalog(),clock,p),null);
  assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:0}),catalog(),clock,p),'town_shop');
  a.goal.slot='weapon';assert.equal(A.chooseTask(m,state(),catalog(),clock,p),'town_forge');
  a.goal={slot:'armor',missing:[{id:'unreachable-ore'}]};a.last.farm=0;
  assert.equal(A.chooseTask(m,state(),catalog(),clock,p),'farm');
  a.cap={atCap:true};a.goal.missing=[];
  assert.equal(A.chooseTask(m,state(),catalog(),clock,p),'town_forge');
});

test('EXP-focused farming is not blocked by an unavailable secondary crafting material',async()=>{
  const m={},a=A.init(m);a.goal={slot:'armor',missing:[{id:'unreachable-ore'}]};
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({autoHunt:'',controls:[{act:'atab',key:'hunt'},{act:'aopt',k:'target',v:'all',on:true},{act:'aopt',k:'prio',v:'near',on:true}]}),
    open:async()=>{},click:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('farm');assert.equal(a.lastResult.ok,true);assert.equal(a.farm.map,'field');
});

test('leveling storage creates headroom without moving worn gear, items or unknown gear',async()=>{
  const m={},a=A.init(m);a.trip={kind:'storage',at:clock,progressAt:clock,phase:'town'};a.bagUsage=[100,100];a.worn=[{uid:'worn'}];
  let usage=10;
  const spares=Array.from({length:12},(_,i)=>({uid:'spare'+i,dir:'in',text:'Void Staff'}));
  const protectedGear=[{uid:'worn',dir:'in',text:'Void Staff'},{uid:'unknown',dir:'in',text:'Unidentified'}];
  const moved=[];
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',panel:'storage',storageUsage:[usage,100],storageGear:[...protectedGear,...spares],
      controls:[{act:'stmove',key:'potion',dir:'in'},...protectedGear,...spares].map(g=>({...g,act:'stmove'}))}),
    click:async control=>{assert(control.uid.startsWith('spare'));moved.push(control.uid);spares.splice(spares.findIndex(g=>g.uid===control.uid),1);usage++;},
    close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('town');assert.equal(a.lastResult.ok,true);assert.equal(moved.length,6);assert.equal(a.bagUsage[0],94);assert.equal(a.trip.phase,'town');assert.equal(a.trip.progressAt,clock);
  a.bagUsage=[72,100];await c.run('town');assert.equal(moved.length,12);assert.equal(a.bagUsage[0],66);assert.equal(a.trip.phase,'return');
});

test('town restock confirms scroll quantity and gold debit before counting fast returns',async()=>{
  const m={},a=A.init(m);a.trip={kind:'shop',at:clock,phase:'town'};let scrolls=2,gold=120000;
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',panel:'shop',hpPotions:30,mpPotions:30,gold,panelText:'Return Scroll have '+scrolls,
      controls:[{act:'buy',key:'return_scroll',amount:'10',label:'10 5,000 G'}]}),
    click:async()=>{scrolls+=10;gold-=5000;},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('town');assert.equal(a.lastResult.ok,true);assert.equal(a.restocked.return_scroll,10);assert.equal(gold,115000);
});

test('leveling town service stops native movement before casting a Return Scroll',async()=>{
  const m={},a=A.init(m);a.farm={map:'field',returnMode:'mq'};let hunting=true;const clicked=[];
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({autoHunt:hunting?'on':'',controls:[{id:'autoBtn'},{id:'potTp'}]}),
    click:async control=>{clicked.push(control.id);if(control.id==='autoBtn')hunting=false;if(control.id==='potTp')assert.equal(hunting,false);},
    close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('town_storage');assert.equal(a.lastResult.ok,true);assert.deepEqual(clicked,['autoBtn','potTp']);assert.equal(a.trip.returnMode,'farm');
});

test('leveling returns restart farming on the verified map without starting a competing quest route',async()=>{
  const m={},a=A.init(m);a.resume={map:'field',mode:'farm',at:clock};let hunting=false;
  const cat=catalog();cat.maps[1].monsters[0].n=3;
  const c=A.createController({mem:m,getCatalog:()=>cat,policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({autoHunt:hunting?'on':'',controls:[{id:'autoBtn'},{aq:'mq'},{act:'atab',key:'hunt'},{act:'aopt',k:'target',v:'mob',on:true},{act:'aopt',k:'prio',v:'near',on:true}]}),
    click:async control=>{if(control.act==='atab')return;assert.equal(control.id,'autoBtn');hunting=true;},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('autonomy_wait');assert.equal(a.lastResult.ok,true);assert.equal(a.resume,null);assert.equal(a.farm.map,'field');
});

test('storage cooldown preserves ownership of an active farm route',()=>{
  const m={},a=A.init(m);a.cbt={claimed:true};a.last.inventory=clock;a.last.equipment=clock;a.last.town_storage=clock;
  a.bagUsage=[95,100];a.farm={map:'field',started:clock};
  assert.equal(A.chooseTask(m,state(),catalog(),clock,{enabled:true,levelingFocus:true,crystalBudget:0}),'autonomy_wait');
});

test('leveling targets exclude roaming bosses, rare elites and monsters above the safe bracket',()=>{
  const cat=catalog();cat.maps[1].monsters=[{id:'mob',n:3},{id:'boss',n:10},{id:'elite',n:0.4},{id:'high',n:5}];
  cat.monsters.push({id:'boss',boss:true,lv:58,hp:10,exp:9999},{id:'elite',lv:58,hp:10,exp:9999},{id:'high',lv:80,hp:10,exp:9999});
  assert.equal(A.levelingTarget(cat,'field',state()).id,'mob');assert.equal(A.levelingTarget(cat,'missing',state()),null);
});

test('a wider normal-target bracket requires an explicit bounded configuration',()=>{
  const cat=catalog();cat.maps[1].monsters=[{id:'higher',n:3}];cat.monsters.push({id:'higher',lv:61,hp:1500,exp:200});
  assert.equal(A.levelingTarget(cat,'field',state()),null);
  assert.equal(A.levelingTarget(cat,'field',state(),4).id,'higher');
  assert.equal(A.levelingTarget(cat,'field',state(),99),null);
});

test('a profitable old monster cannot defeat the current level band inside an eligible map',()=>{
  const c=catalog();c.maps[1].monsters.push({id:'old',n:20},{id:'elite',n:5});
  c.monsters.push({id:'old',lv:47,hp:1,exp:99999},{id:'elite',elite:true,lv:58,hp:1,exp:99999});
  assert.equal(A.levelingTarget(c,'field',state()).id,'mob');
  assert.equal(A.levelingTarget(c,'field',state({lv:'Lv 76'})),null);
});

test('unfinished native AUTO activation keeps ownership ahead of inventory and optional forging',()=>{
  const m={},a=A.init(m);a.cbt={claimed:true};a.farm={map:'field',pendingProfile:true,started:clock};
  assert.equal(A.chooseTask(m,state(),catalog(),clock,{enabled:true,levelingFocus:true}),'autonomy_wait');
  a.farm.pendingProfile=false;a.last.inventory=clock;a.last.equipment=clock;
  assert.equal(A.chooseTask(m,state({lv:'Lv 76'}),catalog(),clock,{enabled:true,levelingFocus:true}),'farm');
});

test('observed native combat gets one bounded learning exposure without delaying safety work',()=>{
  const make=()=>({autonomy:{farm:{map:'field',name:'Field',activatedAt:clock},bagUsage:[50,100]},nativeCombatProfile:{character:'Hero',job:'Starweaver',at:clock},combatTelemetry:{lastDamage:{zone:'Field',at:clock}}});
  const s=state({hpPotions:30,mpPotions:30}),m=make();assert.equal(A.protectCombat(m,s,clock),true);
  assert.equal(A.protectCombat(m,{...s,hp:[600,1000]},clock),true); // Native potion control continues during the exposure.
  assert.equal(A.protectCombat(m,{...s,hp:[400,1000]},clock),false);
  m.combatTelemetry.lastDamage.at=clock+179000;assert.equal(A.protectCombat(m,s,clock+179000),true);
  m.combatTelemetry.lastDamage.at=clock+180000;assert.equal(A.protectCombat(m,s,clock+180000),false);
  m.combatTelemetry.lastDamage.at=clock+900000;assert.equal(A.protectCombat(m,s,clock+900000),false);
  for(const change of [x=>{x.autonomy.bagUsage=[95,100];},x=>{x.autonomy.trip={};},x=>{x.autonomy.resume={};},x=>{x.development={excursion:{}};},x=>{x.dna={needsApply:true};},x=>{x.combatTelemetry.lastDamage.at=clock-11000;},x=>{delete x.nativeCombatProfile;}]){
    const unsafe=make();change(unsafe);assert.equal(A.protectCombat(unsafe,s,clock),false);assert.equal(unsafe.autonomy.farm.protectedUntil,undefined);
  }
  for(const changed of [{hpPotions:10},{mpPotions:null},{hp:[600,1000]},{panelOpen:true},{autoHunt:''},{zone:'Town'},{dead:true}])assert.equal(A.protectCombat(make(),{...s,...changed},clock),false);
  const restored=JSON.parse(JSON.stringify(m));restored.combatTelemetry.lastDamage.at=clock+900000;assert.equal(A.protectCombat(restored,s,clock+900000),false);
});

test('a saved farming return is revalidated after leveling and activates AUTO on the replacement map',async()=>{
  const m={},a=A.init(m),c=catalog();a.resume={map:'old',mode:'farm',at:clock};
  c.maps.push({id:'old',name:'Old',monsters:[{id:'low',n:4}]});c.monsters.push({id:'low',lv:40,hp:1,exp:9999,drops:[]});
  let zone='Town',hunting=false;const routes=[];
  const controls=[{bm:'world'},{wm:'field'},{go:'field'},{id:'autoBtn'},{act:'atab',key:'hunt'},{act:'aopt',k:'target',v:'mob',on:true},{act:'aopt',k:'prio',v:'near',on:true}];
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone,autoHunt:hunting?'on':'',controls}),click:async x=>{if(x.go){routes.push(x.go);zone='Field';}if(x.id==='autoBtn')hunting=true;},
    key:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('autonomy_wait');assert.deepEqual(routes,['field']);assert.equal(a.resume.map,'field');
  await ctl.run('autonomy_wait');assert.equal(a.lastResult.ok,true,a.lastResult.error);assert.equal(hunting,true);assert.equal(a.farm.target,'mob');assert.equal(a.resume,null);
});

test('ending a trial rejects its obsolete return map before dispatching any travel',async()=>{
  const m={},a=A.init(m);a.farm={map:'field',name:'Field',trial:true,returnMap:'obsolete',returnMode:'farm',started:clock-240000};const keys=[];
  const ctl=A.createController({mem:m,getCatalog:()=>catalog(),policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,observe:async()=>state(),
    click:async()=>{throw Error('unexpected travel input');},key:async x=>keys.push(x),open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('finish_farm');assert.equal(a.lastResult.ok,true,a.lastResult.error);assert.deepEqual(keys,[]);assert.equal(a.resume.map,'field');
});

test('an input-budget pause after a verified hunt profile retains AUTO activation across restart',async()=>{
  const m={},a=A.init(m),c=catalog();a.farm={map:'field',name:'Field',pendingProfile:true,started:clock};
  let hunting=false,reject=true,opens=0;
  const args={getCatalog:()=>c,policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({autoHunt:hunting?'on':'',controls:[{id:'autoBtn'},{act:'atab',key:'hunt'},{act:'aopt',k:'target',v:'mob',on:true},{act:'aopt',k:'prio',v:'near',on:true}]}),
    click:async x=>{if(x.id==='autoBtn'){if(reject)throw Object.assign(Error('input budget'),{code:'ACTION_BUDGET'});hunting=true;}},
    open:async()=>{opens++;},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}};
  await A.createController({...args,mem:m}).run('autonomy_wait');assert.equal(a.lastResult.ok,false);assert.equal(a.farm.pendingProfile,false);assert.equal(a.farm.pendingActivation,true);
  const restored=JSON.parse(JSON.stringify(m)),before=opens;reject=false;
  assert.equal(A.chooseTask(restored,state(),c,clock,{enabled:true,levelingFocus:true}),'autonomy_wait');
  await A.createController({...args,mem:restored}).run('autonomy_wait');assert.equal(restored.autonomy.lastResult.ok,true);assert.equal(hunting,true);assert.equal(restored.autonomy.farm.pendingActivation,false);assert.equal(opens,before);
});

test('a pending farm return preserves the verified profile when the final AUTO click must wait',async()=>{
  const m={},a=A.init(m),c=catalog();a.resume={map:'field',mode:'farm',at:clock};let hunting=false,reject=true,opens=0;
  const args={getCatalog:()=>c,policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({autoHunt:hunting?'on':'',controls:[{id:'autoBtn'},{act:'atab',key:'hunt'},{act:'aopt',k:'target',v:'mob',on:true},{act:'aopt',k:'prio',v:'near',on:true}]}),
    click:async x=>{if(x.id==='autoBtn'){if(reject)throw Object.assign(Error('input budget'),{code:'ACTION_BUDGET'});hunting=true;}},
    open:async()=>{opens++;},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}};
  await A.createController({...args,mem:m}).run('autonomy_wait');assert.equal(a.lastResult.ok,false);assert.equal(a.farm.target,'mob');assert.equal(a.farm.pendingActivation,true);assert.ok(a.resume);
  const restored=JSON.parse(JSON.stringify(m)),before=opens;reject=false;
  await A.createController({...args,mem:restored}).run('autonomy_wait');
  assert.equal(restored.autonomy.lastResult.ok,true,restored.autonomy.lastResult.error);assert.equal(hunting,true);assert.equal(restored.autonomy.resume,null);assert.equal(opens,before);
});

test('a new return to the same map cannot inherit an expired earlier trial',async()=>{
  const m={},a=A.init(m),c=catalog();a.resume={map:'field',mode:'farm',at:clock};
  a.farm={map:'field',name:'Field',started:clock-3600000,trial:true,target:'mob',resumeAt:clock-600000};
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({controls:[{act:'atab',key:'hunt'},{act:'aopt',k:'target',v:'mob',on:true},{act:'aopt',k:'prio',v:'near',on:true}]}),
    click:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('autonomy_wait');assert.equal(a.lastResult.ok,true,a.lastResult.error);assert.equal(a.farm.trial,false);assert.equal(a.farm.started,clock);assert.equal(a.farm.resumeAt,clock);assert.equal(a.resume,null);
});

test('resource backoff leaves town for farming even while wing materials are still missing',async()=>{
  const m={development:{resourceBackoffUntil:clock+60000}},a=A.init(m),c=catalog();
  c.gear.push({id:'wing',name:'Arcane Wing',slot:'wing',tier:5,lv:50,craft:{gold:700000,mats:{mithril:8}}});
  a.wingPriority=true;a.inventory={items:{},gear:[]};a.worn=[{uid:'w',slot:'weapon',text:'Void Staff'}];
  a.trip={kind:'shop',phase:'return',returnMap:'field',returnMode:'farm',at:clock,salesDone:true,salePolicyVersion:2};const routes=[];
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{wingPriority:true,levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',hpPotions:25,mpPotions:25,gold:900000,controls:[{bm:'world'},{wm:'field'},{go:'field'}]}),
    click:async x=>{if(x.go)routes.push(x.go);},key:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('town');assert.equal(a.lastResult.ok,true,a.lastResult.error);assert.deepEqual(routes,['field']);assert.equal(a.trip,null);assert.equal(a.resume.mode,'farm');
});

test('optional forge time cannot keep a town visit alive past the 90 second cap',async()=>{
  for(const salesDone of [true,false]){
    const m={},a=A.init(m);a.trip={kind:'forge',phase:'town',at:clock-6*60000,progressAt:clock-1000,salesDone,salePolicyVersion:2};const routes=[];
    const ctl=A.createController({mem:m,getCatalog:()=>catalog(),policy:{sellSurplus:true,goldReserve:100000},now:()=>clock,
      observe:async()=>state({zone:'Town',hpPotions:25,mpPotions:25}),click:async()=>{},key:async()=>routes.push('travel'),open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
    await ctl.run('town');
    // The optional forge never holds the hero: the visit is cut and the field wins.
    assert.equal(a.trip,null);
    assert.ok(a.events.some(e=>e.type==='town_timeout_abort'));
    assert.equal(a.last.forge,undefined);
  }
});

test('periodic leveling review does not start a story boss route or walk back to an inferior map',async()=>{
  const m={},a=A.init(m);a.farm={map:'field',returnMap:'town',returnMode:'mq',started:clock-31*60000};
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state(),click:async()=>assert.fail('review must not dispatch travel or quests'),close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('finish_farm');assert.equal(a.lastResult.ok,true);assert.equal(a.farm,null);assert.equal(a.resume,null);assert.equal(a.last.farm,0);
});

test('a native town recall retains the selected field as the return destination',async()=>{
  const m={},a=A.init(m);a.farm={map:'field',returnMode:'mq'};
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',autoHunt:'',controls:[]}),close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('town_storage');assert.equal(a.lastResult.ok,true);assert.equal(a.trip.returnMap,'field');assert.equal(a.trip.returnMode,'farm');
});

test('a cancelled farm teleport retries the verified map after a bounded wait without starting a quest',async()=>{
  const m={},a=A.init(m);a.resume={map:'field',mode:'farm',at:clock-90000};const clicked=[];
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',autoHunt:'',controls:[{bm:'world'},{wm:'field'},{go:'field'},{aq:'mq'}]}),
    click:async control=>{assert.equal(control.aq,undefined);clicked.push(control);},key:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('autonomy_wait');assert.equal(clicked.length,3);assert.equal(a.resume.map,'field');assert.equal(a.resume.at,clock);assert.equal(a.farm,undefined);
  await c.run('autonomy_wait');assert.equal(clicked.length,3);
});

test('town service interacts with the verified NPC prompt instead of repeatedly walking to it',async()=>{
  const m={},a=A.init(m);a.trip={kind:'storage',at:clock,phase:'town'};a.bagUsage=[95,100];let panel=null,used=10;
  const gear=Array.from({length:3},(_,i)=>({uid:'spare'+i,dir:'in',text:'Void Staff'})),clicked=[];
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',panel,autoHunt:'',storageUsage:panel?[used,100]:null,storageGear:panel?gear:[],
      controls:panel?gear.map(g=>({...g,act:'stmove'})):[{id:'interactBtn',label:'Talk to Storage 120-slot storage shared by all characters F'}]}),
    click:async control=>{clicked.push(control);if(control.id==='interactBtn')panel='storage';else {gear.splice(gear.findIndex(g=>g.uid===control.uid),1);used++;}},
    key:async()=>assert.fail('NPC already reached'),close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('town');assert.equal(a.lastResult.ok,true);assert.equal(clicked[0].id,'interactBtn');assert.equal(a.trip.deposits,3);assert.equal(a.bagUsage[0],92);
});

function saleHarness({wrongDialog=false,missingCredit=false,blocked=false,delayedCredit=false,fromStorage=false}={}) {
  const mem={},a=A.init(mem),worn={uid:'worn',slot:'weapon',text:'Void Staff'};
  a.worn=[worn];a.trip={kind:'shop',phase:'town',at:clock};
  let panel='shop',selected=false,modal=false,gold=120000,inventory=[{uid:'unused',text:'Void Blade',art:'/gear/blade5.png',protected:false}],confirmations=0,settlementReads=0;
  const observe=async()=>{if(delayedCredit&&confirmations&&++settlementReads===3)gold+=500;return state({zone:'Town',panel,gold,inventoryComplete:panel==='bag',inventoryGear:inventory,
    panelText:panel==='bag'?'In Bag\nVoid Blade\nRefine +0/15 · Sell 500 G':'',
    modalText:modal?'Sell equipment?\nVoid Blade for '+(wrongDialog?501:500)+' G':'',
    controls:modal?[{label:'Sell'}]:panel==='bag'?[{act:'isel',key:'g:unused'},...(selected?[{act:'isellg',key:'unused',label:'Sell 500 G'}]:[])]:[{id:'interactBtn',label:'Talk to Shop'}]});};
  if(fromStorage)a.storageOrigins={unused:{status:'withdrawn',name:'Void Blade'}};
  if(blocked)a.saleIntent={uid:'previous',status:'confirming'};
  const controller=A.createController({mem,getCatalog:()=>catalog(),policy:{sellSurplus:true,goldReserve:100000},now:()=>clock,
    observe,open:async p=>{panel=p;},close:async()=>{panel=null;modal=false;},sleep:async()=>{},save:()=>{},log:()=>{},
    click:async c=>{if(c.id==='interactBtn')panel='shop';else if(c.act==='isel')selected=true;else if(c.act==='isellg')modal=true;else if(c.label==='Sell'){confirmations++;modal=false;inventory=[];if(!missingCredit&&!delayedCredit)gold+=500;}}});
  return {mem,controller,confirmations:()=>confirmations};
}
test('surplus identification protects worn, locked, favorite, unknown and future-use gear',()=>{
  const worn=[{uid:'worn',slot:'weapon',text:'Void Staff'}];
  const item={uid:'spare',text:'Void Blade',protected:false};
  const s=state({inventoryComplete:true,inventoryGear:[item]});
  assert.equal(A.surplusGear(catalog(),s,worn).length,1);
  assert.equal(A.surplusGear(catalog(),{...s,inventoryGear:[{...item,text:'+1 Void Blade'}]},worn).length,1);
  for(const patch of [{protected:true},{protected:undefined},{equipped:true},{text:'Unknown'}])
    assert.equal(A.surplusGear(catalog(),{...s,inventoryGear:[{...item,...patch}]},worn).length,0);
  assert.equal(A.surplusGear(catalog(),{...s,inventoryComplete:false},worn).length,0);
  assert.equal(A.surplusGear(catalog(),{...s,inventoryGear:[{...item,uid:'worn'}]},worn).length,0);
  assert.equal(A.surplusGear(catalog(),{...s,inventoryGear:[{...item,text:'Void Staff'}]},[{...worn,text:'Cinder Staff'}]).length,0);
});
test('authorized sale records only a confirmed disappearance and exact gold credit, never a click alone',async()=>{
  const h=saleHarness();await h.controller.run('town');
  assert.equal(h.confirmations(),1);assert.equal(h.mem.autonomy.sales.count,1);assert.equal(h.mem.autonomy.sales.gold,500);
  assert.equal(h.mem.autonomy.saleIntent.status,'confirmed');
  const e=saleHarness({missingCredit:true});await e.controller.run('town');
  assert.equal(e.confirmations(),1);assert.equal(e.mem.autonomy.sales,undefined);assert.equal(e.mem.autonomy.saleIntent.status,'uncertain');
  await e.controller.run('town');assert.equal(e.confirmations(),1);
});
test('changed sale dialog and a restart with pending confirmation cannot trigger irreversible input',async()=>{
  const h=saleHarness({wrongDialog:true});await h.controller.run('town');assert.equal(h.confirmations(),0);
  const e=saleHarness({blocked:true});await e.controller.run('town');assert.equal(e.confirmations(),0);
});
test('opt-in sales replace junk storage and capacity purchases while default policy remains unchanged',()=>{
  const m={},a=A.init(m);a.cbt={claimed:true};a.last.inventory=clock;a.last.equipment=clock;a.last.farm=clock;a.last.forge=clock;
  a.bagUsage=[95,100];a.storageUsage=[100,100];
  assert.equal(A.chooseTask(m,state(),catalog(),clock,{enabled:true,sellSurplus:true,crystalBudget:5000}),'town_shop');
  assert.equal(A.chooseTask(m,state(),catalog(),clock,{enabled:true,crystalBudget:5000}),'capacity');
});

test('stored cleanup withdraws only identified off-class weapons and is bounded before returning to the shop',async()=>{
  const m={},a=A.init(m);a.trip={kind:'liquidate',phase:'town',at:clock};a.bagUsage=[50,100];
  const storage=[{uid:'off',dir:'out',art:'/gear/blade5.png'}, {uid:'caster',dir:'out',art:'/gear/staff5.png'}, {uid:'item',dir:'out',art:'/items/potion.png'}];
  const clicked=[];
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{sellSurplus:true},now:()=>clock,
    observe:async()=>state({zone:'Town',panel:'storage',storageComplete:true,storageGear:storage,controls:storage.map(g=>({...g,act:'stmove'}))}),
    click:async g=>{clicked.push(g.uid);const i=storage.findIndex(x=>x.uid===g.uid);storage.push({...storage[i],dir:'in'});storage.splice(i,1);},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('town');assert.deepEqual(clicked,['off']);assert.equal(a.trip.kind,'shop');assert.equal(a.trip.salesDone,false);assert.equal(a.trip.storageScanned,true);
});

test('instant common loot sale requires all eight highest-tier slots and stops when a patch adds a tier',()=>{
  const slots=['weapon','head','armor','cape','boots','shield','ring','amulet'];
  const c=catalog({gear:slots.map((slot,i)=>({id:'g'+i,name:'Max '+slot,slot,tier:5,lv:55,stats:{}}))});
  const worn=slots.map((slot,i)=>({slot,uid:'u'+i,text:'Max '+slot}));
  assert.equal(A.commonLootSurplus(c,worn),true);assert.equal(A.commonLootSurplus(c,worn.slice(1)),false);
  c.gear.push({id:'next',name:'Next',slot:'weapon',tier:6,lv:70,stats:{}});
  assert.equal(A.commonLootSurplus(c,worn),false);
  const m={},a=A.init(m);A.catalogChanged(m,c,clock);a.farm={map:'field',target:'mob'};
  A.catalogChanged(m,{...c,fingerprint:'patch-next'},clock+1);assert.equal(a.farm.pendingProfile,true);
});
test('native common filter is verified without changing other loot rarity settings',async()=>{
  const m={},a=A.init(m);a.resume={map:'field',mode:'farm',at:clock};let hunting=false,on=true;
  const c=catalog();c.maps[1].monsters[0].n=3;
  const clicked=[];
  const x=A.createController({mem:m,getCatalog:()=>c,policy:{levelingFocus:true,sellSurplus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({autoHunt:hunting?'on':'',controls:[{id:'autoBtn'},{act:'atab',key:'hunt'},{act:'atab',key:'loot'},{act:'aopt',k:'target',v:'mob',on:true},{act:'aopt',k:'prio',v:'near',on:true},{act:'asellr',v:'1',on}]}),
    click:async b=>{clicked.push(b);if(b.id==='autoBtn')hunting=true;if(b.act==='asellr')on=!on;},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await x.run('autonomy_wait');assert.equal(a.lastResult.ok,true);assert.equal(a.commonLootSales.enabled,false);assert.equal(on,false);
  assert.equal(clicked.filter(b=>b.act==='asellr').length,1);
});

test('late UI settlement is observed without selling twice and a verified restart reconciliation counts once',async()=>{
  const h=saleHarness({delayedCredit:true});await h.controller.run('town');
  assert.equal(h.confirmations(),1);assert.equal(h.mem.autonomy.sales.count,1);assert.equal(h.mem.autonomy.sales.gold,500);
  h.mem.autonomy.saleIntent.status='uncertain';h.mem.autonomy.sales={count:0,gold:0,history:[]};h.mem.autonomy.trip.sales=0;h.mem.autonomy.trip.salesDone=false;
  await h.controller.run('town');assert.equal(h.confirmations(),1);assert.equal(h.mem.autonomy.sales.count,1);
  await h.controller.run('town');assert.equal(h.confirmations(),1);assert.equal(h.mem.autonomy.sales.count,1);
});

test('bank weapons are checked before bag sales so the per-visit quota cannot starve storage cleanup',async()=>{
  const m={},a=A.init(m);a.trip={kind:'shop',phase:'town',at:clock,sales:2};a.bagUsage=[50,100];a.storageUsage=[10,100];
  const stock=[{uid:'banked',dir:'out',art:'/gear/blade5.png'}];const clicked=[];
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{sellSurplus:true},now:()=>clock,
    observe:async()=>state({zone:'Town',panel:'storage',storageComplete:true,storageGear:stock,controls:stock.map(g=>({...g,act:'stmove'}))}),
    click:async g=>{clicked.push(g.uid);stock[0].dir='in';},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('town');assert.deepEqual(clicked,['banked']);assert.equal(a.storageOrigins.banked.status,'withdrawn');assert.equal(a.trip.storageScanned,true);assert.equal(a.storageCleanup.remaining,0);
});
test('bank candidates include obsolete caster staves but preserve future upgrades and unknown items',()=>{
  const c=catalog(),s=state(),worn=[{uid:'worn',slot:'weapon',text:'Void Staff'}];
  const rows=[{uid:'old',dir:'out',art:'/gear/staff4.png'},{uid:'same',dir:'out',art:'/gear/staff5.png'},{uid:'other',dir:'out',art:'/gear/blade5.png'},
    {uid:'worn',dir:'out',art:'/gear/staff5.png'},{uid:'unknown',dir:'out',art:'/items/shard.png'}];
  assert.deepEqual(A.storedSurplus(c,s,worn,rows).map(g=>g.uid),['old','same','other']);
  c.gear[1].lv=75;assert.deepEqual(A.storedSurplus(c,s,worn,rows).map(g=>g.uid),['old','other']);
});
test('bank provenance is counted only after a verified sale and survives restart without double counting',async()=>{
  const h=saleHarness({fromStorage:true});await h.controller.run('town');
  assert.equal(h.mem.autonomy.sales.storageCount,1);assert.equal(h.mem.autonomy.sales.storageGold,500);assert.equal(h.mem.autonomy.sales.history[0].source,'storage');assert.equal(h.mem.autonomy.storageOrigins.unused,undefined);
  await h.controller.run('town');assert.equal(h.mem.autonomy.sales.storageCount,1);
  const e=saleHarness({fromStorage:true,missingCredit:true});await e.controller.run('town');assert.equal(e.mem.autonomy.sales,undefined);assert.equal(e.mem.autonomy.saleIntent.source,'storage');
});
test('bank cleanup keeps a bounded cooldown, can be explicitly requested, and stops revisiting an empty scan',()=>{
  const m={},a=A.init(m);a.cbt={claimed:true};a.last.inventory=clock;a.last.equipment=clock;a.last.forge=clock;a.last.farm=clock;a.last.town_shop=clock;
  a.bagUsage=[50,100];a.storageUsage=[100,100];
  const p={enabled:true,sellSurplus:true,levelingFocus:true};
  assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:30}),catalog(),clock,p),null);
  a.storageCleanup={requestedAt:clock};assert.equal(A.chooseTask(m,state(),catalog(),clock,p),'town_shop');
  a.storageCleanup={remaining:0,checkedAt:clock,job:'Starweaver',fingerprint:'version-a'};a.last.town_shop=0;
  assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:30}),catalog(),clock,p),null);
});

test('compatible weapons require the live inferior verdict and primary-stat loss, preserving cards and extra slots',()=>{
  const c=catalog(),worn=[{uid:'worn',slot:'weapon',text:'+4 Void Staff [2]'}];
  const item={uid:'spare',text:'+1 Void Staff',protected:false},s=state({inventoryComplete:true,inventoryGear:[item]});
  const detail='Void Staff [2]\n✦ MATK +4%\nRefine +1/15\nCompared with worn: +4 Void Staff [2]\n▼ Worse than worn\nMATK▼180';
  assert.equal(A.surplusDetail(c,s,worn,item,detail),null);
  for(const d of [detail.replace('Worse','Better'),detail.replace('MATK▼180','MATK▲20'),detail.replace('Void Staff [2]','Void Staff [3]'),detail+'\n🃏 Card',detail.split('Compared')[0]])assert.ok(A.surplusDetail(c,s,worn,item,d));
  assert.ok(A.surplusDetail(c,{...s,inventoryGear:[{...item,better:true}]},worn,item,detail));
  c.jobs.starweaver.weapon='blade';item.text='Void Blade';
  const bladeDetail='Void Blade\nRefine +0/15\nCompared with worn: Void Blade\n▼ Worse than worn\nMATK▼99\nATK▲20';
  assert.ok(A.surplusDetail(c,s,[{uid:'worn',slot:'weapon',text:'Void Blade'}],item,bladeDetail));
});

test('native storage guard rejects weapon, unknown and bulk deposits while allowing identified non-weapon gear',()=>{
  const c=catalog();c.gear.push({id:'hood',name:'Hood',slot:'head'});
  const s={storageGear:[{uid:'w',dir:'in',art:'/gear/blade5.png'},{uid:'h',dir:'in',art:'/gear/hood.png'},{uid:'x',dir:'in',text:'unknown'}]};
  assert.equal(A.storageDepositAllowed(c,s,{act:'stall',dir:'in'}),false);
  for(const uid of ['w','x','missing'])assert.equal(A.storageDepositAllowed(c,s,{act:'stmove',dir:'in',uid}),false);
  assert.equal(A.storageDepositAllowed(c,s,{act:'stmove',dir:'in',uid:'h'}),true);
  assert.equal(A.storageDepositAllowed(null,s,{act:'stmove',dir:'in',uid:'h'}),false);
  assert.equal(A.storageDepositAllowed(c,s,{act:'stmove',dir:'out',uid:'w'}),true);
});

test('every new town arrival queues sales even inside the old town cooldown, without interrupting a return route',()=>{
  const m={},a=A.init(m),p={enabled:true,sellSurplus:true,levelingFocus:true},c=catalog();
  a.cbt={claimed:true};a.last.inventory=clock;a.last.equipment=clock;a.last.town_shop=clock;a.farm={map:'field',started:clock};
  A.update(m,state({zone:'Town'}),c,clock);assert.equal(A.chooseTask(m,state({zone:'Town'}),c,clock,p),'town_shop');
  a.townVisit.servicedAt=clock;assert.equal(A.chooseTask(m,state({zone:'Town'}),c,clock,p),'autonomy_wait');
  A.update(m,state(),c,clock+1);A.update(m,state({zone:'Town'}),c,clock+2);
  assert.equal(A.chooseTask(m,state({zone:'Town'}),c,clock+2,p),'town_shop');
  a.resume={map:'field'};assert.equal(A.chooseTask(m,state({zone:'Town'}),c,clock+2,p),'autonomy_wait');
});

test('return after another town service must visit the shop, and the sales policy never deposits junk weapons',async()=>{
  const m={},a=A.init(m);a.trip={kind:'forge',phase:'return',at:clock,returnMap:'field'};
  const controller=A.createController({mem:m,getCatalog:()=>catalog(),policy:{sellSurplus:true},now:()=>clock,observe:async()=>state({zone:'Town'}),
    click:async()=>assert.fail('no travel or deposit before sales'),close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await controller.run('town');assert.equal(a.trip.kind,'shop');assert.equal(a.trip.phase,'town');assert.equal(a.trip.returnMap,'field');
  a.trip.kind='storage';a.trip.phase='town';
  await controller.run('town');assert.notEqual(a.trip.kind,'storage');
});

test('town sales drain more than eight weapons across bounded slices, preserve necessities and resume the same farm',async()=>{
  const mem={},a=A.init(mem),cat=catalog();cat.maps[1].monsters[0].n=3;
  a.worn=[{slot:'weapon',uid:'worn',text:'+4 Void Staff [2]'}];a.trip={kind:'shop',at:clock,phase:'town',returnMap:'field',returnMode:'farm'};
  cat.gear.push({id:'hood4',name:'Old Hood',slot:'head',lv:40,tier:4,stats:{def:3}},{id:'hood5',name:'New Hood',slot:'head',lv:55,tier:5,stats:{def:5}});
  a.worn.push({uid:'worn-hood',slot:'head',text:'New Hood'});const trip=a.trip;
  let t=clock,panel='shop',zone='Town',hunting=false,selected=null,modal=null,gold=120000;
  let inventory=Array.from({length:13},(_,i)=>({uid:'sale'+i,text:'Void Blade',protected:false}));
  inventory.push({uid:'staff',text:'+1 Void Staff',protected:false},{uid:'card',text:'Void Blade',protected:false},{uid:'locked',text:'Void Blade',protected:true},{uid:'better',text:'Void Staff',protected:false,better:true},{uid:'unknown',text:'unknown',protected:false});
  const secondary=Array.from({length:20},(_,i)=>({uid:'armor'+i,text:'Old Hood',protected:false}));inventory.unshift(...secondary);
  const sold=[],controller=A.createController({mem,getCatalog:()=>cat,policy:{sellSurplus:true,levelingFocus:true,goldReserve:100000},now:()=>t,
    observe:async()=>state({zone,panel,gold,hpPotions:35,mpPotions:35,autoHunt:hunting?'on':'',inventoryComplete:panel==='bag',inventoryGear:inventory,bagUsage:[inventory.length,100],
      panelText:panel==='bag'?'In Bag\n'+(selected?.startsWith('armor')?'Old Hood\n✦ INT +3\nRefine +0/15':selected==='staff'?'Void Staff [2]\n✦ MATK +4%\nRefine +1/15\nCompared with worn: +4 Void Staff [2]\n▼ Worse than worn\nMATK▼180':'Void Blade\nRefine +0/15'+(selected==='card'?'\n🃏 Monster Card':'')):'',
      modalText:modal?'Sell equipment?\n'+modal.name+' for 500 G':'',
      controls:modal?[{label:'Sell'}]:[{bm:'world'},{wm:'field'},{go:'field'},{id:'interactBtn',label:'Talk to Shop'},{id:'autoBtn'},
        {act:'atab',key:'hunt'},{act:'atab',key:'loot'},{act:'aopt',k:'target',v:'mob',on:true},{act:'aopt',k:'prio',v:'near',on:true},
        {act:'ifilter',key:'all',on:true},...inventory.map(g=>({act:'isel',key:'g:'+g.uid})),...(selected?[{act:'isellg',key:selected,label:'Sell 500 G'}]:[])]}),
    click:async c=>{assert.notEqual(c.act,'stmove');if(c.id==='interactBtn')panel='shop';if(c.act==='isel')selected=c.key.slice(2);
      if(c.act==='isellg')modal={uid:selected,name:selected==='staff'?'Void Staff':'Void Blade'};
      if(c.label==='Sell'){sold.push(modal.uid);inventory=inventory.filter(g=>g.uid!==modal.uid);gold+=500;modal=null;selected=null;}
      if(c.go==='field')zone='Field';if(c.id==='autoBtn')hunting=true;},
    key:async()=>{},open:async p=>{panel=p;},close:async()=>{panel=null;},sleep:async()=>{},save:()=>{},log:()=>{}});
  for(let i=0;i<30&&a.trip;i++){const before=sold.length;await controller.run('town');assert.equal(a.lastResult.ok,true,a.lastResult.error);assert.ok(sold.length-before<=2);t+=5000;}
  assert.equal(sold.length,14);assert.equal(new Set(sold).size,14);assert.equal(a.sales.count,14);assert.equal(a.sales.gold,7000);
  assert.deepEqual(inventory.map(g=>g.uid),[...secondary.map(g=>g.uid),'card','locked','better','unknown']);assert.equal(a.resume.map,'field');assert.equal(a.trip,null);
  assert.equal(trip.secondaryInspections,8);assert.equal(Object.values(trip.keepReasons).filter(r=>r==='equipment with options').length,8);
  await controller.run('autonomy_wait');assert.equal(hunting,true);assert.equal(a.resume,null);assert.equal(a.farm.map,'field');
});

test('a filtered bag cannot report that all surplus was inspected',async()=>{
  const m={},a=A.init(m);a.worn=[{uid:'worn',slot:'weapon',text:'Void Staff'}];a.trip={kind:'shop',phase:'town',at:clock};
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{sellSurplus:true},now:()=>clock,
    observe:async()=>state({zone:'Town',panel:'shop',inventoryComplete:false,controls:[]}),open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('town');assert.equal(a.lastResult.ok,false);assert.notEqual(a.trip.salesDone,true);
});

test('a Return Scroll saved to a field continues to the verified town once, retaining the farm destination',async()=>{
  const m={},a=A.init(m);a.trip={kind:'shop',phase:'town',at:clock,returnMap:'field',returnMode:'farm'};const clicked=[];
  const c=A.createController({mem:m,getCatalog:()=>catalog(),policy:{sellSurplus:true},now:()=>clock,
    observe:async()=>state({zone:'Field',autoHunt:'',controls:[{bm:'world'},{wm:'town'},{go:'town'}]}),
    click:async b=>clicked.push(b),key:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await c.run('town');assert.equal(a.lastResult.ok,true);assert.deepEqual(clicked,[{bm:'world'},{wm:'town'},{go:'town'}]);
  assert.equal(a.trip.returnMap,'field');assert.equal(a.trip.townTravelAt,clock);
  await c.run('town');assert.equal(clicked.length,3);assert.equal(a.trip.phase,'town');assert.equal(a.trip.salesDone,false);
});

test('a supplied wing claims the workflow before a farm resume or periodic inventory scan',()=>{
 const m={},a=A.init(m);a.cbt={claimed:true};a.wingPriority=true;a.goal={slot:'wing',missing:[]};a.resume={map:'field'};
 const task=A.chooseTask(m,state({hpPotions:30,mpPotions:30}),catalog(),clock,{enabled:true,wingPriority:true,powerProgression:true});
 assert.equal(task,'town_forge');assert.equal(A.ownsWorkflow(m,state(),catalog(),task),true);
});

test('a ready wing reaches its live recipe before grade, runes and capacity on a fresh town service',async()=>{
 const m={},a=A.init(m),c=catalog();c.gear.push({id:'wing',name:'Arcane Wing',slot:'wing',tier:5,lv:50,craft:{gold:700000,mats:{mithril:8}}});
 a.wingPriority=true;a.inventory={items:{mithril:8},gear:[]};a.worn=[{slot:'weapon',uid:'w',text:'Void Staff'}];a.bagUsage=[98,100];a.last.forge=clock;
 a.trip={kind:'shop',phase:'town',at:clock,salesDone:true,salePolicyVersion:2};m.development={runeSmithNeeded:true};let tab='grade',gold=900000,crafted=false;const calls=[];
 const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{powerProgression:true,wingPriority:true,sellSurplus:true,goldReserve:100000},now:()=>clock,
 observe:async()=>state({zone:'Town',panel:'smith',gold,hpPotions:30,mpPotions:30,smithRows:[{act:'craft',key:'wing',gold:700000,mats:[{have:8,need:8}],disabled:false}],forgeResult:crafted?'Arcane Wing':'',controls:[{act:'smtab',key:'craft'},{act:'smwing',on:false},{act:'craft',key:'wing'}]}),
 click:async c=>{calls.push(c.act+':'+c.key);if(c.act==='craft'){gold-=700000;crafted=true;}},developAtSmith:async()=>assert.fail('runes cannot preempt a ready wing'),open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
 await ctl.run('town');assert.equal(a.lastResult.ok,true,a.lastResult.error);assert.equal(crafted,true);assert.equal(a.wingCraft.status,'crafted');assert.equal(gold,200000);assert.equal(a.trip.phase,'town');assert.ok(!calls.some(c=>/grade|star/.test(c)));
});

test('supplied boss preparation finishes optional town work without a farming detour and preserves uncertain sales',async()=>{
 for(const uncertain of [false,true]){
 const m={},a=A.init(m),c=catalog();m.bossLearning={pending:true,plan:{craftWing:true}};a.wingCraft={status:'equipped'};a.bagUsage=[90,100];a.worn=[{uid:'w',slot:'weapon',text:'Void Staff'}];a.trip={kind:'shop',phase:'return',at:clock,salesDone:false,forgeServiced:true};a.saleIntent={status:uncertain?'uncertain':'confirmed'};let inputs=0;
 const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{sellSurplus:true},now:()=>clock,observe:async()=>state({zone:'Town',hp:[1000,1000],hpPotions:30,mpPotions:30}),click:async()=>inputs++,open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
 await ctl.run('town');assert.equal(a.lastResult.ok,true,a.lastResult.error);assert.equal(inputs,0);
 if(uncertain)assert.ok(a.trip);else{assert.equal(a.trip,null);assert.equal(a.resume,null);assert.equal(a.farm,null);assert.equal(a.townVisit.servicedAt,clock);}
 }
});

test('boss potion restocking precedes optional sales and hands a supplied shop visit back without a forge detour',async()=>{
 const m={},a=A.init(m),c=catalog();m.bossLearning={pending:true,plan:{craftWing:false}};a.bagUsage=[90,100];a.trip={kind:'shop',phase:'town',at:clock,salesDone:false,salePolicyVersion:2};a.worn=[];
 let hpPotions=7,gold=200000;const purchases=[];
 const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{goldReserve:100000,sellSurplus:true},now:()=>clock,
 observe:async()=>state({zone:'Town',panel:'shop',hp:[1000,1000],hpPotions,mpPotions:40,gold,controls:[{act:'buy',key:'mega_potion',amount:'10',label:'Buy 10 for 2000 G'}]}),
 click:async c=>{purchases.push(c.key);hpPotions+=10;gold-=2000;},open:async p=>{if(p==='bag')assert.fail('optional inventory cannot delay low potions');},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
 await ctl.run('town');assert.equal(a.lastResult.ok,true,a.lastResult.error);assert.equal(hpPotions,17);assert.ok(a.trip);
 await ctl.run('town');assert.equal(hpPotions,27);assert.ok(a.trip);await ctl.run('town');assert.equal(a.trip,null);assert.deepEqual(purchases,['mega_potion','mega_potion']);assert.equal(gold,196000);
});

test('a town visit older than 90 seconds is cut off and the hero returns to the field',async()=>{
  const m={},a=A.init(m),c=catalog();
  const trip={kind:'forge',phase:'town',at:clock-120000,returnMap:'field',returnMode:'farm',salesDone:false};
  a.trip=trip;let auto='';
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',panel:'smith',autoHunt:auto,controls:[{bm:'world'},{wm:'field'},{go:'field'},{id:'autoBtn'}]}),
    click:async x=>{if(x.id==='autoBtn')auto='on';},key:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('town');
  assert.equal(a.trip,null);assert.equal(a.resume.map,'field');
  assert.equal(trip.salesDone,true);assert.equal(trip.forgeServiced,true);assert.equal(trip.forgeDone,true);
  assert.equal(a.townCooldownUntil,clock+45*60000);
  assert.ok(a.events.some(e=>e.type==='town_timeout_abort'));
  assert.equal(auto,'on');
});
test('an unreadable refine outcome ends the town visit instead of looping on it',async()=>{
  const m={},a=A.init(m),c=catalog();
  const trip={kind:'forge',phase:'town',at:clock,returnMap:'field',returnMode:'farm'};
  a.trip=trip;
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',panel:null,controls:[]}),
    click:async()=>{},key:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('town');
  assert.equal(a.lastResult.ok,true,a.lastResult.error);
  assert.equal(a.trip,null);
  assert.equal(trip.salesDone,true);assert.equal(trip.forgeServiced,true);assert.equal(trip.forgeDone,true);
  assert.ok(a.events.some(e=>e.type==='town_outcome_unreadable'));
  assert.equal(a.townCooldownUntil,clock+45*60000);
});
test('a visit that just ended keeps the hero out of town for 45 minutes',()=>{
  const m={},a=A.init(m),c=catalog();
  a.wingPriority=true;a.goal={slot:'wing',missing:[]};a.bagUsage=[10,100];
  a.last.inventory=clock;a.last.equipment=clock;a.last.farm=clock;
  const policy={enabled:true,wingPriority:true,levelingFocus:false,goldReserve:100000};
  a.townCooldownUntil=clock+45*60000;
  assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:30}),c,clock,policy),null);
  assert.equal(A.chooseTask(m,state({hpPotions:6,mpPotions:30}),c,clock,policy),'town_forge');
  a.townCooldownUntil=clock-1;
  assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:30}),c,clock,policy),'town_forge');
});
test('a new town visit is refused while the cooldown runs',async()=>{
  const m={},a=A.init(m),c=catalog();
  a.townCooldownUntil=clock+45*60000;
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Field'}),click:async()=>{},key:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('town_shop');
  assert.equal(a.trip??null,null);
  assert.ok(a.events.some(e=>e.type==='town_visit_deferred'));
});

test('a full bag waits for the cooldown like any other errand',async()=>{
  const m={},a=A.init(m),c=catalog();
  a.bagUsage=[130,130];a.townCooldownUntil=clock+45*60000;
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Field'}),click:async()=>{},key:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('town_shop');
  assert.equal(a.trip??null,null);
  assert.ok(a.events.some(e=>e.type==='town_visit_deferred'));
});

test('a trip that ends while the hero is still leveling resumes the farm route, not the quest route',async()=>{
  const m={},a=A.init(m),c=catalog();
  a.trip={kind:'shop',phase:'return',returnMap:'field',returnMode:'mq',at:clock,salesDone:true};
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',autoHunt:'on',controls:[{bm:'world'},{wm:'field'},{go:'field'}]}),
    click:async()=>{},key:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('town');
  assert.equal(a.trip,null);
  assert.equal(a.resume.mode,'farm');
  assert.equal(a.resume.map,'field');
});

test('a level gated story route is stopped while the hero levels',async()=>{
  const m={},a=A.init(m),c=catalog();
  a.farm={map:'field',name:'Field',started:clock,pendingProfile:false,target:'mob'};
  let questRunning=true;const stops=[];
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Field',autoQuestMode:'mq',autoQuestRunning:questRunning,quest:'Sage Quest Chapter 27 Requires Lv 89 (1 more level)',autoHunt:'on',
      controls:[{aq:'stop'},{id:'autoBtn'}]}),
    click:async x=>{if(x.aq==='stop'){stops.push(x.aq);questRunning=false;}},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('autonomy_wait');
  assert.deepEqual(stops,['stop']);
});
test('a story route whose chapter is reachable is left running',async()=>{
  const m={},a=A.init(m),c=catalog();
  a.farm={map:'field',name:'Field',started:clock,pendingProfile:false,target:'mob'};
  const stops=[];
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{levelingFocus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Field',autoQuestMode:'mq',autoQuestRunning:true,quest:'Sage Quest Chapter 27 Requires Lv 40',autoHunt:'on',
      controls:[{aq:'stop'},{id:'autoBtn'}]}),
    click:async x=>{if(x.aq==='stop')stops.push(x.aq);},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('autonomy_wait');
  assert.deepEqual(stops,[]);
});

test('the town visit sells the surplus before the forge step can take the visit',async()=>{
  const m={},a=A.init(m),c=catalog();
  c.gear.push({id:'blade9',name:'Refine Blade',slot:'weapon',fam:'blade',tier:9,lv:70,stats:{atk:10},refinement:Array.from({length:16},(_,r)=>({ore:1,bonus:{atk:r*6}}))});
  a.worn=[{uid:'w',slot:'weapon',text:'+4 Refine Blade'}];
  a.trip={kind:'shop',phase:'town',at:clock,salesDone:false,salePolicyVersion:2,storageScanned:true};
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{sellSurplus:true,goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',panel:'shop',hpPotions:35,mpPotions:35,inventoryComplete:true,inventoryItems:{},inventoryGear:[],controls:[]}),
    click:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('town');
  assert.equal(a.trip.kind,'shop','the sale must run before the forge takes the visit');
  assert.equal(a.trip.salesDone,true);
  a.trip={kind:'shop',phase:'town',at:clock,salesDone:true,salePolicyVersion:2,storageScanned:true};
  await ctl.run('town');
  assert.equal(a.trip.kind,'forge','the forge runs once the bag is relieved');
});
test('a town visit older than the 70 second budget is cut off',async()=>{
  const m={},a=A.init(m),c=catalog();
  const trip={kind:'forge',phase:'town',at:clock-80000,returnMap:'field',returnMode:'farm',salesDone:false};
  a.trip=trip;let auto='';
  const ctl=A.createController({mem:m,getCatalog:()=>c,policy:{goldReserve:100000},now:()=>clock,
    observe:async()=>state({zone:'Town',panel:'smith',autoHunt:auto,controls:[{bm:'world'},{wm:'field'},{go:'field'},{id:'autoBtn'}]}),
    click:async x=>{if(x.id==='autoBtn')auto='on';},key:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},log:()=>{}});
  await ctl.run('town');
  assert.equal(a.trip,null);
  assert.ok(a.events.some(e=>e.type==='town_timeout_abort'));
  assert.equal(a.townCooldownUntil,clock+45*60000);
});
