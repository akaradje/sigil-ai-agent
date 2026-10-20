'use strict';
const {absoluteExp,rankRows}=require('./progression');
const {resolveCap}=require('./game-catalog');
const crypto=require('node:crypto');
const MIN=60000;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function init(mem){return mem.proactive ||= {version:1,idleSince:null,lastProbe:0,probeAttempts:0,context:null,samples:[],opportunities:[]};}
function managed(mem,s){return !!(mem.autonomy?.trip||mem.autonomy?.resume||mem.development?.excursion||mem.classTrip||mem.classBossTrip||mem.sessionHygiene?.pending||mem.positionRecovery?.pending||s.panelOpen||s.menuOpen||s.mapOpen||s.modalText);}
function available(mem,s,catalog,now){const t=mem.gameTelemetry;return !!(catalog&&s.name&&!s.disconnected&&!s.atCharSelect&&!s.dead&&s.hp&&s.hp[1]>0&&s.hp[0]/s.hp[1]>=0.75&&!mem.uiHealth?.safeIdle&&t?.validated&&!t.loading&&!t.positionFault&&now>=t.checkedAt&&now-t.checkedAt<=5000);}
function offer(p,reason,evidence,context,now){const key=hash([reason,context]);if(p.opportunities.some(o=>o.key===key))return;
  p.opportunities.push({key,reason,evidence,at:now});p.opportunities=p.opportunities.slice(-30);}
function update(mem,s,catalog,now=Date.now()){
  const p=init(mem),lv=Number(String(s.lv||'').match(/\d+/)?.[0]),cap=resolveCap(s,catalog);
  const stalled=mem.development?.resourceStalled;
  if(stalled&&now-stalled.at>=0&&now-stalled.at<60*MIN&&stalled.samples>=10&&stalled.durationSec>=300)
    offer(p,'VERIFIED_RESOURCE_STALL',stalled,[s.name,catalog?.fingerprint,stalled.map,stalled.tier],now);
  const context=hash([s.name,s.job,lv,catalog?.fingerprint,mem.dna?.context,s.zone]);
  if(p.context!==context){p.context=context;p.samples=[];p.idleSince=null;}
  const free=available(mem,s,catalog,now)&&!managed(mem,s)&&!mem.autonomy?.resourceHold?.active;
  const fighting=mem.combatTelemetry?.lastDamage?.zone===s.zone&&now-mem.combatTelemetry.lastDamage.at>=0&&now-mem.combatTelemetry.lastDamage.at<=10000;
  if(!free||fighting||mem.cognitive?.workingMemory?.learningPhase==='measuring')p.idleSince=null;
  else p.idleSince ??=now;
  const exp=absoluteExp(catalog,lv,s.exp),power=mem.equipment?.power;
  if(!free||!fighting||exp===null||cap.atCap){p.samples=[];}
  else if(!p.samples.length||now-p.samples.at(-1).at>=MIN){
    if(p.samples.length&&now-p.samples.at(-1).at>2*MIN)p.samples=[];
    p.samples.push({at:now,exp,power:Number.isFinite(power)?power:null});p.samples=p.samples.filter(x=>now-x.at<=35*MIN).slice(-36);
    const first=p.samples[0],last=p.samples.at(-1);
    if(p.samples.length>=25&&now-first.at>=30*MIN&&last.exp===first.exp&&first.power!==null&&last.power===first.power)
      offer(p,'VERIFIED_GROWTH_PLATEAU',{durationSec:(now-first.at)/1000,samples:p.samples.length,expDelta:0,powerDelta:0},context,now);
  }
  const rank=rankRows(mem.rank,s.name,now,10);
  if(free&&rank&&rank.own.rank>10&&rank.own.level<rank.cutoff.level&&!cap.atCap&&p.samples.length>=10)
    offer(p,'BEHIND_TOP_TEN',{rank:rank.own.rank,level:rank.own.level,cutoffLevel:rank.cutoff.level,rankAt:rank.at},context,now);
  if(cap.atCap&&mem.autonomy?.gearCapped)offer(p,'VERIFIED_CAP_STOCKPILE',{levelCap:cap.level,evidence:cap.evidence,gearCapped:true},[s.name,catalog?.fingerprint],now);
  return p;
}
function probeDue(mem,s,catalog,now=Date.now()){
  const p=init(mem);return available(mem,s,catalog,now)&&!managed(mem,s)&&!s.autoQuestRunning&&!mem.autonomy?.resourceHold?.active&&
    Array.isArray(mem.autonomy?.bagUsage)&&mem.autonomy.bagUsage[1]>0&&mem.autonomy.bagUsage[0]<mem.autonomy.bagUsage[1]*0.95&&
    !mem.autonomy?.blocked&&Number.isFinite(s.hpPotions)&&s.hpPotions>20&&Number.isFinite(s.mpPotions)&&s.mpPotions>20&&
    p.idleSince!==null&&now-p.idleSince>=2*MIN&&now-p.lastProbe>=10*MIN&&!(mem.deaths||[]).some(t=>now-t<5*MIN);
}
function prioritizeProbe(mem,s,catalog,{planned,growth}={},now=Date.now()){
  return !['reconnect','revive','survive','boss_break','boss_engage','class_boss','boss_build','job_retry','class','stats','skills'].includes(planned)&&growth!=='tame'&&probeDue(mem,s,catalog,now);
}
function opportunities(mem,knowledge,now=Date.now()){
  return [...(knowledge?.opportunities||[]),...(init(mem).opportunities||[])].filter(o=>now-o.at>=0&&now-o.at<24*60*MIN).slice(-20);
}
module.exports={init,managed,available,update,probeDue,prioritizeProbe,opportunities};
