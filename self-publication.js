'use strict';
// Privileged publication uses a root-owned checkout, never the game's Git config/hooks.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const E=require('./self-evolution');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function receiptValid(d,now=Date.now()){
  const j=d?.active,event=d?.events?.findLast(e=>e.status==='COMMITTED'&&e.jobId===j?.id);
  return !!(j?.phase==='COMMITTED'&&/^[a-f0-9-]{36}$/.test(j.id||'')&&/^[a-f0-9]{64}$/.test(j.candidateBuild||'')&&
    /^[a-f0-9-]{36}$/.test(j.verifiedBoot||'')&&Number.isFinite(j.startedAt)&&event&&event.at-j.startedAt>=600000&&event.at<=now&&
    Array.isArray(j.files)&&j.files.length>0&&j.files.every(f=>E.EDITABLE.includes(f.name)&&/^[a-f0-9]{64}$/.test(f.after||'')));
}
function safeText(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>256*1024)fail('UNSAFE_PUBLICATION_SOURCE');return fs.readFileSync(file,'utf8');}
class GitPublisher {
  constructor({dir,checkout,repoDir,git,runChecks,verify,health,journal,pinnedSources,projectionFile=null,now=Date.now}){
    Object.assign(this,{dir,checkout,repoDir,git,runChecks,verify,health,journal,pinnedSources,projectionFile,now});
    fs.mkdirSync(dir,{recursive:true,mode:0o700});this.file=path.join(dir,'publication-state.json');
  }
  state(){return E.readJson(this.file,{version:1,identity:crypto.randomUUID(),sequence:0,jobs:{},events:[]});}
  save(d){E.writeJsonAtomic(this.file,d);if(this.projectionFile){E.writeJsonAtomic(this.projectionFile,{version:1,identity:d.identity,events:d.events});fs.chmodSync(this.projectionFile,0o644);}}
  event(d,id,status,commit=null,reason=null){d.events.push({id:++d.sequence,jobId:id,status,commit,reason,purpose:d.jobs[id]?.purpose||null,files:d.jobs[id]?.files||[],at:this.now()});d.events=d.events.slice(-40);this.save(d);}
  async checkLive(id,build){
    const d=await this.journal(),h=await this.health();
    if(!receiptValid(d,this.now())||d.active.id!==id||d.active.candidateBuild!==build||!E.validHealth(h,this.now())||h.bootId!==d.active.verifiedBoot||
      h.buildId!==build||h.safeIdle||h.paused||h.offline||h.login||h.expectedReload||h.dead||h.positionFault||h.cycleErrorAt>=d.active.startedAt||E.sourceFingerprint(this.repoDir)!==build)fail('PUBLICATION_CANARY_UNCONFIRMED');
    return d;
  }
  async publish(){
    const lock=path.join(this.dir,'lock');
    if(fs.existsSync(lock)){
      const owner=E.readJson(path.join(lock,'owner.json'),null);if(!Number.isSafeInteger(owner?.pid)||owner.pid<1)return {status:'BUSY'};
      try{process.kill(owner.pid,0);return {status:'BUSY'};}catch(e){if(e.code!=='ESRCH')return {status:'BUSY'};}
      fs.unlinkSync(path.join(lock,'owner.json'));fs.rmdirSync(lock);
    }
    try{fs.mkdirSync(lock,{mode:0o700});}catch(e){if(e.code==='EEXIST')return {status:'BUSY'};throw e;}
    E.writeJsonAtomic(path.join(lock,'owner.json'),{pid:process.pid});
    try{
      const deployment=await this.journal();if(!receiptValid(deployment,this.now()))return {status:'WAITING_FOR_COMMITTED_CANARY'};
      const j=deployment.active,d=this.state();if(d.jobs[j.id]?.status==='PUBLISHED')return {status:'ALREADY_PUBLISHED',commit:d.jobs[j.id].commit};
      if(d.jobs[j.id]?.retryAt>this.now())return {status:'RETRY_LATER'};
      try{
        await this.checkLive(j.id,j.candidateBuild);
        // Fetch may advance main. Divergence is never rebased, merged or force-pushed automatically.
        await this.git(['fetch','--no-tags','origin','refs/heads/main:refs/remotes/origin/main']);
        const parent=(await this.git(['rev-parse','HEAD'])).trim(),remote=(await this.git(['rev-parse','refs/remotes/origin/main'])).trim();
        if(parent!==remote){
          const row=d.jobs[j.id];
          if(row?.commit&&row.commit===parent&&row.parent===remote){/* retry exactly the existing unpushed commit */}
          else fail('GIT_REMOTE_DIVERGED');
        }
        const files={};for(const n of E.SOURCES){
          if(n.includes('/')&&fs.lstatSync(path.join(this.repoDir,path.dirname(n))).isSymbolicLink())fail('UNSAFE_PUBLICATION_SOURCE');
          files[n]=safeText(path.join(this.repoDir,n));
          if(!E.EDITABLE.includes(n)&&this.pinnedSources&&files[n]!==this.pinnedSources[n])fail('PROTECTED_SOURCE_CHANGED');
          const baseline=await this.git(['show','HEAD:'+n]);
          if(files[n]!==baseline&&!E.EDITABLE.includes(n))fail('PUBLICATION_OUT_OF_SCOPE');
        }
        for(const f of j.files)if(sha(files[f.name])!==f.after)fail('SOURCE_CHANGED');
        for(const n of E.EDITABLE)if(files[n]!==undefined){
          const dest=path.join(this.checkout,n);if(fs.lstatSync(dest).isSymbolicLink())fail('UNSAFE_PUBLICATION_CHECKOUT');fs.writeFileSync(dest,files[n],{mode:0o644});
        }
        const jobDir=path.join(this.dir,j.id);fs.mkdirSync(jobDir,{recursive:true,mode:0o700});
        const result=await this.verify(files,jobDir,'probe');if(result?.ok!==true)fail('PUBLICATION_TESTS_FAILED');
        await this.runChecks(this.checkout);
        await this.checkLive(j.id,j.candidateBuild);
        await this.git(['add','--',...E.EDITABLE]);
        const changed=(await this.git(['diff','--cached','--name-only'])).trim().split(/\r?\n/).filter(Boolean);
        if(changed.some(n=>!E.EDITABLE.includes(n)))fail('PUBLICATION_OUT_OF_SCOPE');
        let commit=parent;
        if(changed.length){await this.git(['-c','user.name=Sigil Evolution','-c','user.email=sigil-evolution@users.noreply.github.com','commit','-m','Evolve verified game strategy '+j.id.slice(0,8)]);commit=(await this.git(['rev-parse','HEAD'])).trim();}
        // Durable receipt before network write permits reconciliation after a lost response.
        d.jobs[j.id]={status:'PENDING_PUSH',commit,parent:d.jobs[j.id]?.parent||remote,buildId:j.candidateBuild,purpose:E.OPPORTUNITY_REASONS.has(j.purpose)?j.purpose:'UI_SCHEMA_CHANGED',files:j.files.map(f=>f.name)};this.save(d);
        await this.checkLive(j.id,j.candidateBuild);
        await this.git(['push','--porcelain','origin','HEAD:refs/heads/main']);
        const remoteHead=(await this.git(['ls-remote','origin','refs/heads/main'])).trim().split(/\s/)[0];if(remoteHead!==commit)fail('GIT_PUSH_UNCONFIRMED');
        d.jobs[j.id]={...d.jobs[j.id],status:'PUBLISHED'};
        d.jobs=Object.fromEntries(Object.entries(d.jobs).slice(-64));this.event(d,j.id,'PUBLISHED',commit);
        return {status:'PUBLISHED',commit};
      }catch(e){
        const reason=/^[A-Z_]{3,64}$/.test(e.code||'')?e.code:'PUBLICATION_FAILED';
        d.jobs[j.id]={...d.jobs[j.id],status:'FAILED',retryAt:this.now()+15*60000};this.event(d,j.id,'PUBLICATION_FAILED',null,reason);return {status:'FAILED',reason};
      }
    }finally{fs.unlinkSync(path.join(lock,'owner.json'));fs.rmdirSync(lock);}
  }
}
module.exports={receiptValid,GitPublisher};
