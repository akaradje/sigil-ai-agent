'use strict';
// Character development uses rendered, labelled UI and ordinary input only.
const MIN=60000, norm=s=>String(s||'').replace(/\s+/g,' ').trim();
function readDevelopment(){
  const panel=document.getElementById('panel'),body=document.getElementById('pbody');
  if(!panel||panel.hidden||!body)return null;
  const all=(s,e=body)=>Array.from(e.querySelectorAll(s));
  const num=s=>Number(String(s||'').replace(/,/g,'').match(/\d+(?:\.\d+)?/)?.[0]||0);
  const text=e=>e?.innerText||'', ctl=e=>e?{act:e.dataset.act,key:e.dataset.id||null,disabled:!!e.disabled,text:text(e),tip:e.getAttribute('data-tip')||'',fee:num(e.dataset.fee),skill:e.dataset.sk||null}:null;
  return {panel:panel.dataset.kind,text:text(body).slice(0,18000),
    pets:all('.ranch .pet').map(e=>({id:e.querySelector('[data-act="peton"],[data-act="prel"]')?.dataset.id,
      name:text(e.querySelector('.rn-t>b')),active:e.classList.contains('act'),evolved:e.classList.contains('evo'),
      stats:text(e.querySelector('.rn-t>small')),text:text(e),evolve:ctl(e.querySelector('[data-act="pevo"]'))})),
    runeSlots:all('.rn-slot').map(e=>({id:e.dataset.id,text:text(e),locked:e.classList.contains('lock'),selected:e.classList.contains('on'),empty:!!e.querySelector('.empty')})),
    runeCards:all('.rn-card').map(e=>({id:e.dataset.rune,name:text(e.querySelector('.h .d>b')),known:e.classList.contains('own'),
      level:num(text(e.querySelector('.lv b')))|| (e.classList.contains('own')?1:0),have:num(text(e.querySelector('.have'))),text:text(e),
      up:ctl(e.querySelector('[data-act="rnup"]')),learn:ctl(e.querySelector('[data-act="rnlearn"]')),craft:ctl(e.querySelector('[data-act="rncraft"]'))})),
    runeRows:all('.rn-row').map(e=>({text:text(e),on:e.classList.contains('on'),set:ctl(e.querySelector('[data-act="rnset"]'))})),
    runeSkills:all('.rn-sk').map(e=>({id:e.dataset.id,text:text(e),selected:e.classList.contains('on'),occupied:!!e.querySelector('i')})),
    runeFree:all('[data-act="rnclaim"]').map(e=>({id:e.dataset.id,text:text(e),recommended:e.classList.contains('rec')})),
    skills:all('.sk4-card[data-act="sksel"],.sk-card[data-act="sksel"],.sknode[data-act="sksel"],.sx-skc[data-act="sksel"]').map(e=>({id:e.dataset.id,text:text(e)})),
    cards:all('.cd2[data-act="csel"]').map(e=>({id:e.dataset.id,text:text(e),known:e.classList.contains('has-ef'),copies:num(text(e.querySelector('u')))})),
    cardDetail:text(body.querySelector('.cd2-det')),life:all('.lifew .lsk').map(e=>({name:text(e.querySelector('b')),text:text(e)})),
    buffs:all('#buffs [data-buff]',document).map(e=>({id:e.dataset.buff,name:e.getAttribute('aria-label'),seconds:num(text(e.querySelector('i')))})).slice(0,30)};
}
const EXPRESSION='JSON.stringify(('+readDevelopment.toString()+')())';
// Public scene coordinates identify resource nodes; input still goes through the mouse/keyboard.
const SCENE_EXPRESSION=`import('/src/life-ui.js').then(({LIFE:l})=>{const g=window.SIGIL,p=g?.p,c=document.getElementById('game'),r=c?.getBoundingClientRect(),v=g?.view,cam=g?.camRender;
  if(!p||!g.ready||g.mapLoad||g.fade||!r||!v||!cam||l.map!==g.world?.id)return JSON.stringify({available:false});
  return JSON.stringify({available:true,map:g.world.id,x:p.x,y:p.y,mineLv:p.life?.mine?.lv||1,mineExp:p.life?.mine?.exp||0,mining:l.acts.get(g.link?.id)?.kind==='mine',
    nodes:l.ore.filter(n=>n.up).map(n=>{const x=Math.round(r.left+(n.x-cam.x)*v.scale),y=Math.round(r.top+(n.y-14-cam.y)*v.scale),hit=x>0&&y>0&&x<innerWidth&&y<innerHeight?document.elementFromPoint(x,y):null;return {id:n.i,tier:n.tier,x,y,wx:n.x,wy:n.y,visible:hit===c};})});})`;
function init(mem){return mem.development ||= {version:1,last:{},failures:{},snapshots:{},history:[],steps:0};}
function remember(mem,view,now=Date.now()){
  if(!view?.panel)return;const d=init(mem);
  const section=view.runeSlots?.length?'runes':view.panel;
  d.snapshots[section]={...view,at:now};
}
function due(d,k,now,ms){return now-(d.last[k]||0)>=ms&&now-(d.failures[k]?.at||0)>=5*MIN;}
function routineReady(mem,s){
  const a=mem.autonomy||{},bag=a.bagUsage;
  return !a.trip&&!a.resume&&!s.dead&&!!s.hp&&s.hp[0]/s.hp[1]>=0.45&&
    s.hpPotions>10&&s.mpPotions>10&&!!bag&&bag[0]<Math.floor(bag[1]*0.95);
}
function chooseTask(mem,s,catalog,now=Date.now()){
  if(!s.name||s.dead||!s.hp||mem.uiHealth?.safeIdle)return null;
  const d=init(mem);
  if(d.excursion)return 'growth_materials';
  if(s.hp[0]/s.hp[1]<0.45)return null;
  if(s.controls?.some(c=>c.id==='tameYes')&&due(d,'tame',now,5000))return 'tame';
  if(mem.autonomy?.resume||mem.autonomy?.farm?.pendingProfile||mem.autonomy?.trip||s.autoQuestMode==='jq')return null;
  if(due(d,'pets',now,10*MIN))return 'pets';
  if(due(d,'growth_buffs',now,5*MIN))return 'growth_buffs';
  if(['Mage','Starweaver','Sage'].includes(s.job)&&due(d,'runes',now,d.runesPending?MIN:10*MIN))return 'runes';
  if(due(d,'cards',now,d.cardsPending?MIN:20*MIN))return 'cards';
  if(due(d,'growth_evolutions',now,d.evolutionsPending?5*MIN:60*MIN))return 'growth_evolutions';
  if(due(d,'growth_rewards',now,30*MIN))return 'growth_rewards';
  if(due(d,'growth_audit',now,15*MIN))return 'growth_audit';
  if(catalog?.development?.mining&&mem.autonomy?.powerProgression&&mem.autonomy?.goal?.missing?.length&&due(d,'growth_materials',now,30*MIN))return 'growth_materials';
  return null;
}
function materialPlan(catalog,missing,scene,s){
  const lv=Number(String(s.lv||'').match(/\d+/)?.[0]),wanted=new Set((missing||[]).map(m=>m.id));
  const boss=catalog?.monsters?.filter(m=>m.boss&&m.lv<=lv-15&&m.drops?.some(([id])=>wanted.has(id))).sort((a,b)=>a.lv-b.lv)[0];
  const need=(catalog?.development?.mining||[]).filter(t=>wanted.has(t.ore)||wanted.has(t.gem));
  if(need.length&&scene?.available){
    const target=Math.max(...need.map(t=>t.tier)),tiers=catalog.development.mining.filter(t=>t.tier<=target&&t.level<=scene.mineLv),tier=tiers.at(-1);
    const map=tier&&catalog.maps.filter(m=>!m.town&&Number(m.range?.match(/\d+/)?.[0])>=tier.mapLevel&&Number(m.range?.match(/\d+/)?.[0])<=(catalog.development.mining.find(t=>t.tier===tier.tier+1)?.mapLevel??Infinity)-1&&Number(m.range?.match(/\d+/)?.[0])<=lv-15)[0];
    if(map)return {kind:'mine',map:map.id,tier:tier.tier,levelTarget:Math.max(...need.map(t=>t.level))};
  }
  return boss?{kind:'boss',boss:boss.name,id:boss.id}:null;
}
const LINE=['comet_rain','astral_lance','mana_veil'];
const SKILL_PAIRS={S1:['leech','blaze'],S2:['keen','meteor_fall'],S3:['execute','fire_bolt'],S4:['haste','jupiter_thunder']};
function runeCost(def,s){
  const lv=Number(String(s.lv||'').match(/\d+/)?.[0]);if(!def?.craft||!Number.isInteger(lv)||lv<1||!Number.isFinite(def.goldPerLevel))return null;
  return {...def.craft,gold:def.craft.gold+def.goldPerLevel*(lv-1)};
}
function runeStep(v,catalog,s){
  if(!v?.runeSlots?.length)return null;
  const def=catalog?.development?.runes||{},cards=v.runeCards||[],slots=v.runeSlots;
  // Prefer already collected runes; the first gift follows the native recommendation.
  const free=v.runeFree?.filter(r=>r.recommended);if(free?.length===1)return {act:'rnclaim',id:free[0].id,confirm:true,free:true};
  const missing=slots.filter(r=>!r.locked&&r.empty);
  for(const slot of missing){
    const ids=slot.id.startsWith('L')?[LINE[Number(slot.id.slice(1))-1]]:slot.id==='C'?['harvest','meteor']:slot.id==='X'?['starfall_crown']:SKILL_PAIRS[slot.id]?[SKILL_PAIRS[slot.id][0]]:[];
    for(const id of ids){
      const card=cards.find(c=>c.id===id);if(!card)continue;
      if(!card.known){
        if(card.learn&&!card.learn.disabled)return {act:'rnlearn',id};
        const cost=runeCost(def[id],s);
        if(card.have===0&&cost&&card.craft&&!card.craft.disabled)return {act:'rncraft',id,cost,smith:true};
        continue;
      }
      if(!slot.selected)return {act:'rnslot',id:slot.id};
      const pair=SKILL_PAIRS[slot.id];
      if(pair){const sk=v.runeSkills?.find(k=>k.id===pair[1]);if(!sk||sk.occupied)continue;if(!sk.selected)return {act:'rnsk',id:sk.id};}
      const row=v.runeRows?.find(r=>r.set?.key===id&&!r.set.disabled&&(!pair||r.set.skill===pair[1]));
      if(row)return {act:'rnset',id,fee:row.set.fee,skill:row.set.skill};
    }
  }
  // Combo needs both halves: a partial pair is rendered as a filled slot, so check it independently.
  const combo=slots.find(r=>r.id==='C'&&!r.locked);
  if(combo){
    if(!combo.selected&&(!/Harvest/.test(combo.text)||!/Meteor/.test(combo.text)))return {act:'rnslot',id:'C'};
    if(combo.selected)for(const id of ['harvest','meteor']){
      const card=cards.find(c=>c.id===id);if(!card)continue;
      if(!card.known){if(card.learn&&!card.learn.disabled)return {act:'rnlearn',id};const cost=runeCost(def[id],s);if(card.have===0&&cost&&card.craft&&!card.craft.disabled)return {act:'rncraft',id,cost,smith:true};}
      const row=v.runeRows?.find(r=>r.set?.key===id&&!r.set.disabled);if(card.known&&row)return {act:'rnset',id,fee:row.set.fee};
    }
  }
  // Upgrade the runes in use, preserving reserve and verifying the rendered debit.
  const active=new Set([...LINE,...Object.values(SKILL_PAIRS).map(p=>p[0])]);
  const up=cards.filter(c=>active.has(c.id)&&c.known&&c.up&&!c.up.disabled).sort((a,b)=>a.level-b.level)[0];
  if(up){const cost=catalog?.development?.runeUpgrade?.[up.level];if(cost)return {act:'rnup',id:up.id,cost:{gold:cost.gold,mats:{['rune_'+up.id]:cost.copies,...(cost.ore?{sigil_ore:cost.ore}:{})}},level:up.level};}
  return null;
}
function bestPet(pets=[]){
  const stats=p=>({atk:Number(p.stats?.replace(/,/g,'').match(/ATK\s*([\d.]+)/)?.[1]||0),hp:Number(p.stats?.replace(/,/g,'').match(/HP\s*(\d+)/)?.[1]||0)});
  return pets.filter(p=>p.id&&stats(p).atk>0).sort((a,b)=>(stats(b).atk+stats(b).hp/100)-(stats(a).atk+stats(a).hp/100))[0]||null;
}
function buffChoice(catalog,items,buffs=[]){
  const active=new Set(buffs.map(b=>b.id)),defs=catalog?.items||{};
  const live=buffs.map(b=>defs[b.id]?.use?.buff||{});
  return Object.entries(items||{}).filter(([id,n])=>n>0&&!active.has(id)&&defs[id]?.use?.buff&&
    (defs[id].food||id==='focus_tonic')&&Object.entries(defs[id].use.buff).some(([k,v])=>['exp','hp','regen','mregen','cd'].includes(k)&&v>0)&&
    !live.some(b=>Object.keys(defs[id].use.buff).some(k=>(b[k]||0)>=(defs[id].use.buff[k]||0))))
    .sort(([x],[y])=>{const score=id=>{const b=defs[id].use.buff;return (b.exp||0)*1000+(b.cd||0)*500+(b.hp||0)*100+(b.regen||0)*10+(b.mregen||0)*10;};return score(y)-score(x);})[0]?.[0]||null;
}
function createController({mem,observe,scan,scene,sceneAction,travel,click,scroll,key,open,close,sleep,save,getCatalog,policy={},now=()=>Date.now()}){
  const d=init(mem),reserve=()=>Math.max(100000,policy.goldReserve||0);let actions=0;
  async function view(){const v=await scan();remember(mem,v,now());return v;}
  async function pick(act,id=null,pred=()=>true){
    if(++actions>10)throw Error('Development input budget exhausted');
    let s=await observe(),match=c=>(act.startsWith('#')?c.id===act.slice(1):c.act===act&&(id==null||c.key===id))&&pred(c),m=s.controls.filter(match);
    if(!m.length&&scroll){const off=(s.offscreen||[]).filter(match);if(off.length===1){await scroll(off[0]);await sleep(300);s=await observe();m=s.controls.filter(match);}}
    if(m.length!==1)throw Error('Development control missing or ambiguous');await click(m[0]);await sleep(800);return observe();
  }
  function record(task,detail){d.history.push({task,detail,at:now()});d.history=d.history.slice(-40);d.steps++;}
  async function pay(plan,fn){
    const before=await observe(),cost=plan.cost?.gold??plan.fee??0;
    if(!Number.isFinite(cost)||cost<0||before.gold-cost<reserve())throw Error('Development gold reserve');
    await fn();const after=await observe();
    if(after.crystals!==before.crystals||cost>0&&after.gold!==before.gold-cost||cost===0&&after.gold<before.gold)throw Error('Development debit not acknowledged');
  }
  async function run(task){
    actions=0;const before=await observe();
    try{
      if(task==='tame'){
        await close();const v=await observe();if(!v.controls.some(c=>c.id==='tameYes'))throw Error('Pet offer expired');
        await pick('#tameYes');await open('ranch');const pets=await view();
        if(!pets?.pets?.length)throw Error('Pet acquisition not acknowledged');
        record(task,'Pet acquired through live offer');d.last.pets=0;
      }else if(task==='pets'){
        await open('ranch');let v=await view(),best=bestPet(v?.pets),active=v?.pets?.find(p=>p.active);
        if(best&&!active){await pick('peton',best.id);v=await view();if(!v.pets.some(p=>p.id===best.id&&p.active))throw Error('Summon not acknowledged');record(task,'Summoned '+best.name);}
        else if(best&&active&&best.id!==active.id){
          // Keep accumulated bond; switch only for a substantial native ATK advantage.
          const atk=p=>Number(p.stats.replace(/,/g,'').match(/ATK\s*(\d+)/)?.[1]||0);
          if(atk(best)>atk(active)*1.5&&!/Loyal|ภักดี/.test(active.text)){await pick('peton',best.id);if(!(await view()).pets.some(p=>p.id===best.id&&p.active))throw Error('Pet switch not acknowledged');record(task,'Stronger companion '+best.name);}
        }
        v=await view();active=v?.pets?.find(p=>p.active);
        if(active?.evolve&&!active.evolve.disabled){
          const id=active.id;await pick('pevo',id);const dialog=await observe();
          if(!/evol|วิวัฒนาการ/i.test(dialog.modalText)||!dialog.modalText.includes(active.name))throw Error('Unexpected pet evolution dialog');
          const m=(await observe()).controls.filter(c=>/^(Evolve|Evolution|วิวัฒนาการ)$/i.test(c.label));if(m.length!==1)throw Error('Pet evolution confirmation ambiguous');await click(m[0]);await sleep(900);
          if(!(await view()).pets.some(p=>p.id===id&&p.evolved))throw Error('Pet evolution not acknowledged');record(task,'Companion evolved');
        }
        if(active&&(await observe()).controls.concat((await observe()).offscreen||[]).some(c=>c.act==='ptreat')){const old=active.text;await pick('ptreat');const next=(await view()).pets.find(p=>p.active);if(!next||next.text===old)throw Error('Treat not acknowledged');record(task,'Bond increased with owned treat');}
        d.petStatus=v?.pets?.length?(v.pets.find(p=>p.active)?.name||'Owned pets; summon pending'):'No pets yet; accept next live offer';
      }else if(task==='runes'){
        const nearSmith=before.panel==='smith'||before.controls.some(c=>c.id==='interactBtn'&&/Talk to (Blacksmith|Smith)|คุย.*ช่างตีเหล็ก/i.test(c.label));
        await open('skills');let s=await observe();if(!s.controls.concat(s.offscreen||[]).some(c=>c.act==='rnview'))await pick('rnopen');
        let v=await view();
        const gift=(await observe()).controls.concat((await observe()).offscreen||[]).find(c=>c.act==='rngift');
        if(gift){await pick('rngift');record(task,'Free skill rune dust gift');v=await view();}
        const plan=runeStep(v,getCatalog(),before);d.runesPending=!!plan;d.runeNext=plan?{act:plan.act,id:plan.id,needsSmith:!!plan.smith}:null;
        if(plan){
          if((plan.smith||plan.cost?.gold>0||plan.fee>0)&&!nearSmith){d.runeSmithNeeded=true;d.runesPending=false;}
          else{
            if(plan.cost?.gold){const card=v.runeCards.find(c=>c.id===plan.id),label=plan.act==='rnup'?card?.up?.text:card?.craft?.tip;
              const liveCost=Number(String(label||'').replace(/,/g,'').match(/(\d+)\s*G\b/)?.[1]);if(liveCost!==plan.cost.gold)throw Error('Live rune price differs from catalog');}
            await pay(plan,async()=>{
              await pick(plan.act,plan.id,c=>!plan.skill||c.skill===plan.skill);
              if(plan.confirm){const s=await observe();if(!/free rune|รูนฟรี/i.test(s.modalText))throw Error('Rune gift dialog mismatch');const c=s.controls.filter(c=>/^(Take this rune|Claim this rune|รับรูนนี้)$/i.test(c.label));if(c.length!==1)throw Error('Rune gift confirmation ambiguous');await click(c[0]);await sleep(900);}
              if(plan.act==='rnset'&&plan.fee>0)await pick(plan.act,plan.id,c=>!plan.skill||c.skill===plan.skill);
            });
            const after=await view(),card=after.runeCards.find(c=>c.id===plan.id);
            if(['rnlearn','rnclaim'].includes(plan.act)&&!card?.known||plan.act==='rnup'&&card?.level!==plan.level+1||plan.act==='rncraft'&&card?.have!==(v.runeCards.find(c=>c.id===plan.id)?.have||0)+1||plan.act==='rnset'&&after.runeRows.some(r=>r.set?.key===plan.id))throw Error('Rune outcome not acknowledged');
            d.runeSmithNeeded=false;record(task,plan.act+' '+plan.id);d.runesPending=!!runeStep(after,getCatalog(),before);
          }
        }
      }else if(task==='growth_buffs'){
        await open('bag');let s=await observe();if(!s.inventoryComplete)await pick('ifilter','all');s=await observe();if(!s.inventoryComplete)throw Error('Buff inventory filtered');
        const v=await view(),id=buffChoice(getCatalog(),s.inventoryItems,v.buffs);
        if(id){const count=s.inventoryItems[id];await pick('isel','i:'+id);await pick('iuse',id);const after=await observe(),v2=await view();
          if((after.inventoryItems[id]||0)!==count-1||!v2.buffs.some(b=>b.id===id))throw Error('Buff not acknowledged');record(task,'Active owned buff: '+getCatalog().items[id].name);}
      }else if(task==='growth_evolutions'){
        await open('skills');let s=await observe();if(s.controls.concat(s.offscreen||[]).some(c=>c.act==='rnview'))await pick('rnopen');
        const ids=['fire_bolt','lightning_bolt','blaze','jupiter_thunder','meteor_fall','frost_nova'];d.evolutionChecked ||= {};
        if(!d.evolutionEpoch||now()-d.evolutionEpoch>60*MIN){d.evolutionEpoch=now();d.evolutionChecked={};}
        const id=ids.find(id=>!d.evolutionChecked[id]);d.evolutionsPending=!!id;
        if(id){await pick('sksel',id);s=await observe();const ev=s.skillEvolutions?.filter(c=>c.key===id)||[];
          if(ev.some(c=>c.on))d.evolutionChecked[id]=now();
          else{const b=ev.find(c=>c.branch==='b'&&!c.disabled)||ev.find(c=>!c.disabled);
            if(b){await pick('evo',id,c=>c.branch===b.branch);if(!(await observe()).skillEvolutions.some(c=>c.key===id&&c.branch===b.branch&&c.on))throw Error('Skill evolution not acknowledged');record(task,'Free skill evolution: '+id);}
            d.evolutionChecked[id]=now();}
        }
      }else if(task==='cards'){
        await open('cards');await pick('ctab','col');let v=await view();
        const catalog=getCatalog(),used=new Set((mem.autonomy?.worn||[]).flatMap(w=>w.cards||[]));
        const ranked=(v.cards||[]).filter(c=>c.known&&c.copies>1).map(c=>({...c,score:used.has('card_'+c.id)?100:0,stats:catalog?.development?.cards?.[c.id]||{}}))
          .sort((a,b)=>(b.score+(b.stats.matk||0)*3+(b.stats.int||0)*4+(b.stats.hpP||0)*100)-(a.score+(a.stats.matk||0)*3+(a.stats.int||0)*4+(a.stats.hpP||0)*100));
        let changed=false;
        for(const card of ranked.slice(0,2)){
          await pick('csel',card.id);const s=await observe(),up=[...s.controls,...s.offscreen].find(c=>c.act==='cup'&&c.key===card.id);
          if(up){const old=(await view()).cardDetail;await pick('cup',card.id);if((await view()).cardDetail===old)throw Error('Card upgrade not acknowledged');record(task,'Card level increased: '+card.id);changed=true;break;}
        }
        d.cardsPending=changed;
      }else if(task==='growth_materials'){
        if(!scene||!travel||!sceneAction)throw Error('Resource navigation adapter unavailable');
        let trip=d.excursion;
        if(!trip){
          if(before.hp[0]/before.hp[1]<0.85||before.hpPotions<20||before.mpPotions<20)throw Error('Resource trial needs health and supplies');
          const raw=await scene(),plan=materialPlan(getCatalog(),mem.autonomy?.goal?.missing,raw,before),returnMap=mem.autonomy?.farm?.map;
          d.resourcePlan=plan;if(plan&&returnMap){
            await close();if(before.autoQuestRunning){const stop=(await observe()).controls.filter(c=>c.aq==='stop');if(stop.length!==1)throw Error('Quest stop not unique');await click(stop[0]);await sleep(800);}
            if(/\bon\b/.test((await observe()).autoHunt||''))await pick('#autoBtn');
            if(plan.kind==='boss'){
              await open('bosses');const s=await observe(),boss=s.bossRows.find(b=>b.name===plan.boss&&b.up);
              if(!boss){record(task,'Required boss is not alive; keep leveling');}
              else{d.excursion={...plan,returnMap,started:now(),phase:'travel',map:boss.key.split(',')[0]};save();await pick('bbgo',boss.key);}
            }else{d.excursion={...plan,returnMap,started:now(),phase:'travel'};save();await travel(plan.map);}
          }
        }else{
          const raw=await scene(),s=await observe();
          if(now()-trip.started>5*MIN||s.hp[0]/s.hp[1]<0.65||s.hpPotions<10||s.mpPotions<10||trip.done){
            await close();if(/\bon\b/.test((await observe()).autoHunt||''))await pick('#autoBtn');
            await open('bag');if(!(await observe()).inventoryComplete)await pick('ifilter','all');await observe();await close();
            await travel(trip.returnMap);mem.autonomy.farm=null;mem.autonomy.resume={map:trip.returnMap,mode:'farm',at:now()};
            record(task,'Bounded '+trip.kind+' trip finished; restore leveling');d.excursion=null;
          }else if(raw.available&&raw.map===trip.map){
            if(trip.kind==='mine'){
              if(!raw.mining&&now()-(trip.inputAt||0)>10000){const node=raw.nodes.filter(n=>n.tier===trip.tier).sort((a,b)=>Math.hypot(a.wx-raw.x,a.wy-raw.y)-Math.hypot(b.wx-raw.x,b.wy-raw.y))[0];
                if(node){await close();await sceneAction(node.id,node.tier);trip.inputAt=now();}else trip.done=true;}
              if(raw.mineExp!==trip.mineExp||raw.mineLv!==trip.mineLv){trip.mineExp=raw.mineExp;trip.mineLv=raw.mineLv;d.mining={level:raw.mineLv,exp:raw.mineExp,at:now()};}
            }else if(trip.phase==='travel'){
              await open('auto');await pick('atab','hunt');
              for(const [k,v] of [['target','boss'],['prio','elite']]){const s=await observe();if(!s.controls.concat(s.offscreen||[]).some(c=>c.act==='aopt'&&c.k===k&&c.v===v&&c.on))await pick('aopt',null,c=>c.k===k&&c.v===v);}
              await close();if(!/\bon\b/.test((await observe()).autoHunt||''))await pick('#autoBtn');trip.phase='fight';trip.fightAt=now();
            }else if(now()-trip.fightAt>2*MIN||trip.seen&&s.target!==trip.boss){trip.done=true;}
            else if(s.target===trip.boss)trip.seen=true;
          }
        }
      }else if(task==='growth_rewards'){
        for(const p of ['login','ach']){await open(p);const s=await observe();const acts=s.controls.concat(s.offscreen||[]).filter(c=>p==='login'?c.act==='login':c.act==='achlv'||c.act==='achclaim');
          for(const c of acts.slice(0,1)){await pick(c.act,c.key);record(task,p+' reward checked');}await view();await close();}
      }else if(task==='growth_audit'){
        const panels=['life','book','newbie','bosses','ach','fashion'];const index=d.auditIndex||0,p=panels[index%panels.length];await open(p);await view();d.auditIndex=index+1;
      }else throw Error('Unknown development task');
      d.last[task]=now();delete d.failures[task];d.result={task,ok:true,at:now()};
    }catch(e){d.failures[task]={at:now(),reason:e.message};d.result={task,ok:false,reason:e.message,at:now()};}
    finally{await close();save();}
    return d.result;
  }
  return {run};
}
module.exports={EXPRESSION,SCENE_EXPRESSION,readDevelopment,init,remember,chooseTask,routineReady,runeStep,runeCost,bestPet,buffChoice,materialPlan,createController};
