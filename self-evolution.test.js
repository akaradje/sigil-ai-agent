'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const E=require('./self-evolution');
const R=require('./self-evolution-runner');
const NOW=Date.parse('2026-10-19T12:00:00Z');
const bootId=crypto.randomUUID(), buildId='a'.repeat(64);
function health(change={}) {return {updatedAt:NOW-1000,observedAt:NOW-1000,bootId,buildId,
  safeIdle:true,paused:false,badSince:NOW-240000,missing:['hp'],...change};}
function fixture(t,opts={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sigil-healing-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const repo=path.join(dir,'source');fs.mkdirSync(repo);
  for(const name of E.SOURCES) {
    const dest=path.join(repo,name);fs.mkdirSync(path.dirname(dest),{recursive:true});
    fs.copyFileSync(path.join(__dirname,name),dest);
    fs.chmodSync(dest,0o600);
    if(name==='ui-resilience.js')fs.writeFileSync(dest,'// synthetic unit fixture marker\n'+fs.readFileSync(dest,'utf8'));
  }
  const calls=[];
  const engine=new E.SelfEvolutionEngine({dir:path.join(dir,'state'),repoDir:repo,now:()=>NOW,
    repair:async()=>proposal(),verify:async(files,jobDir,label)=>{calls.push(label);return {ok:true};},...opts});
  return {dir,repo,calls,engine,h:health({buildId:E.sourceFingerprint(repo)})};
}
function proposal() {return {edits:[{file:'ui-resilience.js',find:'// synthetic unit fixture marker',replace:'// repaired synthetic unit fixture marker'}],
  test:"const{test}=require('node:test');const assert=require('node:assert/strict');test('candidate remains closed without state',()=>assert.equal(require('./ui-resilience').assess({}).blocked,true));"};}

test('redaction covers Bearer credentials, key names, JWT and known encoded private values',()=>{
  const secret='synthetic-private-value-only',r=E.createRedactor([secret]);
  const input=`Authorization: Bearer ${secret}\nMETA_API_KEY="${secret}"\n${encodeURIComponent(secret)} ${Buffer.from(secret).toString('base64')} eyJabc.defgh.ijklmn`;
  const clean=r(input);assert.equal(clean.includes(secret),false);assert.equal(clean.includes(Buffer.from(secret).toString('base64')),false);
  assert.equal(clean.includes('eyJabc'),false);assert.equal(r.hasPrivate(input),true);
  assert.equal(E.sanitizeSnapshot('Authorization: Bearer SYNTHETIC_CREDENTIAL').includes('SYNTHETIC_CREDENTIAL'),false);
});
test('health rejects missing, stale, future timestamps and unknown process/build identities',()=>{
  assert.equal(E.validHealth({},NOW),false);
  for(const change of [{updatedAt:NaN},{updatedAt:NOW+1},{updatedAt:NOW-91000},{observedAt:NOW-31000},{bootId:'x'},{buildId:'x'},{paused:undefined}])
    assert.equal(E.validHealth(health(change),NOW),false);
  assert.equal(E.validHealth(health(),NOW),true);
});
test('canary requires a new boot, expected build, fresh observations and comparable EXP context',()=>{
  const h=health({safeIdle:false}),base={bootId:crypto.randomUUID(),candidateBuildId:buildId};
  assert.equal(E.evaluateCanaryHealth(h,NOW-2000,base,NOW).healthy,true);
  assert.equal(E.evaluateCanaryHealth({},NOW-2000,base,NOW).healthy,false);
  assert.equal(E.evaluateCanaryHealth(h,NOW-2000,{...base,bootId},NOW).healthy,false);
  assert.equal(E.evaluateCanaryHealth(h,NOW-2000,{...base,candidateBuildId:'b'.repeat(64)},NOW).healthy,false);
  assert.equal(E.evaluateCanaryHealth(h,NOW-2000,base,NOW+91000).healthy,false);
  assert.equal(E.evaluateCanaryHealth({...h,expPerMin:100},NOW-2000,{...base,expPerMin:100,context:'map'},NOW).reason,'INCOMPARABLE_EXP_SAMPLE');
  assert.equal(E.evaluateCanaryHealth({...h,eligible:true,context:'map',expPerMin:10},NOW-2000,{...base,expPerMin:100,context:'map'},NOW).reason,'EXP_DEGRADATION');
});
test('snapshot exports only enumerated health fields, never arbitrary runtime/error data',()=>{
  const h=E.healthSnapshot({memory:{uiHealth:{checkedAt:NOW,missing:['hp','token'],token:'SYNTHETIC_PRIVATE'},secret:'SYNTHETIC_PRIVATE'},
    bootId,buildId,completedAt:NOW,paused:false},NOW);
  assert.deepEqual(h.missing,['hp']);assert.equal(JSON.stringify(h).includes('SYNTHETIC_PRIVATE'),false);
});
test('proposals cannot traverse paths, edit protected tests, delete or ambiguously replace code',()=>{
  const p=proposal(),base={'ui-resilience.js':'// synthetic unit fixture marker'};
  assert.equal(E.validateProposal(p,base).changed.length,2);
  for(const file of ['../agent.js','agent.js','ui-resilience.test.js','self-evolution.js','supervisor.js','.env'])
    assert.throws(()=>E.validateProposal({...p,edits:[{...p.edits[0],file}]},base),{code:'EDIT_OUT_OF_SCOPE'});
  assert.throws(()=>E.validateProposal(p,{'ui-resilience.js':base['ui-resilience.js'].repeat(2)}),{code:'AMBIGUOUS_EDIT'});
  assert.throws(()=>E.validateProposal({...p,test:''},base),{code:'REGRESSION_TEST_REQUIRED'});
  assert.throws(()=>E.validateProposal({...p,command:'rm'},base),{code:'INVALID_PROPOSAL'});
});
test('private values are blocked even when generic credential redaction would hide both versions',()=>{
  const p=proposal(),secret='synthetic-never-publish-value',r=E.createRedactor([secret]);
  p.edits[0].replace=`const api_key="${secret}";`;
  assert.throws(()=>E.validateProposal(p,{'ui-resilience.js':p.edits[0].find},r),{code:'PRIVATE_VALUE_IN_CANDIDATE'});
});
test('safe-idle repairs retry feedback, retain immutable baseline/tests and never edit live source',async t=>{
  let repairs=0,attempt1;
  const r=fixture(t,{repair:async messages=>{
    repairs++;if(repairs===2)assert.match(messages[1].content,/REGRESSION_EVIDENCE/);return proposal();
  },verify:async(files,dir,label)=>{
    if(label==='attempt-1'){attempt1=files;throw Object.assign(new Error('ignored'),{code:'TESTS_FAILED',feedback:'REGRESSION_EVIDENCE'});}
    if(label==='attempt-2')assert.deepEqual(files,attempt1);
    return {ok:true};
  }});
  const before=E.sourceFingerprint(r.repo),result=await r.engine.observe(r.h);
  assert.equal(result.status,'READY_REVIEW');assert.equal(repairs,2);assert.equal(E.sourceFingerprint(r.repo),before);
  assert.equal(r.engine.load().jobs[0].failure,undefined);
  assert.equal(fs.existsSync(path.join(r.engine.dir,result.jobId,'candidate.json')),true);
  assert.equal((await r.engine.observe(r.h)).reason,'PATCH_PENDING');
});
test('missing sandbox refuses all repair calls and releases lock on every failure',async t=>{
  const r=fixture(t,{verify:null});
  await assert.rejects(r.engine.observe(r.h),{code:'SANDBOX_NOT_CONFIGURED'});
  assert.equal(r.engine.running,false);assert.equal(fs.existsSync(r.engine.lock),false);
});
test('baseline failures never call the model',async t=>{
  let calls=0;const r=fixture(t,{repair:async()=>{calls++;return proposal();},verify:async()=>({ok:false})});
  assert.equal((await r.engine.observe(r.h)).status,'FAILED');assert.equal(calls,0);assert.equal(r.engine.load().jobs[0].failure,'BASELINE_FAILED');
});
test('unsafe edits stop immediately without destructive git or service commands',async t=>{
  let calls=0;const r=fixture(t,{repair:async()=>{calls++;const p=proposal();p.edits[0].file='supervisor.js';return p;}});
  assert.equal((await r.engine.observe(r.h)).status,'FAILED');assert.equal(calls,1);
  assert.deepEqual(r.calls,['baseline']);assert.equal(r.engine.load().jobs[0].failure,'EDIT_OUT_OF_SCOPE');
});
test('all three failed attempts remain durable and cooldown survives worker restart',async t=>{
  let calls=0;const r=fixture(t,{repair:async()=>{calls++;throw Object.assign(new Error('private error'),{code:'MODEL_UNAVAILABLE'});}});
  assert.equal((await r.engine.observe(r.h)).status,'FAILED');assert.equal(calls,3);
  const next=new E.SelfEvolutionEngine({dir:r.engine.dir,repoDir:r.repo,now:()=>NOW});
  next.recover();assert.equal((await next.observe(r.h)).reason,'COOLDOWN');
  assert.equal(JSON.stringify(next.load()).includes('private error'),false);
});
test('pause, maintenance, reload, brief UI faults or stale health never open a repair job',async t=>{
  const r=fixture(t);
  for(const change of [{paused:true},{offline:true},{login:true},{expectedReload:true},{badSince:NOW-1000},{observedAt:NOW-90000},{safeIdle:false}])
    assert.equal((await r.engine.observe({...r.h,...change})).reason,'NO_SUSTAINED_INCIDENT');
  assert.equal(r.engine.load().jobs.length,0);
});
test('concurrent worker instances cannot process the same job or steal a live lock',async t=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const r=fixture(t,{repair:async()=>{await pending;return proposal();}}),first=r.engine.observe(r.h);
  const other=new E.SelfEvolutionEngine({dir:r.engine.dir,repoDir:r.repo});
  assert.equal((await other.observe(r.h)).reason,'BUSY');
  assert.throws(()=>other.recover(),{code:'WORKER_ALREADY_RUNNING'});
  release();assert.equal((await first).status,'READY_REVIEW');
});
test('corrupt ledger fails closed without overwriting evidence or leaking the lock',async t=>{
  const r=fixture(t);fs.writeFileSync(r.engine.file,'{broken');
  await assert.rejects(r.engine.observe(r.h),{code:'STATE_UNREADABLE'});
  assert.equal(fs.readFileSync(r.engine.file,'utf8'),'{broken');assert.equal(fs.existsSync(r.engine.lock),false);
});
test('in-progress records survive crashes and recover as interrupted, not deployed',t=>{
  const r=fixture(t),d=r.engine.load();d.jobs.push({id:crypto.randomUUID(),status:'REPAIRING'});r.engine.save(d);
  r.engine.recover();assert.equal(r.engine.load().jobs[0].status,'INTERRUPTED');assert.equal(r.engine.view().mode,'candidate-review');
});
test('source change during verification discards candidate without overwriting operator changes',async t=>{
  const r=fixture(t,{verify:async(files,dir,label)=>{
    if(label==='attempt-1')fs.appendFileSync(path.join(r.repo,'ui-resilience.js'),'\n// operator change\n');return {ok:true};
  }});
  assert.equal((await r.engine.observe(r.h)).status,'FAILED');assert.equal(r.engine.load().jobs[0].failure,'SOURCE_CHANGED');
  assert.match(fs.readFileSync(path.join(r.repo,'ui-resilience.js'),'utf8'),/operator change/);
});
test('sandbox config has a separate root, read-only source/runtime, private network and bounded resources',()=>{
  const p=R.sandboxProperties({root:'/safe/root',snapshot:'/safe/job/base',runtime:'/opt/node'});
  for(const expected of ['RootDirectory=/safe/root','PrivateNetwork=yes','NoNewPrivileges=yes','ProtectHome=yes','User=nobody','RuntimeMaxSec=120','KillMode=control-group'])assert.ok(p.includes(expected));
  assert.match(p.find(v=>v.startsWith('BindReadOnlyPaths=')),/\/safe\/job\/base:\/work/);
});
test('verifier uses fixed commands and never forwards parent env or model text into argv',async t=>{
  const r=fixture(t),calls=[];
  const verify=R.createVerifier({dir:r.engine.dir,runtime:'/opt/node',run:async(command,args,opts)=>{calls.push({command,args,opts});return 'OK';}});
  await verify({'ui-resilience.js':'// synthetic source'},r.engine.dir,'probe');
  assert.equal(calls[0].command,'/usr/bin/systemd-run');assert.equal(calls[0].args.at(-2),'-e');assert.equal(calls[0].opts.env,undefined);
  await assert.rejects(verify({'../.env':'private'},r.engine.dir,'attempt-1'),{code:'INVALID_SANDBOX_FILE'});
});
test('model transport sends secrets only on stdin, demands JSON and does not expose failed response bodies',async()=>{
  let seen;const repair=R.createRepair({AGENT_BASE:'https://example.invalid/v1',META_API_KEY:'SYNTHETIC_CREDENTIAL',AGENT_MODEL:'configured-model'},
    async(command,args,opts)=>{seen={command,args,opts};return JSON.stringify({choices:[{message:{content:JSON.stringify(proposal())}}]});});
  assert.deepEqual(await repair([{role:'user',content:'untrusted'}]),proposal());
  assert.equal(JSON.stringify(seen.args).includes('SYNTHETIC_CREDENTIAL'),false);assert.match(seen.opts.input,/SYNTHETIC_CREDENTIAL/);
  const invalid=R.createRepair({META_API_KEY:'synthetic',AGENT_MODEL:'model'},async()=>'{raw credential}');
  await assert.rejects(invalid([]),{code:'INVALID_MODEL_RESPONSE'});
});
test('prompt incident data is allowlisted and excludes raw DOM, errors and arbitrary telemetry',()=>{
  const messages=E.buildEvolutionPrompt({reason:'UI_SCHEMA_CHANGED',missing:['hp'],domSnapshot:'PRIVATE_RAW_DOM',telemetry:{token:'PRIVATE_RAW_DOM'}},{},[], 'Authorization: Bearer PRIVATE_FEEDBACK');
  assert.equal(JSON.stringify(messages).includes('PRIVATE_RAW_DOM'),false);assert.equal(JSON.stringify(messages).includes('PRIVATE_FEEDBACK'),false);
  assert.match(messages[0].content,/untrusted data/);
});
test('automatic mode sends only sandbox-verified candidates to the separate broker',async t=>{
  let deployed=0;const r=fixture(t,{deploy:async request=>{deployed++;assert.deepEqual(r.calls,['baseline','attempt-1']);assert.equal(request.files['agent.js'],request.base['agent.js']);return {status:'DEPLOYED'};}});
  assert.equal((await r.engine.observe(r.h)).status,'DEPLOYED');assert.equal(deployed,1);assert.equal(r.engine.view().mode,'automatic-deployment');
});
test('broker rollback failure cannot trigger another model repair/deployment attempt',async t=>{
  let calls=0;const r=fixture(t,{repair:async()=>{calls++;return proposal();},deploy:async()=>{throw Object.assign(new Error('failed'),{code:'ROLLBACK_FAILED'});}});
  assert.equal((await r.engine.observe(r.h)).status,'FAILED');assert.equal(calls,1);assert.equal(r.engine.load().jobs[0].failure,'ROLLBACK_FAILED');
});
test('previous review candidate is revalidated and automatically published after enabling deployment',async t=>{
  const r=fixture(t);await r.engine.observe(r.h);let published=0;
  const next=new E.SelfEvolutionEngine({dir:r.engine.dir,repoDir:r.repo,now:()=>NOW,verify:async()=>({ok:true}),deploy:async()=>{published++;return {status:'DEPLOYED'};}});
  assert.equal((await next.observe({...r.h,safeIdle:false})).status,'DEPLOYED');assert.equal(published,1);
});
test('root-pinned tests cannot be replaced through an agent-writable source tree',async t=>{
  const r=fixture(t);r.engine.protectedSources=r.engine.sources();fs.appendFileSync(path.join(r.repo,'ui-resilience.test.js'),'\n// changed');
  await assert.rejects(r.engine.observe(r.h),{code:'PROTECTED_SOURCE_CHANGED'});assert.equal(r.engine.load().jobs.length,0);
});
test('sandbox snapshot stays readable by its unprivileged user with service umask 0077',{skip:process.platform==='win32'},async t=>{
  const r=fixture(t),previous=process.umask(0o077);
  try{
    const verify=R.createVerifier({dir:r.engine.dir,runtime:'/opt/node',run:async()=>{
      const snapshot=fs.readdirSync(r.engine.dir).find(n=>n.startsWith('probe-'));
      for(const name of ['sandbox-root',snapshot,path.join(snapshot,'uptime-worker')])assert.equal(fs.statSync(path.join(r.engine.dir,name)).mode&0o777,0o755);
      assert.equal(fs.statSync(path.join(r.engine.dir,snapshot,'uptime-worker/monitor.mjs')).mode&0o777,0o444);return '';
    }});
    await verify({'uptime-worker/monitor.mjs':'// synthetic'},r.engine.dir,'probe');
  }finally{process.umask(previous);}
});
