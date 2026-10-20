'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{once}=require('node:events');
const R=require('./runtime-paths'),{migrateState}=require('./scripts/migrate-state');
function rig(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sigil-state-paths-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'source'),state=path.join(root,'state');fs.mkdirSync(source);
  return {root,source,state};
}
test('explicit external state separates runtime, configuration and trusted source while legacy defaults survive',t=>{
  const r=rig(t);
  assert.equal(R.resolveRuntimePaths({repoDir:r.source,env:{}}).stateDir,r.source);
  const paths=R.resolveRuntimePaths({repoDir:r.source,env:{SIGIL_STATE_DIR:r.state}});
  assert.equal(paths.sourceDir,r.source);assert.equal(paths.stateDir,r.state);assert.equal(paths.configDir,r.state);
  assert.equal(R.resolveRuntimePaths({repoDir:r.source,env:{SIGIL_STATE_DIR:r.state,SIGIL_CONFIG_DIR:r.root}}).configDir,r.root);
  R.ensureStateDir(paths);assert.ok(fs.statSync(r.state).isDirectory());
});
test('relative and in-source state paths are rejected rather than silently creating a fresh brain',t=>{
  const r=rig(t);
  for(const state of ['relative',r.source,path.join(r.source,'runtime')])
    assert.throws(()=>R.resolveRuntimePaths({repoDir:r.source,env:{SIGIL_STATE_DIR:state}}));
});
test('a legacy brain must be migrated before an external runtime can start',t=>{
  const r=rig(t);fs.writeFileSync(path.join(r.source,'.agi-brain-memory.json'),'{}');
  const paths=R.resolveRuntimePaths({repoDir:r.source,env:{SIGIL_STATE_DIR:r.state}});
  assert.throws(()=>R.ensureStateDir(paths),{code:'LEGACY_STATE_REQUIRES_MIGRATION'});
  assert.equal(fs.existsSync(r.state),false);
});
test('an outside directory alias cannot route new state back into the source tree',t=>{
  const r=rig(t),alias=path.join(r.root,'alias');
  try{fs.symlinkSync(r.source,alias,process.platform==='win32'?'junction':'dir');}catch{t.skip('Directory links unavailable');return;}
  assert.throws(()=>R.resolveRuntimePaths({repoDir:r.source,env:{SIGIL_STATE_DIR:alias}}),{code:'STATE_DIRECTORY_MUST_BE_OUTSIDE_SOURCE'});
});
test('platform recommendations use user-local state outside the project',()=>{
  const home=path.resolve('synthetic-home');
  assert.equal(R.recommendedStateDir({platform:'win32',env:{LOCALAPPDATA:home},home}),path.join(home,'sigil-ai-agent','state'));
  assert.equal(R.recommendedStateDir({platform:'linux',env:{},home}),path.join(home,'.local','state','sigil-ai-agent'));
});
test('migration dry-run never creates a destination and omits config unless explicitly selected',t=>{
  const r=rig(t);fs.writeFileSync(path.join(r.source,'agent-memory.json'),'{}');fs.writeFileSync(path.join(r.source,'.env'),'synthetic fixture');
  const plan=migrateState({from:r.source,to:r.state});assert.deepEqual(plan.files,['agent-memory.json']);
  assert.equal(fs.existsSync(r.state),false);
  assert.ok(migrateState({from:r.source,to:r.state,includeConfig:true}).files.includes('.env'));
});
test('migration preserves brain identity, backup, DNA and alert queue byte-for-byte without touching originals',t=>{
  const r=rig(t),brain=require('./cognitive-brain').createEmptyBrainState();
  const files={'.agi-brain-memory.json':JSON.stringify(brain),'.agi-brain-memory.json.previous':JSON.stringify(brain),
    'dna-memory.json':'{"version":1}', 'telegram-alerts-state.json':'{"pending":[{"id":9}]}','agent.log':'synthetic history\n'};
  for(const [name,value] of Object.entries(files))fs.writeFileSync(path.join(r.source,name),value);
  migrateState({from:r.source,to:r.state,copy:true});
  for(const [name,value] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(r.source,name),'utf8'),value);
    assert.equal(fs.readFileSync(path.join(r.state,name),'utf8'),value);
  }
  assert.equal(fs.readdirSync(r.state).some(n=>n.startsWith('.sigil-migration-')),false);
});
test('existing destination files cannot be overwritten or merged',t=>{
  const r=rig(t);fs.mkdirSync(r.state);fs.writeFileSync(path.join(r.source,'agent-memory.json'),'{}');
  fs.writeFileSync(path.join(r.state,'agent-memory.json'),'original destination');
  assert.throws(()=>migrateState({from:r.source,to:r.state,copy:true}),{code:'MIGRATION_TARGET_EXISTS'});
  assert.equal(fs.readFileSync(path.join(r.state,'agent-memory.json'),'utf8'),'original destination');
});
test('changed source or malformed memory aborts before publishing any file',t=>{
  const r=rig(t);fs.writeFileSync(path.join(r.source,'agent-memory.json'),'{}');
  assert.throws(()=>migrateState({from:r.source,to:r.state,copy:true,beforeVerify:()=>fs.writeFileSync(path.join(r.source,'agent-memory.json'),'{"changed":true}')}),{code:'STATE_CHANGED_DURING_MIGRATION'});
  assert.deepEqual(fs.readdirSync(r.state),[]);
  fs.writeFileSync(path.join(r.source,'agent-memory.json'),'not json');
  assert.throws(()=>migrateState({from:r.source,to:r.state,copy:true}),{code:'INVALID_STATE_JSON'});
  assert.deepEqual(fs.readdirSync(r.state),[]);
});
test('viewer reads external token, diary and logs without writing them into source',async t=>{
  const r=rig(t);fs.mkdirSync(r.state);
  const token=require('node:crypto').randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(r.state,'viewer-token.txt'),token);fs.writeFileSync(path.join(r.state,'agent-diary.md'),'external diary');
  const net=require('node:net'),server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const child=spawn(process.execPath,[path.join(__dirname,'viewer.js')],{env:{...process.env,AGENT_DIR:r.source,SIGIL_STATE_DIR:r.state,SIGIL_CONFIG_DIR:r.state,VIEWER_TOKEN:'',VIEWER_PORT:String(port)},stdio:'ignore'});
  t.after(async()=>{const exited=once(child,'exit');child.kill();await exited;});
  let response;
  for(let i=0;i<100;i++) {try{response=await fetch('http://127.0.0.1:'+port+'/?k='+token);if(response.ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,30));}
  assert.equal(response?.status,200);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const diary=await fetch('http://127.0.0.1:'+port+'/diary.txt',{headers:{cookie}});
  assert.equal(await diary.text(),'external diary');assert.deepEqual(fs.readdirSync(r.source),[]);
});
