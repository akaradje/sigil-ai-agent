'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('./autonomy');
const C=require('./game-catalog');
const {createAvailability}=require('./server-availability');
const clock=1800000000000;
test('95 percent bag threshold and proactive potion restock keep a cooldown',()=>{
  const m={},a=A.init(m);a.cbt={claimed:true};a.last.inventory=clock;a.last.equipment=clock;a.last.forge=clock;a.last.farm=clock;
  a.bagUsage=[94,100];const policy={enabled:true,crystalBudget:0};
  assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:30}),catalog(),clock,policy),null);
  a.bagUsage=[95,100];assert.equal(A.chooseTask(m,state(),catalog(),clock,policy),'town_storage');
  a.bagUsage=[50,100];assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:10}),catalog(),clock,policy),'town_shop');
  a.last.town_shop=clock;assert.equal(A.chooseTask(m,state({hpPotions:30,mpPotions:10}),catalog(),clock,policy),null);
  m.uiHealth={safeIdle:true};a.bagUsage=[100,100];assert.equal(A.chooseTask(m,state(),catalog(),clock,policy),null);
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
    observe:async()=>state({panel,crystals,modalText:modal,premiumRows:[{id:'bag',price:150,owned,disabled:false}],
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
