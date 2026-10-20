const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const IQ=require('./game-intelligence');

test('production model transport rejects empty capped replies and counts only usable text or tool calls',async()=>{
 const source=require('node:fs').readFileSync(require.resolve('./agent'),'utf8'),start=source.indexOf('async function chat('),end=source.indexOf('// Keep the configured model',start);
 assert.ok(start>0&&end>start);let response={choices:[{finish_reason:'length',message:{content:''}}]},up=0,request;
 const chat=vm.runInNewContext('('+source.slice(start,end).trim()+')',{MODEL:'synthetic-model',rawCall:async(body,timeout)=>{request={body,timeout};return response;},markModelUp:()=>up++});
 await assert.rejects(()=>chat([]),/no usable answer/);assert.equal(up,0);
 response={choices:[{message:{content:'{"action":"navigate_boss"}'}}]};await chat([],undefined,{maxTokens:1600,timeoutSec:60});assert.equal(up,1);assert.equal(request.body.max_tokens,1600);assert.equal(request.timeout,60);
 response={choices:[{message:{content:null,tool_calls:[{id:'fixture',type:'function',function:{name:'look',arguments:'{}'}}]}}]};await chat([]);assert.equal(up,2);assert.equal(request.timeout,60);
});

test('external panel transactions do not exhaust a counter retained from earlier workflows',async()=>{
  const mem=IQ.freshMemory();let panel=null,menu=false,clicks=0;
  const e=IQ.createExecutor({mem,observe:async()=>({...healthy(),panel,panelOpen:!!panel,menuOpen:menu,controls:menu?[{open:'bag'}]:[{id:'menuBtn'}]}),
    click:async c=>{clicks++;if(c.id==='menuBtn')menu=true;else if(c.open){panel=c.open;menu=false;}},key:async()=>{panel=null;menu=false;},sleep:async()=>{},save:()=>{},log:()=>{}});
  for(let i=0;i<20;i++){await e.open('bag');assert.equal(panel,'bag');await e.close();}
  assert.equal(clicks,40);
});
test('supervisor does not steal the UI during agent startup or a short restart',()=>{
  const m={},t=1800000000000;
  assert.equal(IQ.controllerFallbackReady(m,false,t),false);
  assert.equal(IQ.controllerFallbackReady(m,false,t+100),false);
  assert.equal(IQ.controllerFallbackReady(m,true,t+1000),false);
  assert.equal(m.agentMissingSince,undefined);
  assert.equal(IQ.controllerFallbackReady(m,false,t+2000),false);
  assert.equal(IQ.controllerFallbackReady(m,false,t+61999),false);
  assert.equal(IQ.controllerFallbackReady(m,false,t+62000),true);
  assert.equal(IQ.controllerFallbackReady(m,true,t+63000),false);
});
test('serialized perception fits the local GET adapter header budget',()=>{
  assert.ok(encodeURIComponent('JSON.stringify('+IQ.PERCEPTION+')').length<15000);
});
const healthy=()=>({name:'Hero',job:'Mage',lv:'Lv 44',jobLv:'Job 40 MAX',hp:[900,1800],gold:49000,exp:40,quest:'Train to Lv 47',autoQuestRunning:true,controls:[]});
test('earned stat points can be used each level instead of waiting for a twenty-point backlog',()=>{
  const m=IQ.freshMemory();assert.equal(IQ.chooseTask({...healthy(),statPoints:7},m,1800000000000),'stats');
});
test('unaffordable native stat plans wait for changed points or a bounded cost recheck',()=>{
  const now=1800000000000,m=IQ.freshMemory(),s={...healthy(),statPoints:8};m.statsDeferred={points:8,level:s.lv,job:s.job,at:now};
  assert.notEqual(IQ.chooseTask(s,m,now),'stats');assert.equal(IQ.chooseTask({...s,statPoints:9},m,now),'stats');assert.equal(IQ.chooseTask(s,m,now+900001),'stats');
});
test('a zero-point native recommendation is deferred without a fake allocation or confirmation',async()=>{
  const mem=IQ.freshMemory(),clicked=[];let panel=null;
  const s=()=>({...healthy(),statPoints:8,panel,panelOpen:!!panel,controls:panel?[{act:'srec',label:'Suggested'}]:[{open:'stats'}]});
  const e=IQ.createExecutor({mem,observe:async()=>s(),click:async c=>{clicked.push(c.act||c.open);if(c.open)panel=c.open;},key:async()=>{panel=null;},sleep:async()=>{},save:()=>{},log:()=>{}});
  const result=await e.run('stats');assert.equal(result.ok,true);assert.match(result.result,/wait for points/);assert.deepEqual(clicked,['stats','srec']);assert.equal(mem.statsDeferred.points,8);
});
test('ranking deadline stays due during town trips while respecting failure backoff',()=>{
  const now=1800000000000,m=IQ.freshMemory();m.last.rank=now-300001;m.autonomy={trip:{kind:'forge'}};
  assert.equal(IQ.rankDue(m,now),true);
  m.failures.rank={at:now-1000,count:2};assert.equal(IQ.rankDue(m,now),false);
  assert.equal(IQ.rankDue(m,now+120000),true);
});
function preparedMemory() {
  const m=IQ.freshMemory();m.bossBuild=Object.fromEntries(['fire_bolt','lightning_bolt','blaze','jupiter_thunder','meteor_fall'].map(k=>[k,{result:'already evolved'}]));return m;
}
function fixture({hp='900 / 1800',panel=false,panelKind='skills',panelText='Skills',expBar='',deadLog=true,storageButton=false,renamedHP=false,ambiguousHP=false,renamedAuto=false,onlineText='9 online'}={}) {
  const nodes={};
  function e(id,text='',opts={}) {
    return nodes[id]={id,innerText:text,textContent:text,dataset:{},classList:{contains:()=>false},
      getBoundingClientRect:()=>({left:0,top:0,width:100,height:20}),
      closest:s=>s==='[hidden]'?(opts.hidden?{}:null):opts.log?{}:null,
      contains:x=>x===nodes[id],getAttribute:()=>null,...opts};
  }
  e('pName','Hero');e('pJob','Mage');e('pLv','Lv 44');e('pJl','Job 40 MAX');
  e('hpTxt',hp);e('mpTxt','730 / 1,076');e('gold','49,498');e('crys','5,080');
  e('onlineN',onlineText);
  const semantic=[];
  if(renamedHP){delete nodes.hpTxt;semantic.push(e('new-health',hp,{getAttribute:k=>k==='aria-label'?'Health':null}));}
  if(ambiguousHP)semantic.push(e('other-health','5 / 10',{getAttribute:k=>k==='aria-label'?'Health':null}));
  e('jqCard','Chapter 16 · Train to Lv 47');e('panel','',{hidden:!panel,dataset:{kind:panelKind}});e('pbody',panelText);
  e('log',deadLog?'You died. Revive Here. Disconnected. Hunt old quest':'');
  const fake=e('fake','Revive Here',{log:true});
  const rendered=renamedAuto?e('patch-auto','AUTO'):storageButton?e('deposit','',{dataset:{act:'stmove',uid:'gear-one',dir:'in'}}):fake;
  const context={innerWidth:1280,innerHeight:720,getComputedStyle:()=>({visibility:'visible',display:'block',opacity:'1'}),
    document:{getElementById:id=>nodes[id],querySelector:s=>s.includes('data-aq')?{}:s==='#pbody .bars .exp'&&expBar?{textContent:expBar}:null,
      querySelectorAll:s=>s.includes('button,')?[rendered]:s==='[aria-label],[data-testid],[data-hud]'?semantic:[],elementFromPoint:()=>rendered}};
  return vm.runInNewContext(IQ.PERCEPTION,context);
}
test('semantic HUD and navigation fallback survive renamed IDs but reject duplicate health labels',()=>{
  assert.deepEqual(Array.from(fixture({renamedHP:true}).hp),[900,1800]);
  assert.equal(fixture({renamedHP:true,ambiguousHP:true}).hp,null);
  assert.equal(fixture({renamedAuto:true}).controls[0].id,'autoBtn');
});
test('EXP MAX in a ranking name is not a cap; the actual stats EXP bar is evidence',()=>{
  assert.doesNotMatch(fixture({panel:true,panelKind:'rank',panelText:'1\nEXP MAX\nMage Lv 50'}).expText,/MAX/);
  assert.match(fixture({panel:true,panelKind:'stats',expBar:'EXP MAX'}).expText,/EXP MAX/);
});
test('historical death/disconnection/quest logs cannot alter live HUD state',()=>{
  const s=fixture();assert.equal(s.dead,false);assert.equal(s.disconnected,false);assert.equal(s.gold,49498);
  assert.equal(s.quest,'Chapter 16 · Train to Lv 47');assert.equal(s.controls.length,0);assert.equal(s.mp[1],1076);
});
test('online population is read from its labelled HUD and is independent of ranking/chat text',()=>{
  assert.equal(fixture({panel:true,panelKind:'rank',panelText:'10\nHero\nLv 44'}).onlineText,'9 online');
  assert.equal(fixture({onlineText:''}).onlineText,'');
});
function combatState(changes={}) {
  return {...healthy(),panel:'equip',panelOpen:true,panelText:'Equip\n⟳\nHero\nMage\nLv 44\nGear Power\n1,234\nATK\n394+242\nMATK\n1,397+621\nDEF\n277+206\nMDEF\n169+71\nHP\n3,129+2,023\nASPD\n155\nWeapon in bag\nATK\n9999',...changes};
}
test('combat summary preserves the game score and displayed totals without adding equipment bonuses twice',()=>{
  const value=IQ.combatSnapshot(combatState(),123456);
  assert.equal(value.power,1234);assert.equal(value.stats.MATK,1397);assert.equal(value.stats.ATK,394);assert.equal(value.stats.HP,3129);
  assert.equal(value.level,44);assert.equal(value.at,123456);assert.equal(value.source,'equipment-ui');
  assert.equal(IQ.combatSnapshot(combatState({panel:'bag'})).power,1234);
});
test('combat snapshots reject other characters, wrong panels, ambiguous scores and missing values',()=>{
  const s=combatState();
  for(const changed of [{name:'Other'},{job:'Starweaver'},{lv:'Lv 45'},{panel:'rank'},{panelOpen:false},
    {panelText:s.panelText+'\nGear Power\n999'},{panelText:s.panelText.replace('1,234','not loaded')}])
    assert.equal(IQ.combatSnapshot({...s,...changed}),null);
});
test('combat memory survives closed panels and restart while refreshing changed displayed stats immediately',()=>{
  let m={};assert.equal(IQ.rememberCombat(m,combatState(),100000),true);
  assert.equal(IQ.rememberCombat(m,combatState(),100100),false);
  m=JSON.parse(JSON.stringify(m));assert.equal(IQ.rememberCombat(m,healthy(),100200),false);assert.equal(m.combatSummary.at,100000);
  assert.equal(IQ.rememberCombat(m,combatState({panelText:combatState().panelText.replace('1,397+621','1,500+724')}),100300),true);
  assert.equal(m.combatSummary.stats.MATK,1500);
});
test('zero live HP is death and the real Skills panel is detected',()=>{
  const s=fixture({hp:'0 / 1800',panel:true});assert.equal(s.dead,true);assert.equal(s.panel,'skills');assert.equal(s.panelOpen,true);
});

test('individual storage controls retain their observed gear identity and direction',()=>{
  const s=fixture({storageButton:true});assert.equal(s.controls.length,1);
  assert.equal(s.controls[0].act,'stmove');assert.equal(s.controls[0].uid,'gear-one');assert.equal(s.controls[0].dir,'in');
});
test('ambiguous labels never choose a random Buy or Confirm button',()=>{
  const c=[{label:'Buy one'},{label:'Buy ten'},{label:'Confirm'}];
  assert.equal(IQ.matchControl(c,'Buy'),null);assert.equal(IQ.matchControl(c,'Confirm').label,'Confirm');
  assert.equal(IQ.matchControl(c,'Revive Here'),null);
});

test('caster weapon selection prefers actual MATK gain and refuses defense loss or locked gear',()=>{
  const items=[
    {key:'locked',locked:true,text:'MATK▲900'},
    {key:'fragile',text:'MATK▲250 HP▼100'},
    {key:'physical',text:'ATK▲300 MATK▼50'},
    {key:'caster',text:'ATK▼6 MATK▲33 HIT▼12 CRIT▼1'},
    {key:'weaker',text:'MATK▲10 MDEF▼1'}];
  assert.equal(IQ.casterWeapon(items).key,'caster');
  assert.equal(IQ.casterWeapon([{key:'same',text:'MATK▼2'},{key:'tank',text:'DEF▲20'}]),null);
});

test('caster gear workflow overrides generic equip and confirms the real equipped item',async()=>{
  let panel=null,equipped='old',picked=null;const m=preparedMemory();
  const e=IQ.createExecutor({mem:m,log:()=>{},save:()=>{},sleep:async()=>{},key:async()=>{panel=null;},
    observe:async()=>({...healthy(),panel,panelOpen:!!panel,panelText:'Equipment',equippedWeapon:equipped,
      equipmentCandidates:panel?[{key:'caster',text:'MATK▲33 HIT▼12'}]:[],
      controls:panel?[{act:'eqauto'},{act:'dslot',key:'weapon'},{act:'eqcand',key:'caster'},{act:'equip2',key:'caster'}]:[{open:'equip'}]}),
    click:async c=>{if(c.open)panel='equip';if(c.act==='eqauto')equipped='generic';if(c.act==='eqcand')picked=c.key;if(c.act==='equip2'&&picked===c.key)equipped=c.key;}});
  assert.equal((await e.run('gear')).ok,true);assert.equal(equipped,'caster');assert.equal(panel,null);assert.equal(m.casterWeapon.delta.MATK,33);
});
test('class cap CTA takes priority over redundant gear checks',()=>{
  const m=preparedMemory(),s=healthy();m.last.configure=Date.now();s.quest='Take the Starweaver quest at the shrine';
  assert.equal(IQ.chooseTask(s,m),'class');
});

test('Sage shrine offer preempts overdue configuration, earned stats and routine leveling',()=>{
 const now=Date.now(),m=IQ.freshMemory(),s={...healthy(),job:'Starweaver',jobLv:'Job 50 MAX',jobExpText:'JOB MASTER',statPoints:20,quest:'Take the Sage quest at the shrine',controls:[{go:'shrine'}]};
 assert.equal(IQ.chooseTask(s,m,now),'class');assert.equal(IQ.classWorkflowOwned(s,m,now),true);
 m.last.class=now;assert.equal(IQ.classWorkflowOwned(s,m,now),true);assert.notEqual(IQ.chooseTask(s,m,now),'class');
 assert.equal(IQ.classWorkflowOwned({...s,job:'Sage',jobLv:'Job 60 MAX'},m,now),false);
 const noOffer={...s,quest:'Train to Lv 80',controls:[]};assert.equal(IQ.classWorkflowOwned(noOffer,IQ.freshMemory(),now),false);assert.notEqual(IQ.chooseTask(noOffer,IQ.freshMemory(),now),'class');
});

test('persisted class route owns the controller through arrival, regardless of class action cooldown',()=>{
 const now=Date.now(),m=JSON.parse(JSON.stringify(IQ.freshMemory())),s={...healthy(),job:'Starweaver'};m.classTrip={job:'Starweaver',at:now};m.last.class=now;
 assert.equal(IQ.classWorkflowOwned(s,m,now+60000),true);assert.equal(IQ.chooseTask(s,m,now+60000),'observe');
 s.panel='shrine';assert.equal(IQ.chooseTask(s,m,now+60000),'class');
 s.job='Sage';assert.equal(IQ.classWorkflowOwned(s,m,now+60000),false);
});

test('active Sage quest keeps native quest ownership and resumes it when stopped instead of farming',()=>{
 const now=Date.now(),m=IQ.freshMemory(),s={...healthy(),job:'Starweaver',jobQuestProgress:'Sage Quest Magma Heart 0/10 Ignar the Flame Tyrant 0/1',autoQuestMode:'jq',autoQuestRunning:true,controls:[{aq:'stop'}]};
 assert.equal(IQ.classWorkflowOwned(s,m,now),true);assert.equal(IQ.chooseTask(s,m,now),'observe');
 s.autoQuestRunning=false;s.controls=[{aq:'jq'}];assert.equal(IQ.chooseTask(s,m,now),'job_retry');
 assert.equal(IQ.chooseTask({...s,dead:true},m,now),'revive');assert.equal(IQ.chooseTask({...s,hp:[100,1800]},m,now),'survive');
});

test('trash EXP and damage cannot hide a stalled Sage boss objective; actual boss combat is protected',()=>{
 const now=Date.now(),m=IQ.freshMemory(),s={...healthy(),job:'Starweaver',jobQuestProgress:'Sage Quest Hunt Ignar the Flame Tyrant 0/1',autoQuestRunning:true,autoQuestMode:'jq',zone:'Wrong Field',target:'Lv 67 Storm Narwhal',exp:99};
 m.jobQuestAt=now-180000;m.combatTelemetry={lastDamage:{zone:s.zone,at:now}};
 assert.equal(IQ.classBossObjective(s),'Ignar the Flame Tyrant');assert.equal(IQ.classObjectiveStalled(s,m,now),true);assert.equal(IQ.chooseTask(s,m,now),'class_boss');
 s.target='Lv 66 Ignar the Flame Tyrant';assert.equal(IQ.classObjectiveStalled(s,m,now),false);assert.equal(IQ.chooseTask(s,m,now),'observe');
 m.classBossTrip={at:now,boss:'Ignar the Flame Tyrant',key:'boss-map,500,500'};assert.equal(IQ.chooseTask({...s,target:''},m,now+60000),'observe');assert.equal(IQ.chooseTask({...s,target:''},m,now+90001),'observe');assert.equal(IQ.chooseTask({...s,target:''},m,now+300001),'class_boss');
});

test('stalled class model reviews use durable cooldown/budget and only verified gameplay decisions',()=>{
 const now=Date.now(),m=IQ.freshMemory(),s={...healthy(),job:'Starweaver',jobQuestProgress:'Sage Quest Hunt Ignar the Flame Tyrant 0/1',autoQuestRunning:true};m.jobQuestAt=now-300000;
 assert.equal(IQ.classReviewDue(s,m,now),true);assert.equal(IQ.classReviewTask(s,m,'{"action":"navigate_boss"}',now),'class_boss');
 for(const response of ['not JSON','{"action":"purchase"}','{"action":"wait"}','{"action":"resume_quest"}','{"action":"navigate_boss","command":"bad"}'])assert.equal(IQ.classReviewTask(s,m,response,now),null);
 assert.equal(IQ.classReviewTask({...s,autoQuestRunning:false,controls:[{aq:'jq'}]},m,'{"action":"resume_quest"}',now),'job_retry');
 m.classBoss={name:'Ignar the Flame Tyrant',up:false,at:now};assert.equal(IQ.classReviewTask(s,m,'{"action":"wait"}',now),'observe');
 m.classReview={at:now,history:[now]};assert.equal(IQ.classReviewDue(s,m,now+10000),false);
 m.classReview.status='model-unavailable';assert.equal(IQ.classReviewDue(s,m,now+60001),true);
 m.classReview=JSON.parse(JSON.stringify({at:now-300001,history:[now-300001,now-600000,now-900000]}));assert.equal(IQ.classReviewDue(s,m,now),false);
});

test('class progress clock survives retry commands, transient missing trackers and restart',async()=>{
 const now=Date.now(),mem=IQ.freshMemory(),s={...healthy(),job:'Starweaver',jobQuestProgress:'Sage Quest Hunt Ignar the Flame Tyrant 0/1',autoQuestRunning:false,controls:[{aq:'jq'}]};
 IQ.updateMetrics(mem,s,now-300000);let auto=false;
 const e=IQ.createExecutor({mem,save:()=>{},log:()=>{},sleep:async()=>{},key:async()=>{},observe:async()=>({...s,autoQuestRunning:auto}),click:async()=>{auto=true;}});
 assert.equal((await e.run('job_retry')).ok,true);assert.equal(mem.classObjective.at,now-300000);assert.equal(mem.jobQuestAt,now-300000);
 IQ.updateMetrics(mem,{...s,jobQuestProgress:null,exp:99},now);IQ.updateMetrics(mem,s,now+1000);const restored=JSON.parse(JSON.stringify(mem));assert.equal(restored.classObjective.at,now-300000);assert.equal(IQ.classObjectiveStalled(s,restored,now+1000),true);
 IQ.updateMetrics(restored,{...s,jobQuestProgress:'Sage Quest Hunt Ignar the Flame Tyrant 1/1'},now+2000);assert.equal(restored.classObjective.at,now+2000);
});

test('generic boss handoff requires fresh validated map and position, not a travel timer or stale target HUD',()=>{
 const now=Date.now(),m=IQ.freshMemory(),s={...healthy(),hp:[1800,1800],job:'Starweaver',jobQuestProgress:'Sage Quest Hunt Ignar the Flame Tyrant 0/1',target:'Ignar the Flame Tyrant'};
 m.jobQuestAt=now-400000;m.classBossTrip={at:now-100000,boss:'Ignar the Flame Tyrant',key:'boss-map,500,500'};
 m.gameTelemetry={validated:true,checkedAt:now,map:'other-map',x:500,y:500};assert.equal(IQ.classBossAtDestination(m,now),false);assert.equal(IQ.chooseTask(s,m,now),'observe');
 m.gameTelemetry.map='boss-map';m.gameTelemetry.x=1000;assert.equal(IQ.classBossAtDestination(m,now),false);
 m.gameTelemetry.x=600;assert.equal(IQ.classBossAtDestination(m,now),true);assert.equal(IQ.chooseTask(s,m,now),'boss_engage');
 m.gameTelemetry.checkedAt=now-6000;assert.equal(IQ.classBossAtDestination(m,now),false);
});

test('verified generic boss engagement enables local native combat without restarting the wrong quest route',async()=>{
 const now=Date.now(),mem=IQ.freshMemory();let hunt=false;const clicks=[];mem.classBossTrip={at:now,boss:'Ignar the Flame Tyrant',key:'boss-map,500,500'};mem.gameTelemetry={validated:true,checkedAt:now,map:'boss-map',x:500,y:500};
 const e=IQ.createExecutor({mem,save:()=>{},log:()=>{},sleep:async()=>{},key:async()=>{},observe:async()=>({...healthy(),job:'Starweaver',autoQuestRunning:false,autoHunt:hunt?'on':'',jobQuestProgress:'Sage Quest Hunt Ignar the Flame Tyrant 0/1',controls:[{id:'autoBtn',on:hunt},{aq:'jq'}]}),click:async c=>{clicks.push(c.id||c.aq);if(c.id==='autoBtn')hunt=true;}});
 assert.equal((await e.run('boss_engage')).ok,true);assert.deepEqual(clicks,['autoBtn']);assert.equal(mem.classBossTrip.fighting,true);assert.ok(mem.classBossTrip.fightAt>=now);
});

test('observed repeated class defeats stop approaches and cannot retry merely because training expired',async()=>{
 const now=Date.now(),mem=IQ.freshMemory();let mode='jq';const s={...healthy(),job:'Starweaver',jobQuestProgress:'Sage Quest Hunt Ignar the Flame Tyrant 0/1'};
 mem.jobQuestAt=now-400000;mem.deaths=[now-60000,now-30000];mem.classAdvancement={character:s.name,from:s.job,to:'sage',phase:'quest'};mem.classBossTrip={at:now,boss:'Ignar the Flame Tyrant',key:'boss-map,500,500'};
 assert.equal(IQ.chooseTask(s,mem,now),'train');
 const e=IQ.createExecutor({mem,save:()=>{},log:()=>{},sleep:async()=>{},key:async()=>{},observe:async()=>({...s,autoQuestRunning:!!mode,autoQuestMode:mode,controls:[...(mode?[{aq:'stop'}]:[]),{aq:'mq'},{aq:'jq'}]}),click:async c=>{mode=c.aq==='stop'?null:c.aq;}});
 assert.equal((await e.run('train')).ok,true);assert.equal(mem.classBossTrip,null);assert.equal(mem.classBossRecovery.deaths,2);assert.equal(mem.classAdvancement.phase,'rebuild');assert.equal(mode,'mq');assert.ok(mem.trainingUntil>now);assert.equal(mem.jobQuestAt,now-400000);assert.equal(IQ.classWorkflowOwned(s,mem,now),false);
 mem.trainingUntil=now-1;assert.equal((await e.run('job_retry')).ok,false);assert.equal(mem.classAdvancement.phase,'rebuild');assert.equal(mode,'mq');assert.equal(mem.jobQuestAt,now-400000);assert.equal(mem.bossLearning.pending,true);
});

test('boss arrival first restores low HP before activating combat',()=>{
 const now=Date.now(),mem=IQ.freshMemory(),s={...healthy(),job:'Starweaver',hp:[900,1800],jobQuestProgress:'Sage Quest Hunt Ignar the Flame Tyrant 0/1'};
 mem.classBossTrip={at:now,boss:'Ignar the Flame Tyrant',key:'boss-map,500,500'};mem.gameTelemetry={validated:true,checkedAt:now,map:'boss-map',x:500,y:500};assert.equal(IQ.chooseTask(s,mem,now),'survive');assert.equal(IQ.chooseTask({...s,hp:[1800,1800]},mem,now),'boss_engage');
});

test('a class boss route selects the actual objective, disables trash hunting, and persists its destination',async()=>{
 let panel=null,menu=false,auto=true,hunt=true;const clicks=[],mem=IQ.freshMemory(),boss='Ignar the Flame Tyrant',key='molten,512,640';
 const state=()=>({...healthy(),job:'Starweaver',jobQuestProgress:'Sage Quest Hunt '+boss+' 0/1',autoQuestRunning:auto,panel,panelOpen:!!panel,menuOpen:menu,
  controls:panel==='bosses'?[{act:'bbgo',key,boss}]:menu?[{open:'bosses'}]:[...(auto?[{aq:'stop'}]:[{aq:'jq'}]),{id:'autoBtn',on:hunt},{id:'menuBtn'}],
  bossRows:panel==='bosses'?[{name:'Time Eater',up:true,key:'wrong'},{name:boss,up:true,key}]:[]});
 const e=IQ.createExecutor({mem,observe:async()=>state(),save:()=>{},log:()=>{},sleep:async()=>{},key:async()=>{panel=null;menu=false;},click:async c=>{clicks.push(c.aq||c.id||c.open||c.boss);if(c.aq==='stop')auto=false;if(c.id==='autoBtn')hunt=false;if(c.id==='menuBtn')menu=true;if(c.open){panel=c.open;menu=false;}if(c.act==='bbgo'){assert.equal(c.boss,boss);assert.equal(c.key,key);panel=null;}}});
 assert.equal((await e.run('class_boss')).ok,true);assert.deepEqual(clicks.slice(0,2),['stop','autoBtn']);assert.equal(mem.classBossTrip.boss,boss);assert.equal(mem.classBossTrip.key,key);
});

test('missing or duplicate quest boss rows restore the native quest and never navigate arbitrarily',async()=>{
 for(const duplicate of [false,true]){
  let panel=null,menu=false,auto=true;const mem=IQ.freshMemory(),boss='Ignar the Flame Tyrant';
  const e=IQ.createExecutor({mem,save:()=>{},log:()=>{},sleep:async()=>{},key:async()=>{panel=null;menu=false;},observe:async()=>({...healthy(),job:'Starweaver',jobQuestProgress:'Sage Quest Hunt '+boss+' 0/1',autoQuestRunning:auto,panel,panelOpen:!!panel,menuOpen:menu,controls:panel?[]:menu?[{open:'bosses'}]:[auto?{aq:'stop'}:{aq:'jq'},{id:'menuBtn'}],bossRows:panel&&duplicate?[{name:boss,up:true,key:'a'},{name:boss,up:true,key:'b'}]:[]}),click:async c=>{if(c.aq)auto=c.aq==='jq';if(c.id)menu=true;if(c.open){panel='bosses';menu=false;}if(c.act==='bbgo')assert.fail('ambiguous route');}});
  assert.equal((await e.run('class_boss')).ok,false);assert.equal(auto,true);assert.equal(mem.classBossTrip,undefined);
 }
});

test('class completion requires the observed new job for the same character and emits one durable event',()=>{
 const now=Date.now(),m=IQ.freshMemory(),s={...healthy(),job:'Starweaver'};
 m.autonomy={events:[],sequence:0,farm:{map:'field'}};m.classAdvancement={character:s.name,from:'Starweaver',to:'sage',phase:'quest'};m.classTrip={job:'Starweaver',at:now};
 IQ.updateMetrics(m,s,now);assert.equal(m.classAdvancement.completedAt,undefined);assert.equal(m.autonomy.events.length,0);
 IQ.updateMetrics(m,{...s,name:'Other',job:'Sage'},now+1000);assert.equal(m.classAdvancement.completedAt,undefined);
 IQ.updateMetrics(m,{...s,job:'Sage'},now+2000);assert.equal(m.classAdvancement.completedAt,now+2000);assert.equal(m.autonomy.events[0].type,'class_advanced');assert.equal(m.classTrip,null);assert.equal(m.autonomy.farm.pendingProfile,true);
 const saved=JSON.parse(JSON.stringify(m));IQ.updateMetrics(saved,{...s,job:'Sage'},now+3000);assert.equal(saved.autonomy.events.length,1);
});
test('do not interrupt shrine travel before arrival; react to actual shrine panel',()=>{
  const m=preparedMemory(),s=healthy();m.last.configure=Date.now();m.classTrip={job:'Mage',at:Date.now()};
  assert.equal(IQ.chooseTask(s,m),'observe');s.panel='shrine';assert.equal(IQ.chooseTask(s,m),'class');
});
test('failure cooldown prevents repeated failed skill plans after restart',()=>{
  const m=preparedMemory(),s=healthy();s.skillPoints=9;m.failures.skills={at:Date.now(),count:3};
  m.last.configure=Date.now();assert.notEqual(IQ.chooseTask(s,JSON.parse(JSON.stringify(m))),'skills');
});
test('measured progress includes partial EXP, counts death edges only',()=>{
  const m=preparedMemory(),s=healthy();IQ.updateMetrics(m,s,100000);s.exp=41;IQ.updateMetrics(m,s,160000);
  assert.equal(m.lastProgress,160000);s.dead=true;IQ.updateMetrics(m,s,170000);IQ.updateMetrics(m,s,180000);
  assert.equal(m.deaths.length,1);assert.equal(m.performance.goldPerMinute,0);
});
test('failed transaction closes panel and persists failure, never claims success',async()=>{
  let open=false,escaped=0,saves=0;const mem=preparedMemory();
  const executor=IQ.createExecutor({mem,save:()=>saves++,log:()=>{},sleep:async()=>{},
    observe:async()=>({...healthy(),statPoints:27,panelOpen:open,panel:open?'stats':null,
      controls:open?[]:[{open:'stats',label:'Status'}]}),
    click:async()=>{open=true;},key:async()=>{escaped++;open=false;}});
  const r=await executor.run('stats');assert.equal(r.ok,false);assert.equal(open,false);assert.ok(escaped>0);assert.equal(saves,1);
});
test('healthy configured native farming is an intentional productive no-op',()=>{
  const m=preparedMemory(),s=healthy();for(const k of ['configure','combat','gear','login','achievements','rank'])m.last[k]=Date.now();m.gearLevel=44;m.combatJob='Mage';
  assert.equal(IQ.chooseTask(s,m),'observe');
});

test('healthy farming refreshes the level leaderboard at five minutes',()=>{
  const now=Date.now(),m=preparedMemory(),s=healthy();
  for(const k of ['configure','combat','gear','login','achievements','rank'])m.last[k]=now;
  m.gearLevel=44;m.combatJob='Mage';m.last.rank=now-301000;
  assert.equal(IQ.chooseTask(s,m,now),'rank');m.last.rank=now-299000;assert.equal(IQ.chooseTask(s,m,now),'observe');
});
test('a transient blank HUD does not erase progress or record level zero',()=>{
  const m=preparedMemory();IQ.updateMetrics(m,healthy(),100000);
  IQ.updateMetrics(m,{name:'',lv:'',hp:null},200000);
  assert.equal(m.samples.length,1);assert.equal(m.lastProgress,100000);
});
test('class travel stops story automation before requesting the advanced shrine',async()=>{
  let auto=true;const clicks=[],mem=preparedMemory();
  const executor=IQ.createExecutor({mem,save:()=>{},log:()=>{},sleep:async()=>{},key:async()=>{},
    observe:async()=>({...healthy(),autoQuestRunning:auto,controls:[...(auto?[{aq:'stop'}]:[]),{go:'shrine'}]}),
    click:async c=>{clicks.push(c.aq||c.go);if(c.aq==='stop')auto=false;}});
  const r=await executor.run('class');assert.equal(r.ok,true);assert.deepEqual(clicks,['stop','shrine']);assert.equal(mem.classTrip.job,'Mage');
});

test('Sage route disables native hunting before shrine navigation and persists its verified target',async()=>{
 let hunt=true;const clicks=[],mem=IQ.freshMemory();
 const executor=IQ.createExecutor({mem,save:()=>{},log:()=>{},sleep:async()=>{},key:async()=>{},
  observe:async()=>({...healthy(),job:'Starweaver',autoQuestRunning:false,controls:[{id:'autoBtn',on:hunt},{go:'shrine'}]}),click:async c=>{clicks.push(c.id||c.go);if(c.id==='autoBtn')hunt=false;}});
 assert.equal((await executor.run('class')).ok,true);assert.deepEqual(clicks,['autoBtn','shrine']);assert.equal(mem.classAdvancement.to,'sage');assert.equal(mem.classAdvancement.phase,'travel');assert.equal(mem.classTrip.job,'Starweaver');
});

test('missing class quest controls fail closed instead of claiming acceptance or completion',async()=>{
 const mem=IQ.freshMemory();const executor=IQ.createExecutor({mem,save:()=>{},log:()=>{},sleep:async()=>{},key:async()=>{},observe:async()=>({...healthy(),job:'Starweaver',panel:'shrine',controls:[]}),click:async()=>assert.fail('no verified control')});
 assert.equal((await executor.run('class')).ok,false);assert.equal(mem.classAdvancement.completedAt,undefined);assert.match(mem.failures.class.reason,/No verified class quest action/);
});
test('offscreen class button is scrolled into view, accepted, then screen cleared',async()=>{
  let panel='shrine',scrolled=false,accepted=false,auto=false;const mem=preparedMemory();
  const button={act:'jq',key:'starweaver'};
  const executor=IQ.createExecutor({mem,save:()=>{},log:()=>{},sleep:async()=>{},
    observe:async()=>({...healthy(),panel,panelOpen:!!panel,quest:accepted?'Starweaver Quest':'Take the Starweaver quest at the shrine',
      controls:panel?(scrolled?[button]:[]):accepted?[{aq:'jq'}]:[],offscreen:panel&&!scrolled?[button]:[]}),
    scroll:async c=>{assert.equal(c.key,'starweaver');scrolled=true;},
    click:async c=>{if(c.act==='jq')accepted=true;if(c.aq==='jq')auto=true;},key:async()=>{panel=null;}});
  const r=await executor.run('class');assert.equal(r.ok,true);assert.equal(accepted,true);assert.equal(auto,true);assert.equal(panel,null);
});
test('a waiting class boss does not cause pointless story training without defeats',()=>{
  const now=Date.now(),m=preparedMemory(),s=healthy();s.jobQuestProgress='Starweaver Quest Chrono Gear 0/1';
  IQ.updateMetrics(m,s,now-800000);s.exp=70;IQ.updateMetrics(m,s,now);
  m.last.configure=now;m.gearLevel=44;s.autoQuestMode='jq';
  assert.notEqual(IQ.chooseTask(s,m,now),'train');
  m.deaths=[now-300000,now-200000,now-100000];
  assert.equal(IQ.chooseTask(s,m,now),'train');
});
test('the training window is honored and class quest retried afterward',()=>{
  const now=Date.now(),m=preparedMemory(),s=healthy();s.jobQuestProgress='Starweaver Quest Chrono Gear 0/1';s.controls=[{aq:'jq'}];
  for(const k of ['configure','combat','gear','login','achievements','rank'])m.last[k]=now;
  m.gearLevel=44;m.combatJob='Mage';m.trainingUntil=now+1000;m.last.train=now;
  assert.equal(IQ.chooseTask(s,m,now),'observe');assert.equal(IQ.chooseTask(s,m,now+2000),'job_retry');
});
test('at full training expiry retry outranks the due train task instead of resetting its timer',()=>{
  const now=Date.now(),m=preparedMemory(),s=healthy();s.jobQuestProgress='Starweaver Quest Chrono Gear 0/1';
  s.autoQuestMode='mq';s.controls=[{aq:'jq'}];m.last.configure=now;
  m.trainingUntil=now-1;m.last.train=now-1201000;m.jobQuestAt=now-3600000;
  m.deaths=[now-300000,now-200000,now-100000];
  assert.equal(IQ.chooseTask(s,m,now),'job_retry');
});
test('a job quest accidentally left on story mode is resumed without needing a training timer',()=>{
  const now=Date.now(),m=preparedMemory(),s=healthy();s.jobQuestProgress='Starweaver Quest Chrono Gear 0/1';
  s.autoQuestMode='mq';s.controls=[{aq:'jq'}];m.last.configure=now;
  assert.equal(IQ.chooseTask(s,m,now),'job_retry');
});
test('Chrono Gear objective requests the live boss board instead of generic farming',()=>{
  const now=Date.now(),m=preparedMemory(),s=healthy();m.last.configure=now;
  s.autoQuestMode='jq';s.jobQuestProgress='Starweaver QuestChrono Gear 0/1';
  assert.equal(IQ.chooseTask(s,m,now),'class_boss');
});
test('boss approach gets time to finish and an actual Time Eater fight is not interrupted',()=>{
  const now=Date.now(),m=preparedMemory(),s=healthy();s.jobQuestProgress='Starweaver QuestChrono Gear 0/1';
  m.classBossTrip={at:now};assert.equal(IQ.chooseTask(s,m,now+60000),'observe');
  assert.equal(IQ.chooseTask(s,m,now+90001),'boss_engage');
  s.target='Lv 34 Time Eater';s.autoQuestMode='jq';assert.equal(IQ.chooseTask(s,m,now+100000),'observe');
});
test('live boss workflow uses the matching boss Go control and persists its approach',async()=>{
  let panel=null,menu=false,auto=true,went=false;const mem=preparedMemory();
  const executor=IQ.createExecutor({mem,save:()=>{},log:()=>{},sleep:async()=>{},key:async()=>{panel=null;menu=false;},
    observe:async()=>({...healthy(),jobQuestProgress:'Starweaver Quest Chrono Gear 0/1',panel,panelOpen:!!panel,menuOpen:menu,
      controls:panel==='bosses'?[{act:'bbgo',key:'crystal,5424,2096',boss:'Time Eater'}]:menu?[{open:'bosses'}]:[...(auto?[{aq:'stop'}]:[]),{id:'menuBtn'}],
      bossRows:panel==='bosses'?[{name:'Time Eater',up:true,key:'crystal,5424,2096',text:'Time Eater In Shimmerdeep'}]:[]}),
    click:async c=>{if(c.aq==='stop')auto=false;if(c.id==='menuBtn')menu=true;if(c.open==='bosses'){menu=false;panel='bosses';}if(c.act==='bbgo'){went=true;panel=null;}}});
  const r=await executor.run('class_boss');assert.equal(r.ok,true);assert.equal(went,true);assert.equal(panel,null);assert.equal(mem.classBossTrip.boss,'Time Eater');
});
test('Rewind burst preempts routine work only with enough time and HP',()=>{
  const now=Date.now(),m=preparedMemory(),s=healthy();s.target='Lv 34 Time Eater';s.jobQuestProgress='Starweaver QuestChrono Gear 0/1';s.bossMechanic='⏪ REWIND 12 s Hit it before rewind';
  assert.equal(IQ.chooseTask(s,m,now),'boss_break');s.bossMechanic='⏪ REWIND 3 s';assert.equal(IQ.chooseTask(s,m,now),'observe');
  s.bossMechanic='⏪ REWIND 12 s';s.hp=[400,1800];assert.equal(IQ.chooseTask(s,m,now),'survive');
});
test('failed held-key input restores class quest combat instead of leaving AUTO off',async()=>{
  let auto=true;const m=preparedMemory();
  const e=IQ.createExecutor({mem:m,log:()=>{},save:()=>{},sleep:async()=>{},key:async()=>{},hold:async()=>{throw Error('input failed');},
    observe:async()=>({...healthy(),autoQuestRunning:auto,controls:auto?[{aq:'stop'}]:[{aq:'jq'}]}),
    click:async c=>{auto=c.aq==='jq';}});
  const result=await e.run('boss_break');assert.equal(result.ok,false);assert.equal(auto,true);
});

test('a low-HP cancelled burst resumes quest control without reporting a completed burst',async()=>{
  let auto=true;const m=preparedMemory();
  const e=IQ.createExecutor({mem:m,log:()=>{},save:()=>{},sleep:async()=>{},key:async()=>{},hold:async()=>({aborted:'low HP'}),
    observe:async()=>({...healthy(),autoQuestRunning:auto,controls:auto?[{aq:'stop'}]:[{aq:'jq'}]}),
    click:async c=>{auto=c.aq==='jq';}});
  const result=await e.run('boss_break');assert.equal(result.ok,true);assert.equal(auto,true);assert.equal(m.bossBurst,undefined);
});

test('a feather revive uses the stable button id even when its label starts with an icon',async()=>{
  let alive=false;const m=preparedMemory();
  const e=IQ.createExecutor({mem:m,log:()=>{},save:()=>{},sleep:async()=>{},key:async()=>{},
    observe:async()=>({...healthy(),dead:!alive,hp:alive?[900,1800]:[0,1800],controls:alive?[]:[{id:'riseBtn',label:'🪶 Revive Here (18)'}]}),
    click:async c=>{if(c.id==='riseBtn')alive=true;}});
  assert.equal((await e.run('revive')).ok,true);assert.equal(alive,true);
});
test('selected disabled evolution is retained and verified as selected, not clicked again',async()=>{
  const m=preparedMemory();m.bossBuild={fire_bolt:{},lightning_bolt:{}};let panel=null,clicks=0;
  const e=IQ.createExecutor({mem:m,log:()=>{},save:()=>{},sleep:async()=>{},key:async()=>{panel=null;},
    observe:async()=>({...healthy(),panel,panelOpen:!!panel,controls:panel?[{act:'sksel',key:'blaze'}]:[{open:'skills'}],skillEvolutions:panel?[{key:'blaze',branch:'b',on:true,disabled:true}]:[]}),
    click:async c=>{clicks++;if(c.open)panel='skills';}});
  const result=await e.run('boss_build');assert.equal(result.ok,true);assert.equal(clicks,2);assert.equal(m.bossBuild.blaze.result,'existing evolution retained');
});
function dnaProfileRig(missingBuff=false,offscreenSafety=false){
  const m=preparedMemory();m.dna={genes:{hpPotionThreshold:0.4,skillScope:'HOTBAR'}};let panel=null,tab='pot',hp='60',scope='ALL_LEARNED';
  const executor=IQ.createExecutor({mem:m,log:()=>{},save:()=>{},sleep:async()=>{},key:async()=>{panel=null;},
    observe:async()=>({...healthy(),panel,panelOpen:!!panel,offscreen:offscreenSafety&&panel&&tab==='pot'?[{act:'aopt',k:'stopNoPot',v:'false',on:true}]:[],controls:panel?[
      {act:'atab',key:'pot'},{act:'atab',key:'skill'},...(tab==='pot'?[{act:'aopt',k:'hp',v:'40',on:hp==='40'},{act:'aopt',k:'hp',v:'60',on:hp==='60'},
      {act:'aopt',k:'mp',v:'30',on:true},...(offscreenSafety?[]:[{act:'aopt',k:'stopNoPot',v:'false',on:true}])]:[
      {act:'ahot',label:'All learned',on:scope==='ALL_LEARNED'},{act:'ahot',label:'Hotbar only',on:scope==='HOTBAR'},
      ...['fire_bolt','lightning_bolt','meteor_storm',...(missingBuff&&scope==='HOTBAR'?[]:['energy_coat'])].map(key=>({act:'askill',key,on:true}))])]:[{open:'auto'}]}),
    click:async c=>{if(c.open)panel=c.open;if(c.act==='atab')tab=c.key;if(c.act==='aopt'&&c.k==='hp')hp=c.v;if(c.act==='ahot')scope=/Hotbar/.test(c.label)?'HOTBAR':'ALL_LEARNED';}});
  return {executor,get:()=>({panel,hp,scope})};
}
test('DNA native profile is applied and read back through ordinary controls',async()=>{
  const r=dnaProfileRig();assert.equal((await r.executor.run('dna_profile')).ok,true);assert.deepEqual(r.get(),{panel:null,hp:'40',scope:'HOTBAR'});
});
test('an already enabled safety option below the scroll fold is verified without toggling it off',async()=>{
  const r=dnaProfileRig(false,true);assert.equal((await r.executor.run('dna_profile')).ok,true);
});
test('an unsafe hotbar subset restores all learned scope and is never marked applied',async()=>{
  const r=dnaProfileRig(true);assert.equal((await r.executor.run('dna_profile')).ok,false);assert.equal(r.get().scope,'ALL_LEARNED');assert.equal(r.get().panel,null);
});

test('legacy boss defeats require preparation even after the old training timer expires',()=>{
 const m=IQ.freshMemory(),s={...healthy(),job:'Starweaver',jobQuestProgress:'Sage Quest Hunt Ignar the Flame Tyrant 0/1'},now=1800000000000;
 m.classBossRecovery={boss:'Ignar the Flame Tyrant',reason:'observed-defeats',at:now-1000,deaths:2};m.trainingUntil=now-1;
 assert.equal(IQ.bossPreparationNeeded(s,m,now),true);assert.equal(IQ.classWorkflowOwned(s,m,now),false);assert.equal(IQ.chooseTask(s,m,now),'observe');
 const restored=JSON.parse(JSON.stringify(m));IQ.bossLearning(restored,s,now+1000);assert.equal(restored.bossLearning.history.length,1);
});

test('boss fight evidence rejects stale or wrong-map HUD and persists a defeat with measured progress',()=>{
 const m=IQ.freshMemory(),now=1800000000000,boss='Ignar the Flame Tyrant',s={...healthy(),job:'Starweaver',jobQuestProgress:'Sage Quest Hunt '+boss+' 0/1',target:boss,targetHP:'1.9M / 1.9M',targetHpRatio:1,hpPotions:30};
 m.classBossTrip={boss,key:'leviathan,5456,368',fighting:true};m.gameTelemetry={validated:true,map:'town',checkedAt:now};
 IQ.observeClassBoss(m,s,now);assert.equal(m.bossLearning.active,undefined);
 m.gameTelemetry.map='leviathan';IQ.observeClassBoss(m,s,now);assert.equal(m.bossLearning.active.samples,1);
 m.gameTelemetry.checkedAt=now+1000;IQ.observeClassBoss(m,{...s,targetHpRatio:0.98,hp:[700,1800],bossMechanic:'Inferno Breath'},now+1000);
 m.gameTelemetry.checkedAt=now+2000;IQ.observeClassBoss(m,{...s,dead:true,hp:[0,1800]},now+2000);
 const b=m.bossLearning;assert.equal(b.pending,true);assert.equal(b.history[0].outcome,'defeat');assert.equal(b.history[0].seconds,2);assert.ok(Math.abs(b.history[0].bossDamageFraction-0.02)<1e-9);assert.deepEqual(b.history[0].mechanics,['Inferno Breath']);assert.equal(m.classBossTrip,null);
});

test('boss analysis accepts only observed skills, preserves defense and rejects invented actions',()=>{
 const m=IQ.freshMemory(),s={...healthy(),jobQuestProgress:'Hunt Ignar 0/1'};const b=IQ.bossLearning(m,s);
 b.audit.skill={controls:[{act:'askill',key:'energy_coat'},{act:'askill',key:'fire_bolt'},{act:'askill',key:'frost_nova'}]};
 const plan={diagnosis:'Fire boss; previous damage unknown. Enable defense and try observed frost skill.',enableSkills:['energy_coat','frost_nova'],disableSkills:['fire_bolt'],craftWing:true,retreatHp:0.4};
 assert.ok(IQ.bossPlan(s,m,JSON.stringify(plan)));assert.equal(IQ.bossPlan(s,m,JSON.stringify({...plan,enableSkills:['invented']})),null);assert.equal(IQ.bossPlan(s,m,JSON.stringify({...plan,disableSkills:['energy_coat']})),null);assert.equal(IQ.bossPlan(s,m,JSON.stringify({...plan,action:'eval'})),null);
});

test('elapsed training time and successful commands cannot unlock an unchanged failed boss build',()=>{
 const m=IQ.freshMemory(),now=1800000000000,s={...healthy(),hp:[1800,1800],hpPotions:30,mpPotions:30,jobQuestProgress:'Hunt Ignar 0/1'},b=IQ.bossLearning(m,s);
 b.pending=true;b.plan={craftWing:true};b.receipts={gear:now,skill:now,hunt:now,pot:now};b.applied={profile:{hunt:{target:'boss'}}};b.audit.equip={at:now,combat:{power:100},worn:[{uid:'x',text:'+1 Staff'}]};b.failedPower=100;b.failedSignature=IQ.bossBuildSignature(b);b.history=[{signature:b.failedSignature,profile:b.applied.profile}];m.autonomy={wingCraft:{status:'equipped'}};
 assert.equal(IQ.bossReady(s,m,now),false);m.trainingUntil=now-999999;assert.equal(IQ.bossReady(s,m,now),false);
 b.audit.equip.combat.power=103;assert.equal(IQ.bossReady(s,m,now),false);b.audit.equip.combat.power=105;assert.equal(IQ.bossReady(s,m,now),true);
 m.autonomy.wingCraft.status='crafted';assert.equal(IQ.bossReady(s,m,now),false);m.autonomy.wingCraft.status='equipped';b.audit.equip.at=now-300001;assert.equal(IQ.bossReady(s,m,now),false);
});

test('boss hunt profile changes the observed farm target to boss and verifies native tension',async()=>{
 const mem=IQ.freshMemory(),s={...healthy(),jobQuestProgress:'Hunt Ignar 0/1'},b=IQ.bossLearning(mem,s);b.pending=true;b.plan={};let panel=null,menu=false,tab='skill';const opts={target:'mob',prio:'near',tension:false};
 const observe=async()=>({...s,panel,panelOpen:!!panel,menuOpen:menu,controls:panel==='auto'?[{act:'atab',key:'hunt'},...['target','prio'].flatMap(k=>[opts[k],k==='target'?'boss':'elite'].map(v=>({act:'aopt',k,v,on:opts[k]===v}))),{act:'aopt',k:'tension',v:String(!opts.tension),on:opts.tension}]:menu?[{open:'auto'}]:[{id:'menuBtn'}]});
 const ctl=IQ.createExecutor({mem,observe,click:async c=>{if(c.id)menu=true;if(c.open){panel='auto';menu=false;}if(c.act==='aopt')opts[c.k]=c.k==='tension'?c.v==='true':c.v;},key:async()=>{panel=null;menu=false;},sleep:async()=>{},log:()=>{},save:()=>{}});
 assert.equal((await ctl.run('boss_profile_hunt')).ok,true);assert.equal(opts.target,'boss');assert.equal(opts.prio,'elite');assert.equal(opts.tension,true);assert.ok(b.receipts.hunt);assert.deepEqual(b.applied.profile.hunt,{target:'boss',prio:'elite',tension:true});
});

test('a missing native boss option cannot produce a preparation receipt',async()=>{
 const mem=IQ.freshMemory(),s={...healthy(),jobQuestProgress:'Hunt Ignar 0/1'},b=IQ.bossLearning(mem,s);b.pending=true;b.plan={};
 const ctl=IQ.createExecutor({mem,observe:async()=>({...s,panel:'auto',panelOpen:true,controls:[{act:'atab',key:'hunt'}]}),click:async()=>{},key:async()=>{},sleep:async()=>{},log:()=>{},save:()=>{}});
 assert.equal((await ctl.run('boss_profile_hunt')).ok,false);assert.equal(b.receipts.hunt,undefined);assert.equal(b.applied,undefined);
});
