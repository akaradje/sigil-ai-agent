'use strict';
// All observations are rendered UI. No game memory, socket injection or private APIs.
function readUI() {
  const $ = id => document.getElementById(id);
  const visible = e => {
    if (!e || e.closest('[hidden]')) return false;
    const r=e.getBoundingClientRect(), st=getComputedStyle(e);
    return r.width>3 && r.height>3 && st.visibility!=='hidden' && st.display!=='none' && st.opacity!=='0';
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
    const item={label,id:e.id||null,act:e.dataset.act||null,key:e.dataset.id||null,
      open:e.dataset.open||null,aq:e.dataset.aq||null,go:e.dataset.go||null,
      k:e.dataset.k||null,v:e.dataset.v||null,branch:e.dataset.b||null,on:e.classList.contains('on'),x,y};
    if(e.dataset.uid)item.uid=e.dataset.uid;
    if(e.dataset.dir)item.dir=e.dataset.dir;
    if(e.dataset.place)item.place=e.dataset.place;
    if(e.dataset.bm)item.bm=e.dataset.bm;
    if(e.dataset.wm)item.wm=e.dataset.wm;
    if(e.dataset.n)item.amount=e.dataset.n;
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
  const inventoryGear=cells.filter(e=>e.dataset.it?.startsWith('g:')).map(e=>({uid:e.dataset.it.slice(2),text:e.getAttribute?.('aria-label')||e.innerText||'',art:e.querySelector?.('img')?.getAttribute?.('src')||'',equipped:!!e.querySelector?.('u')}));
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
  return {name:txt('pName'),job:txt('pJob'),lv:txt('pLv'),jobLv:txt('pJl'),hp,mp,
    gold:number(txt('gold')),crystals:number(txt('crys')),quest,questProgress,jobQuestProgress,autoQuestMode,zone:txt('zone'),zoneLv:txt('zoneLv'),
    target:txt('tgName'),targetHP:txt('tgTxt'),targetHpRatio:parseFloat($('tgFill')?.style.width||'')/100,bossMechanic:txt('bossMech'),tension:number(txt('tenTxt')),weak:txt('tgElem'),exp:number(txt('expTxt')),jobExp:number(txt('jexpTxt')),
    expText:txt('expTxt')+(/EXP\s+MAX/.test(body)?' EXP MAX':''),jobExpText:txt('jexpTxt'),cbtText:txt('cbtPill'),vipText:txt('vipTag'),
    cbtClaimed:panel==='cbt'?/This account has it|บัญชีนี้รับแล้ว/i.test(body):null,
    bagUsage:panel==='bag'?pair(document.querySelector('#pbody .sx-foot .cap')?.innerText||''):null,
    inventoryComplete:panel==='bag'&&!!document.querySelector('#pbody [data-act="ifilter"][data-id="all"].on')&&!document.getElementById('invQ')?.value,
    inventoryItems,inventoryGear,worn,smithRows,forgeResult:panel==='smith'?(document.querySelector('#pbody .refres.ok')?.innerText||''):null,
    storageGear:panel==='storage'?Array.from(document.querySelectorAll('#pbody [data-act="stmove"][data-uid]')).map(e=>({uid:e.dataset.uid,dir:e.dataset.dir,text:e.innerText||'',art:e.querySelector?.('img')?.getAttribute?.('src')||''})):[],
    storageUsage:panel==='storage'?pair(document.querySelector('#pbody .stbox > div:nth-child(2) > b > small')?.textContent||''):null,
    premiumRows:panel==='prem'?Array.from(document.querySelectorAll('#pbody .prem-item')).map(e=>{const b=e.querySelector?.('[data-act="crbuy"]'),owned=e.querySelector?.('em')?.textContent;return {id:b?.dataset.id,disabled:!!b?.disabled,price:number(b?.innerText||''),owned:owned?number(owned):0,text:e.innerText||''};}):[],
    autoQuestRunning:questRunning,
    autoHunt: $('autoBtn')?.className || '',
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
const PERCEPTION = '('+readUI.toString()+')()';
function n(v) { return Number(String(v||'').match(/\d+/)?.[0]||0); }
function rankDue(m,now=Date.now()) {return now-(m.last?.rank||0)>300000&&now-(m.failures?.rank?.at||0)>(m.failures?.rank?.count||0)*60000;}
function freshMemory() { return {version:3,last:{},failures:{},samples:[],rank:null,task:null,classTrip:null,lastProgress:Date.now(),deaths:[],wasDead:false}; }
function updateMetrics(mem,s,now=Date.now()) {
  if(!s.name || !s.hp || !n(s.lv)) return;
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
function chooseTask(s,m,now=Date.now()) {
  const due=(key,ms)=>now-(m.last[key]||0)>ms && now-(m.failures[key]?.at||0)>(m.failures[key]?.count||0)*60000;
  if(s.atCharSelect||s.disconnected) return 'reconnect';
  if(s.dead) return 'revive';
  if(!s.name||!s.hp) return 'observe';
  if(s.hp[0]/s.hp[1]<0.3) return 'survive';
  const needsTimeEater=/Chrono Gear\s*0\s*\/\s*1/i.test(s.jobQuestProgress||'');
  const rewind=/REWIND\s*(\d+)/i.exec(s.bossMechanic||'');
  if(needsTimeEater && /Time Eater/i.test(s.target||'') && rewind && +rewind[1]>=11 && due('boss_break',20000) && s.hp[0]/s.hp[1]>=0.4)return 'boss_break';
  if(m.classBossTrip) {
    if(needsTimeEater && /Time Eater/i.test(s.target||'') && s.autoQuestMode==='jq')return 'observe';
    if(!needsTimeEater) return 'boss_engage';
    return now-m.classBossTrip.at<90000?'observe':'boss_engage';
  }
  if(needsTimeEater&&!s.autoQuestRunning&&due('job_retry',30000))return 'job_retry';
  const needsBuild=needsTimeEater && ['fire_bolt','lightning_bolt','blaze','jupiter_thunder','meteor_fall'].some(k=>!m.bossBuild?.[k]);
  if(needsTimeEater && /Time Eater/i.test(s.target||'')) {
    if(needsBuild && m.bossCombat && now-m.bossCombat.at>90000 && s.targetHpRatio>0.85 && due('boss_build',5000))return 'boss_build';
    return 'observe';
  }
  if(needsBuild && due('boss_build',5000))return 'boss_build';
  if((s.statPoints>=20||s.statBlocked)&&due('stats',120000)) return 'stats';
  if(s.skillPoints>0&&due('skills',180000)) return 'skills';
  if(due('configure',21600000)) return 'configure';
  if(m.classTrip && m.classTrip.job===s.job && now-m.classTrip.at<240000) return s.panel==='shrine'?'class':'observe';
  if(due('class',180000)&&(/quest at the shrine|Return to.*Shrine|quest complete/i.test(s.quest)||s.panel==='shrine'||s.controls.some(c=>c.go==='shrine'))) return 'class';
  // Expired training MUST retry first. Previously train reset its own timer at every expiry.
  if(m.trainingUntil&&now>m.trainingUntil&&s.controls.some(c=>c.aq==='jq')&&due('job_retry',600000))return 'job_retry';
  if(s.jobQuestProgress && !m.classTrip && now>(m.trainingUntil||0) && s.autoQuestMode==='mq' && due('job_retry',60000))return 'job_retry';
  // A waiting boss is not evidence that more levels are needed. Train only after actual defeats.
  if(s.jobQuestProgress && !m.classTrip && now>(m.trainingUntil||0) && m.deaths.length>=3 && due('train',1200000))return 'train';
  if(needsTimeEater && now>(m.trainingUntil||0) && due('class_boss',120000))return 'class_boss';
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
      switch(task) {
        case 'reconnect': await pick(c=>/^(▶\s*)?Play$/.test(c.label)); result='reconnect requested'; break;
        case 'revive': await pick(c=>c.id==='riseBtn'||/Revive Here/i.test(c.label)); result='feather revive requested'; break;
        case 'survive':
          if(before.hpPotions>0) await pick(c=>c.id==='potHp');
          result='low HP: defer chores, let native recovery work';break;
        case 'stats':
          await open('stats');await act('srec');await act('sapply');await confirm('stat|สเตตัส');
          await sleep(1000);if((await observe()).statPoints>=before.statPoints&&before.statPoints>0)throw Error('stat points did not decrease');
          result='recommended stats committed and verified';break;
        case 'skills': {
          await open('skills');await act('sktab',before.job.toLowerCase(),true);
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
        case 'combat':
          await open('auto');await act('atab','pot');
          await pick(c=>c.act==='aopt'&&c.k==='hp'&&c.v==='60'&&!c.on,true);
          await pick(c=>c.act==='aopt'&&c.k==='mp'&&c.v==='30'&&!c.on,true);
          await pick(c=>c.act==='aopt'&&c.k==='stopNoPot'&&c.v==='true',true);
          {const s=await observe();if(!['hp','mp'].every(k=>s.controls.some(c=>c.act==='aopt'&&c.k===k&&c.v===(k==='hp'?'60':'30')&&c.on)))throw Error('potion thresholds not verified');}
          await act('atab','skill');
          await pick(c=>c.act==='ahot'&&/All learned/i.test(c.label)&&!c.on,true);
          if(!(await observe()).controls.some(c=>c.act==='ahot'&&/All learned/i.test(c.label)&&c.on))throw Error('all learned skills not verified');
          mem.combatJob=before.job;result='HP potion 60%, MP 30%, all learned skills enabled';break;
        case 'class': {
          const next={Novice:'mage',Mage:'starweaver',Starweaver:'sage'}[before.job];
          if(!next) {result='no next class on configured path';break;}
          if(before.panel!=='shrine') {
            await close();
            // The game's CTA while AQ is on resets only the Novice job gate. Stop first for advanced jobs.
            await pick(c=>c.aq==='stop',true);
            await pick(c=>c.go==='shrine');
            mem.classTrip={job:before.job,at:Date.now()};result='walking to shrine for '+next;break;
          }
          if(!await act('jq',next,true)) {
            if(!await act('job',next,true))await act('jqdone',null,true);
          }
          mem.classTrip=null;await close();
          await pick(c=>c.aq==='jq',true);
          const after=await observe();
          if(after.job===before.job && /quest at the shrine/i.test(after.quest))throw Error('class quest not accepted');
          result='class quest accepted/turned in; native quest runner continues';break;
        }
        case 'train':
          await close();await pick(c=>c.aq==='stop',true);await pick(c=>c.aq==='mq');
          if(!(await observe()).autoQuestRunning)throw Error('training route not started');
          mem.trainingUntil=Date.now()+1200000;result='class quest stalled: train story route for 20 min, preserving class progress';break;
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
        case 'class_boss': {
          await close();await pick(c=>c.aq==='stop',true);
          await open('bosses');await sleep(1200);
          const board=await observe(),boss=board.bossRows?.find(b=>b.name==='Time Eater');
          if(!boss)throw Error('Time Eater missing from live boss board');
          mem.classBoss={...boss,at:Date.now()};
          if(boss.up) {
            await pick(c=>c.act==='bbgo'&&c.boss==='Time Eater');
            mem.classBossTrip={at:Date.now(),boss:'Time Eater',key:boss.key};
            result='walking to live Time Eater coordinates from boss-board Go button';
          } else {
            await close();await pick(c=>c.aq==='jq');
            result='Time Eater not alive; recorded respawn board and retained job quest';
          }
          break;
        }
        case 'boss_engage':
          await close();
          if(!(await observe()).autoQuestRunning)await pick(c=>c.aq==='jq');
          mem.classBossTrip=null;mem.last.class_boss=Date.now();
          result='job quest combat resumed after boss approach; ready to turn in if item acquired';break;
        case 'job_retry':
          await close();await pick(c=>c.aq==='stop',true);await pick(c=>c.aq==='jq');
          if(!(await observe()).autoQuestRunning)throw Error('class quest retry not started');
          mem.trainingUntil=0;mem.jobQuestAt=Date.now();result='retry class quest after training';break;
        case 'quest':
          await close();
          if(mem.trainingUntil>Date.now())await pick(c=>c.aq==='mq');
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
  return {run,open,close};
}
module.exports={PERCEPTION,readUI,n,rankDue,freshMemory,updateMetrics,chooseTask,matchControl,casterWeapon,createExecutor};
