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
// Read-only combat measurement from the rendered HUD: the target HP bar is the
// only damage evidence the agent may read. A finished engagement becomes a
// measured kill time, which the brain (UCB) and the autonomy both need.
function combatSample(mem, state, now = Date.now()) {
  const t = mem.combatTelemetry = mem.combatTelemetry || {};
  const target = String(state.target || '').trim();
  const zone = String(state.zone || '').trim();
  const ratio = Number.isFinite(state.targetHpRatio) ? state.targetHpRatio : null;
  const active = t.active;
  if (!target || ratio == null) {
    // The target is gone: an engagement that made progress is a measured kill.
    if (active && active.startedAt && now > active.startedAt && active.lastRatio != null && active.lastRatio < 1) {
      const seconds = (now - active.startedAt) / 1000;
      if (seconds >= 0.4) {
        const samples = (t.samples || []).concat([{ zone: active.zone, seconds, at: now }]).slice(-40);
        t.samples = samples;
        const times = samples.filter(s => s.zone === active.zone).map(s => s.seconds).sort((a, b) => a - b);
        t.current = { zone: active.zone, at: now, count: times.length, medianSeconds: Math.round(times[Math.floor(times.length / 2)] * 100) / 100 };
      }
    }
    t.active = null;
    return t;
  }
  if (!active || active.target !== target) {
    t.active = { target, zone, startedAt: now, lastRatio: ratio, lastAt: now };
    return t;
  }
  active.lastAt = now;
  if (ratio < active.lastRatio) t.lastDamage = { zone, at: now, target, from: active.lastRatio, to: ratio };
  active.lastRatio = ratio;
  return t;
}
function recoveryDue(mem,now=Date.now()) {
  const r=mem.positionRecovery||{},history=(r.history||[]).filter(t=>now-t<3600000);
  return !!mem.gameTelemetry?.confirmed&&now-(r.at||0)>=600000&&history.length<3;
}
module.exports={EXPRESSION,readPublicState,update,combatSample,recoveryDue};
