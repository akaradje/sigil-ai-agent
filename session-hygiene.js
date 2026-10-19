'use strict';
const HOUR=3600000;
function observe(mem,telemetry,now=Date.now()) {
  const h=mem.sessionHygiene ||= {};
  const start=telemetry?.sessionStartedAt;
  if(Number.isFinite(start)&&start>now-30*24*HOUR&&start<=now+60000)h.startedAt=start;
  h.ageHours=h.startedAt==null?null:Math.max(0,(now-h.startedAt)/HOUR);
  return h;
}
function due(mem,now=Date.now(),hours=6) {
  const h=mem.sessionHygiene;
  return !!h&&!h.pending&&Number.isFinite(h.startedAt)&&now-h.startedAt>=hours*HOUR&&now-(h.lastAttempt||0)>=hours*HOUR;
}
function eligible(mem,s,catalog,now=Date.now(),hours=6) {
  const a=mem.autonomy,t=mem.gameTelemetry,h=a?.trip?.hygiene;
  const town=catalog?.maps?.some(m=>m.town&&m.id===t?.map&&String(m.name).replace(/\s+/g,' ').trim()===String(s.zone||'').replace(/\s+/g,' ').trim());
  return due(mem,now,hours)&&town&&t.validated&&!t.positionFault&&now-t.checkedAt<5000&&
    a?.trip?.phase==='return'&&h?.ready&&now-h.readyAt<90000&&h.bagUsage?.[0]<Math.floor(h.bagUsage?.[1]*0.95)&&
    s.hp?.[0]>0&&!s.dead&&s.hpPotions>=20&&s.mpPotions>=20&&!s.target&&!s.autoQuestRunning&&!/\bon\b/.test(s.autoHunt||'')&&
    !s.panelOpen&&!s.menuOpen&&!s.mapOpen&&!s.modalText&&!mem.uiHealth?.safeIdle&&
    !['reserved','unknown'].includes(a.purchase?.status)&&!(mem.forgeIntent&&now-mem.forgeIntent.at<30000);
}
function prepare(mem,now=Date.now()) {
  const h=mem.sessionHygiene,trip=mem.autonomy.trip;
  h.pending={at:now,previousStart:h.startedAt};h.lastAttempt=now;
  mem.autonomy.resume={map:trip.returnMap,mode:trip.returnMode||'mq',at:now};mem.autonomy.trip=null;mem.autonomy.farm=null;
}
function completed(mem,s,now=Date.now()) {
  const h=mem.sessionHygiene,t=mem.gameTelemetry;
  if(!h?.pending||!t?.validated||t.positionFault||mem.uiHealth?.safeIdle||h.startedAt<=h.pending.previousStart||
    !(s.autoQuestRunning||/\bon\b/.test(s.autoHunt||'')))return false;
  h.completedAt=now;h.pending=null;return true;
}
module.exports={observe,due,eligible,prepare,completed};
