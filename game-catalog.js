'use strict';
const crypto = require('node:crypto');

// Only immutable public definitions already served to the game page. No player state,
// private endpoints, network intents or game-state mutations are read or executed.
const CATALOG_EXPRESSION = `(()=>Promise.all([import('/src/data.js'),import('/src/world.js'),import('/src/premium-data.js'),fetch('/src/ui.js').then(r=>{if(!r.ok)throw Error('public UI unavailable');return r.text();}),import('/src/rune-data.js'),import('/src/wings-data.js'),import('/src/life-data.js')]).then(([d,w,p,ui,r,,l])=>{
  const cap=ui.match(/p\\.lv\\s*>=\\s*(\\d+)[\\s\\S]{0,180}['\"]EXP MAX/);
  const levelCap=cap?Number(cap[1]):null;
  return JSON.stringify({levelCap,capSource:cap?'public-ui-definition':null,refineMax:d.REFINE_MAX,refineSafe:d.REFINE_SAFE,tileSize:w.TS,
    jobs:Object.fromEntries(Object.entries(d.JOBS).map(([id,j])=>[id,{name:j.name,weapon:d.WEAPON_FAMILY[j.weapon],line:Array.from(d.lineOf(id)),jobTier:d.jobTier(id),jobCap:d.jobMax(id)}])),
    gear:Object.entries(d.GEAR).map(([id,g])=>({id,name:g.name,art:g.art,slot:g.slot,fam:g.fam,line:g.line||null,jt:g.jt||0,wingTier:g.wingTier||0,tier:g.tier,lv:g.lv,stats:g.st||{},craft:d.craftCost(id),upgrade:d.upgradeCost(id)})),
    development:{runes:Object.fromEntries(Object.entries(r.RUNES).map(([id,x])=>{const cost=lv=>r.LEG_RUNES[id]?r.legCost():r.COMBO_COND[id]||r.COMBO_EFF[id]?r.comboCost(lv):r.craftCost(id,lv);return [id,{name:x.name,kind:x.kind,line:x.line||null,craft:cost(1),goldPerLevel:cost(2).gold-cost(1).gold}];})),
      runeUpgrade:Object.fromEntries([1,2,3,4].map(n=>[n,r.upCost(n)])),cards:Object.fromEntries(Object.entries(d.ITEMS).filter(([,i])=>i.card&&i.mon).map(([,i])=>[i.mon,i.card])),
      mining:l.ORE_TIERS.map((t,i)=>({...t,tier:i+1,level:l.TIER_NEED[i],mapLevel:l.TIER_FROM_LV[i]}))},
    monsters:Object.entries(d.MONSTERS).map(([id,m])=>({id,name:m.name,lv:m.lv,hp:m.hp,exp:m.exp,drops:m.drops||[],boss:!!m.boss})),
    maps:Object.entries(w.MAPS).map(([id,m])=>({id,name:m.th,range:m.lv,town:!!m.town,monsters:(m.mons||[]).map(([id,n])=>({id,n}))})),
    items:Object.fromEntries(Object.entries(d.ITEMS).map(([id,i])=>[id,{name:i.name,price:i.price||null,food:!!i.food,lv:i.lv||0,use:i.use||null}])),shop:p.SHOP.filter(i=>['bag','store'].includes(i.id)),
    expByLevel:Object.fromEntries(Array.from({length:Math.min(1000,(levelCap||200)+1)},(_,i)=>[i+1,d.expToNext(i+1)]))});
}))()`;

function validateCatalog(raw, now=Date.now()) {
  const c=typeof raw==='string'?JSON.parse(raw):raw;
  if(!c||!Array.isArray(c.gear)||!c.gear.length||!Array.isArray(c.maps)||!c.maps.length||!Array.isArray(c.monsters)||!c.jobs)throw Error('Incomplete public catalog');
  if(c.levelCap!=null&&(!Number.isSafeInteger(c.levelCap)||c.levelCap<1||c.levelCap>1000))throw Error('Invalid public level cap');
  if(!Number.isSafeInteger(c.refineMax)||c.refineMax<1||c.refineMax>100)throw Error('Invalid refine cap');
  for(const g of c.gear) {
    if(typeof g.id!=='string'||!Number.isFinite(g.lv)||!Number.isFinite(g.tier))throw Error('Invalid gear metadata');
    for(const cost of [g.craft,g.upgrade])if(cost&&(!Number.isFinite(cost.gold)||cost.gold<0||!cost.mats||Object.values(cost.mats).some(n=>!Number.isSafeInteger(n)||n<0)))throw Error('Invalid recipe');
  }
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex');
  return {...c,fingerprint,at:now};
}

function resolveCap(state,catalog) {
  const text=state.expText||'';
  const explicit=/\bEXP\s*(?:MAX|CAPPED)\b|เลเวลสูงสุด|เลเวลตัน/i.test(text);
  const cap=catalog?.levelCap??null, lv=Number(String(state.lv||'').match(/\d+/)?.[0]);
  return {level:cap,atCap:explicit||(cap!=null&&lv>=cap),evidence:explicit?'rendered EXP MAX':cap!=null?catalog.capSource:null,
    jobCap:catalog?.jobs?.[String(state.job||'').toLowerCase()]?.jobCap??null};
}

function bottlenecks(recipe,items={},gold=null) {
  if(!recipe)return [];
  const missing=Object.entries(recipe.mats||{}).filter(([id,n])=>(items[id]??0)<n).map(([id,need])=>({id,need,have:items[id]??0,missing:need-(items[id]??0)}));
  if(gold!=null&&gold<recipe.gold)missing.push({id:'gold',need:recipe.gold,have:gold,missing:recipe.gold-gold});
  return missing;
}

function farmOptions(catalog,state,missing=[],measured={}) {
  if(!catalog)return [];
  const lv=Number(String(state.lv||'').match(/\d+/)?.[0]||0), wanted=new Set(missing.map(x=>x.id));
  const monsters=new Map(catalog.monsters.map(m=>[m.id,m]));
  return catalog.maps.filter(m=>!m.town).map(map=>{
    const mons=map.monsters.map(x=>monsters.get(x.id)).filter(m=>m&&!m.boss&&m.lv<=lv+3&&m.lv>=Math.max(1,lv-25));
    if(!mons.length)return null;
    const measuredRate=measured[map.id];
    const estimated=mons.reduce((sum,m)=>sum+(m.exp||0)/Math.max(1,m.hp||1),0)/mons.length;
    const material=mons.reduce((sum,m)=>sum+m.drops.filter(([id])=>wanted.has(id)).reduce((a,[,p])=>a+p,0),0)/mons.length;
    // Estimates only prioritize a bounded trial. Verified EXP/min is kept separate.
    return {...map,monsterLevel:Math.round(mons.reduce((sum,m)=>sum+m.lv,0)/mons.length),score:wanted.size?material*100+estimated:estimated,materialChance:material,
      measuredExpPerMinute:measuredRate?.expPerMinute??null,estimated:true};
  }).filter(Boolean).filter(m=>!wanted.size||m.materialChance>0).sort((a,b)=>b.score-a.score);
}
module.exports={CATALOG_EXPRESSION,validateCatalog,resolveCap,bottlenecks,farmOptions};
