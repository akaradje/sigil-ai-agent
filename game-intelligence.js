'use strict';
// All observations are rendered UI. No game memory, socket injection or private APIs.
function readUI() {
  // Prefer stable IDs; use only unique, explicitly labelled semantic alternatives.
  // Never infer player state from chat, ranking names or arbitrary body text.
  const aliases={pName:['Player name','Character name','ชื่อตัวละคร'],pJob:['Class','Job','อาชีพ'],
    pLv:['Level','เลเวล'],pJl:['Job level'],hpTxt:['HP','Health'],mpTxt:['MP','Mana'],
    gold:['Gold','เงิน'],crys:['Crystals','เพชร'],zone:['Zone','Location','พื้นที่'],
    expTxt:['EXP','Experience'],jexpTxt:['Job EXP'],tgName:['Target name'],tgTxt:['Target HP']};
  const visible = e => {
    if (!e || e.closest('[hidden]')) return false;
    const r=e.getBoundingClientRect(), st=getComputedStyle(e);
    return r.width>3 && r.height>3 && st.visibility!=='hidden' && st.display!=='none' && st.opacity!=='0';
  };
  const $ = id => {
    const exact=document.getElementById(id);if(visible(exact))return exact;
    const names=aliases[id];if(!names)return null;
    const found=Array.from(document.querySelectorAll('[aria-label],[data-testid],[data-hud]')).filter(e=>
      visible(e)&&!e.closest('#log,#toast,#nq,#ann,[role=log],[role=dialog],#pbody,.ranklist')&&
      (e.getAttribute('data-testid')===id||e.getAttribute('data-hud')===id||names.some(n=>n.toLowerCase()===(e.getAttribute('aria-label')||'').toLowerCase())));
    return found.length===1?found[0]:null;
  };
  const txt = id => visible($(id)) ? ($(id).innerText || '').trim() : '';
  const pair = t => { const m=t.replace(/,/g,'').match(/(\d+)\s*\/\s*(\d+)/); return m ? [+m[1],+m[2]] : null; };
  const number = t => { const m=t.replace(/,/g,'').match(/\d+(?:\.\d+)?/); return m ? +m[0] : null; };
  const quest=txt('jqCard'), hp=pair(txt('hpTxt')), mp=pair(txt('mpTxt'));
  const tracker=$('jqCard')?.cloneNode?.(true);
  if(tracker)tracker.querySelectorAll('.aqnow,.aqb,.qhint,.jcta,[data-aqw]').forEach(e=>e.remove());
  const questProgress=tracker?(tracker.textContent||'').replace(/\s+/g,' ').trim():quest;
  const panel=visible($('panel')) ? $('panel').dataset.kind : null;
  const modal=Array.from(document.querySelectorAll('.u-modal')).find(visible);
  const controls=[],offscreen=[];
  for (const e of document.querySelectorAll('button,[role=button],[data-act],[data-go],[data-open]')) {
    if (!visible(e) || e.disabled || e.closest('#log,#toast,#nq,#ann')) continue;
    const r=e.getBoundingClientRect(), x=Math.round(r.left+r.width/2), y=Math.round(r.top+r.height/2);
    const hit=(x>=0&&x<innerWidth&&y>=0&&y<innerHeight)?document.elementFromPoint(x,y):null;
    const label=(e.innerText||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim().slice(0,120);
    const item={label,id:e.id||null,scope:e.closest('#menu,[role=menu]')?'menu':e.closest('#pbody,[role=dialog]')?'panel':'hud',act:e.dataset.act||null,key:e.dataset.id||null,
      open:e.dataset.open||null,aq:e.dataset.aq||null,go:e.dataset.go||null,
      k:e.dataset.k||null,v:e.dataset.v||null,branch:e.dataset.b||null,on:e.classList.contains('on')||e.getAttribute('aria-pressed')==='true'||e.getAttribute('aria-selected')==='true',x,y};
    if(e.dataset.uid)item.uid=e.dataset.uid;
    if(e.dataset.dir)item.dir=e.dataset.dir;
    if(e.dataset.place)item.place=e.dataset.place;
    if(e.dataset.bm)item.bm=e.dataset.bm;
    if(e.dataset.wm)item.wm=e.dataset.wm;
    if(e.dataset.n)item.amount=e.dataset.n;
    if(e.dataset.sk)item.skill=e.dataset.sk;
    const bossRow=e.closest('.bbrow');
    if(bossRow)item.boss=bossRow.querySelector('.bb-t > b')?.textContent?.trim();
    if(hit&&(e===hit||e.contains(hit)))controls.push(item);
    else if(!modal&&e.closest('#pbody,#menu,#bigMap'))offscreen.push(item);
  }
  const badge = p => number(document.querySelector('#rail [data-open="'+p+'"] .bdg')?.textContent || '') || 0;
  const revive=controls.some(c=>/^(Revive Here|Back to Cathedral)/i.test(c.label));
  const title=Array.from(document.querySelectorAll('h1,h2,h3')).filter(visible).map(e=>e.innerText).join(' ');
  const atCharSelect=/Choose Character/i.test(title) || (!txt('pName') && controls.some(c=>/^(▶\s*)?Play$/.test(c.label)));
  const jobQuestProgress=/(Mage|Starweaver|Sage) Quest/.test(quest)?questProgress.split('Chapter')[0].trim():null;
  const questRunning=!!document.querySelector('#jqCard [data-aq="stop"]');
  const autoQuestMode=questRunning?(jobQuestProgress&&!document.querySelector('#jqCard [data-aq="jq"]')?'jq':'mq'):null;
  const body=panel?txt('pbody'):'';
  const cells=Array.from(document.querySelectorAll('#pbody [data-act="isel"][data-it]'));
  const inventoryItems={};
  for(const e of cells)if(e.dataset.it?.startsWith('i:'))inventoryItems[e.dataset.it.slice(2)]=number(e.querySelector?.('.u-count')?.textContent||'')||1;
  const inventoryGear=cells.filter(e=>e.dataset.it?.startsWith('g:')).map(e=>({uid:e.dataset.it.slice(2),rarity:Number(e.className.match(/\bu-r([0-4])\b/)?.[1]??-1),text:e.getAttribute?.('aria-label')||e.innerText||'',art:e.querySelector?.('img')?.getAttribute?.('src')||'',equipped:!!e.querySelector?.('u'),protected:!!e.querySelector?.('[aria-pressed="true"]')||/u-fav/.test(e.className),better:e.classList.contains('u-up')}));
  const worn=Array.from(document.querySelectorAll('#pbody [data-act="dslot"][data-id]')).map(e=>({slot:e.dataset.id,uid:e.querySelector?.('[data-it]')?.dataset.it?.replace(/^g:/,''),text:e.innerText||''})).filter(e=>e.uid);
  const smithRows=panel==='smith'?Array.from(document.querySelectorAll('#pbody .shoprow')).map(e=>{
    const b=e.querySelector?.('button[data-act]')||e.nextElementSibling;
    const mats=Array.from(e.querySelectorAll?.('.mat[data-it]')||[]).map(m=>{const nums=(m.title||'').replace(/,/g,'').match(/\d+/g)||[];return {id:m.dataset.it?.replace(/^i:/,''),have:nums.length>1?+nums[0]:null,need:nums.length>1?+nums[1]:null,text:m.innerText||''};});
    const step=(e.querySelector?.('.rf-to')?.textContent||'').match(/\+(\d+)\s*→\s*\+(\d+)/);
    const risk=e.querySelector?.('.rf-risk')?.textContent||'';
    return {uid:e.dataset.it?.replace(/^[gu]:/,''),name:e.querySelector?.('b')?.textContent?.trim(),text:e.innerText||'',
      act:b?.dataset?.act,key:b?.dataset?.id,disabled:!!b?.disabled,button:b?.innerText||'',worn:/\(equipped\)|\(สวมอยู่\)/i.test(e.innerText||''),mats,
      gold:number(e.querySelector?.('.mat.gold')?.textContent||''),refine:step?+step[1]:null,nextRefine:step?+step[2]:null,
      chance:number((risk.match(/[\d.]+%/)||[])[0]||''),risk,costText:e.querySelector?.('.rf-cost')?.textContent||'',max:/^MAX$/.test(b?.innerText?.trim()||'')};
  }):[];
  // Text fallback is limited to navigation. Spending/forging keeps exact row identity.
  const navigation={menuBtn:/^(Full menu|Menu|เมนู)$/i,autoBtn:/^(AUTO|Auto Hunt|ล่าอัตโนมัติ)$/i};
  for(const [id,re] of Object.entries(navigation))if(!controls.some(c=>c.id===id)) {
    const matches=controls.filter(c=>c.scope==='hud'&&!c.act&&!c.open&&!c.aq&&!c.go&&re.test(c.label));
    if(matches.length===1)matches[0].id=id;
  }
  const panels={stats:/^(Status|Stats|สถานะ)(?:\s+[Cc])?$/i,bag:/^(Bag|Inventory|กระเป๋า)(?:\s+[Ii])?$/i,
    equip:/^(Gear|Equipment|อุปกรณ์)(?:\s+[Gg])?$/i,skills:/^(Skills|สกิล)(?:\s+[Kk])?$/i,rank:/^(Ranking|Rankings|อันดับ)$/i};
  if(visible($('menu')))for(const [kind,re] of Object.entries(panels))if(!controls.some(c=>c.open===kind)) {
    const matches=controls.filter(c=>c.scope==='menu'&&!c.act&&!c.open&&re.test(c.label));
    if(matches.length===1)matches[0].open=kind;
  }
  return {name:txt('pName'),job:txt('pJob'),lv:txt('pLv'),jobLv:txt('pJl'),hp,mp,
    gold:number(txt('gold')),crystals:number(txt('crys')),onlineText:txt('onlineN'),quest,questProgress,jobQuestProgress,autoQuestMode,zone:txt('zone'),zoneLv:txt('zoneLv'),
    tameOffer:txt('tameTxt'),target:txt('tgName'),targetHP:txt('tgTxt'),targetHpRatio:parseFloat($('tgFill')?.style.width||'')/100,bossMechanic:txt('bossMech'),tension:number(txt('tenTxt')),weak:txt('tgElem'),exp:number(txt('expTxt')),jobExp:number(txt('jexpTxt')),
    expText:txt('expTxt')+(panel==='stats'&&/EXP\s+MAX/.test(document.querySelector('#pbody .bars .exp')?.textContent||'')?' EXP MAX':''),jobExpText:txt('jexpTxt'),cbtText:txt('cbtPill'),vipText:txt('vipTag'),
    cbtClaimed:panel==='cbt'?/This account has it|บัญชีนี้รับแล้ว/i.test(body):null,
    bagUsage:panel==='bag'?pair(document.querySelector('#pbody .sx-foot .cap')?.innerText||''):null,
    inventoryComplete:panel==='bag'&&!!document.querySelector('#pbody [data-act="ifilter"][data-id="all"].on')&&!document.getElementById('invQ')?.value,
    inventoryItems,inventoryGear,worn,smithRows,forgeResult:panel==='smith'?(document.querySelector('#pbody .refres.ok')?.innerText||''):null,
    storageGear:panel==='storage'?Array.from(document.querySelectorAll('#pbody [data-act="stmove"][data-uid]')).map(e=>({uid:e.dataset.uid,dir:e.dataset.dir,text:e.innerText||'',art:e.querySelector?.('img')?.getAttribute?.('src')||''})):[],
    storageComplete:panel==='storage'&&document.getElementById('stQ')?.value==='',
    storageUsage:panel==='storage'?pair(document.querySelector('#pbody .stbox > div:nth-child(2) > b > small')?.textContent||''):null,
    premiumRows:panel==='prem'?Array.from(document.querySelectorAll('#pbody .prem-item')).map(e=>{const b=e.querySelector?.('[data-act="crbuy"]'),owned=e.querySelector?.('em')?.textContent;return {id:b?.dataset.id,disabled:!!b?.disabled,price:number(b?.innerText||''),owned:owned?number(owned):0,text:e.innerText||''};}):[],
    autoQuestRunning:questRunning,
    autoHunt:controls.find(c=>c.id==='autoBtn')?.on?'on':$('autoBtn')?.className||'',
    statBlocked:(quest.match(/(?:Spend|stat points|stats)\s*(\d+)/i)||[])[1]||null,
    statPoints:badge('stats'),skillPoints:badge('skills'),hpPotions:number(txt('potHp')),mpPotions:number(txt('potMp')),
    dead:!!(hp && hp[0]===0 || revive), atCharSelect, disconnected:!txt('pName') && /disconnect|connection lost/i.test(title),
    panelOpen:!!panel,panel,panelText:panel ? txt('pbody').slice(0,10000) : '',
    menuOpen:visible($('menu')),mapOpen:visible($('bigMap')),modalText:modal ? modal.innerText.slice(0,2500) : '',
    ranking:panel==='rank'?Array.from(document.querySelectorAll('.ranklist .rk')).map(e=>({text:e.innerText,own:e.classList.contains('me')})):[],
    bossRows:panel==='bosses'?Array.from(document.querySelectorAll('#pbody .bbrow')).map(e=>({name:e.querySelector('.bb-t > b')?.textContent?.trim(),up:e.classList.contains('up'),text:e.innerText,key:e.querySelector('[data-act="bbgo"]')?.dataset.id})):[],
    skillEvolutions:panel==='skills'?Array.from(document.querySelectorAll('#pbody [data-act="evo"]')).map(e=>({key:e.dataset.id,branch:e.dataset.b,on:e.classList.contains('on'),disabled:e.disabled})):[],
    equippedWeapon:panel==='equip'?document.querySelector('#pbody [data-act="dslot"][data-id="weapon"] [data-it]')?.dataset.it?.replace(/^g:/,''):null,
    equipmentCandidates:panel==='equip'?Array.from(document.querySelectorAll('#pbody .sx-cands .sx-cand')).map(e=>({key:e.dataset.id,text:e.innerText,locked:e.classList.contains('lk')})):[],
    controls, offscreen, buttons:controls.map(c=>c.label)};
}
// The local adapter accepts GET expressions; retain line boundaries but omit
// indentation/comment-only lines to stay below ordinary HTTP header limits.
const PERCEPTION = '('+readUI.toString().split('\n').filter(l=>!l.trimStart().startsWith('//')).map(l=>l.trim()).join('\n')+')()';
const {bracketHold}=require('./progression');
const DNA=require('./strategy-dna');
const {rankFarmingOptions}=require('./cognitive-brain');
function n(v) { return Number(String(v||'').match(/\d+/)?.[0]||0); }
const textKey=v=>String(v||'').replace(/\s+/g,' ').trim().toLowerCase();
function rankDue(m,now=Date.now()) {return now-(m.last?.rank||0)>300000&&now-(m.failures?.rank?.at||0)>(m.failures?.rank?.count||0)*60000;}
function controllerFallbackReady(mem,alive,now=Date.now()){
  if(alive){delete mem.agentMissingSince;return false;}
  mem.agentMissingSince ??= now;
  return now-mem.agentMissingSince>=60000;
}
function freshMemory() { return {version:3,last:{},failures:{},samples:[],rank:null,task:null,classTrip:null,lastProgress:Date.now(),deaths:[],wasDead:false}; }
const CLASS_PATH=Object.freeze({Novice:'mage',Mage:'starweaver',Starweaver:'sage'});
function bossLearning(m,s,now=Date.now(),catalog){
  const boss=classBossObjective(s,catalog)||m.classObjective?.boss;if(!boss)return null;
  let b=m.bossLearning;
  if(!b||b.character!==s.name||b.objective!==s.jobQuestProgress)b=m.bossLearning={character:s.name,objective:s.jobQuestProgress,boss,history:[],audit:{},receipts:{}};
  const old=m.classBossRecovery;
  if(old?.boss===boss&&old.reason==='observed-defeats'&&!b.importedAt){
    b.importedAt=old.at;b.pending=true;b.defeatAt=old.at;b.history.push({at:old.at,outcome:'legacy-defeats',deaths:old.deaths,detail:'No per-fight samples were recorded; damage cause unknown'});
  }
  return b;
}
// What the agent can actually do in a fight. A build that gained a
// capability (a charged burst against an unbroken shield) may be tried again
// even when the gear power did not move yet.
function bossCapabilities(){return ['ward_burst'];}
function bossBuildSignature(b){return JSON.stringify({equipment:b.audit?.equip?.worn,power:b.audit?.equip?.combat?.power,profile:b.applied?.profile,capabilities:bossCapabilities()});}
function bossPreparationNeeded(s,m,now=Date.now(),catalog){
  const b=bossLearning(m,s,now,catalog);return !!b?.pending;
}
function observeClassBoss(m,s,now=Date.now(),catalog){
  if(m.uiHealth?.safeIdle)return;
  const b=bossLearning(m,s,now,catalog);if(!b)return;
  const trip=m.classBossTrip,t=m.gameTelemetry;
  const valid=t?.validated&&!t.loading&&!t.positionFault&&now-t.checkedAt<=5000&&now>=t.checkedAt;
  const map=String(trip?.key||'').split(',')[0];
  if(!b.active&&trip?.fighting&&trip.boss===b.boss&&valid&&t.map===map&&String(s.target||'').includes(b.boss)&&!s.dead){
    b.active={at:now,boss:b.boss,map,signature:bossBuildSignature(b),capabilities:bossCapabilities(),build:m.combatSummary,profile:b.applied?.profile,samples:0,minHp:1,firstBossRatio:s.targetHpRatio,lastBossRatio:s.targetHpRatio,targetHP:s.targetHP,hpLost:0,potionsStart:s.hpPotions,mechanics:[]};
  }
  const f=b.active;if(!f)return;
  if(s.dead){finish('defeat');return;}
  if(valid&&t.map!==f.map){finish('left-map-without-credit');return;}
  if(!valid||t.map!==f.map||!String(s.target||'').includes(f.boss))return;
  if(!Number.isFinite(s.targetHpRatio)||s.targetHpRatio<0||s.targetHpRatio>1)return;
  f.samples++;f.lastAt=now;f.lastBossRatio=s.targetHpRatio;f.minHp=Math.min(f.minHp,s.hp[0]/s.hp[1]);
  if(f.lastHp!=null)f.hpLost+=Math.max(0,f.lastHp-s.hp[0]);f.lastHp=s.hp[0];f.targetHP=s.targetHP;
  if(s.bossMechanic&&!f.mechanics.includes(s.bossMechanic))f.mechanics=[...f.mechanics,s.bossMechanic].slice(-8);
  f.potionsUsed=Number.isFinite(f.potionsStart)&&Number.isFinite(s.hpPotions)?Math.max(0,f.potionsStart-s.hpPotions):null;
  const ward=/\bWARD\s*(\d+)\s*(?:s\b|วิ)/i.exec(s.bossMechanic||'');
  if(ward){
    const observed=s.bossWardRatio??t.bossWardRatio,left=Number(ward[1]),ratio=Number.isFinite(observed)&&observed>=0&&observed<=1?observed:null;
    if(!f.ward||left>f.ward.left+1)f.ward={at:now,firstLeft:left,firstRatio:ratio,samples:0,bursts:0};
    const w=f.ward;w.left=left;w.ratio=ratio;w.samples++;w.lastSeenAt=now;
    const elapsed=w.firstLeft-left,rate=elapsed>0&&ratio!=null&&w.firstRatio!=null?(w.firstRatio-ratio)/elapsed:0;
    w.estimatedBreakSeconds=rate>0?ratio/rate:null;
    // A normal stop + Return Scroll needs several seconds. Potion thresholds
    // cannot protect against an unresolved WARD blast (public raid mechanic).
    const late=w.samples>=2&&left<=8&&(ratio==null||ratio>0.05)&&(!Number.isFinite(w.estimatedBreakSeconds)||w.estimatedBreakSeconds>left-5);
    if(late){
      // One charged burst is the only damage that can land inside the window.
      // Ask for it first; an unsolved shield after that is a damage problem.
      if(!w.bursts)b.wardRequest={at:now,boss:f.boss,left,ratio,breakSeconds:w.estimatedBreakSeconds??null,deadline:now+left*1000};
      else {b.retreat=true;b.pending=true;f.abortReason='ward-deadline';}
    }
  } else if(f.ward&&now-(f.ward.lastSeenAt||f.ward.at)>5000&&Number.isFinite(f.ward.ratio)&&f.ward.ratio>0.05){
    // The shield window closed with the shield still up: the blast lands.
    b.retreat=true;b.pending=true;f.abortReason='ward-expired';
  }
  // Retreat rather than repeating a lethal race. The controller performs normal UI input.
  if(f.samples>=3&&s.hp[0]/s.hp[1]<=(b.plan?.retreatHp||0.35)){b.retreat=true;b.pending=true;}
  function finish(outcome){
    if(outcome==='left-map-without-credit'&&b.retreat)outcome='retreated';
    const result={...f,at:now,startedAt:f.at,outcome,seconds:Math.round((now-f.at)/1000),bossDamageFraction:Math.max(0,(f.firstBossRatio||0)-(f.lastBossRatio||0))};
    b.history=[...b.history,result].slice(-12);b.active=null;b.pending=true;b.defeatAt=now;b.failedSignature=f.signature;b.failedPower=f.build?.power;b.failedCapabilities=f.capabilities||null;b.audit={};b.receipts={};b.applied=null;b.retreat=false;b.plan=null;b.staged=false;b.quieted=false;
    // A shield that could not be broken is a damage problem: the next trial
    // needs a stronger set, not another identical run.
    b.wardAbort=String(f.abortReason||'').startsWith('ward')?{at:now,reason:f.abortReason,left:f.ward?.left??null,
      ratio:f.ward?.ratio??null,breakSeconds:f.ward?.estimatedBreakSeconds??null,power:f.build?.power??null}:null;
    b.wardRequest=null;
    m.classBossTrip=null;m.trainingUntil=0;if(m.classAdvancement)m.classAdvancement.phase='prepare';
  }
}
function bossPlan(s,m,response,now=Date.now()){
  const b=bossLearning(m,s,now);let p;
  try{if(typeof response!=='string'||response.length>3500)return null;p=JSON.parse(response);}catch{return null;}
  const keys=['diagnosis','enableSkills','disableSkills','craftWing','retreatHp'];
  if(!p||Object.keys(p).some(k=>!keys.includes(k))||typeof p.diagnosis!=='string'||!p.diagnosis.trim()||p.diagnosis.length>900||typeof p.craftWing!=='boolean'||![0.35,0.4,0.5].includes(p.retreatHp))return null;
  const skills=b?.audit?.skill?.controls?.filter(c=>c.act==='askill')||[];
  for(const k of ['enableSkills','disableSkills'])if(!Array.isArray(p[k])||p[k].length>(k==='enableSkills'?9:8)||new Set(p[k]).size!==p[k].length||p[k].some(id=>!skills.some(c=>c.key===id)))return null;
  if(p.enableSkills.some(id=>p.disableSkills.includes(id))||p.disableSkills.includes('energy_coat'))return null;
  if(skills.some(c=>c.key==='energy_coat')&&!p.enableSkills.includes('energy_coat'))return null;
  // Native defensive buffs are controller invariants. Preserve the model's
  // attack choices, but never trade away this observed DEF/MATK buff.
  const defense=skills.some(c=>c.key==='stardust_shield')?['stardust_shield']:[];
  return {...p,enableSkills:[...new Set([...p.enableSkills,...defense])],disableSkills:p.disableSkills.filter(id=>!defense.includes(id)),enforcedDefense:defense,at:now};
}
function bossReviewEvidence(s,m,catalog){
  const b=bossLearning(m,s),a=m.autonomy||{},ids=(b.audit.skill?.controls||[]).filter(c=>c.act==='askill').map(c=>c.key);
  const monster=catalog?.monsters?.find(x=>x.name===b.boss);
  return {boss:b.boss,objective:b.objective,bossElement:monster?.elem,baseHP:monster?.hp,
    warning:'Base HP is not live raid HP. Unknown damage causes remain uncertain; observed boss HP changes may include other players.',
    defeats:b.history.slice(-3).map(h=>{
      const mechanics=[];
      for(const text of h.mechanics||[]){
        const timer=/\b(WARD|REWIND)\s*(\d+)\s*(?:s\b|วิ)/i.exec(text);
        if(timer){let row=mechanics.find(x=>x.name===timer[1].toUpperCase());if(!row){row={name:timer[1].toUpperCase(),firstSeconds:Number(timer[2])};mechanics.push(row);}row.lastSeconds=Number(timer[2]);}
        else mechanics.push({hint:String(text).slice(0,180)});
      }
      return {...Object.fromEntries(['outcome','seconds','samples','minHp','lastHp','targetHP','bossDamageFraction','potionsUsed','ward','abortReason'].map(k=>[k,h[k]])),mechanics};
    }),
    equipment:b.audit.equip?.combat,wing:a.wingCraft?.status,wingGoal:a.goal?.slot==='wing'?a.goal:undefined,
    wardAbort:b.wardAbort||undefined,wardAttempts:(b.wardAttempts||[]).slice(-3),
    previousProfile:b.history.filter(h=>h.signature).at(-1)?.profile||undefined,
    learnedSkills:Object.fromEntries(ids.map(id=>[id,Object.fromEntries(Object.entries(catalog?.definitions?.skills?.[id]||{}).filter(([k])=>['name','elem','kind','range','buff','cd','mult','hits'].includes(k)))])),
    enabledSkills:(b.audit.skill?.controls||[]).filter(c=>c.act==='askill'&&c.on).map(c=>c.key),
    selectedNative:Object.fromEntries(['hunt','pot'].map(part=>[part,(b.audit[part]?.controls||[]).filter(c=>c.on).map(c=>({key:c.k,value:['tension','stopNoPot'].includes(c.k)?true:c.v}))])),
    supportedTactic:{target:'boss',priority:'elite',tension:true,hp:60,mp:30,stopNoPot:true,feather:0,skillScope:'ALL_LEARNED'}};
}
function bossReviewDue(b,now=Date.now()){
  const recent=at=>Number.isFinite(at)&&now>=at&&now-at<3600000;
  const verified=(b.reviewOutcomes||[]).filter(r=>r.status==='decision-verified'&&recent(r.at));
  // An unbroken shield means the reviewed build was not enough: one further
  // reviewed plan is allowed to answer it.
  const shield=wardAbortOf(b);
  return (b.reviews||[]).filter(recent).length<6&&!!(verified.length<3||(shield&&recent(shield.at)))&&
    (b.defeatAt>(b.reviewAt||0)||now-(b.reviewAt||0)>=(['model-unavailable','decision-rejected'].includes(b.reviewStatus)?60000:300000));
}
// The last trial that ended on an unbroken shield. That is a damage problem,
// not a survival problem, so it may be answered with any measured gain.
function wardAbortOf(b){
  if(b?.wardAbort)return b.wardAbort;
  const last=b?.history?.filter(h=>h.signature).at(-1);
  if(!last||!String(last.abortReason||'').startsWith('ward'))return null;
  return {at:last.at,reason:last.abortReason,left:last.ward?.left??null,ratio:last.ward?.ratio??null,
    breakSeconds:last.ward?.estimatedBreakSeconds??null,power:last.build?.power??null};
}
function bossReady(s,m,now=Date.now(),catalog){
  const b=bossLearning(m,s,now,catalog),r=b?.receipts;
  if(!b?.plan||!r?.gear||!r.skill||!r.hunt||!r.pot||!b.applied||s.dead||s.hp?.[0]/s.hp?.[1]<0.9||s.hpPotions<20||s.mpPotions<20)return false;
  if(b.plan.craftWing&&m.autonomy?.wingCraft?.status!=='equipped')return false;
  if(now-(b.audit.equip?.at||0)>300000)return false;
  const sig=bossBuildSignature(b),power=b.audit.equip?.combat?.power;
  if(b.failedSignature===sig)return false;
  // A profile change or a measured equipment gain qualifies; mere elapsed time does not.
  const previous=b.history.filter(h=>h.signature).at(-1);
  if(!previous)return true;
  // A capability the failed trial did not have (a charged burst against an
  // unbroken shield) is itself a reason to try again.
  const failedCaps=b.failedCapabilities??previous.capabilities??null;
  if(failedCaps&&JSON.stringify(failedCaps)!==JSON.stringify(bossCapabilities()))return true;
  // A plan made after the last defeat has never been tried.
  if(Number(b.plan?.at||0)>Number(previous.at||0))return true;
  if(JSON.stringify(previous.profile)!==JSON.stringify(b.applied.profile))return true;
  if(!Number.isFinite(power)||!Number.isFinite(b.failedPower))return false;
  // An unbroken shield is a damage problem: any measured gain in gear power
  // counts there, while other defeats still need the 5% margin.
  return wardAbortOf(b)?power>b.failedPower:power>=(b.failedPower||Infinity)*1.05;
}
function classWorkflowOwned(s,m,now=Date.now()) {
  if(bossPreparationNeeded(s,m,now))return false;
  if(!CLASS_PATH[s.job])return false;
  return !!(m.classTrip?.job===s.job||s.panel==='shrine'||/quest at the shrine|Return to.*Shrine|quest complete/i.test(s.quest||'')||
    [...(s.controls||[]),...(s.offscreen||[])].some(c=>c.go==='shrine')||s.jobQuestProgress&&now>=(m.trainingUntil||0));
}
// The class quest card lists one counter per step ("Magma Heart 0/10",
// "Hunt Ignar the Flame Tyrant 0/1"). Split the card into those steps so the
// bot can read the open step whatever wording the client uses.
function classQuestSteps(s){
  const text=String(s.jobQuestProgress||'').trim();
  if(!text)return [];
  const parts=text.split(/\s*(\d+)\s*\/\s*(\d+)\s*/).filter(p=>p!=='');
  const steps=[];
  for(let i=0;i+2<parts.length;i+=3){
    const have=Number(parts[i+1]),need=Number(parts[i+2]);
    if(!Number.isFinite(have)||!Number.isFinite(need))continue;
    const label=parts[i].replace(/^\s*\S+\s+Quest\s+/,'').replace(/^Hunt\s+/i,'').trim();
    steps.push({label,have,need,done:have>=need});
  }
  return steps;
}
function classBossObjective(s,catalog){
  const goal=s.jobQuestProgress||'';
  if(/Chrono Gear\s*0\s*\/\s*1/i.test(goal))return 'Time Eater';
  const hunted=goal.match(/Hunt\s+(.+?)\s+0\s*\/\s*1\b/i)?.[1]?.trim();
  if(hunted)return hunted;
  // The same open step without the "Hunt" wording: resolve its label against
  // the boss names the public catalog knows.
  const names=(catalog?.monsters||[]).filter(m=>m.boss).map(m=>m.name).filter(Boolean);
  for(const step of classQuestSteps(s)){
    if(step.done||step.need!==1||!step.label)continue;
    const hit=names.find(n=>textKey(n)===textKey(step.label));
    if(hit)return hit;
  }
  return null;
}
function classObjectiveStalled(s,m,now=Date.now(),catalog){
  const boss=classBossObjective(s,catalog),damage=m.combatTelemetry?.lastDamage;
  const fighting=!!(boss&&damage&&String(s.target||'').includes(boss)&&damage.zone===s.zone&&now>=damage.at&&now-damage.at<=10000);
  const objective=m.classObjective,matching=objective?.character===s.name&&objective.job===s.job&&objective.signature===String(s.jobQuestProgress||'').replace(/\s+/g,' ').trim();
  const at=matching?objective.at:m.jobQuestAt;
  return !!s.jobQuestProgress&&!!CLASS_PATH[s.job]&&!s.dead&&s.hp?.[0]/s.hp?.[1]>=0.3&&Number.isFinite(at)&&now-at>=180000&&now>=(m.trainingUntil||0)&&!fighting;
}
function classReviewDue(s,m,now=Date.now(),catalog){
  const r=m.classReview||{},history=(r.history||[]).filter(at=>now>=at&&now-at<3600000);
  const trip=m.classBossTrip,tripBusy=trip&&now-(trip.fightAt||trip.at)<300000;
  return classObjectiveStalled(s,m,now,catalog)&&!tripBusy&&now-(r.at||0)>=(r.status==='model-unavailable'?60000:300000)&&history.length<3;
}
function classBossAtDestination(m,now=Date.now()){
  const trip=m.classBossTrip,t=m.gameTelemetry,[map,x,y]=String(trip?.key||'').split(',');
  return !!trip&&t?.validated&&!t.loading&&!t.positionFault&&now>=t.checkedAt&&now-t.checkedAt<=5000&&t.map===map&&
    [t.x,t.y,Number(x),Number(y)].every(Number.isFinite)&&Number(x)>0&&Number(y)>0&&Math.hypot(t.x-Number(x),t.y-Number(y))<=192;
}
function classReviewTask(s,m,response,now=Date.now(),catalog){
  let decision;try{if(typeof response!=='string'||response.length>2000)return null;decision=JSON.parse(response);}catch{return null;}
  if(!decision||typeof decision!=='object'||Object.keys(decision).some(k=>!['action','reason'].includes(k)))return null;
  const controls=[...(s.controls||[]),...(s.offscreen||[])];
  if(decision.action==='navigate_boss'&&classObjectiveStalled(s,m,now,catalog)&&classBossObjective(s,catalog))return 'class_boss';
  if(decision.action==='resume_quest'&&!s.autoQuestRunning&&controls.some(c=>c.aq==='jq'))return 'job_retry';
  if(decision.action==='return_shrine'&&CLASS_PATH[s.job]&&controls.some(c=>c.go==='shrine'))return 'class';
  if(decision.action==='wait'&&m.classBoss?.name===classBossObjective(s,catalog)&&m.classBoss.up===false&&now>=m.classBoss.at&&now-m.classBoss.at<300000)return 'observe';
  return null;
}
function combatSnapshot(s,now=Date.now()) {
  if(!['bag','equip'].includes(s.panel)||!s.panelOpen||!s.name||!s.job||!s.lv)return null;
  const lines=String(s.panelText||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const anchors=lines.flatMap((x,i)=>/^(Gear Power|Equipment Power|พลังอุปกรณ์)$/i.test(x)?[i]:[]);
  if(anchors.length!==1)return null;
  const i=anchors[0];
  if(lines[i-3]!==s.name||lines[i-2]!==s.job||lines[i-1]!==s.lv)return null;
  const value=lines[i+1];
  if(!/^(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(value||''))return null;
  const power=Number(value.replace(/,/g,''));if(!Number.isSafeInteger(power)||power<0)return null;
  const stats={};
  for(const [j,key] of ['ATK','MATK','DEF','MDEF','HP','ASPD'].entries()){
    const text=lines[i+3+j*2]||'';
    if(lines[i+2+j*2]!==key||!/^\d[\d,]*(?:\.\d+)?(?:[+-]\d[\d,]*(?:\.\d+)?)?$/.test(text))continue;
    const n=Number(text.replace(/,/g,'').match(/^\d+(?:\.\d+)?/)[0]);if(Number.isFinite(n)&&n>=0)stats[key]=n;
  }
  return {character:s.name,job:s.job,level:n(s.lv),power,stats,at:now,source:'equipment-ui'};
}
function rememberCombat(mem,s,now=Date.now()) {
  const value=combatSnapshot(s,now);if(!value)return false;
  const old=mem.combatSummary;
  if(old&&now-old.at<60000&&JSON.stringify({...old,at:0})===JSON.stringify({...value,at:0}))return false;
  mem.combatSummary=value;return true;
}
function updateMetrics(mem,s,now=Date.now(),catalog) {
  if(!s.name || !s.hp || !n(s.lv)) return;
  observeClassBoss(mem,s,now,catalog);
  if(s.jobQuestProgress&&CLASS_PATH[s.job]){
    const signature=s.jobQuestProgress.replace(/\s+/g,' ').trim(),old=mem.classObjective;
    if(!old||old.character!==s.name||old.job!==s.job||old.signature!==signature){
      const review=mem.classReview,same=mem.classAdvancement?.character===s.name&&review?.objective?.replace(/\s+/g,' ').trim()===signature;
      mem.classObjective={character:s.name,job:s.job,signature,boss:classBossObjective(s,catalog),at:!old&&same&&Number.isFinite(review.at)&&review.at<=now?review.at:now,lastAt:now,samples:1};
    }else{old.lastAt=now;old.samples++;old.boss=classBossObjective(s,catalog);}
  }
  const advancement=mem.classAdvancement;
  if(advancement&&advancement.character===s.name&&String(s.job||'').toLowerCase()===advancement.to&&advancement.from!==s.job&&!advancement.completedAt){
    advancement.completedAt=now;advancement.phase='complete';mem.classTrip=null;mem.classBossTrip=null;mem.combatJob=null;mem.last.configure=0;
    if(mem.autonomy?.farm)mem.autonomy.farm.pendingProfile=true;
    const a=mem.autonomy;if(a){a.events ||= [];a.sequence ||=0;a.events.push({id:++a.sequence,type:'class_advanced',detail:{from:advancement.from,to:s.job},at:now});a.events=a.events.slice(-80);}
  }
  const sample={t:now,lv:n(s.lv),jl:n(s.jobLv),job:s.job,gold:s.gold,exp:s.exp,quest:s.questProgress||s.quest,zone:s.zone};
  const prev=mem.samples.at(-1);
  if(/Time Eater/i.test(s.target||'')){
    mem.bossCombat ||= {at:mem.last.boss_engage||now};mem.bossCombat.hp=s.targetHpRatio;
  }else mem.bossCombat=null;
  if(s.jobQuestProgress!==mem.jobQuestProgress){mem.jobQuestProgress=s.jobQuestProgress;mem.jobQuestAt=now;}
  if(!prev || prev.lv!==sample.lv || prev.jl!==sample.jl || prev.job!==sample.job || prev.quest!==sample.quest || (sample.exp!=null && prev.exp!==sample.exp)) mem.lastProgress=now;
  if(s.dead&&!mem.wasDead) mem.deaths.push(now);
  mem.wasDead=s.dead; mem.deaths=mem.deaths.filter(t=>now-t<600000);
  if(!prev||now-prev.t>45000) mem.samples.push(sample);
  mem.samples=mem.samples.filter(x=>now-x.t<3600000).slice(-80);
  const first=mem.samples[0],mins=first?(now-first.t)/60000:0;
  mem.performance={minutes:Math.round(mins),levels:first?sample.lv-first.lv:0,
    goldPerMinute:mins>=1&&Number.isFinite(first.gold)&&Number.isFinite(s.gold)?Math.round((s.gold-first.gold)/mins):null,
    stalledMinutes:Math.floor((now-mem.lastProgress)/60000),deaths10m:mem.deaths.length};
}
function chooseTask(s,m,now=Date.now(),catalog) {
  const due=(key,ms)=>now-(m.last[key]||0)>ms && now-(m.failures[key]?.at||0)>(m.failures[key]?.count||0)*60000;
  if(s.atCharSelect||s.disconnected) return 'reconnect';
  if(s.dead) return 'revive';
  if(!s.name||!s.hp) return 'observe';
  if(bossPreparationNeeded(s,m,now,catalog))return m.bossLearning.retreat?'boss_retreat':'observe';
  if(s.hp[0]/s.hp[1]<0.3) return 'survive';
  // A live shield that cannot be broken in time is answered with a charged
  // burst first; only an unsolved shield ends the trial.
  if(m.bossLearning?.wardRequest&&m.classBossTrip?.fighting&&!s.dead&&s.hp[0]/s.hp[1]>=0.55)return 'boss_ward_burst';
  const nextClass=CLASS_PATH[s.job];
  if(nextClass&&m.classTrip?.job===s.job&&now-m.classTrip.at<240000)return s.panel==='shrine'?'class':'observe';
  if(nextClass&&due('class',60000)&&(/quest at the shrine|Return to.*Shrine|quest complete/i.test(s.quest||'')||s.panel==='shrine'||
    [...(s.controls||[]),...(s.offscreen||[])].some(c=>c.go==='shrine')))return 'class';
  const needsTimeEater=/Chrono Gear\s*0\s*\/\s*1/i.test(s.jobQuestProgress||'');
  const objectiveBoss=classBossObjective(s,catalog);
  const rewind=/REWIND\s*(\d+)/i.exec(s.bossMechanic||'');
  if(needsTimeEater && /Time Eater/i.test(s.target||'') && rewind && +rewind[1]>=11 && due('boss_break',20000) && s.hp[0]/s.hp[1]>=0.4)return 'boss_break';
  if(s.jobQuestProgress&&m.deaths.length>=2&&!m.trainingUntil&&classObjectiveStalled(s,m,now,catalog)&&due('train',1200000))return 'train';
  if(m.classBossTrip) {
    const wanted=m.classBossTrip.boss||'Time Eater';
    if(objectiveBoss!==wanted) return 'boss_engage';
    if(!needsTimeEater){
      if(m.classBossTrip.fighting){
        if(!/\bon\b/.test(s.autoHunt||'')&&classBossAtDestination(m,now))return 'boss_engage';
        if(classObjectiveStalled(s,m,now,catalog)&&now-m.classBossTrip.fightAt>=180000&&due('class_boss',120000))return 'class_boss';
        return 'observe';
      }
      if(classBossAtDestination(m,now))return s.hp[0]/s.hp[1]<0.85?'survive':'boss_engage';
      return now-m.classBossTrip.at<300000||!due('class_boss',120000)?'observe':'class_boss';
    }
    if(String(s.target||'').includes(wanted)&&s.autoQuestMode==='jq')return 'observe';
    return now-m.classBossTrip.at<90000?'observe':'boss_engage';
  }
  if(needsTimeEater&&!s.autoQuestRunning&&due('job_retry',30000))return 'job_retry';
  const needsBuild=needsTimeEater && ['fire_bolt','lightning_bolt','blaze','jupiter_thunder','meteor_fall'].some(k=>!m.bossBuild?.[k]);
  if(needsTimeEater && /Time Eater/i.test(s.target||'')) {
    if(needsBuild && m.bossCombat && now-m.bossCombat.at>90000 && s.targetHpRatio>0.85 && due('boss_build',5000))return 'boss_build';
    return 'observe';
  }
  if(needsBuild && due('boss_build',5000))return 'boss_build';
  if(objectiveBoss&&!needsTimeEater&&classObjectiveStalled(s,m,now,catalog)&&!String(s.target||'').includes(objectiveBoss)&&due('class_boss',120000))return 'class_boss';
  if(nextClass&&s.jobQuestProgress&&now>=(m.trainingUntil||0)){
    if(!s.autoQuestRunning&&s.controls.some(c=>c.aq==='jq')&&due('job_retry',30000))return 'job_retry';
    if(!needsTimeEater&&s.autoQuestRunning&&s.autoQuestMode==='jq'&&m.deaths.length<3)return 'observe';
  }
  // Expired training MUST retry first. Previously train reset its own timer at every expiry.
  if(m.trainingUntil&&now>m.trainingUntil&&s.controls.some(c=>c.aq==='jq')&&due('job_retry',600000))return 'job_retry';
  if(s.jobQuestProgress && !m.classTrip && now>(m.trainingUntil||0) && s.autoQuestMode==='mq' && due('job_retry',60000))return 'job_retry';
  // A waiting boss is not evidence that more levels are needed. Train only after actual defeats.
  if(s.jobQuestProgress && !m.classTrip && now>(m.trainingUntil||0) && m.deaths.length>=3 && due('train',1200000))return 'train';
  if(needsTimeEater && now>(m.trainingUntil||0) && due('class_boss',120000))return 'class_boss';
  if(nextClass&&s.jobQuestProgress&&now>=(m.trainingUntil||0))return 'observe';
  const statWait=m.statsDeferred&&m.statsDeferred.points===s.statPoints&&m.statsDeferred.level===s.lv&&m.statsDeferred.job===s.job&&now-m.statsDeferred.at<900000;
  if(!statWait&&(s.statPoints>=5||s.statBlocked)&&due('stats',120000)) return 'stats';
  if(s.skillPoints>0&&due('skills',180000)) return 'skills';
  if(due('configure',21600000)) return 'configure';
  if(!s.autoQuestRunning&&due('quest',60000)) return 'quest';
  if(due('gear',900000)||m.gearLevel!==n(s.lv)) return due('gear',120000)?'gear':'observe';
  if(due('combat',21600000)||m.combatJob!==s.job)return due('combat',300000)?'combat':'observe';
  if(due('login',21600000)) return 'login';
  if(due('achievements',1800000)) return 'achievements';
  if(due('rank',300000)) return 'rank';
  return 'observe';
}
// Clickable candidates only; unique exact match wins, ambiguous substrings fail closed.
function matchControl(controls,label,exact=false) {
  const l=String(label).toLowerCase().replace(/\s+/g,' ').trim();
  const eq=controls.filter(c=>c.label.toLowerCase()===l);
  const hits=eq.length?eq:exact?[]:controls.filter(c=>c.label.toLowerCase().includes(l));
  if(hits.length!==1) return null;
  return hits[0];
}
function casterWeapon(candidates=[]) {
  const delta=text=>Object.fromEntries(Array.from(text.replace(/,/g,'').matchAll(/\b(MATK|ATK|MDEF|DEF|HP|MP|CRIT)[▲▼]([\d.]+)/g),m=>[m[1],Number(m[2])*(m[0].includes('▼')?-1:1)]));
  return candidates.filter(c=>!c.locked).map(c=>({...c,delta:delta(c.text)}))
    .filter(c=>c.delta.MATK>1&&['HP','DEF','MDEF'].every(k=>(c.delta[k]||0)>=0))
    .sort((a,b)=>(b.delta.MATK+2*(b.delta.CRIT||0))-(a.delta.MATK+2*(a.delta.CRIT||0)))[0]||null;
}
function createExecutor({observe,click,key,scroll,hold,sleep,log,save,mem}) {
  let actions=0;
  async function pick(pred,optional=false) {
    if(++actions>12) throw Error('transaction action budget exceeded');
    let s=await observe(), matches=s.controls.filter(pred);
    if(!matches.length&&scroll) {
      const hidden=(s.offscreen||[]).filter(pred);
      if(hidden.length===1) {await scroll(hidden[0]);await sleep(350);s=await observe();matches=s.controls.filter(pred);}
    }
    if(matches.length!==1) { if(optional)return false;throw Error('control missing or ambiguous'); }
    await click(matches[0]); await sleep(650);return true;
  }
  const act=(a,id,optional=false)=>pick(c=>c.act===a&&(id==null||c.key===id),optional);
  async function close() {
    for(let i=0;i<4;i++) {
      const s=await observe();
      if(!s.panelOpen&&!s.menuOpen&&!s.mapOpen&&!s.modalText) return true;
      await key('Escape');await sleep(250);
    }
    return false;
  }
  async function open(panel) {
    let s=await observe();if(s.panel===panel)return;
    await close();s=await observe();
    if(!s.controls.some(c=>c.open===panel)) { await pick(c=>c.id==='menuBtn'); }
    await pick(c=>c.open===panel);await sleep(600);
    s=await observe();if(s.panel!==panel && !(panel==='map'&&s.mapOpen)) throw Error('panel did not open: '+panel);
  }
  async function confirm(kind) {
    const s=await observe();
    if(!new RegExp(kind,'i').test(s.modalText))throw Error('unexpected confirmation');
    await pick(c=>/^Confirm$|^ยืนยัน$/.test(c.label));
  }
  async function run(task) {
    actions=0;const before=await observe();let result='';
    try {
      if(['class_boss','boss_engage','job_retry'].includes(task)&&bossPreparationNeeded(before,mem))throw Error('Boss retry locked until preparation is verified');
      switch(task) {
        case 'boss_retreat':
          await close();await pick(c=>c.aq==='stop',true);await pick(c=>c.id==='autoBtn'&&c.on,true);
          await pick(c=>c.id==='potTp');result='boss trial aborted with normal Return Scroll; awaiting observed destination';break;
        case 'boss_rebuild':
          await close();await pick(c=>c.aq==='stop',true);await pick(c=>c.aq==='mq');
          if(!(await observe()).autoQuestRunning)throw Error('Preparation farming not acknowledged');
          result='preparation farming continues; retry requires verified build changes';break;
        case 'boss_stage':
          await close();await pick(c=>c.aq==='stop',true);await pick(c=>c.id==='autoBtn'&&c.on,true);
          {const s=await observe();if(s.autoQuestRunning||/\bon\b/.test(s.autoHunt||''))throw Error('Preparation stop not acknowledged');}
          result='native combat paused while applying the boss build';break;
        case 'boss_audit_equip':
        case 'boss_audit_skill':
        case 'boss_audit_hunt':
        case 'boss_audit_pot': {
          const b=bossLearning(mem,before),part=task.slice(11);if(!b?.pending)throw Error('No boss preparation pending');
          await open(part==='equip'?'equip':'auto');
          if(part!=='equip')await act('atab',part);
          if(part==='skill')await pick(c=>c.act==='ahot'&&/All learned|ทุกสกิลที่เรียน/i.test(c.label)&&!c.on,true);
          const s=await observe(),controls=[...s.controls,...(s.offscreen||[])].filter(c=>['aopt','askill','ahot'].includes(c.act)).map(({act,key,k,v,on,label})=>({act,key,k,v,on,label}));
          if(part==='equip'&&!combatSnapshot(s))throw Error('Fresh equipment baseline unavailable');
          if(part!=='equip'&&!controls.length)throw Error('Native AUTO options unavailable');
          b.audit[part]={at:Date.now(),combat:part==='equip'?combatSnapshot(s):undefined,worn:part==='equip'?s.worn:undefined,controls};
          result='observed boss preparation '+part;break;
        }
        case 'boss_profile_hunt':
        case 'boss_profile_skill':
        case 'boss_profile_pot': {
          const b=bossLearning(mem,before),part=task.slice(13);if(!b?.pending||!b.plan)throw Error('No validated boss preparation plan');
          await open('auto');await act('atab',part);
          if(part==='skill'){
            await pick(c=>c.act==='ahot'&&/All learned|ทุกสกิลที่เรียน/i.test(c.label)&&!c.on,true);
            for(const [ids,on] of [[b.plan.enableSkills,true],[b.plan.disableSkills,false]])for(const id of ids){
              const s=await observe(),row=[...s.controls,...(s.offscreen||[])].find(c=>c.act==='askill'&&c.key===id);
              if(!row)throw Error('Planned learned skill no longer observed');
              if(row.on!==on){if(actions>=8){result='boss skills partially applied; verification pending';return {ok:true,pending:true};}await pick(c=>c.act==='askill'&&c.key===id);}
            }
          }else{
            const wanted=part==='hunt'?[['target','boss'],['prio','elite'],['tension','true']]:[['hp','60'],['mp','30'],['stopNoPot','true'],['feather','0']];
            for(const [k,v] of wanted){
              const s=await observe(),rows=[...s.controls,...(s.offscreen||[])];
              if(['tension','stopNoPot'].includes(k)){if(!rows.some(c=>c.act==='aopt'&&c.k===k&&c.on))await pick(c=>c.act==='aopt'&&c.k===k&&c.v===v);}
              else if(!rows.some(c=>c.act==='aopt'&&c.k===k&&c.v===v&&c.on))await pick(c=>c.act==='aopt'&&c.k===k&&c.v===v);
            }
          }
          const s=await observe(),rows=[...s.controls,...(s.offscreen||[])];
          const values=part==='skill'?rows.filter(c=>c.act==='askill'&&c.on).map(c=>c.key).sort():Object.fromEntries(rows.filter(c=>c.act==='aopt'&&c.on).map(c=>[c.k,['tension','stopNoPot'].includes(c.k)?true:c.v]));
          if(part==='skill'&&(!rows.some(c=>c.act==='ahot'&&/All learned|ทุกสกิลที่เรียน/i.test(c.label)&&c.on)||b.plan.enableSkills.some(id=>!values.includes(id))||b.plan.disableSkills.some(id=>values.includes(id))))throw Error('Boss skill profile not acknowledged');
          if(part!=='skill')for(const [k,v] of part==='hunt'?[['target','boss'],['prio','elite'],['tension',true]]:[['hp','60'],['mp','30'],['stopNoPot',true],['feather','0']])if(values[k]!==v)throw Error('Boss native option not acknowledged');
          b.applied ||= {profile:{}};b.applied.profile[part]=values;b.receipts[part]=Date.now();result='verified boss native '+part+' profile';break;
        }
        case 'reconnect': await pick(c=>/^(▶\s*)?Play$/.test(c.label)); result='reconnect requested'; break;
        case 'revive': await pick(c=>c.id==='riseBtn'||/Revive Here/i.test(c.label)); result='feather revive requested'; break;
        case 'survive':
          if(before.hpPotions>0) await pick(c=>c.id==='potHp');
          result='low HP: defer chores, let native recovery work';break;
        case 'stats':
          await open('stats');await act('srec');
          {const staged=await observe();if(![...staged.controls,...(staged.offscreen||[])].some(c=>c.act==='sapply')){
            mem.statsDeferred={points:before.statPoints,level:before.lv,job:before.job,at:Date.now()};
            result='native recommended stats have no affordable increase; wait for points or cost recheck';break;
          }}
          await act('sapply');await confirm('stat|สเตตัส');
          await sleep(1000);if((await observe()).statPoints>=before.statPoints&&before.statPoints>0)throw Error('stat points did not decrease');
          delete mem.statsDeferred;
          result='recommended stats committed and verified';break;
        case 'skills': {
          await open('skills');await act('sktab',before.job.toLowerCase(),true);
          if((await observe()).controls.some(c=>c.act==='rnview'))await act('rnopen');
          const staged=await observe();
          if(staged.controls.some(c=>c.act==='skrec'))await act('skrec');
          if((await observe()).controls.some(c=>c.act==='skapply2')) { await act('skapply2');await confirm('skill|สกิล'); }
          await act('hotsort',null,true);await sleep(1000);
          const after=await observe();
          if(after.skillPoints>=before.skillPoints&&before.skillPoints>0) throw Error('no usable skill allocation yet');
          result='class skill build applied; hotbar sorted'; break;
        }
        case 'configure':
          await open('auto');await act('atab','quest');
          await pick(c=>c.act==='aqstat'&&c.key==='1'&&!c.on,true);
          if(!(await observe()).controls.some(c=>c.act==='aqstat'&&c.key==='1'&&c.on))throw Error('auto allocation not confirmed');
          result='native automatic stat/skill allocation enabled';break;
        case 'dna_profile':
        case 'combat': {
          const g=DNA.profile(mem),threshold=String(Math.round(g.hpPotionThreshold*100));
          await open('auto');await act('atab','pot');
          await pick(c=>c.act==='aopt'&&c.k==='hp'&&c.v===threshold&&!c.on,true);
          await pick(c=>c.act==='aopt'&&c.k==='mp'&&c.v==='30'&&!c.on,true);
          await pick(c=>c.act==='aopt'&&c.k==='stopNoPot'&&c.v==='true',true);
          {const s=await observe(),read=[...s.controls,...(s.offscreen||[])];
            if(task==='dna_profile'&&read.filter(c=>c.act==='aopt'&&c.k==='stopNoPot'&&c.on).length!==1)throw Error('no-potion stop protection not verified');
            if(!['hp','mp'].every(k=>read.some(c=>c.act==='aopt'&&c.k===k&&c.v===(k==='hp'?threshold:'30')&&c.on)))throw Error('potion thresholds not verified');}
          await act('atab','skill');
          const scope=g.skillScope==='HOTBAR'?/Hotbar|ช่องลัด/i:/All learned|ทุกสกิลที่เรียน/i;
          await pick(c=>c.act==='ahot'&&scope.test(c.label)&&!c.on,true);
          const checked=await observe();
          const read=[...checked.controls,...(checked.offscreen||[])];
          if(!read.some(c=>c.act==='ahot'&&scope.test(c.label)&&c.on))throw Error('native skill scope not verified');
          if(g.skillScope==='HOTBAR'&&(!read.some(c=>c.act==='askill'&&c.key==='energy_coat'&&c.on)||read.filter(c=>c.act==='askill'&&c.on).length<4)){
            await pick(c=>c.act==='ahot'&&/All learned|ทุกสกิลที่เรียน/i.test(c.label)&&!c.on,true);
            throw Error('hotbar scope lacks verified defensive buff/skills');
          }
          mem.nativeCombatProfile={character:before.name,job:before.job,genes:{...g},at:Date.now()};
          mem.combatJob=before.job;mem.last.combat=Date.now();result='verified native DNA profile: HP '+threshold+'%, MP 30%, '+g.skillScope;break;
        }
        case 'class': {
          const next=CLASS_PATH[before.job];
          if(!next) {result='no next class on configured path';break;}
          if(mem.classAdvancement?.from!==before.job||mem.classAdvancement?.character!==before.name)mem.classAdvancement={character:before.name,from:before.job,to:next,startedAt:Date.now(),phase:'travel'};
          save();
          if(before.panel!=='shrine') {
            await close();
            if(before.autoQuestRunning&&before.autoQuestMode==='jq'){
              // The native class-quest runner walks home and hands the quest in
              // by itself; only the class pick at the shrine needs the bot.
              mem.classTrip={job:before.job,at:Date.now()};result='native class quest runner continues; the class pick follows at the shrine';break;
            }
            await pick(c=>c.id==='autoBtn'&&c.on,true);
            // The game's CTA while AQ is on resets only the Novice job gate. Stop first for advanced jobs.
            await pick(c=>c.aq==='stop',true);
            await pick(c=>c.go==='shrine');
            mem.classTrip={job:before.job,at:Date.now()};result='walking to shrine for '+next;break;
          }
          // A finished quest is handed in first; a new class is accepted after it.
          const steps=classQuestSteps(before),complete=steps.length>0&&steps.every(x=>x.done);
          const changed=(complete?await act('jqdone',null,true):false)||await act('jq',next,true)||await act('job',next,true)||await act('jqdone',null,true);
          if(!changed)throw Error('No verified class quest action at shrine');
          mem.classTrip=null;await close();
          await pick(c=>c.aq==='jq',true);
          const after=await observe();
          if(after.job===before.job && /quest at the shrine/i.test(after.quest))throw Error('class quest not accepted');
          mem.classAdvancement.phase='quest';updateMetrics(mem,after);
          result='class quest accepted/turned in; native quest runner continues';break;
        }
        case 'train':
          if(mem.classBossTrip||mem.classBoss){
            mem.classBossRecovery={at:Date.now(),boss:classBossObjective(before)||mem.classBossTrip?.boss||mem.classBoss.name,objective:before.jobQuestProgress,deaths:mem.deaths.length,reason:'observed-defeats'};
            mem.classBossTrip=null;if(mem.classAdvancement)mem.classAdvancement.phase='rebuild';save();
          }
          await close();await pick(c=>c.aq==='stop',true);await pick(c=>c.aq==='mq');
          if(!(await observe()).autoQuestRunning)throw Error('training route not started');
          mem.trainingUntil=Date.now()+1200000;
          if(mem.classBossRecovery){mem.classBossRecovery.until=mem.trainingUntil;const a=mem.autonomy;if(a){a.events ||= [];a.sequence ||=0;a.events.push({id:++a.sequence,type:'class_rebuild',detail:{boss:mem.classBossRecovery.boss,deaths:mem.deaths.length,minutes:20},at:Date.now()});a.events=a.events.slice(-80);}}
          result='class quest stalled: train story route for 20 min, preserving class progress';break;
        case 'boss_build': {
          mem.bossBuild ||= {};
          const skill=['fire_bolt','lightning_bolt','blaze','jupiter_thunder','meteor_fall'].find(k=>!mem.bossBuild[k]);
          if(!skill){result='boss build checked';break;}
          await open('skills');await act('sksel',skill);
          let s=await observe(),evolves=(s.skillEvolutions||[]).filter(c=>c.key===skill);
          const branch='b',existing=evolves.find(c=>c.on);
          const retune=skill==='fire_bolt'&&existing?.branch==='a'&&s.gold>=12000;
          if(existing&&!retune) {mem.bossBuild[skill]={at:Date.now(),result:'existing evolution retained'};result=skill+' already evolved';break;}
          if(!evolves.some(c=>c.branch===branch&&!c.disabled)) {mem.bossBuild[skill]={at:Date.now(),result:'not currently eligible'};result=skill+' evolution not eligible';break;}
          await pick(c=>c.act==='evo'&&c.key===skill&&c.branch===branch);
          if(retune)await pick(c=>c.act==='evo'&&c.key===skill&&c.branch===branch);
          s=await observe();
          if(!(s.skillEvolutions||[]).some(c=>c.key===skill&&c.branch===branch&&c.on))throw Error('evolution not confirmed');
          mem.bossBuild[skill]={at:Date.now(),result:retune?'retuned for boss (2000 G)':'first free evolution applied',branch};result=skill+' boss-damage evolution verified';break;
        }
        case 'boss_break': {
          if(!hold)throw Error('held-key input not available');
          await close();
          try {
            await pick(c=>c.aq==='stop',true);
            // Cast before releasing T: otherwise the server's next basic swing can spend the charge.
            const burst=await hold('t',5400,'3');
            if(burst?.aborted) {result='burst cancelled: '+burst.aborted;break;}
            const charged=await observe();
            if(charged.dead)throw Error('knocked out during charge');
            mem.bossBurst={at:Date.now(),chargedTension:burst?.tension??charged.tension,consumed:burst?.consumed,mechanicAfterCharge:burst?.mechanic??charged.bossMechanic,targetHP:charged.targetHP};
            // The verified third slot is Focused Meteor Storm: higher single-hit burst,
            // and slightly longer reach than Fire Bolt while a boss is standing in Rewind.
            await sleep(1500);
            result='held T normally to charge, released a Meteor Storm burst against Rewind';
          } finally {
            const current=await observe();
            if(!current.dead&&!current.autoQuestRunning)await pick(c=>c.aq==='jq');
          }
          break;
        }
        case 'boss_ward_burst': {
          if(!hold)throw Error('held-key input not available');
          const b=bossLearning(mem,before),request=b?.wardRequest;
          if(!request)throw Error('No WARD window to break');
          if(before.dead||before.hp?.[0]/before.hp?.[1]<0.55)throw Error('too low HP to charge a burst');
          if(request.boss&&!String(before.target||'').includes(request.boss))throw Error('boss is not the current target');
          await close();
          // The native auto-hunt keeps hitting the shield while T is charged.
          const burst=await hold('t',5400,'3');
          if(burst?.aborted){b.wardRequest=null;b.retreat=true;b.pending=true;result='WARD burst aborted: '+burst.aborted;break;}
          const live=bossLearning(mem,before)?.active;
          if(live?.ward){live.ward.bursts=(live.ward.bursts||0)+1;live.ward.lastBurstAt=Date.now();}
          b.wardRequest=null;
          b.wardAttempts=[...(b.wardAttempts||[]),{at:Date.now(),left:request.left,ratio:request.ratio??null,breakSeconds:request.breakSeconds??null}].slice(-6);
          result='charged a burst into the WARD window ('+request.left+' s left)';
          break;
        }
        case 'class_boss': {
          const objective=classBossObjective(before);if(!objective)throw Error('No verified boss objective');
          let routed=false;
          try{
            await close();await pick(c=>c.aq==='stop',true);await pick(c=>c.id==='autoBtn'&&c.on,true);
            await open('bosses');await sleep(1200);
            const board=await observe(),matches=board.bossRows?.filter(b=>b.name===objective)||[],boss=matches.length===1?matches[0]:null;
            if(!boss)throw Error('Quest boss missing or ambiguous on live boss board');
            mem.classBoss={...boss,at:Date.now()};
            if(boss.up){
              await pick(c=>c.act==='bbgo'&&c.boss===objective&&c.key===boss.key);
              mem.classBossTrip={at:Date.now(),boss:objective,key:boss.key};routed=true;
              result='walking to live '+objective+' coordinates from boss-board Go button';
            }else result=objective+' not alive; recorded respawn board and retained job quest';
          }finally{
            if(!routed){await close();if(!(await observe()).autoQuestRunning)await pick(c=>c.aq==='jq',true);}
          }
          break;
        }
        case 'boss_engage':
          await close();
          if(mem.classBossTrip?.boss===classBossObjective(before)&&!/Chrono Gear\s*0\s*\/\s*1/i.test(before.jobQuestProgress||'')){
            if(!classBossAtDestination(mem))throw Error('Boss destination not yet verified');
            await pick(c=>c.aq==='stop',true);
            if(!/\bon\b/.test((await observe()).autoHunt||''))await pick(c=>c.id==='autoBtn');
            if(!/\bon\b/.test((await observe()).autoHunt||''))throw Error('Native boss combat activation not confirmed');
            mem.classBossTrip.fighting=true;mem.classBossTrip.fightAt ||=Date.now();
            result='native combat enabled at verified '+mem.classBossTrip.boss+' destination; waiting for observed quest credit';break;
          }
          if(!(await observe()).autoQuestRunning)await pick(c=>c.aq==='jq');
          mem.classBossTrip=null;mem.last.class_boss=Date.now();
          result='job quest combat resumed after boss approach; ready to turn in if item acquired';break;
        case 'job_retry':
          await close();await pick(c=>c.aq==='stop',true);await pick(c=>c.aq==='jq');
          if(!(await observe()).autoQuestRunning)throw Error('class quest retry not started');
          mem.trainingUntil=0;if(mem.classAdvancement)mem.classAdvancement.phase='quest';result='retry class quest after training';break;
        case 'quest':
          await close();
          if(mem.trainingUntil>Date.now()||bossPreparationNeeded(before,mem))await pick(c=>c.aq==='mq');
          else if(!await pick(c=>c.aq==='jq',true))await pick(c=>c.aq==='mq');
          if(!(await observe()).autoQuestRunning)throw Error('auto quest did not start');
          result='quest runner started';break;
        case 'gear':
          await open('equip');await act('eqauto');
          if(['Mage','Starweaver','Sage'].includes(before.job)) {
            await act('dslot','weapon');
            const candidate=casterWeapon((await observe()).equipmentCandidates);
            if(candidate) {
              await act('eqcand',candidate.key);await act('equip2',candidate.key);await sleep(700);
              if((await observe()).equippedWeapon!==candidate.key)throw Error('caster weapon equip not confirmed');
              mem.casterWeapon={at:Date.now(),key:candidate.key,delta:candidate.delta};
            }
          }
          mem.gearLevel=n(before.lv);mem.equipment={at:Date.now(),text:(await observe()).panelText.slice(0,5000)};result='native best-gear selection applied';break;
        case 'login':
          await open('login');await act('login',null,true);result='daily login checked';break;
        case 'achievements':
          await open('ach');
          await act('achlv',null,true);
          result='achievement rewards checked';break;
        case 'rank':
          await open('rank');await act('rktab','lv');await sleep(1600);
          { const snapshot=await observe();
            if(!snapshot.ranking?.length || !snapshot.controls.some(c=>c.act==='rktab'&&c.key==='lv'&&c.on))throw Error('level ranking not loaded');
            mem.rank={at:Date.now(),kind:'lv',character:before.name,text:snapshot.panelText.slice(0,6000),rows:snapshot.ranking};
          }
          result='live ranking recorded';break;
        default:result='native quest/hunt progressing; screen stays clear';
      }
      mem.last[task]=Date.now();delete mem.failures[task];
      mem.task={name:task,result,at:Date.now(),ok:true};log(task+': '+result);
      return mem.task;
    } catch(e) {
      mem.failures[task]={count:Math.min(10,(mem.failures[task]?.count||0)+1),at:Date.now(),reason:e.message};
      mem.task={name:task,result:e.message,at:Date.now(),ok:false};log(task+' failed: '+e.message);
      return mem.task;
    } finally { try {await close();} finally {save();} }
  }
  // External controllers own their own workflow budgets. Each exported open is
  // a new short navigation transaction; run() keeps its shared internal limit.
  return {run,open:async panel=>{actions=0;return open(panel);},close};
}
module.exports={PERCEPTION,readUI,n,rankDue,controllerFallbackReady,freshMemory,combatSnapshot,rememberCombat,updateMetrics,chooseTask,bossLearning,bossPreparationNeeded,observeClassBoss,bossPlan,bossReviewEvidence,bossReviewDue,bossReady,bossBuildSignature,wardAbortOf,classWorkflowOwned,classBossObjective,classQuestSteps,classObjectiveStalled,classReviewDue,classReviewTask,classBossAtDestination,matchControl,casterWeapon,createExecutor,bracketHold,rankFarmingOptions};
