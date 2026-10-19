'use strict';
const {resolveCap,bottlenecks,farmOptions}=require('./game-catalog');
const Progression=require('./progression');
const Hygiene=require('./session-hygiene');
const MIN=60000;
const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
const level=s=>Number(String(s.lv||'').match(/\d+/)?.[0]||0);
function init(mem) {
  return mem.autonomy ||= {version:1,events:[],sequence:0,premium:{reserved:0,spent:0},inventory:null,worn:[],last:{},crafted:{},farmRates:{}};
}
function event(a,type,detail,now=Date.now()) {
  a.events.push({id:++a.sequence,type,detail,at:now});a.events=a.events.slice(-80);
}
function catalogChanged(mem,catalog,now=Date.now()) {
  const a=init(mem),previous=a.catalog;
  if(previous&&catalog.levelCap>previous.levelCap)event(a,'cap_expanded',{from:previous.levelCap,to:catalog.levelCap},now);
  if(previous&&previous.fingerprint!==catalog.fingerprint){a.goal=null;a.last.forge=0;event(a,'catalog_changed',{levelCap:catalog.levelCap,refineMax:catalog.refineMax},now);}
  a.catalog={levelCap:catalog.levelCap,refineMax:catalog.refineMax,fingerprint:catalog.fingerprint,at:catalog.at};
}
function gearForName(catalog,text) {
  const value=norm(text);
  return catalog.gear.filter(g=>value.includes(norm(g.name))||value.includes('/gear/'+g.id+'.png')).sort((a,b)=>b.name.length-a.name.length)[0]||null;
}
function progressionGoal(catalog,state,a,reserve) {
  if(!a.inventory||!catalog)return null;
  const job=catalog.jobs[String(state.job||'').toLowerCase()];if(!job)return null;
  const allowed=g=>g.lv<=level(state)&&(!g.line||job.line.includes(g.line))&&(!g.fam||g.slot!=='weapon'||g.fam===job.weapon);
  const own=a.worn.map(w=>({...w,gear:gearForName(catalog,w.text)})).filter(w=>w.gear);
  const upgrades=[];
  for(const w of own.sort((a,b)=>(a.slot==='weapon'?-1:0)-(b.slot==='weapon'?-1:0))) {
    const cost=w.gear.upgrade,target=catalog.gear.find(g=>g.id===cost?.to);
    if(target&&allowed(target))upgrades.push({kind:'upgrade',uid:w.uid,target:target.id,name:target.name,slot:w.slot,cost,
      missing:bottlenecks(cost,a.inventory.items,Math.max(0,(state.gold||0)-reserve))});
  }
  if(upgrades.length)return upgrades.find(g=>!g.missing.length)||upgrades[0];
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
  return crafts.find(g=>!g.missing.length)||crafts[0]||null;
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
  a.goal=progressionGoal(catalog,state,a,reserve);
  const need=a.goal?.cost?.mats||{},owned=a.inventory?.items||{};
  const total=Object.values(need).reduce((s,n)=>s+n,0),have=Object.entries(need).reduce((s,[id,n])=>s+Math.min(n,owned[id]||0),0);
  a.craftProgress=total?Math.floor(have/total*100):null;
  a.mode=a.trip?'town-service':a.resourceHold?.active?'pre-bracket-stockpiling':a.goal?.missing?.length?'farm-materials':a.goal?'craft-upgrade':a.cap.atCap&&a.gearCapped?'stockpiling':a.cap.atCap?'endgame-forge':'leveling';
  const cumulative=lv=>Array.from({length:Math.max(0,lv-1)},(_,i)=>catalog.expByLevel?.[i+1]||0).reduce((s,n)=>s+n,0);
  const active=!a.trip&&!state.panelOpen&&!state.menuOpen&&!state.mapOpen&&!state.dead&&(!mem.uiHealth?.safeIdle)&&(/\bon\b/.test(state.autoHunt||'')||state.autoQuestRunning);
  const absolute=state.exp==null?null:cumulative(level(state))+(state.exp/100)*(catalog.expByLevel?.[level(state)]||0);
  if(!active){a.expSample=null;return a;}
  if(absolute!=null&&a.expSample&&norm(a.expSample.zone)===norm(state.zone)&&now-a.expSample.at>=MIN) {
    const elapsed=(now-a.expSample.at)/MIN,delta=absolute-a.expSample.value;
    if(delta>=0) {
      a.expPerMinute=Math.round(delta/elapsed);a.expRateAt=now;a.expRateZone=state.zone;const map=catalog.maps.find(m=>norm(m.name)===norm(state.zone));
      if(map){const old=a.farmRates[map.id],fresh=old&&now-old.at<30*MIN;
        a.farmRates[map.id]={expPerMinute:fresh?Math.round((old.expPerMinute+a.expPerMinute)/2):a.expPerMinute,
          minutes:(fresh?old.minutes||0:0)+elapsed,level:level(state),at:now};}
    }
    a.expSample={value:absolute,at:now,zone:state.zone};
  } else if(absolute!=null&&(!a.expSample||norm(a.expSample.zone)!==norm(state.zone)))a.expSample={value:absolute,at:now,zone:state.zone};
  return a;
}
function chooseTask(mem,s,catalog,now=Date.now(),policy={}) {
  if(!policy.enabled||mem.uiHealth?.safeIdle||!s.name||s.dead||!s.hp)return null;
  const a=init(mem),due=(k,ms)=>now-(a.last[k]||0)>ms&&now-(a.failures?.[k]||0)>120000;
  if(s.hp[0]/s.hp[1]<0.3)return s.hpPotions===0?(a.trip?'town':'town_rest'):null;
  if(!catalog)return null; // Keep the existing UI policy running during catalog outages.
  if(!a.cbt&&s.controls.some(c=>c.id==='cbtPill'))return 'cbt';
  const premiumReady=!['reserved','unknown'].includes(a.purchase?.status);
  if(premiumReady&&a.storageUsage&&a.storageUsage[0]>=a.storageUsage[1]-2&&a.premium.reserved<policy.crystalBudget&&due('capacity',10*MIN))return 'capacity';
  if(a.trip)return 'town';
  if(a.resume)return 'autonomy_wait';
  if(a.resourceHold?.active&&a.farm&&!a.farm.trial&&a.goal?.slot!=='weapon')return 'finish_farm';
  if(a.farm?.trial&&(a.farm.abort||s.hp[0]/s.hp[1]<0.4||(mem.deaths||[]).some(t=>t>=a.farm.started)))return 'finish_farm';
  if(a.farm?.trial&&now-a.farm.started>3*MIN) {
    const rate=a.farmRates[a.farm.map];
    if(rate?.at>a.farm.started&&rate.minutes>=2&&rate.expPerMinute<a.farm.baseline*0.9)return 'finish_farm';
  }
  if(a.farm&&now-a.farm.started>10*MIN)return 'finish_farm';
  if(due('inventory',a.bagUsage&&a.bagUsage[0]>=a.bagUsage[1]*0.85?MIN:5*MIN))return 'inventory';
  if(due('equipment',10*MIN))return 'equipment';
  if(a.bagUsage&&a.bagUsage[0]>=Math.floor(a.bagUsage[1]*0.95)) {
    if(premiumReady&&a.premium.reserved<policy.crystalBudget&&due('capacity',10*MIN))return 'capacity';
    return due('town_storage',5*MIN)?'town_storage':null;
  }
  if((s.hpPotions!=null&&s.hpPotions<=10)||(s.mpPotions!=null&&s.mpPotions<=10))return due('town_shop',5*MIN)?'town_shop':null;
  if(a.goal&&!a.goal.missing.length&&(!a.resourceHold?.active||a.goal.slot==='weapon')&&due('forge',MIN))return 'town_forge';
  if(!a.resourceHold?.active&&due('forge',15*MIN))return 'town_forge';
  if((a.goal?.missing?.length||a.cap?.atCap)&&(!a.resourceHold?.active||a.goal?.slot==='weapon')&&!a.farm&&due('farm',10*MIN))return 'farm';
  if(!a.farm&&!s.jobQuestProgress&&due('farm',20*MIN)&&trialOption(mem,s,catalog,now))return 'farm_trial';
  if(a.farm)return 'autonomy_wait';
  return null;
}

function trialOption(mem,s,catalog,now=Date.now()) {
  const a=init(mem),ttk=mem.combatTelemetry?.current;
  if(mem.uiHealth?.safeIdle||a.trip||s.hp?.[0]/s.hp?.[1]<0.75||!Number.isFinite(s.hpPotions)||!Number.isFinite(s.mpPotions)||s.hpPotions<20||s.mpPotions<20||
    !ttk||norm(ttk.zone)!==norm(s.zone)||now-ttk.at>10000||ttk.count<5||ttk.medianSeconds>4)return null;
  const missing=a.goal?.missing?.filter(m=>m.id!=='gold')||[];
  const options=farmOptions(catalog,s,missing,a.farmRates),current=options.find(m=>norm(m.name)===norm(s.zone));
  const rate=current&&a.farmRates[current.id];
  if(!rate||now-rate.at>5*MIN||rate.minutes<2||rate.expPerMinute<=0)return null;
  const next=options.filter(m=>m.id!==current.id&&m.monsterLevel>current.monsterLevel&&m.monsterLevel<=current.monsterLevel+5&&
    (!a.farmTrials?.[m.id]||now-a.farmTrials[m.id].at>60*MIN)).sort((x,y)=>x.monsterLevel-y.monsterLevel)[0];
  return next?{...next,baseline:rate.expPerMinute}:null;
}

function createController({mem,observe,click,key,scroll,open,close,sleep,save,log,getCatalog,policy,now=Date.now}) {
  let actions=0;
  const a=init(mem);
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
    return getCatalog().maps.find(m=>!m.town&&norm(m.name)===norm(s.zone))?.id||a.returnMap||null;
  }
  async function beginTrip(kind,s) {
    a.trip={kind,returnMap:returnPoint(s),returnMode:s.autoQuestMode||a.farm?.returnMode||'mq',at:now(),phase:'town'};save();
    await pick(c=>c.aq==='stop',true);
    if(!getCatalog().maps.some(m=>m.town&&norm(m.name)===norm(s.zone))) {
      if(!await pick(c=>c.id==='potTp',true))await travel('town');
    }
  }
  async function resume(trip) {
    await close();
    if(trip.returnMap)await travel(trip.returnMap);
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
    if(goal&&!goal.missing.length&&(!a.resourceHold?.active||goal.slot==='weapon')) {
      await pick(c=>c.act==='smtab'&&c.key===(goal.kind==='upgrade'?'up':'craft'));
      if(goal.kind==='craft') {
        const g=catalog.gear.find(g=>g.id===goal.target);
        if(g.slot==='wing')await pick(c=>c.act==='smwing');
        else if(g.line)await pick(c=>c.act==='smline');
        else await pick(c=>c.act==='smtier'&&c.key===String(g.tier));
      }
      let live=await state();const row=live.smithRows.find(r=>r.act===(goal.kind==='upgrade'?'upg':'craft')&&r.key===(goal.uid||goal.target));
      if(!row||row.disabled||row.gold==null||live.gold-row.gold<policy.goldReserve)throw Error('live recipe unavailable or reserve would be crossed');
      // Catalog is advisory. Every current material row must independently show sufficient resources.
      if(!row.mats.length||row.mats.some(m=>m.have==null||m.need==null||m.have<m.need))throw Error('live material quantities not confirmed');
      await pick(c=>c.act===row.act&&c.key===row.key);await sleep(1300);live=await state();
      if(!norm(live.forgeResult).includes(norm(goal.name))||live.gold!==s.gold-row.gold)throw Error('craft/upgrade acknowledgement or gold debit not confirmed');
      a.crafted[goal.target]={at:now()};a.last.equipment=0;a.last.inventory=0;
      event(a,'gear_crafted',{name:goal.name,kind:goal.kind,topTier:catalog.gear.filter(g=>g.slot===goal.slot).every(g=>g.tier<=catalog.gear.find(x=>x.id===goal.target).tier)});
      return;
    }
    await pick(c=>c.act==='smtab'&&c.key==='refine');s=await state();
    const rows=s.smithRows.filter(r=>r.act==='refine'&&(r.worn||a.worn.some(w=>w.uid===r.key)));
    a.gearCapped=rows.length>=a.worn.length&&a.worn.length>=8&&rows.every(r=>r.max);
    const row=rows.filter(r=>!r.disabled&&!r.max&&r.refine!=null&&(!a.resourceHold?.active||a.worn.some(w=>w.uid===r.key&&w.slot==='weapon'))).sort((x,y)=>x.refine-y.refine)[0];
    if(!row)return;
    const fee=Number(row.costText.replace(/,/g,'').match(/\d+/)?.[0]);
    if(!fee||s.gold-fee<policy.goldReserve)throw Error('refine fee/reserve not confirmed');
    if(row.refine>=(catalog.refineSafe??0)&&row.chance!==100&&!/Guardian Stone.*(?:stay|เดิม)|(?:stay|เดิม).*Guardian Stone/i.test(row.risk)) {
      if(await pick(c=>c.act==='smguard'&&!c.on,true))return;
      a.blocked='Guardian Stone protection required';return;
    }
    await pick(c=>c.act==='refine'&&c.key===row.key);
    let after=await state();
    if(after.modalText) {
      if(!/refine|ตีบวก/i.test(after.modalText)||/drop to|ลดเหลือ/i.test(after.modalText))throw Error('unprotected refine rejected');
      await pick(c=>/^Refine$|^Confirm$|^ตีบวก$|^ยืนยัน$/.test(c.label));await sleep(900);after=await state();
    }
    const next=after.smithRows.find(r=>r.key===row.key&&r.act==='refine');
    if(!next||!after.forgeResult&&!/failed|ล้มเหลว/i.test(after.panelText))throw Error('refine outcome not observed');
    a.refine={at:now(),name:row.name,from:row.refine,to:next.max?catalog.refineMax:next.refine,cap:catalog.refineMax};
    if(next.max)event(a,'refine_max',{name:row.name,cap:catalog.refineMax});
  }
  async function town(s) {
    const trip=a.trip;
    if(now()-(trip.hygiene?.started||trip.at)>5*MIN){a.blocked='Town trip timed out';await resume(trip);return;}
    const townMap=getCatalog().maps.find(m=>m.town&&norm(m.name)===norm(s.zone));
    if(!townMap)return;
    if(trip.phase==='return'){
      if(Hygiene.due(mem,now(),policy.sessionRefreshHours||6)&&!trip.hygiene?.failed) {
        const h=trip.hygiene ||= {started:now(),shopAttempts:0};
        if(h.ready&&now()-h.readyAt<90000)return; // agent refreshes only after independent safety checks
        if(h.ready){h.failed=true;mem.sessionHygiene.deferred='Refresh safety checks did not pass';}
        else {
          await open('bag');await pick(c=>c.act==='ifilter'&&c.key==='all'&&!c.on,true);const bag=await state();
          if(!bag.inventoryComplete||!bag.bagUsage)throw Error('Pre-refresh inventory not verified');
          h.bagUsage=bag.bagUsage;
          if(bag.bagUsage[0]>=Math.floor(bag.bagUsage[1]*0.95)) {
            if(!h.storageTried){h.storageTried=true;trip.kind='storage';trip.phase='town';return;}
            h.failed=true;mem.sessionHygiene.deferred='Bag could not be safely serviced';
          }else if(bag.hpPotions<20||bag.mpPotions<20||bag.hpPotions==null||bag.mpPotions==null) {
            if(h.shopAttempts++<3){trip.kind='shop';trip.phase='town';return;}
            h.failed=true;mem.sessionHygiene.deferred='Potion replenishment not verified';
          }else {h.ready=true;h.readyAt=now();save();return;}
        }
      }
      await resume(trip);return;
    }
    const panel={forge:'smith',storage:'storage',shop:'shop',rest:'church'}[trip.kind];
    if(s.panel!==panel) {
      await close();await key('m');await sleep(400);await pick(c=>c.bm==='here',true);
      await pick(c=>c.place==='n:'+panel);s=await state();if(s.panel!==panel)return;
    }
    if(trip.kind==='forge')await forge(s);
    if(trip.kind==='rest') {
      await pick(c=>c.act==='rest');const rested=await state();
      if(rested.hp[0]<rested.hp[1]*0.9)throw Error('rest recovery not confirmed');
      trip.kind='shop';return;
    }
    if(trip.kind==='storage') {
      // Deposit one observed spare non-caster weapon at a time. Never bulk-move materials or potions.
      const job=getCatalog().jobs[String(s.job).toLowerCase()];
      for(let i=0;i<3;i++) {
        const current=await state();
        const spare=(current.storageGear||[]).find(g=>g.dir==='in'&&!a.worn.some(w=>w.uid===g.uid)&&(()=>{const gear=gearForName(getCatalog(),g.text+' '+g.art);return gear?.slot==='weapon'&&gear.fam!==job?.weapon;})());
        if(!spare)break;
        await pick(c=>c.act==='stmove'&&c.uid===spare.uid&&c.dir==='in');
        if((await state()).storageGear.some(g=>g.dir==='in'&&g.uid===spare.uid))throw Error('storage deposit not confirmed');
        a.blocked=null;a.last.inventory=0;trip.deposits=(trip.deposits||0)+1;
      }
      a.blocked=trip.deposits?null:'No verified spare non-caster gear to deposit';
      if(!trip.hygiene&&a.goal&&!a.goal.missing.length&&(!a.resourceHold?.active||a.goal.slot==='weapon')){trip.kind='forge';return;}
    }
    if(trip.kind==='shop') {
      for(const [field,id] of [['hpPotions','mega_potion'],['mpPotions','mega_ether']]) {
        const current=await state();if(current[field]==null||current[field]>20)continue;
        const control=current.controls.find(c=>c.act==='buy'&&c.key===id&&c.amount==='10');
        const price=Number(control?.label?.replace(/,/g,'').match(/(\d+)\s*G\b/)?.[1]);
        if(!price||current.gold-price<policy.goldReserve)throw Error('potion price/reserve not verified');
        await pick(c=>c.act==='buy'&&c.key===id&&c.amount==='10');
        if((await state())[field]<=current[field])throw Error('potion restock not confirmed');
      }
    }
    a.last.forge=now();trip.phase='return';
  }
  async function farm(s,trial=false) {
    const missing=a.goal?.missing?.filter(m=>m.id!=='gold')||[];
    const options=farmOptions(getCatalog(),s,missing,a.farmRates);
    if(!options.length){a.blocked=missing.length?'No currently safe public drop route for missing materials':null;a.last.farm=now();return;}
    const current=options.find(m=>norm(m.name)===norm(s.zone));
    const measured=options.filter(m=>a.farmRates[m.id]?.minutes>=2&&now()-a.farmRates[m.id].at<30*MIN).sort((x,y)=>y.measuredExpPerMinute-x.measuredExpPerMinute);
    const proposal=trialOption(mem,s,getCatalog(),now());
    const best=proposal||(!trial?(!missing.length&&measured.length?measured[0]:current&&current.score>=options[0].score*0.8?current:options[0]):null);
    if(!best)return;
    trial=!!proposal;
    a.farm={map:best.id,name:best.name,started:now(),returnMap:returnPoint(s),returnMode:s.autoQuestMode||'mq',expectedDrops:best.materialChance,estimate:true,trial,baseline:best.baseline};
    a.last.farm=now();save();
    await pick(c=>c.aq==='stop',true);
    if(norm(best.name)!==norm(s.zone))await travel(best.id);
    else if(!/\bon\b/.test(s.autoHunt||''))await pick(c=>c.id==='autoBtn');
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
        a.resume={map:f.returnMap,mode:f.returnMode,at:now()};
        if(f.returnMap&&norm(f.returnMap)!==norm(f.map))await travel(f.returnMap);
      } else if(task==='autonomy_wait') {
        if(a.resume) {
          const destination=getCatalog()?.maps.find(m=>m.id===a.resume.map);
          // A teleport/walk can be cancelled by the game. Do not wait forever at
          // the wrong map: native quest routing can recover from the current town.
          if(!destination||norm(destination.name)===norm(s.zone)||now()-a.resume.at>MIN) {
            await close();await pick(c=>c.aq===a.resume.mode);
            if(!(await state()).autoQuestRunning)throw Error('Quest resume not confirmed');
            a.resume=null;if(a.blocked==='Town trip timed out')a.blocked=null;
          }
        }else if(a.farm&&norm(a.farm.name)===norm(s.zone)&&!/\bon\b/.test(s.autoHunt||''))await pick(c=>c.id==='autoBtn');
      }
      a.last[task]=now();a.lastResult={task,ok:true,at:now()};save();
    } catch(e) {
      if(a.trip?.hygiene){a.trip.hygiene.failed=true;a.trip.phase='return';mem.sessionHygiene.deferred=e.message;}
      if(task==='town'&&a.trip?.kind==='forge') {a.last.inventory=0;a.last.equipment=0;a.trip.phase='return';}
      a.failures||={};a.failures[task]=now();a.lastResult={task,ok:false,error:e.message,at:now()};save();log('autonomy '+task+': '+e.message);
    } finally {await close();save();}
    return a.lastResult;
  }
  return {run};
}
module.exports={init,event,catalogChanged,gearForName,progressionGoal,update,chooseTask,trialOption,createController};
