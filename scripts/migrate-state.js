'use strict';
// Copy a stopped runtime without overwriting a destination or removing originals.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {STATE_FILES,CONFIG_FILES,resolveRuntimePaths,ensureStateDir}=require('../runtime-paths');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function snapshot(file,copyTo) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  let output;
  try {
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||fs.lstatSync(file).isSymbolicLink())fail('UNSAFE_MIGRATION_SOURCE');
    const json=file.endsWith('.json')||file.endsWith('.json.previous'),chunks=[];
    if(json&&stat.size>16*1024*1024)fail('STATE_JSON_TOO_LARGE');
    if(copyTo)output=fs.openSync(copyTo,'wx',0o600);
    const checksum=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024);let length;
    while((length=fs.readSync(fd,buffer,0,buffer.length,null))>0) {
      const chunk=buffer.subarray(0,length);checksum.update(chunk);
      if(output!==undefined)fs.writeFileSync(output,chunk);
      if(json)chunks.push(Buffer.from(chunk));
    }
    if(json) {
      let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('INVALID_STATE_JSON');}
      if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_STATE_JSON');
      if(path.basename(file).startsWith('.agi-brain-memory.json')&&!require('../cognitive-brain').validState(value))fail('INVALID_COGNITIVE_STATE');
    }
    if(output!==undefined)fs.fsyncSync(output);
    return {hash:checksum.digest('hex'),size:stat.size,mtime:stat.mtimeMs};
  } finally {if(output!==undefined)fs.closeSync(output);fs.closeSync(fd);}
}
function migrateState({from,to,copy=false,includeConfig=false,beforeVerify}={}) {
  if(!from||!to)fail('MIGRATION_PATHS_REQUIRED');
  const paths=resolveRuntimePaths({repoDir:from,env:{SIGIL_STATE_DIR:to}});
  const names=[...STATE_FILES,...(includeConfig?CONFIG_FILES:[])].filter(name=>fs.existsSync(path.join(paths.sourceDir,name)));
  for(const name of names) {
    const source=path.join(paths.sourceDir,name),target=path.join(paths.stateDir,name);
    if(!fs.lstatSync(source).isFile()||fs.lstatSync(source).isSymbolicLink())fail('UNSAFE_MIGRATION_SOURCE');
    try{fs.lstatSync(target);fail('MIGRATION_TARGET_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const result={copied:copy,files:names,includesConfig:includeConfig};
  if(!copy||!names.length)return result;
  // The migration itself is allowed to create the destination before the legacy
  // state guard used by running services can succeed.
  ensureStateDir({...paths,external:false});
  const staging=fs.mkdtempSync(path.join(paths.stateDir,'.sigil-migration-'));
  const staged=[],published=[],originals=new Map();
  try {
    for(const name of names) {
      const temp=path.join(staging,name);staged.push(temp);
      const value=snapshot(path.join(paths.sourceDir,name),temp);originals.set(name,value);
    }
    if(beforeVerify)beforeVerify();
    for(const [name,previous] of originals) {
      const current=snapshot(path.join(paths.sourceDir,name));
      if(current.hash!==previous.hash||current.size!==previous.size||current.mtime!==previous.mtime)fail('STATE_CHANGED_DURING_MIGRATION');
    }
    for(const name of names) {
      const target=path.join(paths.stateDir,name);
      fs.linkSync(path.join(staging,name),target);published.push(target); // atomic, cannot overwrite
    }
    if(process.platform!=='win32') {
      const fd=fs.openSync(paths.stateDir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    }
    return result;
  } catch(e) {
    for(const target of published)fs.unlinkSync(target);
    throw e;
  } finally {
    for(const temp of staged)if(fs.existsSync(temp))fs.unlinkSync(temp);
    fs.rmdirSync(staging);
  }
}
function main(args=process.argv.slice(2)) {
  const values={from:path.resolve(__dirname,'..')};
  for(let i=0;i<args.length;i++) {
    if(['--from','--to'].includes(args[i])) {const name=args[i].slice(2);if(!args[i+1]||args[i+1].startsWith('--'))fail('INVALID_MIGRATION_ARGUMENT');values[name]=args[++i];}
    else if(args[i]==='--copy')values.copy=true;
    else if(args[i]==='--include-config')values.includeConfig=true;
    else fail('INVALID_MIGRATION_ARGUMENT');
  }
  const result=migrateState(values);
  console.log(JSON.stringify({mode:result.copied?'copied':'dry-run',files:result.files,originalsPreserved:true}));
}
module.exports={migrateState,main};
if(require.main===module)try{main();}catch(e){
  const code=/^[A-Z_]{3,64}$/.test(e.code||'')?e.code:'STATE_MIGRATION_FAILED';
  console.error(code+': migration stopped; originals preserved; no secret values printed');process.exitCode=1;
}
