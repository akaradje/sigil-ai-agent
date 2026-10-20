'use strict';
const {resolveCap,bottlenecks,farmOptions}=require('./game-catalog');
const Progression=require('./progression');
const Hygiene=require('./session-hygiene');
const DNA=require('./strategy-dna');
const {combatSnapshot}=require('./game-intelligence');
const MIN=60000;
const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
const level=s=>Number(String(s.lv||'').match(/\d+/)?.[0]||0);
function init(mem) {
  return mem.autonomy ||= {version:1,events:[],sequence:0,premium:{reserved:0,spent:0},inventory:null,worn:[],last:{},crafted:{},farmRates:{}};
}
function event(a,type,detail,now=Date.now()) {
  a.events.push({id:++a.sequence,type,detail,at:now});a.events=a.events.slice(-80);
}
function wingReserve(a,reserve=100000){return a.wingPriority&&a.goal?.slot==='wing'?reserve+(a.goal.cost?.gold||0):reserve;}
function refineCandidates(catalog,s,worn,rows){
  const mage=['Mage','Starweaver','Sage','Priest','Lumen Oracle'].includes(s.job);
  const score=b=>(b.matk||0)*(mage?3:0)+(b.atk||0)*(mage?0.3:3)+(b.def||0)+(b.mdef||0)*0.8;
  return rows.map(row=>{const w=worn.find(w=>w.uid===row.key),g=gearForName(catalog,w?.text||row.name),r=g?.refinement?.[row.refine],next=g?.refinement?.[row.refine+1];
    const fee=Number(String(row.costText||'').replace(/,/g,'').match(/\d+/)?.[0]),chance=row.chance/100;
    const gain=r&&next?score(next.bonus)-score(r.bonus):null;
    const expected=fee>0&&chance>0?(fee+(r?.ore||1)*40+(row.refine>=catalog.refineSafe?(1-chance)*6000*(g?.tier===5?3:g?.tier===4?2:1):0))/chance:null;
    return {...row,efficiency:gain>0&&expected>0?gain/expected:null};
  }).sort((x,y)=>x.efficiency!=null&&y.efficiency!=null?y.efficiency-x.efficiency:x.refine-y.refine);
}
function catalogChanged(mem,catalog,now=Date.now()) {
  const a=init(mem),previous=a.catalog;
  if(previous&&catalog.levelCap>previous.levelCap)event(a,'cap_expanded',{from:previous.levelCap,to:catalog.levelCap},now);
  if(previous&&previous.fingerprint!==catalog.fingerprint){if(a.farm)a.farm.pendingProfile=true;a.goal=null;a.last.forge=0;event(a,'catalog_changed',{levelCap:catalog.levelCap,refineMax:catalog.refineMax},now);}
  a.catalog={levelCap:catalog.levelCap,refineMax:catalog.refineMax,fingerprint:catalog.fingerprint,at:catalog.at};
}
function gearForName(catalog,text) {
  const value=norm(text);
  return catalog.gear.filter(g=>value.includes(norm(g.name))||value.includes('/gear/'+g.id+'.png')).sort((a,b)=>b.name.length-a.name.length)[0]||null;
}
// Only identified, plain, unprotected surplus. A live sale dialog is checked again before input.
function surplusGear(catalog,s,worn) {
  const job=catalog?.jobs?.[String(s.job||'').toLowerCase()];
  if(!job||!s.inventoryComplete||!worn?.length)return [];
  return (s.inventoryGear||[]).filter(item=>{
    if(item.protected!==false||item.equipped||worn.some(w=>w.uid===item.uid)||item.rarity>=3)return false;
    const gear=gearForName(catalog,item.art||item.text);if(!gear)return false;
    if(gear.slot==='weapon'&&gear.fam&&gear.fam!==job.weapon)return true;
    if(item.better||gear.lv>level(s)||gear.line&&!job.line.includes(gear.line))return false;
    const current=gearForName(catalog,worn.find(w=>w.slot===gear.slot)?.text);
    if(!current||current.tier<gear.tier||current.lv<gear.lv)return false;
    if(gear.slot==='weapon')return true; // Live comparison decides options and refinement.
    if(/\+\d+/.test(item.text))return false;
    const keys=new Set([...Object.keys(gear.stats),...Object.keys(current.stats)]);
    return [...keys].every(k=>(gear.stats[k]||0)<=(current.stats[k]||0));
  });
}
function surplusDetail(catalog,s,worn,item,selected) {
  if(!surplusGear(catalog,s,worn).some(g=>g.uid===item.uid))return 'not proven surplus';
  const gear=gearForName(catalog,item.art||item.text),job=catalog.jobs[String(s.job).toLowerCase()];
  if(!selected.includes(gear.name)||!/(?:Refine|ตีบวก)\s*\+\d+\//i.test(selected))return 'unidentified detail';
  if(/🃏/u.test(selected))return 'installed card';
  if(gear.slot!=='weapon'){
    if(!/✦/u.test(selected))return null;
    const current=worn.find(w=>w.slot===gear.slot),own=gearForName(catalog,current?.text),heading=selected.split(/\r?\n/).find(l=>l.includes(gear.name))||'';
    const comparison=selected.split(/Compared with worn:|เทียบกับที่สวม:/i);
    if(!Number.isInteger(item.rarity)||item.rarity<0||item.rarity>=3||own?.id!==gear.id||
      Number(heading.match(/\[(\d+)\]/)?.[1]||0)>Number(current.text.match(/\[(\d+)\]/)?.[1]||0)||
      /Cooldown|Skill.*damage|vs[ .:]|damage taken|คูลดาวน์|เผ่า|ขนาด/i.test(selected)||comparison.length!==2||
      !/▼\s*Worse than worn|แย่กว่าที่สวมอยู่/i.test(comparison[1])||/▲/.test(comparison[1])||!/▼\s*[1-9]/.test(comparison[1]))return 'equipment with options';
    return null;
  }
  if(gear.fam!==job.weapon)return null;
  const own=worn.find(w=>w.slot==='weapon')?.text||'';
  const heading=selected.split(/\r?\n/).find(l=>l.includes(gear.name))||'';
  if(Number(heading.match(/\[(\d+)\]/)?.[1]||0)>Number(own.match(/\[(\d+)\]/)?.[1]||0))return 'additional card slots';
  const parts=selected.split(/Compared with worn:|เทียบกับที่สวม:/i),comparison=parts.at(-1);
  const primary=job.weapon==='staff'?'MATK':'ATK';
  if(parts.length<2||!/▼\s*Worse than worn|แย่กว่าที่สวมอยู่/i.test(comparison)||
    !new RegExp('\\b'+primary+'\\s*▼\\s*[1-9]\\d*').test(comparison))return 'not a verified inferior weapon';
  return null;
}
function storageDepositAllowed(catalog,s,control) {
  if(control.act==='stall')return false;
  if(control.act!=='stmove'||control.dir!=='in')return true;
  const item=s.storageGear?.find(g=>g.uid===control.uid&&g.dir==='in');
  const gear=catalog?.gear&&item&&gearForName(catalog,item.art||item.text);
  return !!gear&&gear.slot!=='weapon';
}
function storedSurplus(catalog,s,worn,entries=[]) {
  const job=catalog?.jobs?.[String(s.job||'').toLowerCase()];if(!job)return [];
  const current=gearForName(catalog,worn?.find(w=>w.slot==='weapon')?.text);
  return entries.filter(item=>{
    if(item.dir!=='out'||!item.uid||worn?.some(w=>w.uid===item.uid))return false;
    const gear=gearForName(catalog,item.art||item.text);
    return gear?.slot==='weapon'&&gear.fam&&(gear.fam!==job.weapon||current&&gear.lv<=level(s)&&gear.lv<=current.lv&&gear.tier<=current.tier);
  });
}
function storageNeedsScan(a,catalog,s,now) {
  const c=a.storageCleanup;
  return a.storageUsage?.[0]>0&&(!c||c.requestedAt||c.remaining>0||c.job!==s.job||c.fingerprint!==catalog?.fingerprint||now-c.checkedAt>6*60*MIN);
}
function commonLootSurplus(catalog,worn=[]) {
  if(!catalog?.gear?.length)return false;
  const tier=Math.max(...catalog.gear.map(g=>g.tier));
  return ['weapon','head','armor','cape','boots','shield','ring','amulet'].every(slot=>{
    const current=gearForName(catalog,worn.find(w=>w.slot===slot)?.text);
    return current?.tier===tier;
  });
}
function levelingTarget(catalog,mapId,state,maxGap=3) {
  const map=catalog?.maps.find(m=>m.id===mapId),lv=level(state),gap=Number.isInteger(maxGap)&&maxGap>=3&&maxGap<=5?maxGap:3;
  return (map?.monsters||[]).map(entry=>({...catalog.monsters.find(m=>m.id===entry.id),n:entry.n}))
    .filter(m=>m.id&&!m.boss&&m.n>=1&&m.hp>0&&m.exp>0&&m.lv<=lv+gap&&m.lv>=Math.max(1,lv-20))
    .sort((x,y)=>(y.exp/y.hp*y.n)-(x.exp/x.hp*x.n))[0]||null;
}
function progressionGoal(catalog,state,a,reserve) {
  if(!a.inventory||!catalog)return null;
  const job=catalog.jobs[String(state.job||'').toLowerCase()];if(!job)return null;
  const allowed=g=>g.lv<=level(state)&&(!g.jt||job.jobTier>=g.jt)&&(!g.line||job.line.includes(g.line))&&(!g.fam||g.slot!=='weapon'||g.fam===job.weapon);
  const own=a.worn.map(w=>({...w,gear:gearForName(catalog,w.text)})).filter(w=>w.gear);
  const upgrades=[];
  for(const w of own.sort((a,b)=>(a.slot==='weapon'?-1:0)-(b.slot==='weapon'?-1:0))) {
    const cost=w.gear.upgrade,target=catalog.gear.find(g=>g.id===cost?.to);
    if(target&&allowed(target))upgrades.push({kind:'upgrade',uid:w.uid,target:target.id,name:target.name,slot:w.slot,cost,
      missing:bottlenecks(cost,a.inventory.items,Math.max(0,(state.gold||0)-reserve))});
  }
  if(!a.wingPriority&&upgrades.some(g=>!g.missing.length))return upgrades.find(g=>!g.missing.length);
  // Craft a missing highest-tier slot once, rather than repeatedly rolling items already owned.
  const crafts=[];
  for(const slot of ['weapon','armor','head','shield','cape','boots','wing','ring','amulet']) {
    const current=own.find(w=>w.slot===slot)?.gear;
    const core=['matk','int','def','mdef','hp'];
    const candidates=catalog.gear.filter(g=>g.slot===slot&&g.craft&&allowed(g)&&(!current||g.tier>current.tier||g.tier===current.tier&&g.lv>current.lv&&
      core.every(k=>(g.stats[k]||0)>=(current.stats[k]||0))&&core.some(k=>(g.stats[k]||0)>(current.stats[k]||0))));
    const target=candidates.sort((a,b)=>b.tier-a.tier||b.lv-a.lv||(b.stats.matk||0)-(a.stats.matk||0))[0];
    if(!target||a.crafted[target.id]||a.inventory.gear.some(g=>gearForName(catalog,g.text+' '+g.art)?.id===target.id))continue;
    crafts.push({kind:'craft',target:target.id,name:target.name,slot,cost:target.craft,
      missing:bottlenecks(target.craft,a.inventory.items,Math.max(0,(state.gold||0)-reserve))});
  }
  const ready=crafts.filter(g=>!g.missing.length);
  if(a.wingPriority&&crafts.some(g=>g.slot==='wing'))return crafts.find(g=>g.slot==='wing');
  return (a.powerProgression&&ready.find(g=>g.slot==='wing'))||ready[0]||
    (a.powerProgression&&crafts.find(g=>g.slot==='wing'))||upgrades[0]||crafts[0]||null;
}
function update(mem,state,catalog,now=Date.now(),reserve=100000) {
  const a=init(mem);if(!state.name)return a;
  a.resourceHold=Progression.updateBracket(mem,state,catalog,now);
  if(a.farm?.trial&&(state.dead||state.hp&&state.hp[0]/state.hp[1]<0.4))a.farm.abort=true;
  if(a.trip&&now-a.trip.at<5*MIN&&a.blocked==='Town trip timed out')a.blocked=null;
  a.cap=resolveCap(state,catalog);a.zone=state.zone;a.crystals=state.crystals;a.gold=state.gold;
  if(state.panel==='bag'&&state.inventoryComplete) {
    a.inventory={at:now,items:{...state.inventoryItems},gear:state.inventoryGear||[],usage:state.bagUsage};
    if(state.bagUsage)a.bagUsage=state.bagUsage;
  }
  if(state.panel==='equip'&&state.worn?.length)a.worn=state.worn.map(x=>({...x}));
  if(state.panel==='storage'&&state.storageUsage)a.storageUsage=state.storageUsage;
  if(state.panel==='cbt'&&state.cbtClaimed!=null)a.cbt={claimed:state.cbtClaimed,at:now};
  if(!catalog)return a;
  const inTown=catalog.maps.some(m=>m.town&&norm(m.name)===norm(state.zone));
  if(inTown&&!a.townVisit?.active)a.townVisit={active:true,arrivedAt:now};
  else if(!inTown&&a.townVisit?.active)a.townVisit.active=false;
  a.goal=progressionGoal(catalog,state,a,reserve);
  const need=a.goal?.cost?.mats||{},owned=a.inventory?.items||{};
  const total=Object.values(need).reduce((s,n)=>s+n,0),have=Object.entries(need).reduce((s,[id,n])=>s+Math.min(n,owned[id]||0),0);
  a.craftProgress=total?Math.floor(have/total*100):null;
  a.mode=a.trip?'town-service':a.resourceHold?.active?'pre-bracket-stockpiling':a.levelingFocus&&!a.cap.atCap?'leveling':a.goal?.missing?.length?'farm-materials':a.goal?'craft-upgrade':a.cap.atCap&&a.gearCapped?'stockpiling':a.cap.atCap?'endgame-forge':'leveling';
  const cumulative=lv=>Array.from({length:Math.max(0,lv-1)},(_,i)=>catalog.expByLevel?.[i+1]||0).reduce((s,n)=>s+n,0);
  const active=!a.trip&&!state.panelOpen&&!state.menuOpen&&!state.mapOpen&&!state.dead&&(!mem.uiHealth?.safeIdle)&&(/\bon\b/.test(state.autoHunt||'')||state.autoQuestRunning);
  const absolute=state.exp==null?null:cumulative(level(state))+(state.exp/100)*(catalog.expByLevel?.[level(state)]||0);
  if(!active){a.expSample=null;return a;}
  if(absolute!=null&&a.expSample&&norm(a.expSample.zone)===norm(state.zone)&&now-a.expSample.at>=MIN) {
    const elapsed=(now-a.expSample.at)/MIN,delta=absolute-a.expSample.value;
    if(delta>=0) {
      a.expPerMinute=Math.round(delta/elapsed);a.expRateAt=now;a.expRateZone=state.zone;const map=catalog.maps.find(m=>norm(m.name)===norm(state.zone));
      if(map){const old=a.farmRates[map.id],target=a.farm?.map===map.id?a.farm.target||null:null,fresh=old&&now-old.at<30*MIN&&(old.target||null)===target;
        a.farmRates[map.id]={expPerMinute:fresh?Math.round((old.expPerMinute+a.expPerMinute)/2):a.expPerMinute,
          minutes:(fresh?old.minutes||0:0)+elapsed,level:level(state),target,at:now};}
    }
    a.expSample={value:absolute,at:now,zone:state.zone};
  } else if(absolute!=null&&(!a.expSample||norm(a.expSample.zone)!==norm(state.zone)))a.expSample={value:absolute,at:now,zone:state.zone};
  return a;
}
function chooseTask(mem,s,catalog,now=Date.now(),policy={}) {
  if(!policy.enabled||mem.uiHealth?.safeIdle||!s.name||s.dead||!s.hp)return null;
  const a=init(mem),due=(k,ms)=>now-(a.last[k]||0)>ms&&now-(a.failures?.[k]||0)>120000;
  a.levelingFocus=!!policy.levelingFocus&&!a.cap?.atCap;
  a.powerProgression=!!policy.powerProgression;
  a.wingPriority=!!policy.wingPriority;
  policy={...policy,levelingFocus:a.levelingFocus};
  if(s.hp[0]/s.hp[1]<0.3)return s.hpPotions===0?(a.trip?'town':'town_rest'):null;
  if(!catalog)return null; // Keep the existing UI policy running during catalog outages.
  if(!a.cbt&&s.controls.some(c=>c.id==='cbtPill'))return 'cbt';
  const premiumReady=!['reserved','unknown'].includes(a.purchase?.status);
  if(!policy.sellSurplus&&premiumReady&&a.storageUsage&&a.storageUsage[0]>=a.storageUsage[1]-2&&a.premium.reserved<policy.crystalBudget&&due('capacity',10*MIN))return 'capacity';
  if(a.trip)return 'town';
  if(a.resume)return 'autonomy_wait';
  if(policy.sellSurplus&&catalog.maps.some(m=>m.town&&norm(m.name)===norm(s.zone))&&
    (!a.townVisit?.active||!a.townVisit.servicedAt))return 'town_shop';
  if(!policy.levelingFocus&&a.resourceHold?.active&&a.farm&&!a.farm.trial&&a.goal?.slot!=='weapon')return 'finish_farm';
  if(a.farm?.trial&&(a.farm.abort||s.hp[0]/s.hp[1]<0.4||(mem.deaths||[]).some(t=>t>=a.farm.started)))return 'finish_farm';
  if(a.farm?.trial&&now-a.farm.started>3*MIN) {
    const rate=a.farmRates[a.farm.map];
    if(rate?.at>a.farm.started&&rate.minutes>=2&&rate.expPerMinute<a.farm.baseline*0.9)return 'finish_farm';
  }
  if(a.farm&&now-a.farm.started>(policy.levelingFocus&&!a.farm.trial?30:10)*MIN)return 'finish_farm';
  if(due('inventory',a.bagUsage&&a.bagUsage[0]>=a.bagUsage[1]*0.85?MIN:5*MIN))return 'inventory';
  if(due('equipment',10*MIN))return 'equipment';
  if(a.bagUsage&&a.bagUsage[0]>=Math.floor(a.bagUsage[1]*DNA.profile(mem).bagReturnThreshold)) {
    if(!policy.sellSurplus&&a.bagUsage[0]>=Math.floor(a.bagUsage[1]*0.95)&&premiumReady&&a.premium.reserved<policy.crystalBudget&&due('capacity',10*MIN))return 'capacity';
    return due(policy.sellSurplus?'town_shop':'town_storage',5*MIN)?(policy.sellSurplus?'town_shop':'town_storage'):a.farm?'autonomy_wait':null;
  }
  if(policy.sellSurplus&&storageNeedsScan(a,catalog,s,now)&&a.bagUsage&&a.bagUsage[0]<=a.bagUsage[1]-14&&(a.storageCleanup?.requestedAt||due('town_shop',20*MIN)))return 'town_shop';
  if(policy.sellSurplus&&a.inventory&&surplusGear(catalog,{...s,inventoryComplete:true,inventoryGear:a.inventory.gear},a.worn).length>=30&&due('town_shop',20*MIN))return 'town_shop';
  if((s.hpPotions!=null&&s.hpPotions<=10)||(s.mpPotions!=null&&s.mpPotions<=10))return due('town_shop',5*MIN)?'town_shop':null;
  if(a.wingPriority&&a.goal?.slot==='wing'&&a.goal.missing?.length&&a.goal.missing.every(m=>m.id==='sigil_ore')&&due('forge',MIN))return 'town_forge';
  if(a.goal&&!a.goal.missing.length&&(policy.powerProgression||!policy.levelingFocus||a.goal.slot==='weapon')&&(!a.resourceHold?.active||a.goal.slot==='weapon'||a.wingPriority&&a.goal.slot==='wing')&&due('forge',MIN))return 'town_forge';
  if((policy.powerProgression||!policy.levelingFocus)&&!a.resourceHold?.active&&due('forge',policy.powerProgression?30*MIN:15*MIN))return 'town_forge';
  if((policy.levelingFocus||a.goal?.missing?.length||a.cap?.atCap)&&(policy.levelingFocus||!a.resourceHold?.active||a.goal?.slot==='weapon')&&!a.farm&&due('farm',10*MIN))return 'farm';
  if(!a.farm&&!s.jobQuestProgress&&due('farm',20*MIN)&&trialOption(mem,s,catalog,now,policy))return 'farm_trial';
  if(a.farm)return 'autonomy_wait';
  return null;
}

function trialOption(mem,s,catalog,now=Date.now(),policy={}) {
  const a=init(mem),ttk=mem.combatTelemetry?.current;
  if(mem.uiHealth?.safeIdle||a.trip||s.hp?.[0]/s.hp?.[1]<0.75||!Number.isFinite(s.hpPotions)||!Number.isFinite(s.mpPotions)||s.hpPotions<20||s.mpPotions<20||
    !ttk||norm(ttk.zone)!==norm(s.zone)||now-ttk.at>10000||ttk.count<5||ttk.medianSeconds>DNA.profile(mem).ttkToleranceSec)return null;
  const missing=policy.levelingFocus&&!a.cap?.atCap?[]:a.goal?.missing?.filter(m=>m.id!=='gold')||[];
  const options=farmOptions(catalog,s,missing,a.farmRates).filter(m=>!mem.dna?.avoidMaps?.includes(m.id)),current=options.find(m=>norm(m.name)===norm(s.zone));
  const rate=current&&a.farmRates[current.id];
  if(!rate||now-rate.at>5*MIN||rate.minutes<2||rate.expPerMinute<=0)return null;
  const next=options.filter(m=>m.id!==current.id&&m.monsterLevel>current.monsterLevel&&m.monsterLevel<=current.monsterLevel+5&&
    (!a.farmTrials?.[m.id]||now-a.farmTrials[m.id].at>60*MIN)).sort((x,y)=>x.monsterLevel-y.monsterLevel)[0];
  return next?{...next,baseline:rate.expPerMinute}:null;
}

function createController({mem,observe,click,key,scroll,open,close,sleep,save,log,getCatalog,policy,developAtSmith,now=Date.now}) {
  let actions=0;
  const a=init(mem);
  const leveling=()=>!!policy.levelingFocus&&!a.cap?.atCap;
  const targetFor=(map,s)=>levelingTarget(getCatalog(),map,s,policy.levelingMaxGap);
  async function state(){const s=await observe();update(mem,s,getCatalog(),now(),policy.goldReserve);return s;}
  async function pick(pred,optional=false) {
    if(++actions>9)throw Error('autonomy action budget exceeded');
    let s=await state(),matches=s.controls.filter(pred);
    if(!matches.length&&scroll){const hidden=(s.offscreen||[]).filter(pred);if(hidden.length===1){await scroll(hidden[0]);await sleep(300);s=await state();matches=s.controls.filter(pred);}}
    if(matches.length!==1){if(optional)return false;throw Error('observed control missing or ambiguous');}
    await click(matches[0]);await sleep(900);return true;
  }
  async function travel(id) {
    await close();await key('m');await sleep(500);
    await pick(c=>c.bm==='world');await pick(c=>c.wm===id);await pick(c=>c.go===id);
  }
  function returnPoint(s) {
    return getCatalog().maps.find(m=>!m.town&&norm(m.name)===norm(s.zone))?.id||a.farm?.map||a.returnMap||null;
  }
  async function beginTrip(kind,s) {
    a.trip={kind,returnMap:returnPoint(s),returnMode:leveling()&&a.farm?'farm':s.autoQuestMode||a.farm?.returnMode||'mq',at:now(),phase:'town'};save();
    await pick(c=>c.aq==='stop',true);
    if(/\bon\b/.test((await state()).autoHunt||''))await pick(c=>c.id==='autoBtn');
    if(!getCatalog().maps.some(m=>m.town&&norm(m.name)===norm(s.zone))) {
      if(!await pick(c=>c.id==='potTp',true))await travel('town');
    }
  }
  async function farmProfile(s) {
    if(!leveling())return;
    const f=a.farm,target=targetFor(f.map,s);
    if(!target)throw Error('No verified normal leveling target');
    await open('auto');await pick(c=>c.act==='atab'&&c.key==='hunt');
    for(const [k,v] of [['target',target.id],['prio','near']]) {
      let read=await state();
      if(![...read.controls,...(read.offscreen||[])].some(c=>c.act==='aopt'&&c.k===k&&c.v===v&&c.on))await pick(c=>c.act==='aopt'&&c.k===k&&c.v===v&&!c.on);
      read=await state();
      if([...read.controls,...(read.offscreen||[])].filter(c=>c.act==='aopt'&&c.k===k&&c.v===v&&c.on).length!==1)throw Error('Leveling hunt profile not confirmed');
    }
    if(policy.sellSurplus) {
      await pick(c=>c.act==='atab'&&c.key==='loot');
      const desired=commonLootSurplus(getCatalog(),a.worn),current=await state();
      const choices=[...current.controls,...(current.offscreen||[])].filter(c=>c.act==='asellr'&&c.v==='1');
      // No pass / missing UI means no change. Never auto-sell rarities 0 or 2+ here.
      if(choices.length===1&&choices[0].on!==desired)await pick(c=>c.act==='asellr'&&c.v==='1');
      const checked=await state(),choice=[...checked.controls,...(checked.offscreen||[])].filter(c=>c.act==='asellr'&&c.v==='1');
      if(choice.length===1&&choice[0].on!==desired)throw Error('Common loot sale profile not confirmed');
      a.commonLootSales={enabled:choice.length===1&&choice[0].on,at:now(),reason:desired?'all eight slots at catalog maximum tier':'higher-tier progression remains'};
    }
    await close();f.target=target.id;f.pendingProfile=false;
  }
  async function resume(trip) {
    await close();
    const current=await state();
    if(a.wingPriority&&a.goal?.slot==='wing'&&a.goal.missing?.some(m=>!['gold','sigil_ore'].includes(m.id))&&
      getCatalog().maps.some(m=>m.town&&norm(m.name)===norm(current.zone))&&current.hp?.[0]/current.hp?.[1]>=0.85&&current.hpPotions>=20&&current.mpPotions>=20){
      a.returnMap=trip.returnMap||a.returnMap;a.farm=null;a.resume=null;a.trip=null;
      if(trip.salesDone&&a.townVisit)a.townVisit.servicedAt=now();save();return;
    }
    if(trip.returnMap)await travel(trip.returnMap);
    if(trip.salesDone&&a.townVisit)a.townVisit.servicedAt=now();
    a.farm=null;a.resume={map:trip.returnMap,mode:trip.returnMode,at:now()};a.trip=null;save();
  }
  async function buyCapacity() {
    const s=await state();
    const desired=a.storageUsage&&a.storageUsage[0]>=a.storageUsage[1]-2?'store':'bag';
    const row=(s.premiumRows||[]).find(r=>r.id===desired&&!r.disabled&&r.price>0&&r.price<=s.crystals&&r.price+a.premium.reserved<=policy.crystalBudget);
    if(!row)return false;
    if(desired==='bag'&&(!a.bagUsage||a.bagUsage[0]<Math.floor(a.bagUsage[1]*0.95)))return false;
    a.purchase={id:row.id,price:row.price,before:s.crystals,ownedBefore:row.owned,status:'reserved',at:now()};
    a.premium.reserved+=row.price;save(); // Reserve before the irreversible click; survives an ambiguous/crashed request.
    try {
      await pick(c=>c.act==='crbuy'&&c.key===row.id);
      const confirm=await state();
      if(!/purchase|buy|ซื้อ/i.test(confirm.modalText)||!confirm.modalText.includes(String(row.price)))throw Error('premium confirmation changed');
      await pick(c=>/^Buy$|^ซื้อ$/.test(c.label));await sleep(1000);
      const after=await state(),owned=after.premiumRows?.find(r=>r.id===row.id)?.owned;
      if(after.crystals!==s.crystals-row.price||owned==null||owned<=row.owned)throw Error('premium outcome is ambiguous; reservation retained');
      a.purchase.status='confirmed';a.premium.spent+=row.price;event(a,'capacity_bought',{id:row.id,cost:row.price});save();
      a.last.inventory=0;
      if(desired==='store')a.storageUsage=null;
      return true;
    } catch(e){
      // This internal error is raised by gate() before dispatching input, including
      // a confirmation click. Closing the modal cancels it without spending.
      if(e.code==='ACTION_BUDGET') {a.purchase.status='cancelled-before-input';a.premium.reserved-=row.price;}
      else {a.purchase.status='unknown';a.blocked='Capacity purchase outcome uncertain; reserved budget retained';}
      save();throw e;
    }
  }
  async function forge(s) {
    const goal=a.goal,catalog=getCatalog();
    if(policy.powerProgression&&!a.trip?.advancedChecked){
      if(a.trip)a.trip.advancedChecked=true;
      for(const [tab,act] of [['grade','sgrade'],['star','wstar']]){
        await pick(c=>c.act==='smtab'&&c.key===tab);const live=await state();
        const row=live.smithRows.find(r=>r.act===act&&!r.disabled&&a.worn.some(w=>w.uid===r.key)&&r.gold>0&&live.gold-r.gold>=policy.goldReserve&&r.gold<=150000-(a.trip?.powerSpent||0)&&r.mats.length&&r.mats.every(m=>m.have!=null&&m.need!=null&&m.have>=m.need));
        if(row){await pick(c=>c.act===act&&c.key===row.key);await sleep(900);const after=await state();
          if(after.gold!==live.gold-row.gold)throw Error('Advanced forge debit not acknowledged');
          const next=after.smithRows.find(r=>r.act===act&&r.key===row.key);
          if(!next||act==='wstar'&&next.text===row.text)throw Error('Advanced forge outcome not observed');
          a.advancedForge={at:now(),kind:tab,name:row.name,changed:next.text!==row.text};a.last.equipment=0;return true;
        }
      }
      s=await state();
    }
    if(goal&&!goal.missing.length&&(!a.resourceHold?.active||goal.slot==='weapon'||goal.slot==='wing'&&a.wingPriority)) {
      await pick(c=>c.act==='smtab'&&c.key===(goal.kind==='upgrade'?'up':'craft'));
      if(goal.kind==='craft') {
        const g=catalog.gear.find(g=>g.id===goal.target);
        if(g.slot==='wing')await pick(c=>c.act==='smwing'&&!c.on,true);
        else if(g.line)await pick(c=>c.act==='smline'&&!c.on,true);
        else await pick(c=>c.act==='smtier'&&c.key===String(g.tier));
      }
      let live=await state();const row=live.smithRows.find(r=>r.act===(goal.kind==='upgrade'?'upg':'craft')&&r.key===(goal.uid||goal.target));
      if(!row||row.disabled||row.gold==null||live.gold-row.gold<policy.goldReserve)throw Error('live recipe unavailable or reserve would be crossed');
      // Catalog is advisory. Every current material row must independently show sufficient resources.
      if(!row.mats.length||row.mats.some(m=>m.have==null||m.need==null||m.have<m.need))throw Error('live material quantities not confirmed');
      await pick(c=>c.act===row.act&&c.key===row.key);await sleep(1300);live=await state();
      if(!norm(live.forgeResult).includes(norm(goal.name))||live.gold!==s.gold-row.gold)throw Error('craft/upgrade acknowledgement or gold debit not confirmed');
      a.crafted[goal.target]={at:now()};a.last.equipment=0;a.last.inventory=0;
      if(goal.slot==='wing'){a.wingCraft={target:goal.target,name:goal.name,at:now(),status:'crafted'};save();}
      else{if(policy.powerProgression)a.gearPending=true;
        event(a,'gear_crafted',{name:goal.name,kind:goal.kind,topTier:catalog.gear.filter(g=>g.slot===goal.slot).every(g=>g.tier<=catalog.gear.find(x=>x.id===goal.target).tier)});}
      return true;
    }
    await pick(c=>c.act==='smtab'&&c.key==='refine');s=await state();
    const rows=s.smithRows.filter(r=>r.act==='refine'&&(r.worn||a.worn.some(w=>w.uid===r.key)));
    a.gearCapped=rows.length>=a.worn.length&&a.worn.length>=8&&rows.every(r=>r.max);
    const row=refineCandidates(catalog,s,a.worn,rows.filter(r=>!r.disabled&&!r.max&&r.refine!=null&&(!a.resourceHold?.active||a.worn.some(w=>w.uid===r.key&&w.slot==='weapon'))))[0];
    const reserve=wingReserve(a,policy.goldReserve),oreReserve=a.wingPriority&&goal?.slot==='wing'?(goal.cost?.mats?.sigil_ore||0):0;
    if(oreReserve&&(a.inventory?.items?.sigil_ore||0)<oreReserve){
      await pick(c=>c.act==='smtab'&&c.key==='buy');const shop=await state(),ore=shop.smithRows.find(r=>r.act==='buy'&&r.key==='sigil_ore'),unit=Number(ore?.text?.replace(/,/g,'').match(/(\d+)\s*G\b/)?.[1]);
      if(unit>0&&shop.gold-unit*10>=reserve){
        const stock=a.inventory?.items?.sigil_ore||0;await pick(c=>c.act==='buy'&&c.key==='sigil_ore'&&c.amount==='10');
        if((await state()).gold!==shop.gold-unit*10)throw Error('Reserved wing ore debit not acknowledged');
        await open('bag');await pick(c=>c.act==='ifilter'&&c.key==='all'&&!c.on,true);const bag=await state();
        if(!bag.inventoryComplete||(bag.inventoryItems.sigil_ore||0)<stock+10)throw Error('Reserved wing ore quantity not acknowledged');
        return true;
      }return false;
    }
    if(oreReserve&&(a.inventory?.items?.sigil_ore||0)<oreReserve+(row?.refine>=catalog.refineSafe?2:1))return false;
    if(!row){
      if(policy.powerProgression&&rows.some(r=>!r.max)&&s.gold-reserve>10000){
        await pick(c=>c.act==='smtab'&&c.key==='buy');const shop=await state();
        const ore=shop.smithRows.find(r=>r.act==='buy'&&r.key==='sigil_ore'),unit=Number(ore?.text?.replace(/,/g,'').match(/(\d+)\s*G\b/)?.[1]);
        if(unit>0&&shop.gold-unit*10>=reserve){
          const before=shop.gold;await pick(c=>c.act==='buy'&&c.key==='sigil_ore'&&c.amount==='10');
          if((await state()).gold!==before-unit*10)throw Error('Forge ore purchase not acknowledged');return true;
        }
      }
      return false;
    }
    const fee=Number(row.costText.replace(/,/g,'').match(/\d+/)?.[0]);
    if(!fee)throw Error('refine fee not confirmed');
    if(s.gold-fee<reserve)return false;
    if(policy.powerProgression&&fee>150000-(a.trip?.powerSpent||0))return false;
    if(row.refine>=(catalog.refineSafe??0)&&row.chance!==100&&!/Guardian Stone.*(?:stay|เดิม)|(?:stay|เดิม).*Guardian Stone/i.test(row.risk)) {
      if(await pick(c=>c.act==='smguard'&&!c.on,true))return true;
      if(policy.powerProgression){
        await pick(c=>c.act==='smtab'&&c.key==='buy');const shop=await state(),stone=shop.smithRows.find(r=>r.act==='buy'&&r.key==='guardian_stone'),unit=Number(stone?.text?.replace(/,/g,'').match(/(\d+)\s*G\b/)?.[1]);
        if(unit>0&&shop.gold-unit*10>=reserve&&unit*10<=150000-(a.trip?.powerSpent||0)){
          await pick(c=>c.act==='buy'&&c.key==='guardian_stone'&&c.amount==='10');if((await state()).gold!==shop.gold-unit*10)throw Error('Guardian purchase not acknowledged');return true;
        }
      }
      a.blocked='Guardian Stone protection required';return false;
    }
    await pick(c=>c.act==='refine'&&c.key===row.key);
    let after=await state();
    if(after.modalText) {
      if(!/refine|ตีบวก/i.test(after.modalText)||/drop to|ลดเหลือ/i.test(after.modalText))throw Error('unprotected refine rejected');
      await pick(c=>/^Refine(?: now| anyway)?$|^Confirm$|^ตีบวก(?:เลย)?$|^ยืนยัน$/i.test(c.label));await sleep(900);after=await state();
    }
    const next=after.smithRows.find(r=>r.key===row.key&&r.act==='refine');
    if(!next||after.gold!==s.gold-fee||!next.max&&![row.refine,row.refine+1].includes(next.refine)||!after.forgeResult&&!/failed|ล้มเหลว/i.test(after.panelText))throw Error('refine outcome not observed');
    a.refine={at:now(),name:row.name,from:row.refine,to:next.max?catalog.refineMax:next.refine,cap:catalog.refineMax};
    if(policy.powerProgression)a.last.equipment=0;
    if(next.max)event(a,'refine_max',{name:row.name,cap:catalog.refineMax});
    return true;
  }
  async function settleSale(intent,trip) {
    for(let attempt=0;attempt<5;attempt++) {
      const after=await state();
      if(after.inventoryComplete&&Number.isFinite(intent.gold)&&Number.isFinite(intent.price)&&
        !after.inventoryGear.some(g=>g.uid===intent.uid)&&after.gold===intent.gold+intent.price) {
        intent.status='confirmed';a.sales ||= {count:0,gold:0,history:[]};
        a.sales.count++;a.sales.gold+=intent.price;
        if(intent.source==='storage'){a.sales.storageCount=(a.sales.storageCount||0)+1;a.sales.storageGold=(a.sales.storageGold||0)+intent.price;}
        a.sales.history.push({name:intent.name,price:intent.price,source:intent.source||'bag',at:now()});
        if(a.storageOrigins)delete a.storageOrigins[intent.uid];a.sales.history=a.sales.history.slice(-30);
        trip.sales=(trip.sales||0)+1;trip.progressAt=now();save();return true;
      }
      if(attempt<4)await sleep(900); // Settlement only: no repeated input.
    }
    intent.status='uncertain';save();return false;
  }
  async function sellSurplus(trip) {
    await open('bag');await pick(c=>c.act==='ifilter'&&c.key==='all'&&!c.on,true);
    if(['uncertain','confirming'].includes(a.saleIntent?.status)&&!await settleSale(a.saleIntent,trip))throw Error('Uncertain sale requires review');
    for(let i=0;i<2;i++) {
      if(actions>6)return; // Leave room for select, dialog and confirmation this slice.
      const before=await state();if(before.inventoryComplete!==true)throw Error('Complete inventory required before surplus inspection');
      const isWeapon=g=>gearForName(getCatalog(),g.art||g.text)?.slot==='weapon';
      const inspectionLimit=a.wingPriority&&a.goal?.slot==='wing'&&a.bagUsage?.[0]<=a.bagUsage?.[1]-3?4:8;
      const item=surplusGear(getCatalog(),before,a.worn)
        .sort((x,y)=>Number(isWeapon(y))-Number(isWeapon(x))||Number(!!a.storageOrigins?.[y.uid])-Number(!!a.storageOrigins?.[x.uid])||(x.rarity??99)-(y.rarity??99))
        .find(g=>!trip.keepUIDs?.includes(g.uid)&&(isWeapon(g)||(trip.secondaryInspections||0)<inspectionLimit));
      if(!item){trip.salesDone=true;trip.progressAt=now();save();return;}
      await pick(c=>c.act==='isel'&&c.key==='g:'+item.uid);
      if(!isWeapon(item))trip.secondaryInspections=(trip.secondaryInspections||0)+1;
      const detail=await state(),gear=gearForName(getCatalog(),item.art||item.text);
      // Read only the selected detail, not unrelated equipped statistics.
      const selected=detail.panelText.split(/In Bag|ในกระเป๋า/i).at(-1);
      const sale=detail.controls.concat(detail.offscreen||[]).filter(c=>c.act==='isellg'&&c.key===item.uid);
      const price=sale.length===1?Number(sale[0].label.replace(/,/g,'').match(/^(?:Sell|ขาย)\s+(\d+)\s*G$/i)?.[1]):0;
      const reason=surplusDetail(getCatalog(),detail,a.worn,item,selected)||(!price?'sale price unavailable':null);
      if(reason){(trip.keepUIDs ||= []).push(item.uid);(trip.keepReasons ||= {})[item.uid]=reason;trip.progressAt=now();save();continue;}
      await pick(c=>c.act==='isellg'&&c.key===item.uid);
      const confirm=await state();
      if(!/Sell (?:gear|equipment)|ขายอุปกรณ์/i.test(confirm.modalText)||!confirm.modalText.includes(gear.name)||
        Number(confirm.modalText.replace(/,/g,'').match(/(\d+)\s*G\b/)?.[1])!==price||/🃏/u.test(confirm.modalText))throw Error('Sale confirmation changed');
      // No retry after ambiguous confirmation. Persist before the irreversible input.
      a.saleIntent={uid:item.uid,name:gear.name,price,source:a.storageOrigins?.[item.uid]?'storage':'bag',gold:before.gold,at:now(),status:'confirming'};save();
      try{await pick(c=>/^(Sell|ขาย)$/.test(c.label));}
      catch(e){a.saleIntent.status=e.code==='ACTION_BUDGET'||e.message==='autonomy action budget exceeded'?'cancelled-before-input':'uncertain';save();throw e;}
      if(!await settleSale(a.saleIntent,trip))throw Error('Sale outcome uncertain');
    }
  }
  async function finishWing(){
    const w=a.wingCraft;if(!w||w.status==='equipped')return false;
    await open('bag');await pick(c=>c.act==='ifilter'&&c.key==='all'&&!c.on,true);let s=await state();
    const candidates=s.inventoryGear.filter(g=>gearForName(getCatalog(),g.art||g.text)?.id===w.target);
    const worn=s.worn?.find(g=>g.slot==='wing');
    if(!w.uid){if(candidates.length!==1)throw Error('Crafted wing is not uniquely identified');w.uid=candidates[0].uid;}
    if(worn?.uid!==w.uid){
      if(!w.before){const snap=combatSnapshot(s,now());if(!snap)throw Error('Wing power baseline unavailable');w.before=snap;w.otherWorn=s.worn.filter(g=>g.slot!=='wing').map(g=>g.uid).sort();save();}
      await pick(c=>c.act==='isel'&&c.key==='g:'+w.uid);await pick(c=>c.act==='iequip'&&c.key===w.uid);
    }
    await open('equip');s=await state();
    if(!s.worn?.some(g=>g.slot==='wing'&&g.uid===w.uid))throw Error('Wing equip not acknowledged');
    const after=combatSnapshot(s,now());if(!after)throw Error('Wing final power unavailable');
    const comparable=w.before?.character===after.character&&w.before.level===after.level&&JSON.stringify(w.otherWorn)===JSON.stringify(s.worn.filter(g=>g.slot!=='wing').map(g=>g.uid).sort());
    w.after=after;w.delta=comparable?after.power-w.before.power:null;w.status='equipped';w.completedAt=now();
    event(a,'wing_completed',{name:w.name,before:w.before?.power??null,after:after.power,delta:w.delta,uid:w.uid});save();return true;
  }
  async function town(s) {
    const trip=a.trip;
    if(a.wingCraft&&a.wingCraft.status!=='equipped'){await finishWing();trip.progressAt=now();return;}
    const townMap=getCatalog().maps.find(m=>m.town&&norm(m.name)===norm(s.zone));
    if(policy.sellSurplus&&trip.salePolicyVersion!==2){trip.salePolicyVersion=2;trip.salesDone=false;delete trip.keepUIDs;delete trip.keepReasons;}
    if(townMap&&policy.sellSurplus&&trip.phase!=='return'&&['uncertain','confirming'].includes(a.saleIntent?.status)) {
      await open('bag');await pick(c=>c.act==='ifilter'&&c.key==='all'&&!c.on,true);
      if(!await settleSale(a.saleIntent,trip)){a.blocked='Uncertain sale requires review';trip.phase='return';return;}
      await close();s=await state();
    }
    if(now()-(trip.hygiene?.started||trip.progressAt||trip.at)>5*MIN){a.blocked='Town trip timed out';await resume(trip);return;}
    if(!townMap){
      // A Return Scroll uses the saved home, which may be a field rather than a town.
      if(!trip.townTravelAt||now()-trip.townTravelAt>90000){
        const towns=getCatalog().maps.filter(m=>m.town);if(towns.length!==1)throw Error('No unique verified town route');
        trip.townTravelAt=now();save();await travel(towns[0].id);
      }
      return;
    }
    if(trip.kind==='capacity'){
      if(!['reserved','unknown'].includes(a.purchase?.status)){
        await open('prem');await pick(c=>c.act==='crtab'&&c.key==='shop');await buyCapacity();
        await open('bag');await pick(c=>c.act==='ifilter'&&c.key==='all'&&!c.on,true);await state();
      }
      trip.capacityServiced=true;trip.kind='shop';trip.progressAt=now();return;
    }
    if(trip.phase==='return'){
      if(policy.sellSurplus&&trip.salesDone!==true){trip.kind='shop';trip.phase='town';trip.progressAt=now();save();return;}
      if(Hygiene.due(mem,now(),policy.sessionRefreshHours||6)&&!trip.hygiene?.failed) {
        const h=trip.hygiene ||= {started:now(),shopAttempts:0};
        if(h.ready&&now()-h.readyAt<90000)return; // agent refreshes only after independent safety checks
        if(h.ready){h.failed=true;mem.sessionHygiene.deferred='Refresh safety checks did not pass';}
        else {
          await open('bag');await pick(c=>c.act==='ifilter'&&c.key==='all'&&!c.on,true);const bag=await state();
          if(!bag.inventoryComplete||!bag.bagUsage)throw Error('Pre-refresh inventory not verified');
          h.bagUsage=bag.bagUsage;
          if(bag.bagUsage[0]>=Math.floor(bag.bagUsage[1]*0.95)) {
            if(!policy.sellSurplus&&!h.storageTried){h.storageTried=true;trip.kind='storage';trip.phase='town';return;}
            h.failed=true;mem.sessionHygiene.deferred='Bag could not be safely serviced';
          }else if(bag.hpPotions<20||bag.mpPotions<20||bag.hpPotions==null||bag.mpPotions==null) {
            if(h.shopAttempts++<3){trip.kind='shop';trip.phase='town';return;}
            h.failed=true;mem.sessionHygiene.deferred='Potion replenishment not verified';
          }else {h.ready=true;h.readyAt=now();save();return;}
        }
      }
      await resume(trip);return;
    }
    if(policy.sellSurplus&&trip.kind==='storage'){trip.kind='shop';trip.salesDone=false;}
    if(policy.sellSurplus&&!a.wingPriority&&trip.kind==='shop'&&!trip.storageScanned&&a.bagUsage?.[0]<=a.bagUsage?.[1]-14&&storageNeedsScan(a,getCatalog(),s,now())&&
      (!policy.powerProgression||a.storageCleanup?.requestedAt||trip.forgeServiced||now()-(a.last.forge||0)<=30*MIN))trip.kind='liquidate';
    const panel={forge:'smith',storage:'storage',liquidate:'storage',shop:'shop',rest:'church'}[trip.kind];
    if(s.panel!==panel) {
      const names={smith:/Talk to (?:Blacksmith|Smith)|คุย.*(?:ช่างตีเหล็ก|ตีบวก)/i,storage:/Talk to Storage|คุย.*คลัง/i,shop:/Talk to Shop|คุย.*ร้านขาย/i,church:/Talk to (?:Cathedral|Church)|คุย.*(?:โบสถ์|มหาวิหาร)/i};
      const talk=c=>c.id==='interactBtn'&&names[panel]?.test(c.label);
      if(!s.controls.some(talk)) {
        await close();await key('m');await sleep(400);await pick(c=>c.bm==='here',true);
        await pick(c=>c.place==='n:'+panel);s=await state();
      }
      if(s.panel!==panel&&s.controls.some(talk)) {
        await pick(talk);s=await state();
        for(let i=0;i<3&&s.panel!==panel;i++){await sleep(500);s=await state();}
      }
      if(s.panel!==panel)return;
    }
    if(trip.serviceReached!==trip.kind){trip.serviceReached=trip.kind;trip.progressAt=now();}
    if(trip.kind==='forge'){
      if(policy.powerProgression&&!trip.runesServiced&&developAtSmith&&mem.development?.runeSmithNeeded){
        trip.runesServiced=true;await developAtSmith();trip.progressAt=now();return;
      }
      for(let step=0;step<(policy.powerProgression?2:1);step++){
        const live=await state(),before=live.gold,changed=await forge(live);
        if(policy.powerProgression&&changed){
          trip.powerActions=(trip.powerActions||0)+1;trip.powerSpent=(trip.powerSpent||0)+Math.max(0,before-(await state()).gold);trip.progressAt=now();
          if(trip.powerActions<(a.wingPriority&&a.goal?.slot==='wing'&&a.goal.missing.length?4:12)&&trip.powerSpent<150000){
            if(step===0&&actions<=5&&!a.gearPending)continue;
            return;
          }
        }
        break;
      }
      trip.forgeServiced=true;
      if(policy.powerProgression){await open('equip');await state();a.last.equipment=now();}
    }
    if(trip.kind==='rest') {
      await pick(c=>c.act==='rest');const rested=await state();
      if(rested.hp[0]<rested.hp[1]*0.9)throw Error('rest recovery not confirmed');
      trip.kind='shop';return;
    }
    if(trip.kind==='liquidate') {
      if(s.storageComplete!==true)throw Error('Storage is filtered or incomplete');
      a.storageOrigins ||= {};
      for(let i=0;i<4;i++) {
        const current=await state();
        if(current.storageComplete!==true)throw Error('Storage snapshot changed');
        if(!a.bagUsage||a.bagUsage[0]>=a.bagUsage[1]-10)break;
        const spare=storedSurplus(getCatalog(),current,a.worn,current.storageGear)[0];
        if(!spare)break;
        const gear=gearForName(getCatalog(),spare.art||spare.text);
        a.storageOrigins[spare.uid]={name:gear.name,at:now(),status:'withdrawing'};save();
        try{await pick(c=>c.act==='stmove'&&c.uid===spare.uid&&c.dir==='out');}
        catch(e){if(e.code==='ACTION_BUDGET'||e.message==='autonomy action budget exceeded')delete a.storageOrigins[spare.uid];save();throw e;}
        let verified=false;
        for(let attempt=0;attempt<5;attempt++){
          const after=await state();
          if(after.storageComplete===true&&!after.storageGear.some(g=>g.uid===spare.uid&&g.dir==='out')&&after.storageGear.some(g=>g.uid===spare.uid&&g.dir==='in')){verified=true;break;}
          if(attempt<4)await sleep(500);
        }
        if(!verified)throw Error('Surplus withdrawal not confirmed');
        a.storageOrigins[spare.uid].status='withdrawn';a.bagUsage=[a.bagUsage[0]+1,a.bagUsage[1]];trip.progressAt=now();save();
      }
      const current=await state();
      if(current.storageComplete!==true)throw Error('Storage count not verified');
      a.storageCleanup={checkedAt:now(),remaining:storedSurplus(getCatalog(),current,a.worn,current.storageGear).length,job:s.job,fingerprint:getCatalog().fingerprint,requestedAt:null};
      trip.storageScanned=true;trip.kind='shop';trip.salesDone=false;return;
    }
    if(trip.kind==='storage') {
      // Leveling may store any identified spare gear. Deposits are reversible;
      // worn gear, materials and potions are never selected or bulk-moved.
      const job=getCatalog().jobs[String(s.job).toLowerCase()];
      const batch=leveling()?Math.min(6,Math.max(1,9-actions)):3;
      for(let i=0;i<batch;i++) {
        const current=await state();
        if(current.storageUsage&&current.storageUsage[0]>=current.storageUsage[1])break;
        const spare=(current.storageGear||[]).find(g=>g.dir==='in'&&!a.worn.some(w=>w.uid===g.uid)&&(()=>{const gear=gearForName(getCatalog(),g.text+' '+g.art);return !!gear&&(leveling()||gear.slot==='weapon'&&gear.fam!==job?.weapon);})());
        if(!spare)break;
        await pick(c=>c.act==='stmove'&&c.uid===spare.uid&&c.dir==='in');
        if((await state()).storageGear.some(g=>g.dir==='in'&&g.uid===spare.uid))throw Error('storage deposit not confirmed');
        a.blocked=null;a.last.inventory=0;trip.deposits=(trip.deposits||0)+1;
        trip.progressAt=now();
        if(a.bagUsage)a.bagUsage=[Math.max(0,a.bagUsage[0]-1),a.bagUsage[1]];
      }
      a.blocked=trip.deposits?null:'No verified spare non-caster gear to deposit';
      if(leveling()&&trip.deposits&&a.bagUsage&&a.bagUsage[0]>Math.floor(a.bagUsage[1]*0.7)) {
        const live=await state();
        if(live.storageUsage&&live.storageUsage[0]<live.storageUsage[1]&&(live.storageGear||[]).some(g=>g.dir==='in'&&!a.worn.some(w=>w.uid===g.uid)&&gearForName(getCatalog(),g.text+' '+g.art)))return;
      }
      if(!trip.hygiene&&a.goal&&!a.goal.missing.length&&(policy.powerProgression||!leveling()||a.goal.slot==='weapon')&&(!a.resourceHold?.active||a.goal.slot==='weapon')){trip.kind='forge';return;}
    }
    if(trip.kind==='shop') {
      if(policy.sellSurplus&&trip.salesDone!==true){await sellSurplus(trip);return;}
      for(const [field,id] of [['hpPotions','mega_potion'],['mpPotions','mega_ether']]) {
        const current=await state();if(current[field]==null||current[field]>20)continue;
        const control=current.controls.find(c=>c.act==='buy'&&c.key===id&&c.amount==='10');
        const price=Number(control?.label?.replace(/,/g,'').match(/(\d+)\s*G\b/)?.[1]);
        if(!price||current.gold-price<policy.goldReserve)throw Error('potion price/reserve not verified');
        await pick(c=>c.act==='buy'&&c.key===id&&c.amount==='10');
        const after=await state();if(after[field]<=current[field])throw Error('potion restock not confirmed');
        a.restocked||={};a.restocked[field]=(a.restocked[field]||0)+after[field]-current[field];
      }
      const current=await state(),scrolls=current.panelText?.match(/Return Scroll\s+have\s+(\d+)/i);
      if(scrolls&&Number(scrolls[1])<5) {
        const control=[...current.controls,...(current.offscreen||[])].find(c=>c.act==='buy'&&c.key==='return_scroll'&&c.amount==='10');
        const price=Number(control?.label?.replace(/,/g,'').match(/(\d+)\s*G\b/)?.[1]);
        if(price&&current.gold-price>=policy.goldReserve) {
          await pick(c=>c.act==='buy'&&c.key==='return_scroll'&&c.amount==='10');
          const after=await state(),owned=Number(after.panelText?.match(/Return Scroll\s+have\s+(\d+)/i)?.[1]);
          if(owned!==Number(scrolls[1])+10||after.gold!==current.gold-price)throw Error('Return Scroll restock not confirmed');
          a.restocked||={};a.restocked.return_scroll=(a.restocked.return_scroll||0)+10;
        }
      }
      if(policy.powerProgression){
        const pets=mem.development?.snapshots?.ranch?.pets||[];
        for(const [id,name,minimum] of [['pet_treat','Pet Treat',pets.length?3:0],['focus_tonic','Focus Tonic',['Mage','Starweaver','Sage'].includes(s.job)?2:0]]){
          if(!minimum)continue;const live=await state(),owned=live.panelText.match(new RegExp(name+'\\s+(?:have|มี)\\s+(\\d+)','i'));
          if(!owned||Number(owned[1])>=minimum)continue;
          const control=[...live.controls,...(live.offscreen||[])].find(c=>c.act==='buy'&&c.key===id&&c.amount==='10');
          const price=Number(control?.label?.replace(/,/g,'').match(/(\d+)\s*G\b/)?.[1]);
          if(!price||price>20000||live.gold-price<policy.goldReserve)continue;
          await pick(c=>c.act==='buy'&&c.key===id&&c.amount==='10');const after=await state(),count=Number(after.panelText.match(new RegExp(name+'\\s+(?:have|มี)\\s+(\\d+)','i'))?.[1]);
          if(count!==Number(owned[1])+10||after.gold!==live.gold-price)throw Error('Development supply purchase not acknowledged');
          a.restocked||={};a.restocked[id]=(a.restocked[id]||0)+10;
        }
      }
    }
    if(policy.sellSurplus&&trip.kind==='shop'&&!trip.storageScanned&&a.storageCleanup?.requestedAt&&storageNeedsScan(a,getCatalog(),s,now())){trip.kind='liquidate';trip.progressAt=now();return;}
    if(policy.powerProgression&&trip.kind==='shop'&&trip.salesDone&&!trip.capacityServiced&&(!a.wingPriority||a.bagUsage?.[0]>a.bagUsage?.[1]-3)&&a.bagUsage?.[0]>=Math.floor(a.bagUsage?.[1]*0.95)&&a.premium.reserved<policy.crystalBudget&&!['reserved','unknown'].includes(a.purchase?.status)){
      trip.kind='capacity';trip.progressAt=now();return;
    }
    if(policy.powerProgression&&trip.kind==='shop'&&!trip.forgeServiced&&(a.wingPriority&&a.goal?.slot==='wing'&&a.goal.missing?.some(m=>m.id==='sigil_ore')||!a.resourceHold?.active&&now()-(a.last.forge||0)>30*MIN)){trip.kind='forge';trip.progressAt=now();return;}
    if(policy.sellSurplus&&!a.wingPriority&&trip.kind==='shop'&&!trip.storageScanned&&storageNeedsScan(a,getCatalog(),s,now())){trip.kind='liquidate';trip.progressAt=now();return;}
    if(trip.kind==='forge'||!policy.powerProgression)a.last.forge=now();trip.phase='return';
  }
  async function farm(s,trial=false) {
    const missing=leveling()?[]:a.goal?.missing?.filter(m=>m.id!=='gold')||[];
    const options=farmOptions(getCatalog(),s,missing,a.farmRates).filter(m=>!mem.dna?.avoidMaps?.includes(m.id));
    if(!options.length){a.blocked=missing.length?'No currently safe public drop route for missing materials':null;a.last.farm=now();return;}
    const current=options.find(m=>norm(m.name)===norm(s.zone));
    const measured=options.filter(m=>a.farmRates[m.id]?.minutes>=2&&now()-a.farmRates[m.id].at<30*MIN&&(!leveling()||a.farmRates[m.id].target===targetFor(m.id,s)?.id)).sort((x,y)=>y.measuredExpPerMinute-x.measuredExpPerMinute);
    const proposal=trialOption(mem,s,getCatalog(),now(),policy);
    const best=proposal||(!trial?(!missing.length&&measured.length?measured[0]:current&&current.score>=options[0].score*0.8?current:options[0]):null);
    if(!best)return;
    trial=!!proposal;
    a.farm={map:best.id,name:best.name,started:now(),returnMap:returnPoint(s),returnMode:s.autoQuestMode||'mq',expectedDrops:best.materialChance,estimate:true,trial,baseline:best.baseline,pendingProfile:leveling()};
    a.last.farm=now();save();
    await pick(c=>c.aq==='stop',true);
    if(leveling()&&/\bon\b/.test((await state()).autoHunt||''))await pick(c=>c.id==='autoBtn');
    if(norm(best.name)!==norm(s.zone))await travel(best.id);
    else if(!leveling()&&!/\bon\b/.test(s.autoHunt||''))await pick(c=>c.id==='autoBtn');
  }
  async function run(task) {
    actions=0;
    try {
      let s=await state();
      if(task==='cbt') {
        await pick(c=>c.id==='cbtPill');s=await state();
        if(s.cbtClaimed===false) {
          const before=s.crystals;await pick(c=>c.act==='cbtgift');await sleep(1200);s=await state();
          if(s.cbtClaimed!==true||s.crystals<before+5000)throw Error('CBT gift not confirmed');
          event(a,'cbt_claimed',{crystals:s.crystals-before,vip:s.vipText});
        }
        if(s.cbtClaimed!==true)throw Error('CBT claim status not confirmed');
      } else if(task==='inventory'){await open('bag');await pick(c=>c.act==='ifilter'&&c.key==='all'&&!c.on,true);if(!(await state()).inventoryComplete)throw Error('Inventory is filtered; snapshot rejected');}
      else if(task==='equipment'){await open('equip');await state();}
      else if(task.startsWith('town_'))await beginTrip(task.slice(5),s);
      else if(task==='town')await town(s);
      else if(task==='capacity'){await open('prem');await pick(c=>c.act==='crtab'&&c.key==='shop');await buyCapacity();}
      else if(task==='farm'||task==='farm_trial')await farm(s,task==='farm_trial');
      else if(task==='finish_farm') {
        const f=a.farm;a.farm=null;a.last.farm=now();
        if(f.trial){a.farmTrials||={};a.farmTrials[f.map]={at:now(),expPerMinute:a.farmRates[f.map]?.expPerMinute??null,baseline:f.baseline};}
        if(leveling()&&!f.trial){a.last.farm=0;a.resume=null;}
        else {
          a.resume={map:f.returnMap,mode:f.returnMode,at:now()};
          if(f.returnMap&&norm(f.returnMap)!==norm(f.map))await travel(f.returnMap);
        }
      } else if(task==='autonomy_wait') {
        if(a.resume) {
          const destination=getCatalog()?.maps.find(m=>m.id===a.resume.map);
          // A teleport/walk can be cancelled by the game. Do not wait forever at
          // the wrong map: native quest routing can recover from the current town.
          if(!destination||norm(destination.name)===norm(s.zone)||now()-a.resume.at>MIN) {
            if(a.resume.mode==='farm') {
              if(!destination)throw Error('Farm return map not confirmed');
              if(norm(destination.name)!==norm(s.zone)) {
                a.resume.at=now();save();await travel(destination.id);return;
              }
              await close();
              a.farm={map:destination.id,name:destination.name,started:now(),returnMap:destination.id,returnMode:'mq',estimate:false,trial:false};
              await farmProfile(s);
              if(!/\bon\b/.test((await state()).autoHunt||''))await pick(c=>c.id==='autoBtn');
              if(!/\bon\b/.test((await state()).autoHunt||''))throw Error('Farm resume not confirmed');
            } else {
              await close();await pick(c=>c.aq===a.resume.mode);
              if(!(await state()).autoQuestRunning)throw Error('Quest resume not confirmed');
            }
            a.resume=null;if(a.blocked==='Town trip timed out')a.blocked=null;
          }
        }else if(a.farm&&norm(a.farm.name)===norm(s.zone)) {
          if(a.farm.pendingProfile||leveling()&&targetFor(a.farm.map,s)?.id!==a.farm.target)await farmProfile(s);
          if(!/\bon\b/.test((await state()).autoHunt||''))await pick(c=>c.id==='autoBtn');
        }
      }
      a.last[task]=now();a.lastResult={task,ok:true,at:now()};save();
    } catch(e) {
      if(a.trip?.hygiene){a.trip.hygiene.failed=true;a.trip.phase='return';mem.sessionHygiene.deferred=e.message;}
      if(task==='town'&&a.trip?.kind==='forge') {a.last.inventory=0;a.last.equipment=0;a.trip.phase='return';}
      a.failures||={};a.failures[task]=now();a.lastResult={task,ok:false,error:e.message,at:now()};save();log('autonomy '+task+': '+e.message);
    } finally {await close();save();}
    return a.lastResult;
  }
  return {run,travel:async id=>{actions=0;await travel(id);}};
}
module.exports={init,event,catalogChanged,gearForName,surplusGear,surplusDetail,storageDepositAllowed,storedSurplus,storageNeedsScan,commonLootSurplus,levelingTarget,progressionGoal,update,chooseTask,trialOption,createController,refineCandidates,wingReserve};
