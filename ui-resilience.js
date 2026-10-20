'use strict';
// A shared, UI-only boundary: never learn a broken initial page as a healthy baseline.
function assess(s={}) {
  const pair=x=>Array.isArray(x)&&x.length===2&&x.every(Number.isFinite)&&x[1]>0&&x[0]>=0&&x[0]<=x[1];
  const fields={name:!!s.name,job:!!s.job,level:/\d+/.test(s.lv||''),jobLevel:/\d+/.test(s.jobLv||''),
    hp:pair(s.hp),mp:pair(s.mp),gold:Number.isFinite(s.gold),crystals:Number.isFinite(s.crystals),zone:!!s.zone,
    exp:Number.isFinite(s.exp)||/EXP\s*MAX/i.test(s.expText||'')};
  const missing=Object.keys(fields).filter(k=>!fields[k]);
  const login=!!(s.atCharSelect&&!s.name&&s.controls?.filter(c=>/^(▶\s*)?Play$/i.test(c.label)).length===1);
  return {missing,loss:missing.length/10,login,blocked:!login&&(missing.length/10>0.3||!fields.name||!fields.level||!fields.hp)};
}
function update(mem,s,now=Date.now()) {
  const a=require('./autonomy').init(mem);
  const h=mem.uiHealth ||= {safeIdle:false,notified:false};
  const report=assess(s);Object.assign(h,report,{checkedAt:now});
  if(s.name)h.character=s.name;
  const emit=type=>{a.events.push({id:++a.sequence,type,at:now,detail:{missing:report.missing,character:h.character}});a.events=a.events.slice(-80);};
  if(report.blocked) {
    h.safeIdle=true;h.healthySince=null;h.badSince??=now;
    // Stop immediately, notify after a sustained observation rather than a loading frame.
    const expectedReload=mem.positionRecovery?.pending&&now-mem.positionRecovery.at<90000||mem.sessionHygiene?.pending&&now-mem.sessionHygiene.pending.at<90000;
    if(!h.notified&&!expectedReload&&now-h.badSince>=15000){emit('ui_changed');h.notified=true;}
  }else {
    h.badSince=null;
    // A login screen cannot establish recovery of the in-game schema.
    if(!report.login) {
      h.healthySince??=now;
      if(!h.safeIdle||now-h.healthySince>=10000){
        if(h.notified)emit('ui_recovered');
        h.safeIdle=false;h.notified=false;
      }
    }
  }
  return h;
}
function assertReady(h,now=Date.now()) {
  if(!h||(h.safeIdle&&!h.login)||h.blocked||now-h.checkedAt>10000)throw Object.assign(Error('UI schema unavailable: Safe Idle'),{code:'UI_SAFE_IDLE'});
}
// Only completed, fully observed HP bars count. A target disappearing, visibly switching,
// healing or a polling gap is censored; HP drops are not assumed to be hit counts.
// The current HUD has no entity UID, so same-name switches remain an uncertainty.
function observeCombat(mem,s,now=Date.now()) {
  const c=mem.combatTelemetry ||= {samples:[],zones:{}};
  const hp=String(s.targetHP||'').replace(/,/g,'').match(/(\d+)\s*\/\s*(\d+)/);
  const ratio=hp&&+hp[2]>0?+hp[1]/+hp[2]:s.targetHpRatio;
  if(!s.name||s.dead||!s.target||!Number.isFinite(ratio)||ratio<0||ratio>1||s.panelOpen||s.mapOpen||s.menuOpen){c.active=null;return c;}
  let p=c.active;
  if(!p||p.name!==s.target||p.identity!==(s.targetIdentity||null)||p.zone!==s.zone||now-p.last>3000||ratio>p.ratio+0.01){
    p=c.active={name:s.target,identity:s.targetIdentity||null,zone:s.zone,at:now,last:now,ratio,full:ratio>=0.95,damaged:false};
  }else {
    if(ratio<p.ratio){p.damaged=true;c.lastDamage={zone:s.zone,at:now};}
    if(ratio===0&&p.ratio>0&&p.full&&p.damaged){
      const seconds=(now-p.at)/1000;
      if(seconds>=0.5&&seconds<=120)c.samples.push({zone:s.zone,target:s.target,seconds,at:now});
      c.active=null;
    }else Object.assign(p,{last:now,ratio});
  }
  c.samples=c.samples.filter(x=>now-x.at<15*60000).slice(-80);
  const here=c.samples.filter(x=>x.zone===s.zone).map(x=>x.seconds).sort((a,b)=>a-b);
  c.current={zone:s.zone,count:here.length,medianSeconds:here.length?here[Math.floor(here.length/2)]:null,estimated:true,at:now};
  return c;
}
module.exports={assess,update,assertReady,observeCombat};
