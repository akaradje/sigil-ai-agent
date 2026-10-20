'use strict';
// game/main.js explicitly exposes window.SIGIL for console inspection. Read a
// narrow allowlist only: never serialize G, the player object, link or credentials.
function readPublicState() {
  const g=window.SIGIL,p=g?.p,w=g?.world;
  if(!g||!p||!w)return {available:false};
  const number=x=>Number.isFinite(x)?x:null;
  return {available:true,running:!!g.running,ready:!!g.ready,loading:!!g.mapLoad||!!g.fade,
    sessionStartedAt:typeof performance==='object'&&Number.isFinite(performance.timeOrigin)?performance.timeOrigin:null,
    map:typeof p.map==='string'?p.map:null,world:typeof w.id==='string'?w.id:null,
    x:number(p.x),y:number(p.y),width:number(w.w),height:number(w.h),
    bossWardRatio:number(parseFloat(globalThis.document?.querySelector('#bossMech .wb>b')?.style.width)/100),
    targetId:['string','number'].includes(typeof p.target)?String(p.target).slice(0,100):null};
}
const EXPRESSION='JSON.stringify(('+readPublicState.toString()+')())';
function update(mem,raw,tileSize,now=Date.now()) {
  const previous=mem.gameTelemetry||{};
  const usable=raw?.available&&raw.running&&raw.ready&&!raw.loading&&typeof raw.map==='string'&&raw.map.length>0&&raw.map===raw.world&&
    [raw.x,raw.y,raw.width,raw.height,tileSize].every(Number.isFinite)&&raw.width>0&&raw.height>0&&tileSize>0;
  const outside=!!(usable&&(raw.x<0||raw.y<0||raw.x>=raw.width*tileSize||raw.y>=raw.height*tileSize));
  const t=mem.gameTelemetry={...raw,validated:!!usable,checkedAt:now,outside,badSince:outside?(previous.outside?previous.badSince:now):null};
  // Loading/unavailable telemetry cannot establish a position fault or recovery.
  t.positionFault=usable?outside:previous.positionFault||false;
  t.confirmed=outside&&now-t.badSince>=30000;
  return t;
}
function recoveryDue(mem,now=Date.now()) {
  const r=mem.positionRecovery||{},history=(r.history||[]).filter(t=>now-t<3600000);
  return !!mem.gameTelemetry?.confirmed&&now-(r.at||0)>=600000&&history.length<3;
}
module.exports={EXPRESSION,readPublicState,update,recoveryDue};
