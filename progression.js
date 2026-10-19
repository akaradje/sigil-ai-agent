'use strict';
const MIN=60000;
const lv=s=>Number(String(s?.lv||'').match(/\d+/)?.[0]||0);
function bracketHold(s,catalog) {
  const level=lv(s),nextLevel=level+1,job=catalog?.jobs?.[String(s.job||'').toLowerCase()];
  const capped=/EXP\s*MAX/i.test(s.expText||'')||catalog?.levelCap!=null&&level>=catalog.levelCap;
  const active=!capped&&level%10===9&&Number.isFinite(s.exp)&&s.exp>50;
  const unlocks=(catalog?.gear||[]).filter(g=>g.lv===nextLevel&&(!g.line||job?.line?.includes(g.line))&&
    (g.slot!=='weapon'||!g.fam||job?.weapon===g.fam)).map(g=>({id:g.id,name:g.name,slot:g.slot,tier:g.tier}));
  return {active,level,nextLevel,unlocks};
}
function updateBracket(mem,s,catalog,now=Date.now()) {
  const level=lv(s);if(!s.name||!level)return null;
  const p=mem.bracketPolicy ||= {character:s.name,lastLevel:level};
  if(p.character!==s.name){mem.bracketPolicy={character:s.name,lastLevel:level};return updateBracket(mem,s,catalog,now);}
  if(level>p.lastLevel&&Math.floor(level/10)>Math.floor(p.lastLevel/10))p.recheck={level,at:now};
  p.lastLevel=level;
  if(p.recheck&&catalog?.at>=p.recheck.at){p.lastRecheck={...p.recheck,catalogAt:catalog.at};p.recheck=null;}
  const hold=bracketHold(s,catalog);
  return {...hold,active:hold.active||!!p.recheck,awaitingCatalog:!!p.recheck};
}
function forgeDecision(c,s,mem,catalog,now=Date.now()) {
  const hold=mem.autonomy?.resourceHold||bracketHold(s,catalog);
  const direct=['craft','upg','refine'].includes(c.act)||!c.act&&s.panel==='smith'&&/^(Craft|Refine|Upgrade|ตีบวก|คราฟต์|อัปขั้น)/i.test(c.label||'');
  const confirm=!direct&&!!s.modalText&&/craft|refine|upgrade|คราฟต์|ตีบวก|อัปขั้น/i.test(s.modalText)&&/^(Confirm|Refine|Craft|Upgrade|ยืนยัน|ตีบวก|คราฟต์)$/i.test(c.label||'');
  if(!direct&&!confirm)return {allowed:true};
  const slot=direct?(c.act==='craft'?catalog?.gear?.find(g=>g.id===c.key)?.slot:mem.autonomy?.worn?.find(w=>w.uid===c.key)?.slot):
    mem.forgeIntent?.character===s.name&&now-mem.forgeIntent.at<30000?mem.forgeIntent.slot:null;
  return {allowed:!hold.active||slot==='weapon',slot,forge:true};
}
function absoluteExp(catalog,level,percent=0) {
  if(!Number.isInteger(level)||level<1||!Number.isFinite(percent)||percent<0||percent>100)return null;
  let total=0;
  for(let i=1;i<level;i++){const n=catalog?.expByLevel?.[i];if(!Number.isFinite(n)||n<=0)return null;total+=n;}
  const step=catalog?.expByLevel?.[level];
  return percent===0?total:Number.isFinite(step)&&step>0?total+percent/100*step:null;
}
function rankRows(rank,name,now,targetRank=10) {
  if(!rank||rank.kind!=='lv'||rank.character!==name||!Number.isFinite(rank.at)||now-rank.at>20*MIN||rank.at>now+MIN)return null;
  const rows=(Array.isArray(rank.rows)?rank.rows:[]).map(r=>{
    const a=String(r.text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const position=({'🥇':1,'🥈':2,'🥉':3})[a[0]]||(/^\d+$/.test(a[0])?Number(a[0]):null);
    const level=Number(a.at(-1)?.match(/^Lv\s+(\d+)$/i)?.[1]);
    return {name:a[1],rank:position,level,own:r.own===true};
  });
  if(rows.filter(r=>r.own).length!==1)return null;
  const own=rows.filter(r=>r.own&&r.name===name),cut=rows.filter(r=>r.rank===targetRank&&r.name&&r.level>0);
  return own.length===1&&own[0].rank>0&&cut.length===1?{own:own[0],cutoff:cut[0],at:rank.at}:null;
}
function updateCatchUp(mem,s,catalog,now=Date.now(),targetRank=10) {
  targetRank=targetRank===5?5:10;
  const value=absoluteExp(catalog,lv(s),s.exp);if(!s.name||value==null)return null;
  let t=mem.catchUp;
  if(!t||t.character!==s.name||t.fingerprint!==catalog?.fingerprint||t.targetRank!==targetRank)t=mem.catchUp={character:s.name,targetRank,fingerprint:catalog?.fingerprint,ownSamples:[],cutoffSamples:[]};
  const sample=t.ownSamples.at(-1);
  if(!sample||now-sample.at>=MIN)t.ownSamples.push({at:now,value});
  t.ownSamples=t.ownSamples.filter(x=>now-x.at<2*3600000).slice(-121);
  const rank=rankRows(mem.rank,s.name,now,targetRank);
  const result=t.current={at:now,targetRank,status:'waiting',etaMovingMinutes:null,etaStaticMinutes:null};
  if(!rank)return result;
  Object.assign(result,{rank:rank.own.rank,rankAt:rank.at,cutoff:rank.cutoff});
  if(rank.own.rank<=targetRank){result.status=targetRank===5?'top5':'top10';return result;}
  if(catalog?.levelCap!=null&&rank.cutoff.level>=catalog.levelCap){result.status='cap-tie';return result;}
  const low=absoluteExp(catalog,rank.cutoff.level),high=absoluteExp(catalog,rank.cutoff.level+1);
  if(low==null||high==null)return result;
  result.gapExp=[Math.max(0,low-value),Math.max(0,high-value)];
  const last=t.cutoffSamples.at(-1);
  if(now-rank.at<90000&&(!last||rank.at>last.at))t.cutoffSamples.push({at:rank.at,name:rank.cutoff.name,level:rank.cutoff.level,low,high});
  t.cutoffSamples=t.cutoffSamples.filter(x=>now-x.at<2*3600000).slice(-30);
  const own=t.ownSamples.find(x=>now-x.at>=10*MIN&&now-x.at<=60*MIN);
  const ownRate=own&&value>=own.value?(value-own.value)/((now-own.at)/MIN):null;
  result.ownWallExpPerMinute=ownRate==null?null:Math.round(ownRate);
  const a=mem.autonomy,recent=a?.expRateAt&&now-a.expRateAt<3*MIN&&a.expRateZone===s.zone;
  const farmRate=recent&&a.expPerMinute>0?a.expPerMinute:null;
  if(farmRate)result.etaStaticMinutes=result.gapExp.map(x=>Math.ceil(x/farmRate));
  result.status='uncertain';
  const current=t.cutoffSamples.at(-1);
  const previous=current&&t.cutoffSamples.find(x=>x.name===current.name&&current.at-x.at>=20*MIN);
  if(!previous||ownRate==null||now-current.at>20*MIN)return result;
  const mins=(current.at-previous.at)/MIN;
  const growth=[Math.max(0,(current.low-previous.high)/mins),Math.max(0,(current.high-previous.low)/mins)];
  result.cutoffGrowthBounds=growth.map(Math.round);
  if(ownRate>growth[1]){
    const age=Math.max(0,(now-rank.at)/MIN),gap=[Math.max(0,low+growth[0]*age-value),Math.max(0,high+growth[1]*age-value)];
    result.status='closing';result.etaMovingMinutes=[Math.ceil(gap[0]/(ownRate-growth[0])),Math.ceil(gap[1]/(ownRate-growth[1]))];
  }else if(ownRate<growth[0])result.status='falling';
  else if(ownRate===0&&growth[0]===0)result.status='flat';
  return result;
}
module.exports={bracketHold,updateBracket,forgeDecision,absoluteExp,rankRows,updateCatchUp};
