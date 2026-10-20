'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');

const STATE_FILES=Object.freeze(['agent-memory.json','dna-memory.json','dna-memory.json.previous',
  '.agi-brain-memory.json','.agi-brain-memory.json.previous','telegram-alerts-state.json',
  'game-catalog-cache.json','agent.log','supervisor.log','metrics.jsonl','agent-decisions.jsonl',
  'agent-diary.md','agent-lessons.md','agent-goal.txt','agent-tactic.txt']);
const CONFIG_FILES=Object.freeze(['.env','telegram.env','viewer-token.txt']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
function inside(root,target) {
  const relative=path.relative(root,target);
  return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
}
function canonical(target) {
  const missing=[];let current=target;
  while(!fs.existsSync(current)) {
    const parent=path.dirname(current);if(parent===current)return target;
    missing.unshift(path.basename(current));current=parent;
  }
  return path.join(fs.realpathSync(current),...missing);
}
function recommendedStateDir({platform=process.platform,env=process.env,home=os.homedir()}={}) {
  return platform==='win32'?path.join(env.LOCALAPPDATA||path.join(home,'AppData','Local'),'sigil-ai-agent','state'):
    path.join(env.XDG_STATE_HOME||path.join(home,'.local','state'),'sigil-ai-agent');
}
function resolveRuntimePaths({repoDir,env=process.env}={}) {
  const sourceDir=path.resolve(repoDir||env.AGENT_DIR||env.SIGIL_DIR||__dirname);
  const explicit=!!env.SIGIL_STATE_DIR;
  if(explicit&&!path.isAbsolute(env.SIGIL_STATE_DIR))fail('STATE_DIRECTORY_MUST_BE_ABSOLUTE');
  const stateDir=explicit?path.resolve(env.SIGIL_STATE_DIR):sourceDir;
  if(explicit&&inside(canonical(sourceDir),canonical(stateDir)))fail('STATE_DIRECTORY_MUST_BE_OUTSIDE_SOURCE');
  if(env.SIGIL_CONFIG_DIR&&!path.isAbsolute(env.SIGIL_CONFIG_DIR))fail('CONFIG_DIRECTORY_MUST_BE_ABSOLUTE');
  const configDir=env.SIGIL_CONFIG_DIR?path.resolve(env.SIGIL_CONFIG_DIR):stateDir;
  return {sourceDir,stateDir,configDir,external:explicit};
}
function ensureStateDir(paths) {
  if(paths.external)for(const name of ['agent-memory.json','dna-memory.json','.agi-brain-memory.json','telegram-alerts-state.json'])
    if(fs.existsSync(path.join(paths.sourceDir,name))&&!fs.existsSync(path.join(paths.stateDir,name)))fail('LEGACY_STATE_REQUIRES_MIGRATION');
  fs.mkdirSync(paths.stateDir,{recursive:true,mode:0o700});
  if(!fs.statSync(paths.stateDir).isDirectory())fail('STATE_DIRECTORY_UNAVAILABLE');
  fs.accessSync(paths.stateDir,fs.constants.W_OK);
  return paths;
}
module.exports={resolveRuntimePaths,recommendedStateDir,ensureStateDir,inside,STATE_FILES,CONFIG_FILES};
