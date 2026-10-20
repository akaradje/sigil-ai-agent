'use strict';
// Observed task outcomes, not a responsive HTTP endpoint or command timestamps.
const MIN=60000;
const finite=Number.isFinite;
const num=s=>Number(String(s||'').match(/\d+/)?.[0]||0);
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
function init(mem){return mem.activityWatchdog ||= {version:1,sequence:0,history:[],status:'observing'};}
function recent(at,now,ms){return finite(at)&&now>=at&&now-at<=ms;}
function pendingReload(mem,now){return [mem.positionRecovery,mem.uiRecovery,mem.sessionHygiene?.pending].some(r=>r?.pending!==false&&recent(r?.at,now,90000))||mem.activityWatchdog?.incident?.lastAction==='reload'&&recent(mem.activityWatchdog.incident.attemptedAt,now,90000);}
function snapshot(mem,s,catalog,now){
  const a=mem.autonomy||{},d=mem.development||{},t=mem.gameTelemetry,trip=d.excursion;
  if(!s.name||s.dead||s.disconnected||s.atCharSelect||mem.uiHealth?.safeIdle||!t?.validated||t.loading||t.positionFault||!recent(t.checkedAt,now,5000)||pendingReload(mem,now))return null;
  const map=catalog?.maps.find(m=>norm(m.name)===norm(s.zone));if(!map)return null;
  const destination=trip?.map||a.resume?.map||(!map.town&&a.farm?.map);
  const classGoal=now>=(mem.trainingUntil||0)&&mem.classAdvancement?.character===s.name&&mem.classAdvancement?.from===s.job&&s.jobQuestProgress;
  const mode=classGoal?'class':destination&&destination!==map.id?'travel':trip?.kind==='mine'?'mine':trip?.kind==='boss'?'combat':map.town?'town':'combat';
  const resource=d.activityResource;
  if(mode==='mine'&&(!resource||resource.map!==map.id||!recent(resource.at,now,30000)||!finite(resource.level)||!finite(resource.exp)))return null;
  const needed=new Set((a.goal?.missing||[]).map(m=>m.id));
  const receipts=(a.events||[]).filter(e=>['equipment_sold','capacity_bought','wing_completed','bank_equipment_sold'].includes(e.type)).map(e=>e.id);
  const objectiveBoss=classGoal?.match?.(/Hunt\s+(.+?)\s+0\s*\/\s*1\b/i)?.[1]?.trim()||(/Chrono Gear\s*0\s*\/\s*1/i.test(classGoal||'')?'Time Eater':null);
  return {character:s.name,className:s.job,zone:s.zone,map:map.id,mode,objective:classGoal||null,x:t.x,y:t.y,level:num(s.lv),exp:s.exp,job:num(s.jobLv),jobExp:s.jobExp,
    hpPotions:s.hpPotions,mpPotions:s.mpPotions,bag:a.bagUsage?.[0],sales:a.trip?.sales||0,deposits:a.trip?.deposits||0,
    forge:Math.max(a.refine?.at||0,a.advancedForge?.at||0),receipt:Math.max(0,...receipts),
    mineLevel:resource?.level,mineExp:resource?.exp,materials:Object.fromEntries(Object.entries(resource?.materials||{}).filter(([id])=>needed.has(id))),
    fighting:(mode==='combat'||mode==='class'&&objectiveBoss&&String(s.target||'').includes(objectiveBoss))&&mem.combatTelemetry?.lastDamage?.zone===s.zone&&recent(mem.combatTelemetry.lastDamage.at,now,10000)};
}
function gained(before,after){
  if(!before)return false;
  if(after.mode==='class')return after.objective!==before.objective||after.fighting;
  if(after.level>before.level||after.job>before.job||finite(after.exp)&&after.exp>before.exp||finite(after.jobExp)&&after.jobExp>before.jobExp)return true;
  if(after.mode==='combat')return after.fighting;
  if(after.mode==='mine')return after.mineLevel>before.mineLevel||after.mineExp>before.mineExp||Object.entries(after.materials).some(([id,n])=>finite(n)&&finite(before.materials?.[id])&&n>before.materials[id]);
  return after.mode==='town'&&(after.sales>before.sales||after.deposits>before.deposits||after.receipt>before.receipt||after.forge>before.forge||
    finite(after.bag)&&finite(before.bag)&&after.bag<before.bag||after.hpPotions>before.hpPotions||after.mpPotions>before.mpPotions);
}
function emit(mem,type,detail,now){const a=mem.autonomy;if(!a)return;a.events.push({id:++a.sequence,type,detail,at:now});a.events=a.events.slice(-80);}
function observe(mem,s,catalog,{paused=false,offline=false}={},now=Date.now()){
  const w=init(mem),v=!paused&&!offline&&snapshot(mem,s,catalog,now);
  if(!v){w.baseline=null;w.since=null;w.lastAt=now;w.samples=0;w.status='suspended';return w;}
  const continuous=recent(w.lastAt,now,15000)&&w.lastAt<now;
  const same=w.baseline?.character===v.character&&w.baseline?.zone===v.zone&&w.baseline?.mode===v.mode;
  const productive=same&&gained(w.baseline,v)||w.baseline?.mode==='class'&&w.baseline.character===v.character&&w.baseline.className!==v.className;
  const moved=same&&v.mode==='travel'&&[v.x,v.y,w.anchor?.x,w.anchor?.y].every(finite)&&Math.hypot(v.x-w.anchor.x,v.y-w.anchor.y)>=32;
  if(productive||moved){
    if(w.incident?.attemptedAt&&now>w.incident.attemptedAt){emit(mem,'activity_recovered',{mode:v.mode,reason:w.incident.reason,action:w.incident.lastAction},now);w.lastRecovery={at:now,mode:v.mode,action:w.incident.lastAction};}
    w.incident=null;w.pending=null;w.stage=0;w.since=now;w.samples=1;w.anchor={x:v.x,y:v.y};w.status='productive';
  }else if(!continuous||!same){w.since=now;w.samples=1;w.anchor={x:v.x,y:v.y};w.status=w.incident?.attemptedAt?'verifying':'observing';}
  else w.samples++;
  w.baseline=v;w.lastAt=now;
  const limit=v.mode==='mine'||v.mode==='town'?5*MIN:3*MIN;
  if(now-w.since>=limit&&w.samples>=30&&(!w.incident?.attemptedAt||now-w.incident.attemptedAt>=2*MIN)){
    w.incident ||= {id:++w.sequence,at:now,mode:v.mode,reason:v.mode==='class'?'CLASS_OBJECTIVE_STALLED':v.mode==='mine'?'MINING_STALLED':v.mode==='town'?'TOWN_STALLED':v.mode==='travel'?'TRAVEL_STALLED':'COMBAT_IDLE'};
    const history=(w.history||[]).filter(h=>recent(h.at,now,60*MIN));
    if(history.length>=3||w.stage>=3){
      if(w.status!=='escalated')emit(mem,'activity_escalated',{reason:w.incident.reason},now);
      w.status='escalated';w.pending=null;
    }else{w.pending ||= {incident:w.incident.id,action:w.stage===1?'reload':w.stage===2?'restart':'resume'};w.status='recovery-pending';}
    w.evidence={at:now,mode:v.mode,map:v.map,durationSec:Math.floor((now-w.since)/1000),samples:w.samples,attempts:w.stage||0};
  }
  return w;
}
function safeToRecover(mem,s,now=Date.now()){
  const a=mem.autonomy||{},t=mem.gameTelemetry;
  return !!s.name&&!s.dead&&!s.disconnected&&!s.atCharSelect&&!mem.uiHealth?.safeIdle&&t?.validated&&!t.loading&&!t.positionFault&&recent(t.checkedAt,now,5000)&&
    !s.modalText&&!['reserved','unknown'].includes(a.purchase?.status)&&!['confirming','uncertain'].includes(a.saleIntent?.status)&&!pendingReload(mem,now)&&
    !(a.wingCraft&&a.wingCraft.status!=='equipped')&&!mem.classTrip&&!mem.classBossTrip&&!(mem.classAdvancement&&!mem.classAdvancement.completedAt&&now>=(mem.trainingUntil||0));
}
function take(mem,s,now=Date.now()){
  const w=init(mem);if(!w.pending||!safeToRecover(mem,s,now))return null;
  const history=(w.history||[]).filter(h=>recent(h.at,now,60*MIN));if(history.length>=3)return null;
  const action=w.pending.action;w.history=[...history,{at:now,action,incident:w.pending.incident}];w.stage=(w.stage||0)+1;
  w.incident.attemptedAt=now;w.incident.lastAction=action;w.pending=null;w.status='verifying';
  emit(mem,'activity_recovery',{reason:w.incident.reason,action,mode:w.incident.mode},now);return action;
}
function cycleHung(mem,{busy,startedAt,paused,offline},now=Date.now()){
  const w=init(mem),history=(w.history||[]).filter(h=>recent(h.at,now,60*MIN));
  return !!busy&&!paused&&!offline&&finite(startedAt)&&now-startedAt>=150000&&history.length<3&&!history.some(h=>h.action==='restart');
}
function reserveRestart(mem,now=Date.now()){
  const w=init(mem);w.history=[...(w.history||[]).filter(h=>recent(h.at,now,60*MIN)),{at:now,action:'restart',reason:'CYCLE_HUNG'}];
  emit(mem,'activity_recovery',{reason:'CYCLE_HUNG',action:'restart'},now);
}
async function recover(mem,s,action,{autonomy,development,executor,catalog,policy,persist,reload,restart,now=Date.now}){
  await executor.close();
  if(action==='reload')return reload();
  if(action==='restart')return restart();
  const a=mem.autonomy||{},d=mem.development||{},w=init(mem);
  if(d.excursion){
    const trip=d.excursion;trip.done=true;trip.stalled=true;d.resourceBackoffUntil=now()+30*MIN;
    d.resourceStalled={at:now(),map:trip.map,tier:trip.tier,samples:w.evidence?.samples||0,durationSec:w.evidence?.durationSec||0};
    persist();return development.run('growth_materials');
  }
  if(a.trip)return autonomy.run('town');
  if(a.resume||a.farm&&norm(a.farm.name)===norm(s.zone))return autonomy.run('autonomy_wait');
  if(policy.levelingFocus&&s.hp?.[1]>0&&s.hp[0]/s.hp[1]>=0.75&&s.hpPotions>10&&s.mpPotions>10&&a.bagUsage?.[0]<a.bagUsage?.[1])return autonomy.run('farm');
  return autonomy.run(require('./autonomy').chooseTask(mem,s,catalog,now(),policy)||'autonomy_wait');
}
module.exports={init,observe,take,cycleHung,reserveRestart,recover};
