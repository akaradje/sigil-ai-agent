'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {WorldKnowledge}=require('./world-knowledge'),{validateCatalog}=require('./game-catalog');
const catalog=()=>({levelCap:100,refineMax:10,jobs:{mage:{line:['mage'],weapon:'staff'}},gear:[{id:'staff',name:'Staff',lv:1,tier:1,craft:{gold:1,mats:{ore:2}}}],maps:[{id:'field',name:'Field',town:false,range:[70,80],monsters:[]}],monsters:[]});
test('catalog cache has stable provenance, detects expansion and survives restart',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sigil-world-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'world-knowledge.json');
 let now=100000;const k=new WorldKnowledge({file,now:()=>now});a.equal(k.ingestCatalog(validateCatalog(catalog(),10)),true);
 a.equal(k.ingestCatalog(catalog()),false);a.equal(k.view().opportunities.length,0);
 const next=catalog();next.levelCap=120;next.maps.push({id:'new',name:'New',range:[100,120],monsters:[]});now++;
 k.ingestCatalog(next);a.equal(k.view().opportunities.length,1);a.equal(k.view().opportunities[0].reason,'PUBLIC_CATALOG_EXPANDED');
 const restarted=new WorldKnowledge({file});a.equal(restarted.view().maps,2);a.equal(restarted.db.catalog.levelCap,120);
 fs.writeFileSync(file,'{broken');a.equal(new WorldKnowledge({file}).view().maps,2);
});
test('unknown menu requires repeated distinct observations and never executes input',()=>{
 let now=100000;const k=new WorldKnowledge({now:()=>now});const s={name:'test',zone:'Field',controls:[{open:'ascension',scope:'menu'}]};
 for(let i=0;i<100;i++)k.observe(s,{},now);a.equal(k.view().opportunities.length,0);
 now+=10000;k.observe(s,{},now);now+=10000;k.observe(s,{},now);
 a.equal(k.view().opportunities.length,1);a.equal(k.view().opportunities[0].evidence.panel,'ascension');
 k.observe({...s,controls:[{open:'__proto__',scope:'menu'},{open:'evil/path',scope:'hud'}]},{});a.equal(k.view().opportunities.length,1);
});
test('knowledge refuses incomplete catalogs and excludes stale or other-character rankings',()=>{
 const k=new WorldKnowledge({now:()=>10000000});a.throws(()=>k.ingestCatalog({}));
 k.observe({name:'test',zone:'Field'},{rank:{character:'other',at:10000000,rows:[{text:'private'}]}});
 a.equal(k.view().observations.leaderboard,null);a.match(k.view().dropEvidence,/separate/);
});
test('observed loot retains net yield separately and rejects spending, gaps and consumed inventory',()=>{
 let now=100000;const k=new WorldKnowledge({now:()=>now}),mem={autonomy:{sequence:1},combatTelemetry:{samples:[]}};
 const s={name:'test',zone:'Field',panel:'bag',inventoryComplete:true,inventoryItems:{ore:1}};
 k.observe(s,mem,now);
 for(let i=1;i<=6;i++){now+=10000;mem.combatTelemetry.samples.push({zone:'Field',at:now,seconds:2});k.observe({...s,panel:null},mem,now);}
 k.observe({...s,inventoryItems:{ore:4}},mem,now);
 a.equal(k.view().observedYields[0].items.ore,3);a.match(k.view().observedYields[0].evidence,/not a true drop probability/);
 mem.autonomy.sequence++;now+=10000;k.observe({...s,inventoryItems:{ore:20}},mem,now);a.equal(k.view().observedYields[0].items.ore,3);
});
test('unknown system inspection reads one navigation panel only while safely idle in town',async()=>{
 let now=200000;const k=new WorldKnowledge({now:()=>now});k.db.controls.ascension={open:'ascension',count:3,lastAt:now};
 const mem={gameTelemetry:{validated:true,checkedAt:now}},catalog={maps:[{name:'Town',town:true}]};let panel=null,opened=0,closed=0;
 const observe=async()=>({name:'test',zone:'Town',hp:[100,100],panel,panelOpen:!!panel,panelText:'Ascension requires level 100',controls:[{scope:'panel',act:'ascend',key:'mage'}]});
 const args={mem,catalog,observe,open:async p=>{panel=p;opened++;},close:async()=>{panel=null;closed++;},now};
 mem.development={excursion:{kind:'mine'}};a.equal(await k.inspectNext(args),false);a.equal(opened,0);delete mem.development;
 a.equal(await k.inspectNext(args),true);a.equal(opened,1);a.equal(closed,1);
 a.equal(k.view().opportunities.at(-1).evidence.controls[0].act,'ascend');a.equal(k.nextPanelProbe(),null);
});

test('a boss whose shield the build cannot break becomes a gate until the damage reaches the requirement',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sigil-gate-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'world-knowledge.json');let now=100000;const k=new WorldKnowledge({file,now:()=>now});
 const gate=k.gateBoss('Ignar the Flame Tyrant',{factor:1.58,requiredMatk:3716,requiredPower:1650,observedMatk:2352,observedPower:1050,reason:'shield-not-broken-in-time',map:'Leviathan Grave'});
 a.equal(gate.factor,1.58);a.equal(gate.requiredMatk,3716);a.equal(gate.map,'Leviathan Grave');
 a.equal(k.bossGate('Ignar the Flame Tyrant',{matk:2352,power:1050}).boss,'Ignar the Flame Tyrant');
 a.equal(k.bossGate('Ignar the Flame Tyrant',{matk:3800,power:1050}),null);
 a.equal(k.bossGate('Ignar the Flame Tyrant',{matk:2352,power:1700}),null);
 a.equal(k.view().bossGates.length,1);
 now+=1000;k.gateBoss('Ignar the Flame Tyrant',{factor:1.7,requiredMatk:3999});
 a.equal(k.view().bossGates[0].attempts,2);
 a.equal(new WorldKnowledge({file}).view().bossGates.length,1);
});
