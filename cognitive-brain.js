'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {absoluteExp} = require('./progression');
const DNA = require('./strategy-dna');
const {farmOptions} = require('./game-catalog');
const MIN = 60000;
const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, finite(n)));
const round = n => Math.round(n * 1000) / 1000;
const object = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
const digest = o => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 24);
const modelKey = (contextKey,mapName) => contextKey === 'default' && !['__proto__','constructor','prototype'].includes(mapName) ? mapName : digest([contextKey,mapName]);
const contextId = key => ['__proto__','constructor','prototype'].includes(key) ? digest([key]) : key;

function skill(id, name, params) {
  return {id, name, params, uses:0, wins:0, avgReward:0, masteryLevel:1, contexts:{}};
}
function createEmptyBrainState() {
  return {version:1, identity:crypto.randomUUID(), updatedAt:0, totalTicksPlayed:0, masteryIndex:1,
    episodic:{recentTransitions:[], highRewardMoments:[], hazardMemories:{}},
    semanticWorldModel:{maps:{}, craftingRoi:{}},
    // Templates are recommendations. They are never treated as executed game commands.
    proceduralSkills:{
      burst_aoe_pull:skill('burst_aoe_pull', 'AOE template', {pullCount:4, kiteDistance:2}),
      single_target_snipe:skill('single_target_snipe', 'Single target template', {pullCount:1, kiteDistance:4}),
      kite_and_sustain:skill('kite_and_sustain', 'Survival template', {pullCount:2, kiteDistance:6}),
      native_all_learned:skill('native_all_learned', 'Native AUTO: all learned skills', {skillScope:'ALL_LEARNED'}),
      native_hotbar:skill('native_hotbar', 'Native AUTO: verified hotbar', {skillScope:'HOTBAR'}),
      native_quest:skill('native_quest', 'Native Auto Quest', {mode:'quest'}),
    },
    activeCurriculum:{currentGoal:'OPTIMIZE_EXP_VELOCITY', targetMetric:'expPerMin', baselineValue:0, targetValue:0},
    consolidatedThrough:0, lessons:[]};
}

function validState(s) {
  try {
    const numeric = x => typeof x === 'number' && Number.isFinite(x);
    const counts = x => Number.isSafeInteger(x) && x >= 0;
    const safe = x => {
      if (typeof x === 'number') return numeric(x);
      if (Array.isArray(x)) return x.every(safe);
      if (object(x)) return Object.keys(x).every(k => !['__proto__','prototype','constructor'].includes(k) && safe(x[k]));
      return true;
    };
    return s?.version === 1 && typeof s.identity === 'string' && counts(s.totalTicksPlayed) &&
      numeric(s.masteryIndex) && s.masteryIndex >= 1 && s.masteryIndex <= 100 && numeric(s.updatedAt) &&
      counts(s.consolidatedThrough) && object(s.activeCurriculum) && numeric(s.activeCurriculum.baselineValue) &&
      numeric(s.activeCurriculum.targetValue) && typeof s.activeCurriculum.currentGoal === 'string' &&
      Array.isArray(s.lessons) && s.lessons.length <= 20 && object(s.episodic) &&
      [s.episodic.recentTransitions, s.episodic.highRewardMoments].every(a => Array.isArray(a) && a.length <= 500 &&
        a.every(e => object(e) && numeric(e.reward) && counts(e.id) && typeof e.mapName === 'string')) &&
      object(s.episodic.hazardMemories) && Object.keys(s.episodic.hazardMemories).length <= 256 &&
      Object.values(s.episodic.hazardMemories).every(h => counts(h.count) && numeric(h.lastOccurredAt)) &&
      object(s.semanticWorldModel?.maps) && object(s.semanticWorldModel.craftingRoi) &&
      Object.keys(s.semanticWorldModel.maps).length <= 128 && Object.values(s.semanticWorldModel.maps).every(m =>
        counts(m.visits) && numeric(m.durationSec) && numeric(m.avgExpPerMin) && numeric(m.avgGoldPerMin) &&
        numeric(m.avgTtkSec) && counts(m.deaths) && numeric(m.dangerScore)) &&
      object(s.proceduralSkills) && Object.keys(s.proceduralSkills).length > 0 && Object.keys(s.proceduralSkills).length <= 32 &&
      Object.entries(s.proceduralSkills).every(([id, v]) => object(v) && id === v.id && counts(v.uses) && counts(v.wins) &&
        numeric(v.avgReward) && numeric(v.masteryLevel) && object(v.params) && object(v.contexts) &&
        Object.keys(v.contexts).length <= 32 && Object.values(v.contexts).every(c => counts(c.uses) && counts(c.wins) && numeric(c.mean))) && safe(s);
  } catch { return false; }
}

function readMemory(file) {
  try {
    if (fs.statSync(file).size > 4 * 1024 * 1024) return null;
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    return validState(state) ? state : null;
  } catch { return null; }
}
function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
    if (process.platform !== 'win32') {
      const dir = fs.openSync(path.dirname(file), 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    }
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

class CognitiveBrain {
  constructor(options = {}) {
    if(options.memoryFile)this.memoryFile=options.memoryFile;
    else {
      const runtime=require('./runtime-paths'),paths=runtime.resolveRuntimePaths({repoDir:options.repoDir});
      if(paths.external)runtime.ensureStateDir(paths);
      this.memoryFile=path.join(paths.stateDir,'.agi-brain-memory.json');
    }
    this.maxRecentEpisodes = clamp(options.maxRecentEpisodes ?? 150, 1, 500);
    this.explorationConstant = clamp(options.explorationConstant ?? Math.SQRT2, 0, 5);
    this.now = options.now || Date.now;
    this.state = readMemory(this.memoryFile) || readMemory(this.memoryFile + '.previous') || createEmptyBrainState();
    this.workingMemory = {currentMap:null, activeSkillId:null, immediateThreatLevel:0, lastStateSnapshot:null};
    this.window = null;
    this.warmup = null;
    this.lastSampleAt = null;
    this.lastSavedAt = 0;
    this.wasDead = false;
    this.wasStuck = false;
    this.contextKey = '';
  }
  save() {
    this.state.updatedAt = this.now();
    if (!validState(this.state)) throw new Error('Invalid cognitive memory');
    const previous = readMemory(this.memoryFile);
    if (previous) atomicWrite(this.memoryFile + '.previous', previous);
    atomicWrite(this.memoryFile, this.state);
    this.lastSavedAt = this.now();
  }
  perceive(gameState = {}) {
    const hp = Array.isArray(gameState.hp) ? gameState.hp[0] : gameState.hp;
    const maxHp = Array.isArray(gameState.hp) ? gameState.hp[1] : gameState.maxHp;
    const hpRatio = Number.isFinite(hp) && maxHp > 0 ? clamp(hp / maxHp, 0, 1) : null;
    const enemies = clamp(gameState.nearbyEnemies, 0, 100);
    const threat = hpRatio === null ? 0 : clamp((1 - hpRatio) * 0.7 + Math.max(0, enemies - 3) * 0.1, 0, 1);
    Object.assign(this.workingMemory, {currentMap:norm(gameState.mapName || gameState.zone) || null,
      immediateThreatLevel:round(threat), lastStateSnapshot:{mapName:norm(gameState.mapName || gameState.zone),
        hpRatio, dead:!!gameState.dead, target:typeof gameState.target === 'string' ? gameState.target.slice(0,100) : null,
        perceivedAt:this.now()}});
    return this.workingMemory;
  }
  selectOptimalSkill(context = {}) {
    const threat = clamp(context.threatLevel ?? this.workingMemory.immediateThreatLevel, 0, 1);
    const ids = context.skillIds || Object.keys(this.state.proceduralSkills).filter(id => !id.startsWith('native_'));
    const candidates = ids.filter(id=>Object.hasOwn(this.state.proceduralSkills,id)).map(id => this.state.proceduralSkills[id]);
    if (!candidates.length) return null;
    const key = contextId(context.contextKey || this.contextKey || 'default');
    const stats = s => s.contexts[key] || {uses:0, mean:0};
    const total = candidates.reduce((n,s) => n + stats(s).uses, 0);
    let best, score = -Infinity;
    for (const s of candidates) {
      const c = stats(s);
      const bonus = threat > 0.6 && s.id === 'kite_and_sustain' ? 3 : threat < 0.25 && s.id === 'burst_aoe_pull' ? 0.15 : 0;
      const ucb = c.mean + bonus + this.explorationConstant * Math.sqrt(Math.log(total + 2) / Math.max(1,c.uses)) + (c.uses ? 0 : 1);
      if (ucb > score) {best=s;score=ucb;}
    }
    this.workingMemory.recommendedSkillId = best.id;
    return {skillId:best.id, name:best.name, masteryLevel:best.masteryLevel, params:{...best.params}, expectedScore:round(score)};
  }
  recordExperience(input = {}) {
    const mapName = norm(input.mapName || this.workingMemory.currentMap) || 'Unknown';
    const skillId = Object.hasOwn(input,'skillId') ? input.skillId : this.workingMemory.activeSkillId;
    const durationSec = clamp(input.durationSec ?? 60, 0.001, 3600);
    const expGained = clamp(input.expGained,0,1e12), goldGained = clamp(input.goldGained,-1e12,1e12);
    const minutes = durationSec / 60, expPerMin = expGained / minutes, goldPerMin = goldGained / minutes;
    const died = input.died === true, stuck = input.stuck === true, contextKey = contextId(input.contextKey || this.contextKey || 'default');
    const reward = clamp(expPerMin + goldPerMin * 0.2 - Math.max(0,finite(input.potionsUsed)) * 2.5 - (died ? 150 : 0) - (stuck ? 60 : 0), -1e9, 1e9);
    const id = ++this.state.totalTicksPlayed, timestamp = this.now();
    const maps = this.state.semanticWorldModel.maps, mapKey = modelKey(contextKey,mapName);
    const m = maps[mapKey] ||= {mapName, contextKey, visits:0, durationSec:0, avgExpPerMin:0, avgGoldPerMin:0,
      avgTtkSec:0, ttkSamples:0, deaths:0, dangerScore:0};
    // Duration weighting avoids counting a one-second incident as a full farming visit.
    const weight = durationSec / (m.durationSec + durationSec);
    m.visits++;m.durationSec += durationSec;m.lastAt=timestamp;
    m.avgExpPerMin = round(m.avgExpPerMin * (1-weight) + expPerMin * weight);
    m.avgGoldPerMin = round(m.avgGoldPerMin * (1-weight) + goldPerMin * weight);
    if (Number.isFinite(input.ttkSec) && input.ttkSec > 0) {
      m.avgTtkSec = round((m.avgTtkSec * m.ttkSamples + input.ttkSec) / ++m.ttkSamples);
    }
    if (died) m.deaths++;
    m.dangerScore = round(m.deaths / m.visits);
    prune(maps,128,'lastAt');
    const s = Object.hasOwn(this.state.proceduralSkills,skillId) ? this.state.proceduralSkills[skillId] : null;
    if (s) {
      s.uses++;if(!died && !stuck && reward > 0)s.wins++;
      s.avgReward = round(s.avgReward + (reward-s.avgReward)/s.uses);
      s.masteryLevel = Math.min(100, Math.floor(1 + Math.log2(s.wins+1)*10));
      const c = s.contexts[contextKey] ||= {uses:0,wins:0,mean:0};
      c.uses++;if(!died && !stuck && reward>0)c.wins++;
      const normalized = reward / (100 + Math.abs(reward));
      c.mean += (normalized-c.mean)/c.uses;c.lastAt=timestamp;
      prune(s.contexts,32,'lastAt');
    }
    if ((died || stuck) && Number.isFinite(input.position?.x) && Number.isFinite(input.position?.y)) {
      const key = this.hazardKey(mapName,input.position,contextKey), hazards=this.state.episodic.hazardMemories;
      const h = hazards[key] ||= {count:0};
      Object.assign(h,{count:h.count+1,reason:died?'DEATH_ZONE':'STUCK_GEOMETRY',lastOccurredAt:timestamp});
      prune(hazards,256,'lastOccurredAt');
    }
    const episode={id,timestamp,mapName,contextKey,skillId:skillId || null,expPerMin:round(expPerMin),reward:round(reward),died,stuck,
      state:Object.hasOwn(input,'state')?input.state:this.workingMemory.lastStateSnapshot, action:input.action || {skillId:skillId || null},
      nextState:input.nextState || null,durationSec};
    this.state.episodic.recentTransitions.push(episode);
    this.state.episodic.recentTransitions=this.state.episodic.recentTransitions.slice(-this.maxRecentEpisodes);
    if(reward>80 && !died && !stuck) {
      this.state.episodic.highRewardMoments.push(episode);
      this.state.episodic.highRewardMoments.sort((a,b)=>b.reward-a.reward);
      this.state.episodic.highRewardMoments=this.state.episodic.highRewardMoments.slice(0,20);
    }
    const learned=Object.values(this.state.proceduralSkills).filter(s=>s.uses);
    this.state.masteryIndex=round(learned.length?learned.reduce((n,s)=>n+s.masteryLevel,0)/learned.length:1);
    return {reward:episode.reward,mapModel:m,masteryIndex:this.state.masteryIndex};
  }
  predictBestFarmingZone(candidateMaps = [], options = {}) {
    const contextKey=contextId(options.contextKey || this.contextKey || 'default');
    const results=candidateMaps.filter(m=>typeof m==='string').map(mapName=>{
      const m=this.state.semanticWorldModel.maps[modelKey(contextKey,norm(mapName))];
      if(!m)return {mapName,predictedUtility:options.explore===false?-Infinity:100,isExploration:true,reason:'UNEXPLORED_FRONTIER_CURIOSITY'};
      const efficiency=m.avgTtkSec>0?Math.min(1.5,3.5/m.avgTtkSec):1;
      return {mapName,predictedUtility:round(m.avgExpPerMin*efficiency+m.avgGoldPerMin*0.15-m.dangerScore*200),
        isExploration:false,avgExpPerMin:m.avgExpPerMin,dangerScore:m.dangerScore,durationSec:m.durationSec,lastAt:m.lastAt,
        reason:'WORLD_MODEL_PREDICTION'};
    });
    return results.sort((a,b)=>b.predictedUtility-a.predictedUtility)[0] || null;
  }
  consolidateMemory() {
    if(this.state.consolidatedThrough<this.state.totalTicksPlayed) {
      const episodes=this.state.episodic.recentTransitions.filter(e=>e.contextKey===(this.contextKey || 'default'));
      const best=episodes.filter(e=>!e.died&&!e.stuck&&e.reward>0).sort((a,b)=>b.expPerMin-a.expPerMin)[0];
      const danger=episodes.filter(e=>e.died||e.stuck).length;
      if(best)this.state.activeCurriculum={currentGoal:danger?'IMPROVE_SURVIVAL':`SURPASS_PEAK_ON_${best.mapName.toUpperCase()}`,
        targetMetric:danger?'incidentRate':'expPerMin',baselineValue:danger?danger/episodes.length:best.expPerMin,
        targetValue:round(danger?danger/episodes.length*0.95:best.expPerMin*1.05)};
      this.state.lessons=episodes.filter(e=>e.died||e.stuck||e===best).slice(-20).map(e=>({mapName:e.mapName,
        skillId:e.skillId,reason:e.died?'DEATH':e.stuck?'STUCK':'MEASURED_PEAK',reward:e.reward,at:e.timestamp}));
      this.state.consolidatedThrough=this.state.totalTicksPlayed;
    }
    this.save();return this.view();
  }
  hazardKey(mapName,position,contextKey) {return digest([contextKey,norm(mapName),Math.round(position.x),Math.round(position.y)]);}
  isHazardPosition(mapName,position = {},contextKey=this.contextKey || 'default') {
    if(!Number.isFinite(position.x)||!Number.isFinite(position.y))return false;
    const h=this.state.episodic.hazardMemories[this.hazardKey(mapName,position,contextKey)];
    return !!(h && h.count>=2);
  }
  // Called by the read-only telemetry sampler, never by the viewer/status endpoint.
  observe(s,mem,catalog,now=this.now()) {
    this.perceive(s);
    const t=mem.gameTelemetry,map=catalog?.maps?.find(m=>norm(m.name)===norm(s.zone));
    const field=catalog?.maps?.find(m=>!m.town);
    const ctx=DNA.context(s,mem,catalog) || (field && DNA.context({...s,zone:field.name},mem,catalog));
    const valid=s.name && !s.disconnected && !s.atCharSelect && map && t?.validated && !t.loading && t.map===map.id && now-t.checkedAt>=0 && now-t.checkedAt<5000;
    const dead=!!s.dead,stuck=!!t?.confirmed;
    const deathEdge=dead&&!this.wasDead,stuckEdge=stuck&&!this.wasStuck;
    this.wasDead=dead;this.wasStuck=stuck;
    if(!valid){this.resetSampling();return;}
    if(ctx) {
      const {map:ignored, ...data}=ctx.data;
      this.contextKey=digest(data);
    }
    if(map.town) {this.resetSampling();return;}
    const native=mem.nativeCombatProfile;
    const applied=mem.dna?.needsApply?null:mem.dna?.enabled?
      (mem.dna.context===ctx?.key?DNA.profile(mem):null):
      native?.character===s.name&&native.job===s.job&&now-native.at>=0&&now-native.at<30*MIN?native.genes:null;
    const actualSkill=s.autoQuestRunning?'native_quest':!applied?null:
      applied.skillScope==='HOTBAR'?'native_hotbar':'native_all_learned';
    const eligible=ctx && actualSkill && !mem.uiHealth?.safeIdle && !mem.autonomy?.trip && !mem.development?.excursion &&
      !s.panelOpen&&!s.menuOpen&&!s.mapOpen&&!s.modalText&&!t.positionFault&&
      (s.autoQuestRunning||/\bon\b/.test(s.autoHunt||''));
    const exp=absoluteExp(catalog,ctx?.level,s.exp);
    const sample={at:now,mapName:map.name,contextKey:this.contextKey,skillId:actualSkill,exp,gold:s.gold,
      hpPotions:s.hpPotions,mpPotions:s.mpPotions,profileKey:digest(applied||null),state:{...this.workingMemory.lastStateSnapshot}};
    const samplingContinuous=this.lastSampleAt!==null&&now>this.lastSampleAt&&now-this.lastSampleAt<=10000;
    const sameProfile=a=>a&&a.contextKey===sample.contextKey&&a.mapName===sample.mapName&&
      a.skillId===sample.skillId&&a.profileKey===sample.profileKey;
    const previousWarmup=this.warmup;
    const damage=mem.combatTelemetry?.lastDamage;
    const fighting=damage?.zone===s.zone&&Number.isFinite(damage.at)&&now-damage.at>=0&&now-damage.at<=10000;
    const measurable=eligible&&!dead&&exp!==null&&Number.isFinite(s.gold);
    if(!measurable||!fighting||!samplingContinuous||!sameProfile(this.warmup?.sample))this.warmup=null;
    if(measurable&&fighting&&!this.warmup)this.warmup={since:now,sample:{...sample,genes:applied}};
    const remaining=this.warmup?Math.max(0,MIN-(now-this.warmup.since)):MIN;
    const ready=!!this.warmup&&remaining===0;
    this.workingMemory.learningPhase=ready?'measuring':this.warmup?'warming':'waiting-for-combat';
    this.workingMemory.warmupRemainingSec=Math.ceil(remaining/1000);
    const w=this.window;
    const continuous=w && this.lastSampleAt!==null && now>this.lastSampleAt && now-this.lastSampleAt<=10000 &&
      w.contextKey===sample.contextKey&&w.mapName===sample.mapName&&
      (w.skillId===sample.skillId&&w.profileKey===sample.profileKey||deathEdge||stuckEdge);
    let recordedIncident=false;
    if(continuous && (deathEdge||stuckEdge||ready&&now-w.at>=MIN) && exp!==null && Number.isFinite(s.gold)) {
      const durationSec=(now-w.at)/1000;
      if(exp>=w.exp && durationSec>0) {
        const potionsUsed=[['hpPotions'],['mpPotions']].reduce((n,[key])=>n+(Number.isFinite(w[key])&&Number.isFinite(sample[key])?Math.max(0,w[key]-sample[key]):0),0);
        this.recordExperience({mapName:w.mapName,contextKey:w.contextKey,skillId:w.skillId,
          expGained:exp-w.exp,goldGained:s.gold-w.gold,durationSec,potionsUsed,died:deathEdge,stuck:stuckEdge,
          // A measured kill time stays valid for the zone it was measured in.
          ttkSec:mem.combatTelemetry?.current?.zone===s.zone&&now-mem.combatTelemetry.current.at<300000?
            mem.combatTelemetry.current.medianSeconds:undefined,position:{x:t.x,y:t.y},state:w.state,nextState:sample.state,
          action:{type:'native-auto',skillId:w.skillId,genes:w.genes}});
        recordedIncident=deathEdge||stuckEdge;
        this.window=null;
      }
    }
    if((deathEdge||stuckEdge)&&ctx&&!recordedIncident) {
      // A terminal incident remains evidence during warm-up. Attribute it only
      // to a continuously observed verified exposure, never unobserved EXP/gold.
      const exposure=samplingContinuous&&previousWarmup?.sample.contextKey===sample.contextKey&&
        previousWarmup.sample.mapName===sample.mapName?previousWarmup.sample:null;
      this.recordExperience({mapName:map.name,contextKey:this.contextKey,skillId:exposure?.skillId||null,durationSec:1,
        died:deathEdge,stuck:stuckEdge,position:{x:t.x,y:t.y},state:exposure?.state||null,nextState:sample.state,
        action:{type:'observed-incident',skillId:exposure?.skillId||null,genes:exposure?.genes||null}});
    }
    if(!ready||!continuous)this.window=null;
    if(ready&&!this.window)this.window={...sample,genes:applied};
    this.lastSampleAt=now;
    this.workingMemory.activeSkillId=eligible?actualSkill:null;
    this.workingMemory.recommendedMacroId=this.selectOptimalSkill()?.skillId || null;
    this.selectOptimalSkill({skillIds:s.autoQuestRunning?['native_quest']:['native_all_learned','native_hotbar']});
    if(this.state.totalTicksPlayed && now-this.lastSavedAt>=MIN)this.save();
  }
  resetSampling() {
    this.window=null;this.warmup=null;this.lastSampleAt=null;
    this.workingMemory.activeSkillId=null;
    this.workingMemory.learningPhase='waiting-for-combat';
    this.workingMemory.warmupRemainingSec=60;
  }
  view() {
    return {identity:this.state.identity,updatedAt:this.state.updatedAt,enabled:true,masteryIndex:this.state.masteryIndex,
      totalExperiences:this.state.totalTicksPlayed,knownMapsCount:Object.keys(this.state.semanticWorldModel.maps).length,
      activeCurriculum:{...this.state.activeCurriculum},workingMemory:{...this.workingMemory},
      // The measured combat results the mastery index was built from.
      measured:Object.values(this.state.semanticWorldModel.maps).filter(m=>m.visits>0).sort((a,b)=>b.durationSec-a.durationSec).slice(0,8)
        .map(m=>({map:m.mapName,visits:m.visits,expPerMin:m.avgExpPerMin,ttkSec:m.avgTtkSec,deaths:m.deaths})),
      lessons:this.state.lessons.slice(-5),consolidatedThrough:this.state.consolidatedThrough};
  }
}
function prune(records,limit,field) {
  const keys=Object.keys(records).sort((a,b)=>finite(records[b][field])-finite(records[a][field]));
  for(const k of keys.slice(limit))delete records[k];
}

// Only already eligible public-catalog routes may be ranked. Unknown routes remain
// under the existing controller's guarded trial policy, never a curiosity override.
function rankFarmingOptions(options,view) {
  if(!view?.enabled||!Array.isArray(view.mapPredictions))return options;
  const predictions=new Map(view.mapPredictions.filter(p=>!p.isExploration&&p.durationSec>=120&&Number.isFinite(p.predictedUtility)).map(p=>[norm(p.mapName),p]));
  if(!options.length||options.some(m=>!predictions.has(norm(m.name))))return options;
  return options.slice().sort((a,b)=>predictions.get(norm(b.name)).predictedUtility-predictions.get(norm(a.name)).predictedUtility);
}

function learningFarmingOptions(catalog,s,mem={},maxGap=3) {
  const level=Number(String(s.lv||'').match(/\d+/)?.[0]);
  if(!Number.isInteger(level)||level<1)return [];
  const upper=level+clamp(maxGap,3,5),lower=Math.max(1,level-5);
  const monsters=new Map((catalog?.monsters||[]).map(m=>[m.id,m]));
  return farmOptions(catalog,s,[],mem.autonomy?.farmRates).filter(map=>
    !mem.dna?.avoidMaps?.includes(map.id)&&map.monsters.some(entry=>{
      const m=monsters.get(entry.id);
      return m&&!m.boss&&!m.elite&&(entry.n==null||entry.n>=1)&&m.lv>=lower&&m.lv<=upper;
    }));
}

module.exports={CognitiveBrain,createEmptyBrainState,rankFarmingOptions,learningFarmingOptions,validState};
