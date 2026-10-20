'use strict';
// Daily isolated exercise. Production is observed with GETs; all writes/control target a copy.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const E=require('./self-evolution'),R=require('./self-evolution-runner'),{DeploymentBroker}=require('./self-deployment');
const {AlertEngine}=require('./telegram-alerts');
const STATE='/var/lib/sigil-self-healing-e2e',PUBLIC='/var/lib/sigil-self-healing-reports/e2e.json';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const dayAt=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
function schedule(now=Date.now()) {
  const day=dayAt(now),target=Date.parse(day+'T00:00:00Z');
  return {enabled:true,timeZone:'Asia/Bangkok',hour:7,minute:0,nextRunAt:target>now?target:target+86400000};
}
function summary(r){return {runId:r.runId,day:r.day,stage:r.stage,startedAt:r.startedAt,finishedAt:r.finishedAt,
  notificationPolicy:r.notificationPolicy||'all_results',failureCode:r.failureCode||null};}
function canRun(ledger,day){return !(ledger.runs||[]).some(r=>r.day===day);}
function quietEvent(engine,deployment,status) {
  engine.observe({deployment,agent:null,supervisorOk:true,viewerOk:true});
  const events=engine.db.pending.filter(e=>e.key.startsWith('deployment:')&&e.key.endsWith(':'+status));
  assert.equal(events.length,1,'EXPECTED_ALERT_MISSING');
  engine.acknowledge(events);return status; // Exercise routing/deduplication, deliberately never call Telegram.
}
function failureCode(e){return /^[A-Z][A-Z0-9_]{1,63}$/.test(e?.code||'')?e.code:'ISOLATED_CHECK_FAILED';}
function writePublic(report,ledger) {
  fs.mkdirSync(path.dirname(PUBLIC),{recursive:true,mode:0o755});fs.chmodSync(path.dirname(PUBLIC),0o755);
  E.writeJsonAtomic(PUBLIC,{...report,schedule:schedule(),history:ledger.runs.filter(r=>r.finishedAt).slice(-30).reverse()});fs.chmodSync(PUBLIC,0o644);
}
function store(ledger,report) {
  const row=summary(report),at=ledger.runs.findIndex(r=>r.runId===row.runId);
  if(at<0)ledger.runs.push(row);else ledger.runs[at]=row;
  ledger.runs=ledger.runs.slice(-31);E.writeJsonAtomic(path.join(STATE,'daily.json'),ledger);writePublic(report,ledger);
}
async function production() {
  const response=await fetch('http://127.0.0.1:4801/health',{signal:AbortSignal.timeout(3000)});
  assert.equal(response.ok,true,'PRODUCTION_UNREACHABLE');const h=await response.json();assert.ok(h.selfHealing?.bootId);
  const paths=require('./runtime-paths').resolveRuntimePaths({repoDir:process.env.SIGIL_DIR||'/home/asteria/sigil'});
  return {bootId:h.selfHealing.bootId,buildId:h.selfHealing.buildId,paused:h.paused,
    pid:execFileSync('/usr/bin/systemctl',['show','sigil-agent.service','--property=MainPID','--value'],{encoding:'utf8'}).trim(),
    files:Object.fromEntries([...E.SOURCES.map(n=>[n,path.join(paths.sourceDir,n)]),
      ...require('./runtime-paths').CONFIG_FILES.map(n=>['config/'+n,path.join(paths.configDir,n)])].map(([n,p])=>
      [n,fs.existsSync(p)?hash(fs.readFileSync(p)):null]))};
}

// FIXTURE_SCRIPTS (generated from the previously verified, credential-free fixture).
const FIXTURES = {"control.cjs": "'use strict';\nconst fs=require('fs'),path=require('path'),{spawn}=require('child_process'),assert=require('assert/strict');\nconst E=require('/opt/sigil-self-healing/self-evolution');\nconst root=__dirname,entry=path.join(root,'sim-agent.cjs'),endpoint=path.join(root,'endpoint.json');\nassert.match(root,/^\\/var\\/lib\\/sigil-self-healing-e2e\\/runs\\/[0-9]+$/);\nconst sleep=ms=>new Promise(r=>setTimeout(r,ms));\nasync function health(){const ep=E.readJson(endpoint,null);assert.ok(ep?.port>0);const r=await fetch('http://127.0.0.1:'+ep.port+'/health',{signal:AbortSignal.timeout(1500)});return r.json();}\nasync function pause(){E.writeJsonAtomic(path.join(root,'paused.json'),{paused:true});}\nasync function stop(){\n const ep=E.readJson(endpoint,null);if(!ep)return;\n let cmd;try{cmd=fs.readFileSync('/proc/'+ep.pid+'/cmdline','utf8').split('\\0');}catch(e){if(e.code==='ENOENT')return;throw e;}\n if(cmd.length===1&&cmd[0]==='')return;\n assert.equal(cmd[1],entry);assert.equal(cmd[0],process.execPath);\n const h=await health();assert.equal(h.bootId,ep.bootId);process.kill(ep.pid,'SIGTERM');\n for(let i=0;i<50;i++){try{const stat=fs.readFileSync('/proc/'+ep.pid+'/stat','utf8');if(stat.split(') ')[1]?.startsWith('Z'))return;}catch(e){if(e.code==='ENOENT')return;throw e;}await sleep(100);}\n throw Error('SIMULATED_AGENT_STOP_TIMEOUT');\n}\nasync function start(paused){\n fs.rmSync(endpoint,{force:true});E.writeJsonAtomic(path.join(root,'paused.json'),{paused:Boolean(paused)});\n const child=spawn(process.execPath,[entry],{env:{PATH:'/usr/bin:/bin'},stdio:'ignore',detached:true});child.unref();\n for(let i=0;i<60;i++){try{const h=await health();if(h.bootId)return;}catch{}await sleep(100);}\n throw Error('SIMULATED_AGENT_START_TIMEOUT');\n}\nmodule.exports={health,pause,stop,start};\n", "sim-agent.cjs": "'use strict';\nconst fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto');\nconst E=require('/opt/sigil-self-healing/self-evolution');\nconst root=__dirname,repo=path.join(root,'source'),ui=require(path.join(repo,'ui-resilience'));\nconst bootId=crypto.randomUUID(),buildId=E.sourceFingerprint(repo);let cycles=0;\nconst server=http.createServer((req,res)=>{\n if(req.method!=='GET'||req.url!=='/health'){res.writeHead(404);return res.end();}\n const now=Date.now(),fault=E.readJson(path.join(root,'fault.json'),{}).runtimeError;\n const h={bootId,buildId,updatedAt:now-1,observedAt:now-1,completedCycles:++cycles,\n   safeIdle:ui.__selfHealingE2E!==true,paused:Boolean(E.readJson(path.join(root,'paused.json'),{}).paused),badSince:now-240000,missing:['hp'],\n   offline:false,login:false,expectedReload:false,positionFault:false,dead:false,cycleErrorAt:fault?now-1:0};\n res.setHeader('content-type','application/json');res.end(JSON.stringify(h));\n});\nserver.listen(0,'127.0.0.1',()=>E.writeJsonAtomic(path.join(root,'endpoint.json'),{pid:process.pid,port:server.address().port,bootId}));\nprocess.on('SIGTERM',()=>server.close(()=>process.exit(0)));\n", "guard.cjs": "'use strict';\nconst path=require('path'),fs=require('fs'),assert=require('assert/strict'),{DeploymentBroker}=require('/opt/sigil-self-healing/self-deployment');\nconst E=require('/opt/sigil-self-healing/self-evolution');\nconst control=require('./control.cjs'),root=__dirname;\nconst broker=new DeploymentBroker({dir:path.join(root,'state'),repoDir:path.join(root,'source'),health:control.health,pause:control.pause,stop:control.stop,start:control.start,projectionFile:path.join(root,'public','events.json')});\nconst sleep=ms=>new Promise(r=>setTimeout(r,ms));\n(async()=>{\n if(process.argv.includes('--watch')){\n  const startedAt=Date.now();let polls=0;\n  while(Date.now()-startedAt<900000){\n   const result=await broker.guard();polls++;\n   if(result.status==='ROLLED_BACK'){\n    const at=Date.now(),faultAt=fs.statSync(path.join(root,'fault.json')).mtimeMs;\n    assert.ok(startedAt<faultAt);\n    E.writeJsonAtomic(path.join(root,'guard-receipt.json'),{pid:process.pid,startedAt,at,polls,faultAt,latencyMs:at-faultAt,reason:result.reason});\n    console.log('INDEPENDENT_PERIODIC_GUARD_CONFIRMED');return;\n   }\n   assert.notEqual(result.status,'ROLLBACK_FAILED');await sleep(5000);\n  }\n  throw Error('GUARD_TIMEOUT');\n }\n // The test coordinator only waits for the independently scheduled guard; it cannot force a rollback.\n for(let i=0;i<45;i++){\n  if(broker.load().active?.phase==='ROLLED_BACK'&&fs.existsSync(path.join(root,'guard-receipt.json'))){\n   const receipt=E.readJson(path.join(root,'guard-receipt.json'));assert.notEqual(receipt.pid,process.pid);\n   console.log('INDEPENDENT_GUARD_ROLLBACK_CONFIRMED');return;\n  }\n  await sleep(500);\n }\n throw Error('GUARD_DID_NOT_ROLL_BACK');\n})().catch(()=>{console.error('ISOLATED_GUARD_FAILED');process.exitCode=1;});\n"};

async function exercise(report,ledger) {
  const root=path.join(STATE,'runs',String(Date.now())),repo=path.join(root,'source'),state=path.join(root,'state');
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  for(const dir of [repo,state,path.join(root,'public')])fs.mkdirSync(dir,{mode:0o700});
  for(const [name,source] of Object.entries(FIXTURES))fs.writeFileSync(path.join(root,name),source,{flag:'wx',mode:0o600});
  for(const n of E.SOURCES){const dest=path.join(repo,n);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.copyFileSync(path.join(__dirname,'source',n),dest);}
  fs.writeFileSync(path.join(repo,'unrelated.txt'),'DAILY_CHECK_SENTINEL',{mode:0o600});
  const control=require(path.join(root,'control.cjs')),before=await production();
  E.writeJsonAtomic(path.join(root,'production-before.json'),before);
  let watch,timer,publishing=false,observing=false,observation=null;
  const verifyProduction=async()=>{
    try{assert.deepEqual(await production(),before,'PRODUCTION_CHANGED');report.productionSamples=(report.productionSamples||0)+1;}
    catch(e){report.productionUnchanged=false;report.checks.productionUnchanged='FAILED';throw e;}
  };
  async function publish(){
    while(publishing)await sleep(20);publishing=true;
    try{
      report.checkedAt=Date.now();report.deployment=E.readJson(path.join(root,'public','events.json'),null);
      report.repair=E.readJson(path.join(root,'public','repair.json'),null);
      try{report.health=await control.health();}catch{report.health=null;}
      if(report.deployment?.phase==='CANARY')report.stage='CANARY';
      writePublic(report,ledger);
    }finally{publishing=false;}
  }
  try{
    await control.start(false);const initial=await control.health();assert.equal(initial.safeIdle,true);
    const original=fs.readFileSync(path.join(repo,'ui-resilience.js'),'utf8'),build=E.sourceFingerprint(repo);
    const protectedSources=Object.fromEntries(E.SOURCES.filter(n=>!E.EDITABLE.includes(n)).map(n=>[n,fs.readFileSync(path.join(repo,n),'utf8')]));
    const broker=new DeploymentBroker({dir:state,repoDir:repo,health:control.health,pause:control.pause,stop:control.stop,start:control.start,
      protectedSources,projectionFile:path.join(root,'public','events.json')});
    const verify=R.createVerifier({dir:state,runtime:path.dirname(path.dirname(process.execPath)),
      run:(command,args,options)=>R.execBounded(command,args.map(a=>a==='--property=CPUQuota=100%'?'--property=CPUQuota=50%':a),options)});
    const engine=new E.SelfEvolutionEngine({dir:state,repoDir:repo,protectedSources,projectionFile:path.join(root,'public','repair.json'),
      repair:async()=>({edits:[{file:'ui-resilience.js',find:'module.exports={assess,update,assertReady,observeCombat};',
        replace:'module.exports={assess,update,assertReady,observeCombat};\nmodule.exports.__selfHealingE2E = true;'}],
        test:"const{test}=require('node:test'),a=require('node:assert/strict');test('daily isolated repair probe',()=>a.equal(require('./ui-resilience').__selfHealingE2E,true));"}),
      verify:async(files,job,label)=>{report.stage=label==='baseline'?'BASELINE':'VERIFYING';await publish();await verify(files,job,label);
        report.checks[label==='baseline'?'baselineTests':'candidateTests']='PASSED';return {ok:true};},deploy:req=>broker.deploy(req)});
    engine.recover();await publish();
    watch=spawn(process.execPath,[path.join(root,'guard.cjs'),'--watch'],{env:{PATH:'/usr/bin:/bin'},stdio:'ignore'});
    let watchDone=false,watchCode=null;watch.once('exit',code=>{watchDone=true;watchCode=code;});
    let lastObservation=0;
    timer=setInterval(()=>{
      publish().catch(()=>{});
      if(!observing&&Date.now()-lastObservation>=15000){observing=true;lastObservation=Date.now();
        observation=verifyProduction().catch(()=>{}).finally(()=>{observing=false;});}
    },2000);
    assert.equal((await engine.observe(initial)).status,'DEPLOYED','REPAIR_PIPELINE_FAILED');
    const d=broker.load();assert.equal(d.active.phase,'COMMITTED');
    report.canaryElapsedMs=d.events.find(e=>e.status==='COMMITTED').at-d.events.find(e=>e.status==='CANARY').at;
    assert.ok(report.canaryElapsedMs>=600000);report.checks.canary='PASSED';
    const healthy=await control.health();assert.notEqual(healthy.bootId,initial.bootId);assert.equal(healthy.buildId,d.active.candidateBuild);
    let alerts=new AlertEngine();
    report.suppressedNotifications.push(quietEvent(alerts,E.readJson(path.join(root,'public','events.json')),'COMMITTED'));
    E.writeJsonAtomic(path.join(root,'alerts.json'),alerts.db);report.checks.telegramCommit='PASSED';report.stage='COMMITTED';await publish();
    await sleep(2000);report.stage='INJECTING_FAILURE';E.writeJsonAtomic(path.join(root,'fault.json'),{runtimeError:true});await publish();
    for(let i=0;i<50&&!watchDone;i++)await sleep(500);
    assert.equal(watchDone,true,'INDEPENDENT_GUARD_TIMEOUT');assert.equal(watchCode,0,'INDEPENDENT_GUARD_FAILED');
    const restored=broker.load(),h=await control.health();assert.equal(restored.active.phase,'ROLLED_BACK');
    assert.equal(h.buildId,build);assert.notEqual(h.bootId,healthy.bootId);assert.equal(fs.readFileSync(path.join(repo,'ui-resilience.js'),'utf8'),original);
    assert.equal(fs.readFileSync(path.join(repo,'unrelated.txt'),'utf8'),'DAILY_CHECK_SENTINEL');report.checks.guardRollback='PASSED';
    const receipt=E.readJson(path.join(root,'guard-receipt.json'));report.guardLatencyMs=receipt.latencyMs;
    report.suppressedNotifications.push(quietEvent(alerts,E.readJson(path.join(root,'public','events.json')),'ROLLED_BACK'));
    report.checks.telegramRollback='PASSED';E.writeJsonAtomic(path.join(root,'alerts.json'),alerts.db);
    alerts=new AlertEngine(E.readJson(path.join(root,'alerts.json')));
    for(let i=0;i<3;i++)alerts.observe({deployment:E.readJson(path.join(root,'public','events.json')),agent:null,supervisorOk:true,viewerOk:true});
    assert.equal(alerts.db.pending.filter(e=>e.key.startsWith('deployment:')).length,0);report.checks.noDuplicateAlerts='PASSED';
    clearInterval(timer);if(observation)await observation;await verifyProduction();assert.notEqual(report.productionUnchanged,false);
    report.productionUnchanged=true;report.checks.productionUnchanged='PASSED';report.stage='PASSED';await publish();
    E.writeJsonAtomic(path.join(root,'result.json'),report);
  }finally{
    clearInterval(timer);if(observation)await observation;while(publishing)await sleep(20);
    if(watch&&!watch.killed)watch.kill('SIGTERM');await control.stop();
  }
}
async function main(){
  assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);
  fs.mkdirSync(STATE,{recursive:true,mode:0o700});fs.chmodSync(STATE,0o700);
  const lock=new DeploymentBroker({dir:STATE,repoDir:STATE});
  if(!lock.acquire())return;
  try{
    const ledger=E.readJson(path.join(STATE,'daily.json'),{version:1,runs:[]});assert.equal(ledger.version,1);assert.ok(Array.isArray(ledger.runs));
    const previous=E.readJson(PUBLIC,null);
    if(process.argv.includes('--finalize')){
      if(previous?.notificationPolicy==='failed_runs_only'&&!previous.finishedAt){
        previous.stage='FAILED';previous.failureCode='SERVICE_INTERRUPTED';previous.finishedAt=Date.now();store(ledger,previous);
      }
      return;
    }
    // A boot after an interrupted run must retain a failure in history before starting another day.
    for(const row of ledger.runs)if(!row.finishedAt){
      row.stage='FAILED';row.failureCode='SERVICE_INTERRUPTED';row.finishedAt=Date.now();
      if(previous?.runId===row.runId){previous.stage=row.stage;previous.failureCode=row.failureCode;previous.finishedAt=row.finishedAt;writePublic(previous,ledger);}
    }
    E.writeJsonAtomic(path.join(STATE,'daily.json'),ledger);
    const day=dayAt(Date.now());if(!canRun(ledger,day))return;
    const report={version:1,kind:'isolated-e2e',day,runId:crypto.randomUUID(),startedAt:Date.now(),checkedAt:Date.now(),stage:'PREPARING',
      notificationPolicy:'failed_runs_only',suppressedNotifications:[],notifications:[],productionUnchanged:null,checks:{}};
    store(ledger,report);
    try{await exercise(report,ledger);assert.equal(report.stage,'PASSED');}
    catch(e){report.stage='FAILED';report.failureCode=failureCode(e);process.exitCode=1;}
    report.finishedAt=Date.now();report.checkedAt=Date.now();store(ledger,report);
    console.log(JSON.stringify({day,runId:report.runId,stage:report.stage,notificationPolicy:report.notificationPolicy}));
  }finally{lock.release();}
}
module.exports={dayAt,schedule,summary,canRun,quietEvent,failureCode};
if(require.main===module)main().catch(()=>{console.error('DAILY_CHECK_FAILED');process.exitCode=1;});
