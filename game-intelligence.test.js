const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const IQ=require('./game-intelligence');

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
    observe:async()=>({...healthy(),panel,panelOpen:!!panel,menuOpen:menu,
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
