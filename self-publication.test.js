'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const E=require('./self-evolution'),{GitPublisher,receiptValid}=require('./self-publication');
const NOW=Date.parse('2026-10-20T10:00:00Z'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function rig(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sigil-pub-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const repoDir=path.join(dir,'live'),checkout=path.join(dir,'publish');fs.mkdirSync(repoDir);fs.mkdirSync(checkout);const base={};
 for(const n of E.SOURCES){base[n]=fs.readFileSync(path.join(__dirname,n),'utf8');for(const root of [repoDir,checkout]){fs.mkdirSync(path.dirname(path.join(root,n)),{recursive:true});fs.writeFileSync(path.join(root,n),base[n]);}}
 fs.appendFileSync(path.join(repoDir,'ui-resilience.js'),'\n// verified publication fixture\n');
 const build=E.sourceFingerprint(repoDir),boot=crypto.randomUUID(),id=crypto.randomUUID(),calls=[];
 const journal={active:{id,phase:'COMMITTED',candidateBuild:build,verifiedBoot:boot,startedAt:NOW-700000,files:[{name:'ui-resilience.js',after:hash(fs.readFileSync(path.join(repoDir,'ui-resilience.js')))}]},events:[{jobId:id,status:'COMMITTED',at:NOW-1000}]};
 const state={parent:'a'.repeat(40),remote:'a'.repeat(40),changes:true,checks:0,verifications:0,failPush:false,healthy:true};
 const git=async args=>{calls.push(args);const command=args[0];
  if(command==='fetch')return '';
  if(command==='rev-parse')return args[1]==='HEAD'?state.parent:state.remote;
  if(command==='show')return base[args[1].slice(5)]||'';
  if(command==='diff')return state.changes?'ui-resilience.js\n':'';
  if(command==='-c'){state.parent='b'.repeat(40);state.changes=false;return '';}
  if(command==='push'){if(state.failPush)throw Object.assign(Error(),{code:'GIT_NETWORK_FAILED'});state.remote=state.parent;return '';}
  if(command==='ls-remote')return state.remote+'\trefs/heads/main';return '';
 };
 const health=async()=>({updatedAt:NOW-1,observedAt:NOW-1,bootId:boot,buildId:build,paused:false,safeIdle:!state.healthy});
 const publisher=new GitPublisher({dir:path.join(dir,'state'),repoDir,checkout,git,journal:async()=>journal,health,now:()=>NOW,
  verify:async()=>{state.verifications++;return {ok:true};},runChecks:async()=>{state.checks++;}});
 return {publisher,journal,calls,state,repoDir,checkout,base};
}
test('publication requires a full committed ten-minute canary, matching live build and boot',()=>{
 const id=crypto.randomUUID();const d={active:{id,phase:'COMMITTED',candidateBuild:'a'.repeat(64),verifiedBoot:crypto.randomUUID(),startedAt:NOW-600000,files:[{name:'ui-resilience.js',after:'b'.repeat(64)}]},events:[{jobId:id,status:'COMMITTED',at:NOW}]};
 a.equal(receiptValid(d,NOW),true);d.active.startedAt++;a.equal(receiptValid(d,NOW),false);d.active.startedAt-=2;d.active.phase='ROLLED_BACK';a.equal(receiptValid(d,NOW),false);
});
test('only verified allowed code reaches a non-forced main push; success is durable and idempotent',async t=>{
 const r=rig(t);const result=await r.publisher.publish();a.equal(result.status,'PUBLISHED');a.equal(r.state.checks,1);a.equal(r.state.verifications,1);
 a.deepEqual(r.calls.find(x=>x[0]==='push'),['push','--porcelain','origin','HEAD:refs/heads/main']);
 a.equal((await r.publisher.publish()).status,'ALREADY_PUBLISHED');a.equal(r.calls.filter(x=>x[0]==='push').length,1);
});
test('remote divergence, protected changes, source drift and failed runtime checks stop publication',async t=>{
 for(const kind of ['remote','protected','source','health','tests']){
  const r=rig(t);
  if(kind==='remote')r.state.remote='c'.repeat(40);
  if(kind==='protected')fs.appendFileSync(path.join(r.repoDir,'supervisor.js'),'\n// unauthorized');
  if(kind==='source')fs.appendFileSync(path.join(r.repoDir,'ui-resilience.js'),'\n// later drift');
  if(kind==='health')r.state.healthy=false;
  if(kind==='tests')r.publisher.verify=async()=>({ok:false});
  a.equal((await r.publisher.publish()).status,'FAILED',kind);a.equal(r.calls.some(x=>x[0]==='push'),false,kind);
 }
});
test('failed push preserves the exact commit for a later retry without duplicating commits',async t=>{
 const r=rig(t);r.state.failPush=true;a.equal((await r.publisher.publish()).status,'FAILED');
 r.state.failPush=false;r.publisher.now=()=>NOW+16*60000;
 r.publisher.health=async()=>({updatedAt:NOW+16*60000-1,observedAt:NOW+16*60000-1,bootId:r.journal.active.verifiedBoot,buildId:r.journal.active.candidateBuild,paused:false,safeIdle:false});
 // The publisher's checkout now contains the exact candidate, as real git show HEAD would.
 r.base['ui-resilience.js']=fs.readFileSync(path.join(r.repoDir,'ui-resilience.js'),'utf8');
 a.equal((await r.publisher.publish()).status,'PUBLISHED');a.equal(r.calls.filter(x=>x[0]==='-c').length,1);
});
test('runtime regression during publication checks prevents even a previously committed candidate from being pushed',async t=>{
 const r=rig(t);r.publisher.runChecks=async()=>{r.state.healthy=false;};a.equal((await r.publisher.publish()).status,'FAILED');a.equal(r.calls.some(x=>x[0]==='push'),false);
});
