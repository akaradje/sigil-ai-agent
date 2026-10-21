'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateCatalog}=require('./game-catalog');
const {writeJsonAtomic}=require('./self-evolution');
const MIN=60000;
const id=x=>typeof x==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(x)&&!['constructor','prototype','__proto__'].includes(x);
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const PANELS=new Set('stats bag skills equip map auto cards ranch life minigame fest party guild mailbox chat market vend bstore tlog prem vip fashion rank lab pvp settings login bosses ach legends book newbie storage smith cbt runes pets cooking guide wings'.split(' '));
const privateNavigation=x=>/(?:account|auth|login|password|setting|security|payment|billing|topup|trade|mail|chat|guild|party|pvp|market|delete|reset|rename)/i.test(x);
function empty(){return {version:1,catalog:null,revisions:[],controls:{},opportunities:[],observations:{},observedYields:{},bossGates:{},updatedAt:0};}
function valid(d){return d?.version===1&&Array.isArray(d.revisions)&&d.revisions.length<=12&&Array.isArray(d.opportunities)&&d.opportunities.length<=40&&d.controls&&Object.keys(d.controls).length<=256&&d.observations&&(!d.catalog||validateCatalog(d.catalog));}
class WorldKnowledge {
  constructor({file,now=Date.now}={}){
    this.file=file;this.now=now;this.savedAt=0;this.dirty=false;this.db=empty();
    this.lootWindow=null;
    if(file)for(const p of [file,file+'.previous'])try{
      const stat=fs.lstatSync(p);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)continue;
      const d=JSON.parse(fs.readFileSync(p,'utf8'));if(valid(d)){this.db=d;break;}
    }catch{}
    this.db.observedYields ||= {};
  }
  // A boss whose shield could not be broken in time is remembered as a gate:
  // the shortfall in damage per second tells the bot what it has to farm for
  // before trying that boss again.
  gateBoss(boss,evidence={}){
    const key=String(boss||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,64);
    if(!key)return null;
    const e=evidence||{},now=this.now();
    this.db.bossGates ||= {};
    const previous=this.db.bossGates[key];
    const factor=Math.max(1,Number(e.factor)||1);
    const gate={boss,at:now,factor:Math.round(factor*100)/100,
      requiredMatk:Math.round(Number(e.requiredMatk)||0),requiredPower:Math.round(Number(e.requiredPower)||0),
      observedMatk:Math.round(Number(e.observedMatk)||0),observedPower:Math.round(Number(e.observedPower)||0),
      reason:String(e.reason||'shield-not-broken-in-time').slice(0,120),
      map:e.map?String(e.map).slice(0,60):null,attempts:(previous?.attempts||0)+1};
    this.db.bossGates[key]=gate;
    this.db.bossGates=Object.fromEntries(Object.entries(this.db.bossGates).sort((a,b)=>b[1].at-a[1].at).slice(0,16));
    this.dirty=true;this.save(true);
    return gate;
  }
  clearBossGate(boss){
    const key=String(boss||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,64);
    if(!this.db.bossGates?.[key])return false;
    delete this.db.bossGates[key];
    this.dirty=true;this.save(true);
    return true;
  }
  bossGate(boss,measured={}){
    const key=String(boss||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').slice(0,64);
    const g=this.db.bossGates?.[key];if(!g)return null;
    const m=measured||{};
    const matkOk=g.requiredMatk&&Number.isFinite(m.matk)&&m.matk>=g.requiredMatk;
    const powerOk=g.requiredPower&&Number.isFinite(m.power)&&m.power>=g.requiredPower;
    return matkOk||powerOk?null:g;
  }
  offer(reason,evidence,key=hash([reason,evidence])){
    if(this.db.opportunities.some(o=>o.key===key))return;
    this.db.opportunities.push({key,reason,evidence,at:this.now()});this.db.opportunities=this.db.opportunities.slice(-40);this.dirty=true;
  }
  ingestCatalog(raw){
    const {fingerprint:ignoredFingerprint,at:ignoredAt,...definition}=raw;
    const next=validateCatalog(definition,this.now()),previous=this.db.catalog;
    if(previous?.fingerprint===next.fingerprint)return false;
    if(previous){
      const oldMaps=new Set(previous.maps.map(m=>m.id)),oldGear=new Set(previous.gear.map(g=>g.id));
      const evidence={before:previous.fingerprint,after:next.fingerprint,
        levelCap:next.levelCap??null,previousLevelCap:previous.levelCap??null,
        maps:next.maps.filter(m=>!oldMaps.has(m.id)).slice(0,5).map(m=>({id:m.id,name:m.name,range:m.range,monsters:m.monsters.slice(0,8)})),
        recipes:next.gear.filter(g=>g.craft&&!oldGear.has(g.id)).slice(0,5).map(g=>({id:g.id,tier:g.tier,lv:g.lv,slot:g.slot,cost:g.craft}))};
      if(evidence.maps.length||evidence.recipes.length||next.levelCap!==previous.levelCap)this.offer('PUBLIC_CATALOG_EXPANDED',evidence,next.fingerprint);
    }
    this.db.catalog=next;this.db.revisions.push({fingerprint:next.fingerprint,at:next.at,levelCap:next.levelCap??null});this.db.revisions=this.db.revisions.slice(-12);
    this.dirty=true;this.save(true);return true;
  }
  observe(s,mem,now=this.now()){
    if(!s?.name||s.disconnected||s.atCharSelect||mem.uiHealth?.safeIdle)return;
    this.observeYield(s,mem,now);
    if(id(s.panel)&&!PANELS.has(s.panel)&&!privateNavigation(s.panel)){
      const controls=(s.controls||[]).filter(c=>c.scope==='panel').slice(0,20).map(c=>Object.fromEntries(['act','key','open','k','v','label'].map(k=>[k,typeof c[k]==='string'?c[k].slice(0,80):null])));
      const evidence={panel:s.panel,source:'visible-panel-contract',text:require('./self-evolution').sanitizeSnapshot(s.panelText,2000),controls};
      this.offer('UNSUPPORTED_PUBLIC_SYSTEM',evidence,hash([this.db.catalog?.fingerprint,s.panel,controls]));
      if(this.db.controls[s.panel])this.db.controls[s.panel].inspectedAt=now;
    }
    for(const c of (s.controls||[]).slice(0,200)){
      if(!id(c.open)||privateNavigation(c.open)||!['hud','menu'].includes(c.scope))continue;
      const key=c.open,old=this.db.controls[key];
      if(!old&&Object.keys(this.db.controls).length>=256)continue;
      if(!old)this.db.controls[key]={open:key,firstAt:now,lastAt:now,count:1};
      else if(now-old.lastAt>=10000){old.lastAt=now;old.count=Math.min(10,old.count+1);}
      const row=this.db.controls[key];
      if(!PANELS.has(key)&&row.count>=3)this.offer('UNSUPPORTED_PUBLIC_SYSTEM',{panel:key,observations:row.count,firstAt:row.firstAt,source:'visible-enabled-navigation'},hash([this.db.catalog?.fingerprint,key]));
    }
    this.db.observations={at:now,character:s.name,zone:s.zone,
      buffs:{cbt:String(s.cbtText||'').slice(0,160),vip:String(s.vipText||'').slice(0,160)},
      leaderboard:mem.rank?.character===s.name&&now-mem.rank.at<20*MIN?{at:mem.rank.at,kind:mem.rank.kind,rows:(mem.rank.rows||[]).slice(0,20).map(r=>({text:String(r.text||'').slice(0,200),own:r.own===true}))}:null,
      combat:mem.combatTelemetry?.current?.zone===s.zone?{...mem.combatTelemetry.current}:null};
    this.dirty=true;this.save();
  }
  observeYield(s,mem,now){
    const context=hash([s.name,s.zone,this.db.catalog?.fingerprint]),sequence=mem.autonomy?.sequence||0,deaths=mem.deaths?.length||0;
    let w=this.lootWindow;
    if(w&&(w.context!==context||w.sequence!==sequence||w.deaths!==deaths||now-w.lastSeen>30000||mem.autonomy?.trip||mem.development?.excursion||now-w.at>15*MIN))w=this.lootWindow=null;
    if(w){w.lastSeen=now;for(const kill of mem.combatTelemetry?.samples||[])if(kill.zone===s.zone&&kill.at>w.killCursor&&kill.at<=now){w.kills++;w.killCursor=kill.at;}}
    if(s.panel!=='bag'||!s.inventoryComplete)return;
    if(w&&now-w.at>=MIN&&w.kills>=5){
      const gains={};let consumed=false;
      for(const key of new Set([...Object.keys(w.items),...Object.keys(s.inventoryItems||{})])){
        const delta=(s.inventoryItems?.[key]||0)-(w.items[key]||0);if(delta<0)consumed=true;else if(delta>0&&id(key))gains[key]=delta;
      }
      if(!consumed){const row=this.db.observedYields[context]||{zone:s.zone,minutes:0,observedKills:0,items:{},samples:0};
        row.minutes+=(now-w.at)/MIN;row.observedKills+=w.kills;row.samples++;row.at=now;
        for(const [key,n] of Object.entries(gains))row.items[key]=(row.items[key]||0)+n;
        this.db.observedYields[context]=row;
        this.db.observedYields=Object.fromEntries(Object.entries(this.db.observedYields).sort((a,b)=>b[1].at-a[1].at).slice(0,64));
      }
    }
    this.lootWindow={context,sequence,deaths,at:now,lastSeen:now,items:{...s.inventoryItems},kills:0,killCursor:now};
  }
  save(force=false){
    const now=this.now();if(!this.file||!this.dirty||!force&&now-this.savedAt<MIN)return;
    const value={...this.db,updatedAt:now};if(Buffer.byteLength(JSON.stringify(value))>8*1024*1024)throw Error('KNOWLEDGE_TOO_LARGE');
    fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
    if(fs.existsSync(this.file)&&valid(this.db))writeJsonAtomic(this.file+'.previous',this.db);
    writeJsonAtomic(this.file,value);this.db.updatedAt=now;this.savedAt=now;this.dirty=false;
  }
  nextPanelProbe(now=this.now()){
    return Object.values(this.db.controls).find(c=>!PANELS.has(c.open)&&!privateNavigation(c.open)&&c.count>=3&&!c.inspectedAt&&now-c.lastAt<24*60*MIN)?.open||null;
  }
  async inspectNext({mem,catalog,observe,open,close,now=this.now()}){
    const panel=this.nextPanelProbe(now),s=await observe(),p=require('./proactive-planner');
    if(!panel||!p.available(mem,s,catalog,now)||p.managed(mem,s)||mem.autonomy?.farm||
      !catalog.maps.some(m=>m.town&&m.name===s.zone))return false;
    this.db.controls[panel].inspectedAt=now;this.dirty=true;
    try{
      await open(panel);const read=await observe();
      if(read.panel!==panel||!read.panelOpen||read.modalText)return false;
      this.observe(read,mem,now);return true;
    }finally{await close();this.save(true);}
  }
  view(){const d=this.db,c=d.catalog;return {version:1,updatedAt:d.updatedAt,fingerprint:c?.fingerprint||null,
    maps:c?.maps.length||0,monsters:c?.monsters.length||0,recipes:c?.gear.filter(g=>g.craft).length||0,
    dropEvidence:'public-definition-probabilities; observed ROI is separate',
    sources:['public-client-definitions','visible-dom','allowlisted-public-telemetry'],
    observedYields:Object.values(d.observedYields).slice(0,10).map(r=>({...r,evidence:'net-inventory-gain; not a true drop probability'})),
    opportunities:d.opportunities.slice(-10),observations:d.observations,
    bossGates:Object.values(d.bossGates||{}).slice(0,8)};}
}
module.exports={WorldKnowledge,PANELS,id};
