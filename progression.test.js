'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('./progression'),A=require('./autonomy');
const now=1800000000000,MIN=60000;
const state=(change={})=>({name:'Hero',lv:'Lv 59',job:'Starweaver',exp:60,zone:'Field',...change});
const catalog=()=>({fingerprint:'one',at:now-1000,levelCap:99,jobs:{starweaver:{weapon:'staff',line:['mage','starweaver']}},
  gear:[{id:'cape55',name:'Old Cape',slot:'cape',tier:5,lv:55,stats:{def:10}},{id:'cape60',name:'New Cape',slot:'cape',tier:5,lv:60,line:'starweaver',stats:{def:20},craft:{gold:5000,mats:{ore:1}}}],
  expByLevel:Object.fromEntries(Array.from({length:101},(_,i)=>[i+1,1000]))});
const rank=(at,level=66,name='Rival')=>({kind:'lv',character:'Hero',at,rows:[{text:`10\n${name}\nMonk Lv ${level}\nLv ${level}`},{own:true,text:'11\nHero\nStarweaver Lv 59\nLv 59'}]});
test('bracket hold starts above 50 percent, lists real unlocks, and never blocks endgame cap',()=>{
  const c=catalog();assert.equal(P.bracketHold(state({exp:50}),c).active,false);
  assert.equal(P.bracketHold(state(),c).active,true);assert.equal(P.bracketHold(state(),c).unlocks[0].name,'New Cape');
  assert.equal(P.bracketHold(state({lv:'Lv 60'}),c).active,false);
  assert.equal(P.bracketHold(state({lv:'Lv 99',exp:100,expText:'EXP MAX'}),c).active,false);
});
test('crossing a bracket holds secondary spending until a fresh catalog, across restart',()=>{
  let m={};const c=catalog();P.updateBracket(m,state(),c,now);
  assert.equal(P.updateBracket(m,state({lv:'Lv 60',exp:0}),c,now+1000).awaitingCatalog,true);
  m=JSON.parse(JSON.stringify(m));assert.equal(P.updateBracket(m,state({lv:'Lv 60',exp:5}),c,now+2000).active,true);
  assert.equal(P.updateBracket(m,state({lv:'Lv 60',exp:5}),{...c,at:now+3000},now+3000).active,false);
});
test('secondary holds cover direct actions and confirmations, preserving primary weapon and survival purchases',()=>{
  const m={autonomy:{resourceHold:{active:true},worn:[{uid:'weapon',slot:'weapon'},{uid:'cape',slot:'cape'}]}};
  assert.equal(P.forgeDecision({act:'refine',key:'cape'},state(),m,catalog(),now).allowed,false);
  assert.equal(P.forgeDecision({act:'refine',key:'weapon'},state(),m,catalog(),now).allowed,true);
  assert.equal(P.forgeDecision({act:'buy',key:'potion'},state(),m,catalog(),now).allowed,true);
  assert.equal(P.forgeDecision({label:'Craft'},state({panel:'smith'}),m,catalog(),now).allowed,false);
  const modal=state({modalText:'Confirm refine'});m.forgeIntent={character:'Hero',slot:'weapon',at:now};
  assert.equal(P.forgeDecision({label:'Confirm'},modal,m,catalog(),now).allowed,true);
  assert.equal(P.forgeDecision({label:'Confirm'},modal,m,catalog(),now+31000).allowed,false);
});
test('same-tier higher-level caster equipment is planned only after unlock without core-stat loss',()=>{
  const c=catalog(),a=A.init({});a.inventory={items:{ore:1},gear:[]};a.worn=[{slot:'cape',uid:'old',text:'Old Cape'}];
  assert.equal(A.progressionGoal(c,state({gold:120000}),a,100000),null);
  assert.equal(A.progressionGoal(c,state({lv:'Lv 60',gold:120000}),a,100000).target,'cape60');
  c.gear[1].stats.hp=-100;assert.equal(A.progressionGoal(c,state({lv:'Lv 60',gold:120000}),a,100000),null);
});
test('unknown EXP tables, stale/wrong-category/ambiguous leaderboards cannot invent catch-up',()=>{
  assert.equal(P.absoluteExp({},60,20),null);
  const m={rank:rank(now)};assert.equal(P.updateCatchUp(m,state(),catalog(),now).status,'uncertain');
  m.rank.kind='gold';assert.equal(P.updateCatchUp(m,state(),catalog(),now).status,'waiting');
  m.rank=rank(now);m.rank.rows.push({own:true,text:'12\nOther\nLv 59'});assert.equal(P.rankRows(m.rank,'Hero',now),null);
  assert.equal(P.rankRows(rank(now),'Hero',now+21*MIN),null);
});
test('ETA separates a stationary cutoff scenario from unknown moving-competitor speed',()=>{
  const c=catalog(),m={rank:rank(now),autonomy:{expPerMinute:100,expRateAt:now,expRateZone:'Field'}};
  const x=P.updateCatchUp(m,state(),c,now);
  assert.deepEqual(x.gapExp,[6400,7400]);assert.deepEqual(x.etaStaticMinutes,[64,74]);assert.equal(x.etaMovingMinutes,null);
});
test('two-sided rival EXP bounds prevent claiming a closing trend from unchanged level alone',()=>{
  const c=catalog(),m={rank:rank(now)};P.updateCatchUp(m,state({lv:'Lv 59',exp:0}),c,now);
  m.rank=rank(now+20*MIN);const x=P.updateCatchUp(m,state({lv:'Lv 59',exp:20}),c,now+20*MIN);
  assert.equal(x.status,'uncertain');assert.deepEqual(x.cutoffGrowthBounds,[0,50]);
});
test('confirmed closing and falling use wall-clock growth, including a level crossing',()=>{
  const c=catalog(),m={rank:rank(now)};P.updateCatchUp(m,state({exp:0}),c,now);
  m.rank=rank(now+20*MIN);const x=P.updateCatchUp(m,state({lv:'Lv 61',exp:0}),c,now+20*MIN);
  assert.equal(x.status,'closing');assert.equal(x.ownWallExpPerMinute,100);assert.ok(x.etaMovingMinutes[1]>x.etaMovingMinutes[0]);
  const n={rank:rank(now)};P.updateCatchUp(n,state({exp:0}),c,now);
  n.rank=rank(now+20*MIN,70);assert.equal(P.updateCatchUp(n,state({exp:20}),c,now+20*MIN).status,'falling');
});
test('level-cap ties and rank membership require actual ranking evidence',()=>{
  const m={rank:rank(now,99)};assert.equal(P.updateCatchUp(m,state(),catalog(),now).status,'cap-tie');
  m.rank.rows[1].text='9\nHero\nLv 66';assert.equal(P.updateCatchUp(m,state(),catalog(),now).status,'top10');
});

test('Top 5 objective resets old Top 10 telemetry and requires fresh rank-five evidence',()=>{
  const m={rank:rank(now)};P.updateCatchUp(m,state(),catalog(),now);
  m.rank.rows.push({own:false,text:'5\nFifth\nLv 99'});
  const c=P.updateCatchUp(m,state(),catalog(),now,5);
  assert.equal(c.targetRank,5);assert.equal(c.cutoff.rank,5);assert.equal(c.status,'cap-tie');assert.equal(c.etaMovingMinutes,null);
  assert.equal(m.catchUp.cutoffSamples.length,0);
  m.rank.rows[1].text='4\nHero\nLv 99';assert.equal(P.updateCatchUp(m,state(),catalog(),now,5).status,'top5');
});
