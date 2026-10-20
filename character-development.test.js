'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),D=require('./character-development');
const now=1800000000000;
const state=(extra={})=>({name:'Hero',job:'Starweaver',lv:'Lv 73',hp:[900,1000],controls:[],offscreen:[],gold:2000000,crystals:4000,...extra});
test('temporary ore depletion waits for respawn and a ready boss deadline ends the mining stage',async()=>{
  const m={autonomy:{wingPriority:true,goal:{slot:'wing',missing:[{id:'gear'}]}},development:{version:1,last:{},failures:{},snapshots:{},history:[],steps:0,excursion:{kind:'mine',map:'south',tier:1,returnMap:'old',started:now-10000}}};let inputs=0;
  const ctl=D.createController({mem:m,observe:async()=>state({hpPotions:25,mpPotions:25}),scan:async()=>null,scene:async()=>({available:true,map:'south',mineLv:1,mineExp:0,nodes:[]}),sceneAction:async()=>inputs++,travel:async()=>inputs++,click:async()=>inputs++,open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},getCatalog:()=>({monsters:[{id:'time',boss:true,drops:[['gear',1]]}]}),now:()=>now});
  assert.equal((await ctl.run('growth_materials')).ok,true);assert.equal(inputs,0);assert.equal(m.development.excursion.done,undefined);assert.equal(m.development.excursion.waitingForNodes,now);
  m.development.bossRetryAt=now;await ctl.run('growth_materials');assert.equal(m.development.excursion.done,true);
});
test('boss combat selects the rendered requested entity before enabling AUTO',async()=>{
  const m={autonomy:{wingPriority:true},development:{version:1,last:{},failures:{},snapshots:{},history:[],steps:0,excursion:{kind:'boss',id:'time',boss:'Time Eater',map:'crystal',phase:'travel',profileReady:true,bossPoint:{x:500,y:600},started:now-60000}}},events=[];let target='',auto=false;
  const ctl=D.createController({mem:m,observe:async()=>state({hpPotions:25,mpPotions:25,autoHunt:auto?'on':'',target,controls:[{id:'autoBtn'}]}),scan:async()=>null,scene:async()=>({available:true,map:'crystal',x:500,y:600,bosses:[{id:'entity-time',kind:'time',visible:true}]}),sceneAction:async(id,kind)=>{events.push([id,kind]);target='Lv 34 Time Eater';},travel:async()=>{},click:async c=>{events.push(c.id);auto=true;},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},getCatalog:()=>({}),now:()=>now});
  assert.equal((await ctl.run('growth_materials')).ok,true);assert.deepEqual(events,[['entity-time','boss'],'autoBtn']);assert.equal(m.development.excursion.seen,true);assert.equal(m.development.excursion.phase,'fight');
});
test('waiting for a guaranteed boss material can continue safe mining instead of standing idle or starting town chores',()=>{
  const c={monsters:[{id:'time',lv:34,boss:true,drops:[['gear',1]]}],development:{mining:[{tier:1,level:1,mapLevel:0,ore:'copper'}]},maps:[{id:'south',range:'Lv 1-6'}]};
  assert.equal(D.materialPlan(c,[{id:'gear'}],{available:true,mineLv:1},state(),{wingPriority:true,skipBoss:true}).map,'south');
});
test('resource boss routing pins the requested live boss before enabling generic boss hunting',async()=>{
  const m={autonomy:{wingPriority:true},development:{version:1,last:{},failures:{},snapshots:{},history:[],steps:0,excursion:{kind:'boss',id:'time',boss:'Time Eater',map:'crystal',phase:'fight',started:now-60000,fightAt:now-30000}}},events=[];let auto=true;
  const ctl=D.createController({mem:m,observe:async()=>state({hpPotions:25,mpPotions:25,autoHunt:auto?'on':'',target:'Lv 30 Other Boss',bossRows:[{name:'Time Eater',up:true,key:'crystal,500,600'}],controls:[{id:'autoBtn'},{act:'bbgo',key:'crystal,500,600'}]}),scan:async()=>null,scene:async()=>({available:true,map:'crystal',x:100,y:100}),sceneAction:async()=>{},travel:async()=>{},click:async c=>{events.push(c.id||c.key);if(c.id==='autoBtn')auto=false;},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},getCatalog:()=>({}),now:()=>now});
  await ctl.run('growth_materials');assert.deepEqual(events,['autoBtn','crystal,500,600']);assert.equal(auto,false);assert.equal(m.development.excursion.phase,'travel');assert.deepEqual(m.development.excursion.bossPoint,{x:500,y:600});
});
test('wing departure stops combat and uses an owned potion rather than waiting forever for a high health sample',async()=>{
  const m={autonomy:{wingPriority:true,goal:{slot:'wing',missing:[{id:'mithril'}]},farm:{map:'old'}}},events=[];let hp=700,auto=true,potions=25;
  const ctl=D.createController({mem:m,observe:async()=>state({hp:[hp,1000],hpPotions:potions,mpPotions:25,autoHunt:auto?'on':'',controls:[{id:'autoBtn'},{id:'potHp'}]}),scan:async()=>null,scene:async()=>({available:true,mineLv:1}),sceneAction:async()=>{},
    travel:async id=>events.push(id),click:async c=>{events.push(c.id);if(c.id==='autoBtn')auto=false;if(c.id==='potHp'){hp=1000;potions--;}},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},
    getCatalog:()=>({development:{mining:[{tier:1,level:1,mapLevel:0,ore:'copper'},{tier:4,level:20,mapLevel:46,ore:'mithril'}]},maps:[{id:'south',range:'Lv 1-6'}],monsters:[]}),now:()=>now});
  assert.equal((await ctl.run('growth_materials')).ok,true);assert.deepEqual(events,['autoBtn','potHp','south']);assert.equal(m.development.excursion.kind,'mine');
  m.autonomy.goal.missing=[{id:'sigil_ore'}];assert.equal(D.materialReady(m,state({hpPotions:25,mpPotions:25})),false);
});
test('wing gathering chains bounded stages without returning through the EXP map between them',async()=>{
  const m={autonomy:{wingPriority:true,inventory:{items:{}},farm:{map:'original'},goal:{slot:'wing',missing:[{id:'mithril'}]}},development:{version:1,last:{},failures:{},snapshots:{},history:[],steps:0,excursion:{kind:'mine',map:'south',returnMap:'original',started:now-16*60000}}},travelled=[];
  const ctl=D.createController({mem:m,observe:async()=>state({hp:[800,1000],hpPotions:25,mpPotions:25,autoHunt:''}),scan:async()=>null,scene:async()=>({available:true,map:'south'}),sceneAction:async()=>{},travel:async id=>travelled.push(id),click:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},getCatalog:()=>({}),now:()=>now});
  assert.equal((await ctl.run('growth_materials')).ok,true);assert.equal(m.development.excursion,null);assert.deepEqual(travelled,[]);assert.equal(m.autonomy.farm.map,'original');assert.equal(m.autonomy.resume,undefined);
});
test('travel recovery spends only an observed free warp and refuses paid wing confirmations',async()=>{
  for(const paid of [false,true]){
    const m={autonomy:{wingPriority:true},development:{version:1,last:{},failures:{},snapshots:{},history:[],steps:0,excursion:{kind:'boss',id:'time',boss:'Time Eater',map:'crystal',returnMap:'old',started:now-60000}}};let modal=false,confirmed=0,map='coral',free=1;
    const ctl=D.createController({mem:m,observe:async()=>state({hpPotions:25,mpPotions:25,bossRows:[{name:'Time Eater',up:true,key:'crystal,500,500'}],modalText:modal?(paid?'Use 1 Warp Wing':'Use 1 free warp'):'',controls:[{act:'crtab',key:'warp'},{act:'crwarp',key:'crystal'},{label:'Warp'},{act:'bbgo',key:'crystal,500,500'}]}),
      scan:async()=>null,scene:async()=>({available:true,map,freeWarps:free,x:0,y:0}),sceneAction:async()=>{},travel:async()=>{},click:async c=>{if(c.act==='crwarp')modal=true;if(c.label==='Warp'){confirmed++;map='crystal';free=0;modal=false;}},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},getCatalog:()=>({}),now:()=>now});
    await ctl.run('growth_materials');assert.equal(confirmed,paid?0:1);if(paid)assert.equal(m.development.result.ok,false);else assert.deepEqual(m.development.excursion.bossPoint,{x:500,y:500});
  }
});
test('explicit wing focus gets material time even with a full gear bag, while active town work and health stay protected',()=>{
  const m={autonomy:{wingPriority:true,goal:{slot:'wing',missing:[{id:'mithril'}]},bagUsage:[100,100]}};
  const s=state({hpPotions:25,mpPotions:25});assert.equal(D.routineReady(m,s),false);assert.equal(D.materialReady(m,s),true);assert.equal(D.chooseTask(m,s,{},now),'growth_materials');
  assert.equal(D.materialReady(m,{...s,hp:[600,1000]}),false);m.autonomy.trip={kind:'shop'};assert.equal(D.materialReady(m,s),false);assert.equal(D.chooseTask(m,s,{},now),null);
});
test('wing focus uses a guaranteed boss drop first and mines during the boss retry window',()=>{
  const c={monsters:[{id:'time',name:'Time Eater',lv:34,boss:true,drops:[['gear',1]]}],development:{mining:[{tier:1,level:1,mapLevel:0,ore:'copper'},{tier:4,level:20,mapLevel:46,ore:'mithril'}]},maps:[{id:'south',range:'Lv 1-6'}]};
  const missing=[{id:'gear'},{id:'mithril'}],scene={available:true,mineLv:1};
  assert.equal(D.materialPlan(c,missing,scene,state(),{wingPriority:true}).kind,'boss');
  assert.equal(D.materialPlan(c,missing,scene,state(),{wingPriority:true,skipBoss:true}).kind,'mine');
});
test('public map-wide material drops are a fallback when mining is unavailable',()=>{
  const c={development:{mapDrops:{crystal:[{id:'sapphire',chance:0.0015}]}},maps:[{id:'crystal',range:'Lv 25-32',monsters:[{id:'golem',n:3}]}],monsters:[{id:'golem',lv:30,hp:1000}]};
  assert.equal(D.materialPlan(c,[{id:'sapphire'}],{available:false},state()).map,'crystal');
  assert.equal(D.materialPlan(c,[{id:'unknown'}],{available:false},state()),null);
});
test('expiring pet offers precede town work, but survival and changed UI still win',()=>{
  const m={autonomy:{trip:{kind:'forge'}}},s=state({controls:[{id:'tameYes'}]});
  assert.equal(D.chooseTask(m,s,null,now),'tame');
  assert.equal(D.chooseTask(m,{...s,hp:[200,1000]},null,now),null);
  assert.equal(D.chooseTask({...m,uiHealth:{safeIdle:true}},s,null,now),null);
  assert.equal(D.chooseTask(m,state(),null,now),null);
});
test('growth retries have backoff and farming resumes between work slices',()=>{
  const m={},d=D.init(m);assert.equal(D.chooseTask(m,state(),null,now),'pets');
  d.last.pets=now;assert.equal(D.chooseTask(m,state(),null,now),'growth_buffs');d.last.growth_buffs=now;assert.equal(D.chooseTask(m,state(),null,now),'runes');
  d.failures.runes={at:now};assert.equal(D.chooseTask(m,state(),null,now),'cards');
  m.autonomy={resume:{map:'field'}};assert.equal(D.chooseTask(m,state(),null,now),null);
});
test('safe development gets time between frequent bag checks, while urgent supplies and active trips keep priority',()=>{
  const m={autonomy:{bagUsage:[89,100]}},s=state({hpPotions:22,mpPotions:42});assert.equal(D.routineReady(m,s),true);
  m.autonomy.bagUsage=[95,100];assert.equal(D.routineReady(m,s),false);m.autonomy.bagUsage=[89,100];
  assert.equal(D.routineReady(m,{...s,hpPotions:10}),false);m.autonomy.trip={kind:'shop'};assert.equal(D.routineReady(m,s),false);
});
test('native 60-percent potion cycling does not starve nonintrusive development',()=>{
  const m={autonomy:{bagUsage:[80,100]}},s=state({hp:[620,1000],hpPotions:22,mpPotions:42});
  assert.equal(D.routineReady(m,s),true);assert.equal(D.chooseTask(m,s,{},now),'pets');
  assert.equal(D.routineReady(m,{...s,hp:[400,1000]}),false);assert.equal(D.chooseTask(m,{...s,hp:[400,1000]},null,now),null);
});
test('duplicate offers cannot monopolize development or fill the ranch with one species',()=>{
  const d={snapshots:{ranch:{pets:[{name:'Storm Narwhal'},{name:'Storm Narwhal'}]}}};
  assert.equal(D.worthOffer(d,state({tameOffer:'Storm Narwhal\nLv 66 · wants to join'})),false);
  assert.equal(D.worthOffer(d,state({tameOffer:'Gloom Nautilus\nLv 68 · wants to join'})),true);
  d.snapshots.ranch.pets=Array.from({length:10},()=>({name:'Other'}));assert.equal(D.worthOffer(d,state({tameOffer:'Rare boss'})),false);
});
test('bounded model reviews persist their deadline across restarts and react to new level brackets',()=>{
  const m={autonomy:{bagUsage:[80,100]}},s=state({hpPotions:22,mpPotions:42});
  assert.equal(D.reviewDue(m,s,now),false);assert.equal(D.reviewDue(m,s,now+119*60000),false);assert.equal(D.reviewDue(m,s,now+120*60000),true);
  assert.equal(D.reviewDue(m,{...s,lv:'Lv 75'},now+16*60000),true);
  m.development.lastReviewAt=now+120*60000;m.development.lastReviewEpoch='Starweaver:14';
  assert.equal(D.reviewDue(JSON.parse(JSON.stringify(m)),s,now+125*60000),false);
});
test('optional model exploration never preempts urgent supplies, trips or UI recovery',()=>{
  const m={autonomy:{bagUsage:[80,100]}},s=state({hpPotions:22,mpPotions:42});D.reviewDue(m,s,now);
  assert.equal(D.reviewDue(m,{...s,hpPotions:10},now+180*60000),false);m.autonomy.trip={kind:'forge'};assert.equal(D.reviewDue(m,s,now+180*60000),false);
  m.autonomy.trip=null;m.uiHealth={safeIdle:true};assert.equal(D.reviewDue(m,s,now+180*60000),false);
});
test('runes use native recommendation, then collected copies before paid crafting',()=>{
  const v={runeSlots:[{id:'L1',empty:true,selected:true}],runeCards:[{id:'comet_rain',known:false,have:1,learn:{disabled:false}}],runeRows:[]};
  assert.deepEqual(D.runeStep(v,{},state()),{act:'rnlearn',id:'comet_rain'});
  v.runeFree=[{id:'astral_lance',recommended:true}];assert.equal(D.runeStep(v,{},state()).id,'astral_lance');
  v.runeFree.push({id:'comet_rain',recommended:true});assert.equal(D.runeStep(v,{},state()).act,'rnlearn');
});
test('locked slots and occupied skill bindings never get reassigned',()=>{
  const card={id:'leech',known:true,have:0};
  const v={runeSlots:[{id:'S1',empty:true,selected:true}],runeCards:[card],runeSkills:[{id:'blaze',occupied:true,selected:true}],runeRows:[{set:{key:'leech',skill:'blaze',fee:0}}]};
  assert.equal(D.runeStep(v,{},state()),null);v.runeSlots[0].locked=true;assert.equal(D.runeStep(v,{},state()),null);
});
test('rune crafting follows current level and public cost coefficients',()=>{
  const c={craft:{gold:100,dust:30},goldPerLevel:100};assert.equal(D.runeCost(c,state()).gold,7300);
  assert.equal(D.runeCost({...c,goldPerLevel:undefined},state()),null);
  const v={runeSlots:[{id:'L1',empty:true,selected:true}],runeCards:[{id:'comet_rain',known:false,have:0,craft:{disabled:false}}]};
  assert.equal(D.runeStep(v,{development:{runes:{comet_rain:c}}},state()).smith,true);
});
test('partial combo installs its missing half instead of treating the slot as complete',()=>{
  const v={runeSlots:[{id:'C',empty:false,selected:true,text:'Harvest → –'}],runeCards:[{id:'harvest',known:true},{id:'meteor',known:false,learn:{disabled:false}}],runeRows:[{on:true}]};
  assert.equal(D.runeStep(v,{},state()).id,'meteor');
});
test('a pet requires numeric rendered combat stats before it can be selected',()=>{
  assert.equal(D.bestPet([{id:'x',stats:'???'}]),null);
  assert.equal(D.bestPet([{id:'a',stats:'Lv 1 · HP 100 · ATK 10'},{id:'b',stats:'Lv 2 · HP 200 · ATK 20'}]).id,'b');
});
test('an unacknowledged rune click is not recorded as a successful development',async()=>{
  const mem={},v={panel:'skills',runeSlots:[{id:'L1',empty:true,selected:true}],runeCards:[{id:'comet_rain',known:false,have:1,learn:{disabled:false}}]};
  const ctl=D.createController({mem,observe:async()=>state({controls:[{act:'rnview'},{act:'rnlearn',key:'comet_rain'}]}),scan:async()=>v,click:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},getCatalog:()=>({}),now:()=>now});
  const result=await ctl.run('runes');assert.equal(result.ok,false);assert.equal(mem.development.history.length,0);
});
test('owned rune learning verifies its codex transition without spending crystals',async()=>{
  const mem={};let learned=false;
  const ctl=D.createController({mem,observe:async()=>state({controls:[{act:'rnview'},{act:'rnlearn',key:'comet_rain'}]}),scan:async()=>({panel:'skills',runeSlots:[{id:'L1',empty:true,selected:true}],runeCards:[{id:'comet_rain',known:learned,have:learned?0:1,learn:{disabled:false}}]}),click:async()=>{learned=true;},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},getCatalog:()=>({}),now:()=>now});
  assert.equal((await ctl.run('runes')).ok,true);assert.equal(mem.development.steps,1);
});
test('free rune learning tolerates concurrent farming income while verifying the learned rune',async()=>{
  const mem={};let learned=false,calls=0;
  const ctl=D.createController({mem,observe:async()=>state({gold:2000000+100*calls++,controls:[{act:'rnview'},{act:'rnlearn',key:'comet_rain'}]}),scan:async()=>({panel:'skills',runeSlots:[{id:'L1',empty:true,selected:true}],runeCards:[{id:'comet_rain',known:learned,have:learned?0:1,learn:{disabled:false}}]}),click:async()=>{learned=true;},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},getCatalog:()=>({}),now:()=>now});
  assert.equal((await ctl.run('runes')).ok,true);assert.equal(mem.development.steps,1);
});
test('development observation fits the existing GET header budget',()=>{assert.ok(encodeURIComponent(D.EXPRESSION).length<15000);});
test('resource scene reads are narrow and fit the adapter without importing action functions',()=>{
  assert.ok(encodeURIComponent(D.SCENE_EXPRESSION).length<15000);assert.doesNotMatch(D.SCENE_EXPRESSION,/\.send\(|walkTo\(|lifeTap\(|startAct\(/);
});
test('food chooses the highest EXP bonus and never consumes another copy while it is active',()=>{
  const c={items:{feast:{food:true,use:{buff:{exp:0.1,hp:0.06}}},soup:{food:true,use:{buff:{exp:0.08}}},focus_tonic:{use:{buff:{cd:0.1}}}}};
  assert.equal(D.buffChoice(c,{feast:2,soup:1},[]),'feast');assert.equal(D.buffChoice(c,{feast:2,soup:1},[{id:'feast'}]),null);
  assert.equal(D.buffChoice(c,{focus_tonic:1},[]),'focus_tonic');
});
test('wing mining starts at the unlocked life tier rather than the character level',()=>{
  const c={development:{mining:[{tier:1,level:1,mapLevel:0,ore:'copper',gem:'quartz'},{tier:2,level:5,mapLevel:12,ore:'iron',gem:'garnet'},{tier:3,level:12,mapLevel:28,ore:'silver',gem:'sapphire'},{tier:4,level:20,mapLevel:46,ore:'mithril',gem:'crystal'}]},maps:[{id:'south',range:'Lv 1-6'},{id:'sand',range:'Lv 12-18'},{id:'swamp',range:'Lv 28-36'},{id:'obsidian',range:'Lv 46-50'}],monsters:[]};
  assert.equal(D.materialPlan(c,[{id:'mithril'}],{available:true,mineLv:1},state()).map,'south');
  assert.equal(D.materialPlan(c,[{id:'mithril'}],{available:true,mineLv:20},state()).map,'obsidian');
  assert.equal(D.materialPlan(c,[{id:'sapphire'}],{available:false},state()),null);
});
test('boss material trips reject bosses close to or above the character level',()=>{
  const c={monsters:[{id:'hard',name:'Hard',lv:70,boss:true,drops:[['gear',1]]},{id:'safe',name:'Safe',lv:40,boss:true,drops:[['gear',1]]}]};
  assert.equal(D.materialPlan(c,[{id:'gear'}],null,state()).id,'safe');
  c.monsters.shift();c.monsters[0].lv=80;assert.equal(D.materialPlan(c,[{id:'gear'}],null,state()),null);
});
test('low health during a resource trial schedules return rather than abandoning recovery state',()=>{
  const m={development:{excursion:{kind:'mine'}}};assert.equal(D.chooseTask(m,state({hp:[400,1000]}),{},now),'growth_materials');
  assert.equal(D.chooseTask(m,state({dead:true}),{},now),null);
});
test('a timed-out resource trip restores the saved farm and keeps the bag/sale state intact',async()=>{
  const mem={autonomy:{farm:{map:'original'},sales:{count:4}},development:{version:1,last:{},failures:{},snapshots:{},history:[],steps:0,excursion:{kind:'mine',map:'south',returnMap:'original',started:now-6*60000}}},visited=[];
  const ctl=D.createController({mem,observe:async()=>state({hpPotions:25,mpPotions:25,inventoryComplete:true,autoHunt:''}),scan:async()=>null,scene:async()=>({available:true,map:'south'}),sceneAction:async()=>{},travel:async id=>visited.push(id),click:async()=>{},open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},getCatalog:()=>({}),now:()=>now});
  assert.equal((await ctl.run('growth_materials')).ok,true);assert.deepEqual(visited,['original']);assert.equal(mem.development.excursion,null);assert.equal(mem.autonomy.resume.map,'original');assert.equal(mem.autonomy.sales.count,4);
});
test('paid rune operations fail before input if the currently rendered price cannot be verified',async()=>{
  let clicks=0;const mem={},v={panel:'skills',runeSlots:[{id:'L1',empty:true,selected:true}],runeCards:[{id:'comet_rain',known:false,have:0,craft:{disabled:false,tip:'Unexpected price'}}]};
  const ctl=D.createController({mem,observe:async()=>state({panel:'smith',controls:[{act:'rnview'}]}),scan:async()=>v,click:async()=>clicks++,open:async()=>{},close:async()=>{},sleep:async()=>{},save:()=>{},getCatalog:()=>({development:{runes:{comet_rain:{craft:{gold:100,dust:30},goldPerLevel:100}}}}),now:()=>now});
  assert.equal((await ctl.run('runes')).ok,false);assert.equal(clicks,0);assert.equal(mem.development.steps,0);
});
