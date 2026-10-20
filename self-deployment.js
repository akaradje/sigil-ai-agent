'use strict';
// Trusted, fixed-scope deployment broker. Never accepts commands or paths from a model.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const E=require('./self-evolution');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const error=code=>Object.assign(new Error(code),{code});
const transitional=new Set(['PREPARED','INSTALLING','STARTING','CANARY','ROLLING_BACK','ROLLBACK_FAILED']);
const uuid=x=>/^[a-f0-9-]{36}$/.test(x||'');
const digest=x=>/^[a-f0-9]{64}$/.test(x||'');
function processIdentity(pid){
  try{return fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()+':'+fs.readFileSync('/proc/'+pid+'/stat','utf8').split(') ').at(-1).split(' ')[19];}
  catch{return null;}
}

function atomicSource(file,text,meta) {
  const tmp=file+'.deploy-'+crypto.randomUUID();const fd=fs.openSync(tmp,'wx',meta.mode&0o777);
  try {fs.writeFileSync(fd,text);if(process.platform!=='win32')fs.fchownSync(fd,meta.uid,meta.gid);fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  try {fs.renameSync(tmp,file);E.syncDirectory(path.dirname(file));}
  finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function text(file) {
  const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>256*1024)throw error('UNSAFE_SOURCE');
  return fs.readFileSync(file,'utf8');
}
function buildId(files){return hash(E.RUNTIME.map(n=>n+'\0'+files[n]).join('\0'));}
function publicPatch(j){
  return {beforeBuild:digest(j.beforeBuild)?j.beforeBuild:null,candidateBuild:digest(j.candidateBuild)?j.candidateBuild:null,
    patchHash:digest(j.patchHash)?j.patchHash:null,
    files:(j.files||[]).map(f=>typeof f==='string'?f:f.name).filter(n=>E.EDITABLE.includes(n))};
}

class DeploymentBroker {
  constructor({dir,repoDir,health,pause,stop,start,projectionFile=null,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),
    canaryMs=600000,pollMs=5000,startupGraceMs=45000,redact=E.sanitizeSnapshot,protectedSources=null}) {
    Object.assign(this,{dir,repoDir,health,pause,stop,start,projectionFile,now,sleep,canaryMs,pollMs,startupGraceMs,redact,protectedSources});
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    this.file=path.join(dir,'deployment-state.json');this.lock=path.join(dir,'deployment-lock');
  }
  load(){
    const d=E.readJson(this.file,{version:1,identity:crypto.randomUUID(),sequence:0,events:[],rejected:[],active:null});
    if(d.version!==1||!uuid(d.identity)||!Number.isSafeInteger(d.sequence)||!Array.isArray(d.events)||d.events.length>40||!Array.isArray(d.rejected))throw error('DEPLOYMENT_STATE_INVALID');
    const j=d.active;
    if(j&&(!uuid(j.id)||!Array.isArray(j.files)||j.files.length<1||j.files.length>E.EDITABLE.length||j.files.some(f=>!E.EDITABLE.includes(f.name)||!digest(f.before)||!digest(f.after))))throw error('DEPLOYMENT_STATE_INVALID');
    return d;
  }
  save(d){
    E.writeJsonAtomic(this.file,d);
    if(this.projectionFile){
      const publicState={identity:d.identity,mode:'automatic-deployment',phase:d.active?.phase||null,jobId:d.active?.id||null,
        checkedAt:this.now(),active:d.active?{...publicPatch(d.active),createdAt:d.active.createdAt,
          startedAt:d.active.startedAt,canaryMs:this.canaryMs}:null,
        events:d.events.map(e=>({id:e.id,jobId:e.jobId,status:e.status,at:e.at,
          reason:/^[A-Z][A-Z0-9_]{0,63}$/.test(e.reason||'')?e.reason:null,...publicPatch(e)}))};
      fs.mkdirSync(path.dirname(this.projectionFile),{recursive:true,mode:0o755});
      fs.chmodSync(path.dirname(this.projectionFile),0o755);
      E.writeJsonAtomic(this.projectionFile,publicState);fs.chmodSync(this.projectionFile,0o644);
    }
  }
  emit(d,status,reason){
    d.active.phase=status;d.active.reason=reason||null;
    d.events.push({id:++d.sequence,jobId:d.active.id,status,reason:reason||null,at:this.now(),...publicPatch(d.active)});d.events=d.events.slice(-40);this.save(d);
  }
  acquire(){
    const token=this.lock+'.'+crypto.randomUUID();
    E.writeJsonAtomic(token,{pid:process.pid,identity:processIdentity(process.pid)});
    try{fs.linkSync(token,this.lock);}
    catch(e){
      if(e.code!=='EEXIST')throw e;
      const owner=E.readJson(this.lock,null);
      if(!Number.isSafeInteger(owner?.pid)||owner.pid<1)throw error('DEPLOYMENT_LOCK_UNKNOWN');
      try{process.kill(owner.pid,0);if(!owner.identity||processIdentity(owner.pid)===owner.identity)return false;}catch(e){if(e.code!=='ESRCH')return false;}
      fs.unlinkSync(this.lock);return this.acquire();
    }finally{fs.unlinkSync(token);}
    return true;
  }
  release(){fs.unlinkSync(this.lock);}
  async locked(fn){
    const began=this.now();
    while(!this.acquire()){
      if(this.now()-began>=10000)throw error('DEPLOYMENT_BUSY');
      await this.sleep(250);
    }
    try{return await fn();}finally{this.release();}
  }
  current(){return Object.fromEntries(E.SOURCES.map(n=>[n,text(path.join(this.repoDir,n))]));}
  validate(base,files){
    if(!base||!files||E.SOURCES.some(n=>typeof base[n]!=='string'||typeof files[n]!=='string')||Object.keys(base).some(n=>!E.SOURCES.includes(n))||
      Object.keys(files).some(n=>!E.SOURCES.includes(n)&&n!=='self-evolution.candidate.test.js'))throw error('INVALID_DEPLOYMENT');
    const changed=E.SOURCES.filter(n=>base[n]!==files[n]);
    if(this.protectedSources&&E.SOURCES.some(n=>!E.EDITABLE.includes(n)&&base[n]!==this.protectedSources[n]))throw error('PROTECTED_SOURCE_CHANGED');
    if(!changed.length||changed.some(n=>!E.EDITABLE.includes(n)))throw error('DEPLOYMENT_OUT_OF_SCOPE');
    for(const n of changed)if(this.redact.hasPrivate?.(files[n]))throw error('PRIVATE_VALUE_IN_CANDIDATE');
    const current=this.current();if(E.SOURCES.some(n=>current[n]!==base[n]))throw error('SOURCE_CHANGED');
    return changed;
  }
  async readHealth(){try{return await this.health();}catch{return null;}}
  async rollback(reason='CANARY_REJECTED'){
    return this.locked(async()=>this.restore(this.load(),reason));
  }
  async restore(d,reason){
    const j=d.active;
    if(!j||['ROLLED_BACK','SUPERSEDED'].includes(j.phase))return {status:j?.phase||'NO_DEPLOYMENT'};
    const observed=await this.readHealth();const keepPaused=j.phase==='COMMITTED'||j.phase==='CANARY'?Boolean(observed?.paused):Boolean(j.wasPaused);
    if((j.rollbackAttempts||0)>=3)throw error('ROLLBACK_REQUIRES_OPERATOR');
    j.rollbackAttempts=(j.rollbackAttempts||0)+1;
    this.emit(d,'ROLLING_BACK',reason);
    try {
      await this.stop();
      for(const f of j.files){
        const file=path.join(this.repoDir,f.name);let current=null;
        try{current=hash(text(file));}catch(e){if(e.code!=='ENOENT')throw e;}
        if(current!==null&&current!==f.before&&current!==f.after)throw error('ROLLBACK_SOURCE_CONFLICT');
        const old=text(path.join(this.dir,'deployments',j.id,'backup',f.name));
        if(hash(old)!==f.before)throw error('ROLLBACK_BACKUP_INVALID');
        if(current!==f.before)atomicSource(file,old,f);
      }
      await this.start(keepPaused);
      // A broken UI may be the reason for restoring the baseline. Confirm the old process/build,
      // not a fabricated recovery of that pre-existing UI incident.
      let confirmed=false;
      for(let i=0;i<8;i++){
        const h=await this.readHealth();
        if(h&&uuid(h.bootId)&&h.bootId!==j.bootId&&h.buildId===j.beforeBuild){confirmed=true;break;}
        await this.sleep(this.pollMs);
      }
      if(!confirmed)throw error('ROLLBACK_RESTART_UNCONFIRMED');
      d.rejected.push({hash:j.patchHash,at:this.now()});d.rejected=d.rejected.slice(-40);
      this.emit(d,'ROLLED_BACK',reason);return {status:'ROLLED_BACK',reason};
    }catch(e){this.emit(d,'ROLLBACK_FAILED',e.code||'ROLLBACK_FAILED');throw error('ROLLBACK_FAILED');}
  }
  async recover(){
    return this.locked(async()=>{const d=this.load();if(d.active&&transitional.has(d.active.phase))return this.restore(d,'WORKER_INTERRUPTED');this.save(d);return {status:d.active?.phase||'READY'};});
  }
  async deploy({jobId,base,files}){
    if(!uuid(jobId))throw error('INVALID_JOB_ID');
    const current=await this.readHealth();
    if(!E.validHealth(current,this.now())||current.paused||current.offline||current.login||current.expectedReload||current.positionFault)
      return {status:'READY_REVIEW',reason:'DEPLOYMENT_DEFERRED'};
    const changed=this.validate(base,files),patchHash=hash(changed.map(n=>n+'\0'+files[n]).join('\0'));
    await this.locked(async()=>{
      const d=this.load();
      if(d.active&&transitional.has(d.active.phase))throw error('DEPLOYMENT_BUSY');
      if(d.rejected.some(r=>r.hash===patchHash&&this.now()-r.at<24*3600000))throw error('PATCH_QUARANTINED');
      const folder=path.join(this.dir,'deployments',jobId,'backup');fs.mkdirSync(folder,{recursive:true,mode:0o700});
      const manifest=changed.map(n=>{
        const stat=fs.lstatSync(path.join(this.repoDir,n)),backup=path.join(folder,n);
        if(fs.existsSync(backup))throw error('DEPLOYMENT_ALREADY_ATTEMPTED');
        atomicSource(backup,base[n],{mode:0o600,uid:process.getuid?.()||0,gid:process.getgid?.()||0});
        return {name:n,before:hash(base[n]),after:hash(files[n]),mode:stat.mode&0o777,uid:stat.uid,gid:stat.gid};
      });
      d.active={id:jobId,phase:'PREPARED',files:manifest,bootId:current.bootId,beforeBuild:buildId(base),candidateBuild:buildId(files),
        patchHash,wasPaused:current.paused,createdAt:this.now(),leaseAt:this.now(),startedAt:null};
      if(d.active.beforeBuild!==current.buildId)throw error('SOURCE_CHANGED');
      this.emit(d,'PREPARED');
      try {
        await this.pause();this.validate(base,files);
        this.emit(d,'INSTALLING');await this.stop();
        for(const f of manifest)atomicSource(path.join(this.repoDir,f.name),files[f.name],f);
        d.active.startedAt=this.now();this.emit(d,'STARTING');await this.start(false);
        d.active.leaseAt=this.now();this.emit(d,'CANARY');
      }catch(e){await this.restore(d,e.code||'INSTALLATION_FAILED');}
    });
    if(this.load().active?.phase==='ROLLED_BACK')return {status:'ROLLED_BACK',reason:this.load().active.reason};
    try {
      const result=await this.monitor();
      if(result.status==='ROLLED_BACK')return result;
      return {status:'DEPLOYED'};
    }catch(e){return this.rollback(e.code||'CANARY_REJECTED');}
  }
  async monitor(){
    let healthyAt=0,boot=null,lastCycle=0,distinctCycles=0,healthySamples=0;
    const start=this.now();
    while(this.now()-start<this.canaryMs){
      const h=await this.readHealth(),d=this.load(),j=d.active;
      if(j?.phase==='ROLLED_BACK')return {status:'ROLLED_BACK',reason:j.reason};
      if(j?.phase!=='CANARY')throw error('DEPLOYMENT_STATE_CHANGED');
      if(h?.bootId&&h.bootId!==j.bootId&&h.cycleErrorAt>=j.startedAt)throw error('RUNTIME_ERROR');
      const verdict=E.evaluateCanaryHealth(h,j.startedAt,{bootId:j.bootId,candidateBuildId:j.candidateBuild},this.now());
      if(!verdict.healthy){if(healthyAt||this.now()-start>=this.startupGraceMs)throw error(verdict.reason);}
      else {
        if(boot&&h.bootId!==boot)throw error('UNEXPECTED_AGENT_RESTART');
        boot=h.bootId;healthyAt||=this.now();healthySamples++;
        if(h.updatedAt!==lastCycle){lastCycle=h.updatedAt;distinctCycles++;}
      }
      await this.locked(async()=>{const latest=this.load();if(latest.active?.phase!=='CANARY')throw error('DEPLOYMENT_STATE_CHANGED');latest.active.leaseAt=this.now();this.save(latest);});
      await this.sleep(this.pollMs);
    }
    if(!healthyAt||distinctCycles<3||healthySamples<Math.max(3,Math.floor((this.canaryMs-this.startupGraceMs)/this.pollMs*0.8)))throw error('INSUFFICIENT_CANARY_EVIDENCE');
    return this.locked(async()=>{const d=this.load();if(d.active?.phase!=='CANARY')throw error('DEPLOYMENT_STATE_CHANGED');d.active.verifiedBoot=boot;this.emit(d,'COMMITTED');return {status:'DEPLOYED'};});
  }
  // Independent systemd timer, including after worker death or a later production regression.
  async guard(){
    if(!this.acquire())return {status:'BUSY'};
    try{
      const d=this.load(),j=d.active;
      if(!j){this.save(d);return {status:'READY'};}
      if(['ROLLING_BACK','ROLLBACK_FAILED'].includes(j.phase)){
        if(j.rollbackAttempts>=3){this.save(d);return {status:'ROLLBACK_FAILED'};}
        return await this.restore(d,j.reason||'WORKER_INTERRUPTED');
      }
      if(transitional.has(j.phase)){
        if(this.now()-j.leaseAt>25000)return await this.restore(d,'WORKER_HEARTBEAT_LOST');
        return {status:j.phase};
      }
      if(j.phase!=='COMMITTED'){this.save(d);return {status:j.phase};}
      // Explicit operator source changes supersede this guard; never overwrite a third version.
      try{if(E.sourceFingerprint(this.repoDir)!==j.candidateBuild){this.emit(d,'SUPERSEDED');return {status:'SUPERSEDED'};}}
      catch(e){if(e.code==='ENOENT')return await this.restore(d,'SOURCE_FILE_MISSING');throw e;}
      const h=await this.readHealth();
      if(h?.paused||h?.offline||h?.login||h?.expectedReload){this.save(d);return {status:'MONITORING_DEFERRED'};}
      if(h?.bootId&&h.bootId!==j.verifiedBoot)return await this.restore(d,'UNEXPECTED_AGENT_RESTART');
      const result=E.evaluateCanaryHealth(h,j.startedAt,{bootId:j.bootId,candidateBuildId:j.candidateBuild},this.now());
      if(!result.healthy)return await this.restore(d,result.reason);
      this.save(d);return {status:'MONITORING'};
    }finally{this.release();}
  }
}
module.exports={DeploymentBroker,atomicSource,buildId};
