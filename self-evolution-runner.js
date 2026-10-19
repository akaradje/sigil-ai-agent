'use strict';
// A separate trusted worker: neither the game controller nor the model can launch commands.
const fs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');
const crypto=require('node:crypto');
const E=require('./self-evolution');
const {DeploymentBroker}=require('./self-deployment');
const {readEnv}=require('./telegram-alerts');
const error=code=>Object.assign(new Error(code),{code});

function execBounded(command,args,{input='',timeout=120000,cwd,env={PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}}={}) {
  return new Promise((resolve,reject)=>{
    const child=execFile(command,args,{cwd,env,encoding:'utf8',timeout,maxBuffer:512*1024,killSignal:'SIGKILL'},(err,stdout,stderr)=>{
      if(err){const failure=error('SANDBOX_TEST_FAILED'),output=String(stdout+'\n'+stderr);
        const failed=output.match(/not ok [\s\S]*?(?:\n\s*\.\.\.|$)/g);
        failure.feedback=failed?.length?failed.join('\n').slice(0,12000):output.slice(-12000);reject(failure);}
      else resolve(stdout);
    });
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
function sandboxProperties({root,snapshot,runtime}) {
  return [
    'RootDirectory='+root,'WorkingDirectory=/work',
    'BindReadOnlyPaths=/usr /lib /lib64 '+runtime+':/runtime '+snapshot+':/work',
    'TemporaryFileSystem=/tmp:rw,nosuid,nodev,mode=1777','MountAPIVFS=yes',
    'User=nobody','Group=nogroup','PrivateNetwork=yes','PrivateDevices=yes','ProtectSystem=strict',
    'ProtectHome=yes','ProtectProc=invisible','ProcSubset=pid','NoNewPrivileges=yes',
    'CapabilityBoundingSet=','RestrictSUIDSGID=yes','LockPersonality=yes','RestrictRealtime=yes',
    'ProtectKernelTunables=yes','ProtectKernelModules=yes','ProtectControlGroups=yes',
    'UMask=0077','RuntimeMaxSec=120','TimeoutStopSec=3','KillMode=control-group',
    'MemoryMax=768M','TasksMax=96','CPUQuota=100%','LimitCORE=0','Environment=PATH=/runtime/bin:/usr/bin HOME=/tmp LANG=C.UTF-8'
  ];
}
function createVerifier({dir,runtime,run=execBounded}) {
  const root=path.join(dir,'sandbox-root');
  fs.mkdirSync(root,{recursive:true,mode:0o755});
  fs.chmodSync(root,0o755);
  return async(files,jobDir,label)=>{
    if(!/^(baseline|attempt-[123]|probe)$/.test(label))throw error('INVALID_SANDBOX_LABEL');
    const snapshot=path.join(jobDir,label+'-'+crypto.randomUUID());
    fs.mkdirSync(snapshot,{mode:0o755});
    fs.chmodSync(snapshot,0o755);
    for(const [name,content] of Object.entries(files)) {
      if(!E.SOURCES.includes(name)&&name!=='self-evolution.candidate.test.js')throw error('INVALID_SANDBOX_FILE');
      const file=path.join(snapshot,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o755});
      fs.chmodSync(path.dirname(file),0o755);
      fs.writeFileSync(file,content,{flag:'wx',mode:0o444});
      fs.chmodSync(file,0o444);
    }
    const tests=E.TESTS.concat(files['self-evolution.candidate.test.js']?['self-evolution.candidate.test.js']:[]);
    // JSON builds a fixed script from trusted filenames; no model strings become command arguments.
    const syntax=Object.keys(files).filter(f=>/\.(js|mjs)$/.test(f));
    const script="const{execFileSync}=require('node:child_process');for(const f of "+JSON.stringify(syntax)+")execFileSync(process.execPath,['--check',f],{stdio:'pipe'});execFileSync(process.execPath,['--test','--test-concurrency=2',..."+JSON.stringify(tests)+"],{stdio:'inherit',env:{PATH:'/runtime/bin:/usr/bin',HOME:'/tmp',LANG:'C.UTF-8'}})";
    const properties=sandboxProperties({root,snapshot,runtime});
    const args=['--quiet','--wait','--pipe','--collect','--unit=sigil-repair-test-'+crypto.randomUUID(),
      ...properties.flatMap(p=>['--property='+p]),'/runtime/bin/node','-e',script];
    await run('/usr/bin/systemd-run',args,{timeout:135000});
    return {ok:true};
  };
}
function createRepair(cfg,run=execBounded) {
  const endpoint=new URL((cfg.AGENT_BASE||'https://api.meta.ai/v1').replace(/\/$/,'')+'/chat/completions');
  if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)throw error('INVALID_MODEL_ENDPOINT');
  if(!cfg.META_API_KEY || !cfg.AGENT_MODEL)throw error('MODEL_NOT_CONFIGURED');
  return async messages=>{
    const body=JSON.stringify({model:cfg.AGENT_MODEL,messages,max_tokens:4000,temperature:0.1});
    // curl config arrives on stdin: credentials/prompt never appear in argv, errors or job ledger.
    const lines=['url = '+JSON.stringify(endpoint.href),'request = "POST"','header = "Content-Type: application/json"',
      'header = '+JSON.stringify('Authorization: Bearer '+cfg.META_API_KEY)];
    if(cfg.AGENT_RELAY_KEY)lines.push('header = '+JSON.stringify('x-relay-key: '+cfg.AGENT_RELAY_KEY));
    lines.push('data-binary = '+JSON.stringify(body));
    let raw;
    try {raw=await run('/usr/bin/curl',['--silent','--show-error','--fail','--max-time','90','--config','-'],{input:lines.join('\n'),timeout:95000});}
    catch{throw error('MODEL_UNAVAILABLE');}
    try {
      const response=JSON.parse(raw),content=response.choices?.[0]?.message?.content;
      if(typeof content!=='string'||content.length>80000)throw error('INVALID_MODEL_RESPONSE');
      return JSON.parse(content.replace(/^```(?:json)?\s*/,'').replace(/\s*```\s*$/,''));
    }catch{throw error('INVALID_MODEL_RESPONSE');}
  };
}
function createProductionBroker({dir,repoDir,redact,protectedSources,run=execBounded}) {
  async function read(){
    const r=await fetch('http://127.0.0.1:4801/health',{signal:AbortSignal.timeout(3000)});
    if(!r.ok)throw error('AGENT_UNREACHABLE');return r.json();
  }
  async function control(route){const r=await fetch('http://127.0.0.1:4801/'+route,{signal:AbortSignal.timeout(3000)});if(!r.ok)throw error('AGENT_UNREACHABLE');await r.text();}
  return new DeploymentBroker({dir,repoDir,redact,protectedSources,projectionFile:'/run/sigil-self-healing/events.json',health:async()=>(await read()).selfHealing,
    pause:async()=>{await control('pause');for(let i=0;i<30;i++){if(!(await read()).busy)return;await new Promise(r=>setTimeout(r,1000));}throw error('AGENT_NOT_IDLE');},
    stop:async()=>{try{await run('/usr/bin/systemctl',['stop','sigil-agent.service','sigil-supervisor.service'],{timeout:20000});}catch{throw error('SERVICE_STOP_FAILED');}},
    start:async paused=>{
      try{await run('/usr/bin/systemctl',['start','sigil-agent.service','sigil-supervisor.service'],{timeout:20000});}catch{throw error('SERVICE_START_FAILED');}
      for(let i=0;i<20;i++){try{await read();if(paused)await control('pause');return;}catch{await new Promise(r=>setTimeout(r,250));}}
      throw error('SERVICE_START_FAILED');
    }});
}
async function main() {
  const repoDir=process.env.SIGIL_DIR||__dirname;
  const cfg={...readEnv(process.env.SELF_HEAL_CONFIG||'/etc/sigil-self-healing.env'),...process.env};
  const guarding=process.argv.includes('--guard');
  if(!guarding&&cfg.SIGIL_SELF_HEAL!=='1')throw error('SELF_HEAL_DISABLED');
  if(process.platform!=='linux' || process.getuid?.()!==0)throw error('LINUX_SANDBOX_REQUIRED');
  const dir=cfg.SELF_HEAL_DIR||'/var/lib/sigil-self-healing';
  const runtime=path.dirname(path.dirname(process.execPath));
  const secrets=Object.entries(cfg).filter(([k])=>/(?:KEY|TOKEN|PASSWORD|SECRET|CHAT_ID)/i.test(k)).map(([,v])=>v);
  const protectedSources=Object.fromEntries(E.SOURCES.filter(n=>!E.EDITABLE.includes(n)).map(n=>[n,fs.readFileSync(path.join(__dirname,'source',n),'utf8')]));
  const redact=E.createRedactor(secrets),broker=createProductionBroker({dir,repoDir,redact,protectedSources});
  if(guarding){await broker.guard();return;}
  await broker.recover();
  const engine=new E.SelfEvolutionEngine({dir,repoDir,repair:createRepair(cfg),verify:createVerifier({dir,runtime}),redact,
    protectedSources,projectionFile:'/run/sigil-self-healing/repair.json',
    deploy:cfg.SELF_HEAL_AUTO_DEPLOY==='1'?request=>broker.deploy(request):null});
  engine.recover();
  async function poll(){
    try {
      const res=await fetch('http://127.0.0.1:4801/health',{signal:AbortSignal.timeout(5000)});
      if(res.ok)await engine.observe((await res.json()).selfHealing);
    }catch(e){console.error('self-healing: '+(/^[A-Z_]+$/.test(e.code||'')?e.code:'OBSERVER_UNAVAILABLE'));}
  }
  console.log('Self-healing worker ready; deployment='+Boolean(engine.deploy)+'; Git push disabled');
  if(process.argv.includes('--once'))return poll();
  async function loop(){await poll();setTimeout(loop,30000);}
  await loop();
}
module.exports={execBounded,sandboxProperties,createVerifier,createRepair,createProductionBroker};
if(require.main===module)main().catch(e=>{console.error(e.code||'WORKER_START_FAILED');process.exitCode=1;});
