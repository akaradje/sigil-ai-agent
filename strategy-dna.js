'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {absoluteExp}=require('./progression');
const MIN=60000,HOUR=60*MIN;
const DEFAULT=Object.freeze({hpPotionThreshold:0.6,bagReturnThreshold:0.95,ttkToleranceSec:4,skillScope:'ALL_LEARNED',craftPriorityBias:'DPS_FIRST'});
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,20);
function genes(raw={}) {
  return {hpPotionThreshold:raw.hpPotionThreshold===0.4?0.4:0.6,
    bagReturnThreshold:[0.9,0.95].includes(raw.bagReturnThreshold)?raw.bagReturnThreshold:0.95,
    ttkToleranceSec:Number.isFinite(raw.ttkToleranceSec)?Math.round(Math.max(3,Math.min(6,raw.ttkToleranceSec))*10)/10:4,
    skillScope:raw.skillScope==='HOTBAR'?'HOTBAR':'ALL_LEARNED',
    // Spending priorities are not mutated: crafted items cannot be rolled back.
    craftPriorityBias:'DPS_FIRST'};
}
const profile=mem=>genes(mem?.dna?.genes||DEFAULT);
function nativeControl(c,mem) {
  const g=profile(mem);
  if(c.act==='aopt'&&(c.k==='hp'&&c.v!==String(Math.round(g.hpPotionThreshold*100))||c.k==='mp'&&c.v!=='30'||c.k==='stopNoPot'&&c.v==='false'))return {allowed:false};
  if(c.act==='ahot'){
    const desired=g.skillScope==='HOTBAR'?/Hotbar|ช่องลัด/i:/All learned|ทุกสกิลที่เรียน/i;
    if(desired.test(c.label||''))return {allowed:true};
    if(/All learned|ทุกสกิลที่เรียน/i.test(c.label||''))return {allowed:true,invalidate:true};
    return {allowed:false};
  }
  return {allowed:true};
}
function offspring(elite,parent=elite,random=Math.random,allowLowHP=false) {
  const original=genes(elite),other=genes(parent),keys=['bagReturnThreshold','ttkToleranceSec','skillScope',...(allowLowHP?['hpPotionThreshold']:[])];
  const key=keys[Math.min(keys.length-1,Math.floor(random()*keys.length))],child={...original};
  // One-locus crossover, or a micro-mutation if both parents have the same allele.
  if(other[key]!==original[key])child[key]=other[key];
  else if(key==='bagReturnThreshold')child[key]=original[key]===0.95?0.9:0.95;
  else if(key==='hpPotionThreshold')child[key]=original[key]===0.6?0.4:0.6;
  else if(key==='skillScope')child[key]=original[key]==='ALL_LEARNED'?'HOTBAR':'ALL_LEARNED';
  else {child[key]=Math.max(3,Math.min(6,original[key]+(random()<0.5?-0.2:0.2)));if(child[key]===original[key])child[key]+=original[key]===3?0.2:-0.2;}
  return genes(child);
}
function arm(g){g=genes(g);return {id:hash(g),genes:g,n:0,mean:0,m2:0,results:[],blockedUntil:0};}
function record(a,r) {a.n++;const d=r.score-a.mean;a.mean+=d/a.n;a.m2+=d*(r.score-a.mean);a.results.push(r);a.results=a.results.slice(-6);}
function select(arms,total,now) {
  return arms.filter(a=>a.blockedUntil<=now).map(a=>({a,score:a.n?a.mean+0.15*Math.sqrt(2*Math.log(Math.max(2,total))/a.n):Infinity}))
    .sort((x,y)=>y.score-x.score)[0]?.a||null;
}
function fitness(w,end,now) {
  const minutes=(now-w.at)/MIN,exp=Math.max(0,end.exp-w.exp),gold=end.gold-w.gold;
  if(minutes<=0||![exp,gold,w.expStep].every(Number.isFinite))return null;
  const hp=Math.max(0,w.hpPots+(end.hpBought-w.hpBought)-end.hpPots),mp=Math.max(0,w.mpPots+(end.mpBought-w.mpBought)-end.mpPots);
  const potionRate=(hp+mp)/minutes,expRate=exp/minutes,goldRate=gold/minutes;
  const score=expRate/Math.max(1,w.expStep)+0.03*goldRate/10000+0.01*w.rare/minutes-0.01*potionRate-2*w.deaths-0.2*w.stuckMinutes;
  return {score,expRate,goldRate,potionRate,rare:w.rare,minutes,coverage:w.covered/(minutes*60),fieldFraction:w.field/(minutes*60),minHp:w.minHp,deaths:w.deaths,at:now};
}
function context(s,mem,catalog) {
  const map=catalog?.maps?.find(m=>!m.town&&m.name.replace(/\s+/g,' ')===String(s.zone||'').replace(/\s+/g,' '));
  if(!map||!s.name||!catalog.fingerprint||!mem.autonomy?.worn?.length)return null;
  const level=Number(String(s.lv).match(/\d+/)?.[0]),jobLv=Number(String(s.jobLv||'').match(/\d+/)?.[0]||0);
  const build=hash(mem.autonomy.worn.map(w=>[w.slot,w.uid,w.text]).sort());
  const data={character:s.name,patch:catalog.fingerprint,job:s.job,bracket:Math.floor(level/10),levelBand:Math.floor(level/2),jobBand:Math.floor(jobLv/5),build,refine:mem.autonomy.refine?.at||0,map:map.id,atCap:!!mem.autonomy.cap?.atCap};
  return {key:hash(data),data,level};
}
function validMemory(d) {
  try{return d?.version===1&&d.contexts&&!Array.isArray(d.contexts)&&Array.isArray(d.immunity)&&Array.isArray(d.outbox)&&Number.isSafeInteger(d.sequence)&&
    Object.keys(d.contexts).length<=64&&Object.values(d.contexts).every(c=>c.data&&c.arms?.[c.elite]&&Object.keys(c.arms).length<=12&&Object.values(c.arms).every(a=>
      Array.isArray(a.results)&&Number.isFinite(a.mean)&&Number.isFinite(a.n)&&Number.isFinite(a.m2)));}catch{return false;}
}
class FileStore {
  constructor(file){this.file=file;}
  load(){for(const p of [this.file,this.file+'.previous'])try{
    if(fs.statSync(p).size>4*1024*1024)continue;
    const d=JSON.parse(fs.readFileSync(p,'utf8'));
    if(validMemory(d))return d;
  }catch{}return null;}
  save(d){
    const p=this.file;
    try{const old=JSON.parse(fs.readFileSync(p,'utf8'));if(validMemory(old))fs.copyFileSync(p,p+'.previous');}catch{}
    const fd=fs.openSync(p+'.tmp','w',0o600);
    try{fs.writeFileSync(fd,JSON.stringify(d));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(p+'.tmp',p);fs.chmodSync(p,0o600);
  }
}
class Engine {
  constructor({store,random=Math.random,now=Date.now(),lastEventStore=null,lastEventId=0}) {
    this.store=store;this.random=random;this.savedAt=0;
    this.db=store?.load()||{version:1,sequence:0,contexts:{},immunity:[],outbox:[],active:null};
    this.db.identity ||= crypto.randomUUID();
    if(this.db.identity===lastEventStore&&Number.isSafeInteger(lastEventId))this.db.sequence=Math.max(this.db.sequence,lastEventId);
    // A restart leaves an unobserved gap: retain elites, discard the unverified trial window.
    const a=this.db.active,c=a&&this.db.contexts[a.key];
    if(c){a.current=c.elite;a.needsApply=true;a.window=null;a.pendingSince=now;}
    else this.db.active=null;
  }
  save(now=Date.now(),force=false){if(force||now-this.savedAt>=MIN){this.store?.save(this.db);this.savedAt=now;}}
  emit(type,detail,now){this.db.outbox.push({id:++this.db.sequence,type,detail,at:now});this.db.outbox=this.db.outbox.slice(-40);}
  acknowledge(id){this.db.outbox=this.db.outbox.filter(e=>e.id>id);this.save(Date.now(),true);}
  events(){return this.db.outbox;}
  active(){const a=this.db.active;return a&&this.db.contexts[a.key];}
  desired(){const c=this.active(),a=this.db.active;return genes(c?.arms?.[a.current]?.genes||DEFAULT);}
  quarantine(kind,s,mem,catalog,telemetry,now) {
    const map=telemetry?.map||this.active()?.data.map;if(!map)return;
    const x=Number.isFinite(telemetry?.x)?Math.floor(telemetry.x/128)*128:null,y=Number.isFinite(telemetry?.y)?Math.floor(telemetry.y/128)*128:null;
    const id=hash([catalog?.fingerprint,map,kind,x,y]);
    let q=this.db.immunity.find(i=>i.id===id);
    if(!q){q={id,patch:catalog?.fingerprint,map,kind,x,y,count:0};this.db.immunity.push(q);}
    // One incident edge per cell per ten minutes, not one per polling tick.
    if(!q.at||now-q.at>10*MIN){q.count++;q.at=now;}
    this.db.immunity=this.db.immunity.filter(i=>now-i.at<24*HOUR).slice(-256);
  }
  rollback(reason,now,penalize=true) {
    const a=this.db.active,c=this.active();if(!c)return;
    if(a.current!==c.elite){
      const trial=c.arms[a.current];if(penalize)trial.blockedUntil=now+6*HOUR;
      if(penalize)this.emit('dna_rollback',{reason,genome:trial.id},now);a.current=c.elite;a.needsApply=true;a.pendingSince=now;
    }
    a.window=null;c.phase='baseline';this.save(now,true);
  }
  guard(s,mem,catalog,telemetry,now=Date.now()) {
    const bad=s.dead?'death':telemetry?.positionFault?'outside':s.hp&&s.hp[0]/s.hp[1]<0.3?'low-hp':null;
    const a=this.db.active;
    if(!a){if(bad&&this.db.idleHazard!==bad){this.quarantine(bad,s,mem,catalog,telemetry,now);this.save(now,true);}this.db.idleHazard=bad;return;}
    if(Number.isFinite(telemetry?.sessionStartedAt)){
      if(a.sessionStart!=null&&a.sessionStart!==telemetry.sessionStartedAt){this.rollback('browser session changed',now,false);a.needsApply=true;a.pendingSince=now;}
      a.sessionStart=telemetry.sessionStartedAt;
    }
    if(bad&&a.lastHazard!==bad){
      this.quarantine(bad,s,mem,catalog,telemetry,now);
      const c=this.active();
      if(a.current===c.elite&&hash(c.arms[c.elite].genes)!==hash(DEFAULT)){
        c.arms[c.elite].blockedUntil=now+6*HOUR;
        const safe=arm(DEFAULT);c.arms[safe.id]||=safe;c.elite=safe.id;
      }
      this.rollback(bad,now);
    }
    a.lastHazard=bad;
    const lost=mem.uiHealth?.safeIdle||mem.availability?.status==='down';
    if(lost&&!a.observationLost)this.rollback('observation unavailable',now,false);
    a.observationLost=!!lost;
  }
  applied(ok,now=Date.now()) {
    const a=this.db.active,c=this.active();if(!c)return;
    if(!ok){a.needsApply=true;a.applyAfter=now+MIN;this.rollback('native profile not verified',now);}
    else {a.needsApply=false;a.applyAfter=0;a.window=null;}
    this.save(now,true);
  }
  canApply(mem,s,now=Date.now()) {
    const a=this.db.active;
    const trial=a&&a.current!==this.active()?.elite;
    return !!a?.needsApply&&now>=(a.applyAfter||0)&&(!trial||s.hp?.[0]/s.hp?.[1]>=0.85&&s.hpPotions>=20&&s.mpPotions>=20)&&
      !mem.autonomy?.trip&&!mem.autonomy?.resume&&!s.dead&&s.name&&!s.atCharSelect&&!s.jobQuestProgress&&!s.bossMechanic;
  }
  observe(s,mem,catalog,telemetry,now=Date.now()) {
    this.guard(s,mem,catalog,telemetry,now);
    const managed=mem.autonomy?.trip||mem.autonomy?.resume;
    const ctx=!managed&&context(s,mem,catalog),old=this.active();
    if(ctx&&(!this.db.active||ctx.key!==this.db.active.key)){
      if(old)this.rollback('context changed',now,false);
      let c=this.db.contexts[ctx.key];
      if(!c){
        const base=arm(DEFAULT);c=this.db.contexts[ctx.key]={data:ctx.data,elite:base.id,arms:{[base.id]:base},generation:0,phase:'baseline',createdAt:now,hyperUntil:old&&(old.data.patch!==ctx.data.patch||old.data.bracket!==ctx.data.bracket)?now+HOUR:0};
        if(old&&old.data.patch===ctx.data.patch&&old.data.job===ctx.data.job){
          const inherited=arm({...old.arms[old.elite].genes,hpPotionThreshold:0.6,skillScope:'ALL_LEARNED'});
          if(inherited.id!==base.id){inherited.seededFrom=old.elite;c.arms[inherited.id]=inherited;}
        }
      }
      c.at=now;this.db.active={key:ctx.key,current:c.elite,needsApply:true,pendingSince:now,window:null};
      const keys=Object.keys(this.db.contexts).sort((x,y)=>(this.db.contexts[y].at||0)-(this.db.contexts[x].at||0));
      for(const k of keys.filter(k=>k!==ctx.key).slice(63))delete this.db.contexts[k];
      this.save(now,true);
    }
    const a=this.db.active,c=this.active();if(!c)return this.view(now);
    const healthy=s.name&&!s.dead&&s.hp&&s.hp[0]/s.hp[1]>=0.3&&!mem.uiHealth?.safeIdle&&!telemetry?.positionFault&&!s.atCharSelect&&!s.bossMechanic&&!s.jobQuestProgress;
    if(!healthy){a.window=null;return this.view(now);}
    const exp=absoluteExp(catalog,Number(String(s.lv).match(/\d+/)?.[0]),s.exp==null&&mem.autonomy?.cap?.atCap?0:s.exp);
    if(a.needsApply&&a.current!==c.elite&&now-a.pendingSince>5*MIN)this.rollback('no safe configuration window',now);
    if(exp==null||!Number.isFinite(s.gold)||!Number.isFinite(s.hpPotions)||!Number.isFinite(s.mpPotions)||a.needsApply)return this.view(now);
    const end={exp,gold:s.gold,hpPots:s.hpPotions,mpPots:s.mpPotions,hpBought:mem.autonomy?.restocked?.hpPotions||0,mpBought:mem.autonomy?.restocked?.mpPotions||0};
    const field=!!ctx&&!s.panelOpen&&!s.mapOpen&&!s.menuOpen&&(s.autoQuestRunning||/\bon\b/.test(s.autoHunt||''));
    let w=a.window;
    if(w&&now-w.last>45000){this.rollback('sampling gap',now,false);return this.view(now);}
    if(!w){if(!field)return this.view(now);w=a.window={...end,at:now,last:now,covered:0,field:0,wasField:true,minHp:1,rare:0,deaths:0,stuckMinutes:0,expStep:catalog.expByLevel?.[Number(String(s.lv).match(/\d+/)?.[0])]||1,lastProgress:now,lastExp:exp,lastGold:s.gold};}
    const dt=Math.max(0,(now-w.last)/1000);w.covered+=dt;if(field&&w.wasField)w.field+=dt;w.wasField=field;w.last=now;
    w.minHp=Math.min(w.minHp,s.hp[0]/s.hp[1]);
    if(exp>w.lastExp){w.lastProgress=now;w.lastExp=exp;}
    if(c.data.atCap&&s.gold>w.lastGold)w.lastProgress=now;
    w.lastGold=s.gold;
    if(!field)w.lastProgress=now;
    w.stuckMinutes=field?Math.max(0,(now-w.lastProgress)/MIN-3):0;
    const inventory=mem.autonomy?.inventory;
    if(inventory&&inventory.at!==w.inventoryAt){
      const rare=new Set((catalog.monsters||[]).flatMap(m=>(m.drops||[]).filter(([,p])=>p>0&&p<=0.03).map(([id])=>id)));
      if(w.items)for(const id of rare)w.rare+=Math.max(0,(inventory.items[id]||0)-(w.items[id]||0));
      w.items={...inventory.items};w.inventoryAt=inventory.at;
    }
    const elapsed=now-w.at,elite=c.arms[c.elite],base=elite.results.at(-1),trial=a.current!==c.elite;
    const current=elapsed>0?fitness(w,end,now):null;
    if(trial&&elapsed>=5*MIN&&base&&(current.expRate<base.expRate*0.7||current.potionRate>Math.max(1,base.potionRate*1.5)||w.stuckMinutes>0)){
      if(w.stuckMinutes>0)this.quarantine('stuck',s,mem,catalog,telemetry,now);
      this.rollback('early performance/sustain regression',now);return this.view(now);
    }
    const duration=now<c.hyperUntil?10*MIN:15*MIN;
    if(elapsed>=duration){
      a.window=null;
      if(current.coverage>=0.8&&current.fieldFraction>=0.6){
        const selected=c.arms[a.current];record(selected,current);
        if(!trial&&selected.results.length>=4&&now-(c.lastDrift||0)>HOUR){
          const r=selected.results,mean=xs=>xs.reduce((n,x)=>n+x.expRate,0)/xs.length;
          if(mean(r.slice(-2))<mean(r.slice(-4,-2))*0.7){
            c.archive=[...(c.archive||[]),{at:now,mean:selected.mean,genome:selected.id}].slice(-8);
            c.hyperUntil=now+HOUR;c.lastDrift=now;selected.n=0;selected.mean=0;selected.m2=0;selected.results=[];
            this.emit('dna_drift',{map:c.data.map},now);
          }
        }
        if(trial&&selected.n>=2){
          const b=elite.results.slice(-2),r=selected.results.slice(-2),mean=(xs,k)=>xs.reduce((n,x)=>n+x[k],0)/xs.length;
          const variance=xs=>xs.length>1?xs.reduce((n,x)=>n+(x.expRate-mean(xs,'expRate'))**2,0)/(xs.length-1):Infinity;
          const noise=2*Math.sqrt(variance(b)/b.length+variance(r)/r.length),gain=mean(r,'expRate')-mean(b,'expRate');
          const expWin=gain>Math.max(mean(b,'expRate')*0.05,noise);
          const potWin=mean(b,'potionRate')>0.1&&mean(r,'potionRate')<mean(b,'potionRate')*0.75&&mean(r,'expRate')>=mean(b,'expRate')*0.98;
          const goldWin=c.data.atCap&&mean(r,'goldRate')>Math.max(mean(b,'goldRate')*1.1,mean(b,'goldRate')+100);
          if(b.length>=2&&(expWin||potWin||goldWin)&&mean(r,'score')>mean(b,'score')&&mean(r,'potionRate')<=Math.max(0.1,mean(b,'potionRate')*1.1)){
            const from=c.elite;c.elite=selected.id;c.generation++;c.phase='elite';
            const metric=expWin?'exp':potWin?'potions':'gold';
            const improvement=expWin?gain/Math.max(1,mean(b,'expRate')):potWin?1-mean(r,'potionRate')/mean(b,'potionRate'):mean(r,'goldRate')/Math.max(1,mean(b,'goldRate'))-1;
            this.emit('dna_evolved',{from,to:selected.id,metric,gainPercent:Math.round(improvement*1000)/10,map:c.data.map,generation:c.generation},now);
          }else this.rollback('repeat windows did not confirm improvement',now);
        }
        if(a.current===c.elite&&c.arms[c.elite].n>=2&&now-(a.switchedAt||0)>=30*MIN){
          const parent=Object.values(c.arms).filter(p=>p.id!==c.elite&&p.n>=2&&p.blockedUntil<=now&&p.mean>=c.arms[c.elite].mean-Math.abs(c.arms[c.elite].mean)*0.25).sort((x,y)=>y.mean-x.mean)[0]||c.arms[c.elite];
          const child=arm(offspring(c.arms[c.elite].genes,parent.genes,this.random,current.minHp>=0.7));
          if(!c.arms[child.id]&&Object.keys(c.arms).length<12)c.arms[child.id]=child;
          const pool=Object.values(c.arms).filter(p=>p.genes.hpPotionThreshold!==0.4||current.minHp>=0.7);
          const next=select(pool,Object.values(c.arms).reduce((n,x)=>n+x.n,0),now);
          if(next&&next.id!==c.elite){a.current=next.id;a.needsApply=true;a.pendingSince=now;a.switchedAt=now;c.phase='experiment';}
        }
      }else if(trial&&current.coverage>=0.8)this.rollback('excessive non-farming time',now);
      this.save(now,true);
    }else this.save(now);
    return this.view(now);
  }
  view(now=Date.now()) {
    const a=this.db.active,c=this.active();
    const avoidMaps=[...new Set(this.db.immunity.filter(i=>now-i.at<6*HOUR&&i.patch===c?.data.patch&&i.count>=2&&['outside','stuck'].includes(i.kind)).map(i=>i.map))];
    return {enabled:true,context:a?.key||null,map:c?.data.map||null,generation:c?.generation||0,mode:c?(now<c.hyperUntil?'hyper-validation':c.phase):'waiting',
      genomeId:a?.current||hash(DEFAULT),genes:this.desired(),needsApply:!!a?.needsApply,windowMinutes:a?.window?Math.round((now-a.window.at)/MIN):0,
      fitness:c?.arms[a.current]?.mean??null,eliteFitness:c?.arms[c.elite]?.mean??null,windows:c?.arms[a.current]?.n||0,
      immunityCount:this.db.immunity.length,avoidMaps};
  }
}
function readSummary(file){try{const d=new FileStore(file).load(),a=d?.active,c=a&&d.contexts[a.key];return {generation:c?.generation||0,immunityCount:d?.immunity?.length||0,genomeId:c?.elite||null};}catch{return null;}}
module.exports={DEFAULT,genes,profile,nativeControl,offspring,arm,record,select,fitness,context,FileStore,Engine,readSummary};
