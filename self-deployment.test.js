'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const E=require('./self-evolution'),{DeploymentBroker}=require('./self-deployment');
const NOW=Date.parse('2026-10-19T13:00:00Z');
function rig(t,options={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sigil-deploy-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const repoDir=path.join(root,'source');fs.mkdirSync(repoDir);
  const base={};for(const n of E.SOURCES){const dest=path.join(repoDir,n);fs.mkdirSync(path.dirname(dest),{recursive:true});base[n]=fs.readFileSync(path.join(__dirname,n),'utf8');fs.writeFileSync(dest,base[n]);}
  fs.writeFileSync(path.join(repoDir,'.env'),'SYNTHETIC_PRIVATE_FILE');
  const files={...base,'ui-resilience.js':base['ui-resilience.js']+'\n// isolated deployment fixture\n','self-evolution.candidate.test.js':'// synthetic regression'};
  const state={clock:NOW,bootId:crypto.randomUUID(),running:true,paused:false,stops:0,starts:0,fault:false,frozen:false,lastUpdated:NOW-1};
  const opts={dir:path.join(root,'state'),repoDir,now:()=>state.clock,canaryMs:40,pollMs:5,startupGraceMs:5,projectionFile:path.join(root,'projection','events.json'),
    sleep:async ms=>{state.clock+=ms;},health:async()=>{
      if(!state.running)throw Error('unreachable');
      return {updatedAt:state.frozen?state.lastUpdated:state.clock-1,observedAt:state.clock,bootId:state.bootId,buildId:E.sourceFingerprint(repoDir),
        safeIdle:state.fault,paused:state.paused,offline:false,login:false,expectedReload:false,cycleErrorAt:0,completedCycles:state.clock};
    },pause:async()=>{state.paused=true;},stop:async()=>{state.running=false;state.stops++;},start:async paused=>{state.starts++;state.clock++;state.running=true;state.paused=paused;state.bootId=crypto.randomUUID();},...options};
  const broker=new DeploymentBroker(opts);return {root,repoDir,base,files,state,opts,broker,request:{jobId:crypto.randomUUID(),base,files}};
}
test('passing canary atomically deploys only allowed files and keeps a durable original backup',async t=>{
  const r=rig(t),result=await r.broker.deploy(r.request),d=r.broker.load();
  assert.equal(result.status,'DEPLOYED');assert.equal(d.active.phase,'COMMITTED');assert.equal(r.state.starts,1);
  assert.equal(fs.readFileSync(path.join(r.repoDir,'ui-resilience.js'),'utf8'),r.files['ui-resilience.js']);
  assert.equal(fs.readFileSync(path.join(r.broker.dir,'deployments',r.request.jobId,'backup','ui-resilience.js'),'utf8'),r.base['ui-resilience.js']);
  assert.equal(fs.readFileSync(path.join(r.repoDir,'.env'),'utf8'),'SYNTHETIC_PRIVATE_FILE');
  assert.equal(fs.existsSync(path.join(r.repoDir,'self-evolution.candidate.test.js')),false);
  assert.equal(d.events.filter(e=>e.status==='COMMITTED').length,1);
});
test('runtime health failure rolls back immediately and confirms the original build restarted',async t=>{
  const r=rig(t);r.state.fault=true;
  assert.equal((await r.broker.deploy(r.request)).status,'ROLLED_BACK');
  assert.equal(fs.readFileSync(path.join(r.repoDir,'ui-resilience.js'),'utf8'),r.base['ui-resilience.js']);
  assert.equal(r.state.starts,2);assert.equal(r.broker.load().active.phase,'ROLLED_BACK');
});
test('a single reused heartbeat cannot pass a canary',async t=>{
  const r=rig(t);const original=r.opts.start;
  r.broker.start=async paused=>{await original(paused);r.state.frozen=true;r.state.lastUpdated=r.state.clock+1;};
  const result=await r.broker.deploy(r.request);assert.equal(result.status,'ROLLED_BACK');
  assert.equal(r.broker.load().events.some(e=>e.status==='COMMITTED'),false);
});
test('late health failure cannot be hidden by a final healthy poll',async t=>{
  const r=rig(t);r.broker.health=async()=>{const h=await r.opts.health();return {...h,safeIdle:r.state.clock>NOW+20&&r.state.starts===1};};
  assert.equal((await r.broker.deploy(r.request)).status,'ROLLED_BACK');
  assert.equal(r.broker.load().events.some(e=>e.status==='COMMITTED'),false);
});
test('uncaught cycle errors abort even during the startup grace period',async t=>{
  const r=rig(t);r.broker.health=async()=>{const h=await r.opts.health();return {...h,cycleErrorAt:r.state.starts===1?r.state.clock:0};};
  const result=await r.broker.deploy(r.request);assert.equal(result.status,'ROLLED_BACK');assert.equal(result.reason,'RUNTIME_ERROR');
});
test('bad process restart during canary restores the baseline',async t=>{
  const r=rig(t);r.broker.sleep=async ms=>{r.state.clock+=ms;if(r.state.starts===1&&r.state.clock>NOW+15)r.state.bootId=crypto.randomUUID();};
  assert.equal((await r.broker.deploy(r.request)).status,'ROLLED_BACK');
});
test('operator pause or upstream maintenance defers deployment without touching files or services',async t=>{
  const r=rig(t);r.state.paused=true;
  assert.equal((await r.broker.deploy(r.request)).status,'READY_REVIEW');assert.equal(r.state.stops,0);
  assert.equal(fs.readFileSync(path.join(r.repoDir,'ui-resilience.js'),'utf8'),r.base['ui-resilience.js']);
});
test('candidate cannot modify protected code/tests, inject paths or replace operator changes',async t=>{
  const r=rig(t);
  await assert.rejects(r.broker.deploy({...r.request,files:{...r.files,'agent.js':r.base['agent.js']+'\n// modified'}}),{code:'DEPLOYMENT_OUT_OF_SCOPE'});
  await assert.rejects(r.broker.deploy({...r.request,files:{...r.files,'../.env':'synthetic'}}),{code:'INVALID_DEPLOYMENT'});
  fs.appendFileSync(path.join(r.repoDir,'ui-resilience.js'),'\n// operator');
  await assert.rejects(r.broker.deploy(r.request),{code:'SOURCE_CHANGED'});assert.equal(r.state.stops,0);
});
test('a rejected patch is quarantined across worker restarts',async t=>{
  const r=rig(t);r.state.fault=true;assert.equal((await r.broker.deploy(r.request)).status,'ROLLED_BACK');r.state.fault=false;
  const next=new DeploymentBroker(r.opts);
  await assert.rejects(next.deploy({...r.request,jobId:crypto.randomUUID()}),{code:'PATCH_QUARANTINED'});
});
test('independent guard restores files after an interrupted worker lease',async t=>{
  const r=rig(t);await r.broker.deploy(r.request);const d=r.broker.load();d.active.phase='CANARY';d.active.leaseAt=r.state.clock-26000;r.broker.save(d);
  const guard=new DeploymentBroker(r.opts);assert.equal((await guard.guard()).status,'ROLLED_BACK');
  assert.equal(fs.readFileSync(path.join(r.repoDir,'ui-resilience.js'),'utf8'),r.base['ui-resilience.js']);
  assert.equal(guard.load().active.reason,'WORKER_HEARTBEAT_LOST');
});
test('startup recovery restores an uncommitted deployment before accepting new work',async t=>{
  const r=rig(t);await r.broker.deploy(r.request);const d=r.broker.load();d.active.phase='STARTING';r.broker.save(d);
  assert.equal((await new DeploymentBroker(r.opts).recover()).status,'ROLLED_BACK');
});
test('guard continues watching after a successful canary and rolls back later regressions',async t=>{
  const r=rig(t);await r.broker.deploy(r.request);r.state.fault=true;
  assert.equal((await new DeploymentBroker(r.opts).guard()).status,'ROLLED_BACK');
});
test('maintenance and human pause suspend post-deployment monitoring',async t=>{
  const r=rig(t);await r.broker.deploy(r.request);r.state.paused=true;
  assert.equal((await r.broker.guard()).status,'MONITORING_DEFERRED');assert.equal(r.state.stops,1);
});
test('explicit later source changes disarm the old guard without overwriting operator code',async t=>{
  const r=rig(t);await r.broker.deploy(r.request);fs.appendFileSync(path.join(r.repoDir,'ui-resilience.js'),'\n// later operator');
  assert.equal((await r.broker.guard()).status,'SUPERSEDED');assert.match(fs.readFileSync(path.join(r.repoDir,'ui-resilience.js'),'utf8'),/later operator/);
});
test('rollback preserves an operator pause and keeps secrets out of the public projection',async t=>{
  const r=rig(t);await r.broker.deploy(r.request);r.state.paused=true;
  await r.broker.rollback('OPERATOR_ROLLBACK');assert.equal(r.state.paused,true);
  const projection=fs.readFileSync(r.opts.projectionFile,'utf8');assert.equal(projection.includes('SYNTHETIC_PRIVATE_FILE'),false);assert.equal(projection.includes(r.repoDir.replaceAll('\\','\\\\')),false);
});
test('rollback backup corruption is reported as failure, never as successful recovery',async t=>{
  const r=rig(t);await r.broker.deploy(r.request);
  fs.writeFileSync(path.join(r.broker.dir,'deployments',r.request.jobId,'backup','ui-resilience.js'),'corrupt');
  await assert.rejects(r.broker.rollback('TEST_ROLLBACK'),{code:'ROLLBACK_FAILED'});
  assert.equal(r.broker.load().active.phase,'ROLLBACK_FAILED');assert.equal(r.broker.load().events.some(e=>e.status==='ROLLED_BACK'),false);
});
test('guard cannot steal a live deployment lock and can reclaim a dead process lock',async t=>{
  const r=rig(t);assert.equal(r.broker.acquire(),true);
  assert.equal((await new DeploymentBroker(r.opts).guard()).status,'BUSY');r.broker.release();
  E.writeJsonAtomic(r.broker.lock,{pid:2147483646});assert.equal((await r.broker.guard()).status,'READY');
});
test('corrupt deployment state fails closed without deleting files',async t=>{
  const r=rig(t);fs.writeFileSync(r.broker.file,'{broken');await assert.rejects(r.broker.guard(),{code:'STATE_UNREADABLE'});
  assert.equal(fs.readFileSync(path.join(r.repoDir,'.env'),'utf8'),'SYNTHETIC_PRIVATE_FILE');
});
test('root-pinned protected source rejects changed tests even if the live baseline agrees',async t=>{
  const r=rig(t);r.broker.protectedSources={...r.base};
  r.base['ui-resilience.test.js']+='\n// tampered test';r.files['ui-resilience.test.js']=r.base['ui-resilience.test.js'];
  fs.writeFileSync(path.join(r.repoDir,'ui-resilience.test.js'),r.base['ui-resilience.test.js']);
  await assert.rejects(r.broker.deploy(r.request),{code:'PROTECTED_SOURCE_CHANGED'});assert.equal(r.state.stops,0);
});
test('guard restores a partially written multi-file installation without touching unrelated files',async t=>{
  const r=rig(t);r.files['game-telemetry.js']+='\n// second candidate file';await r.broker.deploy(r.request);
  fs.writeFileSync(path.join(r.repoDir,'ui-resilience.js'),r.base['ui-resilience.js']);
  const d=r.broker.load();d.active.phase='INSTALLING';d.active.leaseAt=r.state.clock-26000;r.broker.save(d);
  assert.equal((await r.broker.guard()).status,'ROLLED_BACK');
  for(const n of ['ui-resilience.js','game-telemetry.js'])assert.equal(fs.readFileSync(path.join(r.repoDir,n),'utf8'),r.base[n]);
  assert.equal(fs.readFileSync(path.join(r.repoDir,'.env'),'utf8'),'SYNTHETIC_PRIVATE_FILE');
});
test('three failed rollback attempts stop automatic service restart loops',async t=>{
  const r=rig(t);await r.broker.deploy(r.request);fs.writeFileSync(path.join(r.broker.dir,'deployments',r.request.jobId,'backup','ui-resilience.js'),'corrupt');
  await assert.rejects(r.broker.rollback('TEST'),{code:'ROLLBACK_FAILED'});
  await assert.rejects(r.broker.guard(),{code:'ROLLBACK_FAILED'});await assert.rejects(r.broker.guard(),{code:'ROLLBACK_FAILED'});
  const stops=r.state.stops;assert.equal((await r.broker.guard()).status,'ROLLBACK_FAILED');assert.equal(r.state.stops,stops);
});
test('worker waits for an independent guard to finish its short startup lock',async t=>{
  const r=rig(t),other=new DeploymentBroker(r.opts);assert.equal(other.acquire(),true);let waited=false;
  r.broker.sleep=async ms=>{r.state.clock+=ms;if(!waited){waited=true;other.release();}};
  assert.equal((await r.broker.recover()).status,'READY');assert.equal(waited,true);
});
test('status projection is readable under umask 0077 while the durable journal remains private',{skip:process.platform==='win32'},t=>{
  const r=rig(t),previous=process.umask(0o077);
  try{r.broker.save(r.broker.load());assert.equal(fs.statSync(path.dirname(r.opts.projectionFile)).mode&0o777,0o755);assert.equal(fs.statSync(r.opts.projectionFile).mode&0o777,0o644);assert.equal(fs.statSync(r.broker.file).mode&0o777,0o600);}
  finally{process.umask(previous);}
});
test('a missing module owned by the patch is restored by the independent guard',async t=>{
  const r=rig(t);await r.broker.deploy(r.request);fs.unlinkSync(path.join(r.repoDir,'ui-resilience.js'));
  assert.equal((await r.broker.guard()).status,'ROLLED_BACK');
  assert.equal(fs.readFileSync(path.join(r.repoDir,'ui-resilience.js'),'utf8'),r.base['ui-resilience.js']);
});
