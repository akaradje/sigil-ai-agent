'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const T=require('./game-telemetry');
const now=1800000000000;
const sample=()=>({available:true,running:true,ready:true,loading:false,map:'town',world:'town',x:500,y:500,width:96,height:68});
test('public state projection never serializes player, network, account or token fields',()=>{
  const g={running:true,ready:true,p:{map:'town',x:500,y:500,target:'monster-1',token:'private',inventory:['private']},world:{id:'town',w:96,h:68},link:{secret:'private'}};
  const s=JSON.parse(vm.runInNewContext(T.EXPRESSION,{window:{SIGIL:g}}));
  assert.equal(s.targetId,'monster-1');assert.doesNotMatch(JSON.stringify(s),/private|token|inventory|link/);
  assert.equal(vm.runInNewContext(T.EXPRESSION,{window:{}}),'{"available":false}');
});
test('outside-map diagnosis needs verified dimensions and 30 seconds of evidence',()=>{
  const m={},s={...sample(),x:6188,y:2683};
  assert.equal(T.update(m,s,32,now).confirmed,false);assert.equal(T.update(m,s,32,now+30000).confirmed,true);
  assert.equal(T.recoveryDue(m,now+30000),true);
  assert.equal(T.update(m,s,null,now+40000).confirmed,false);
  assert.equal(T.update(m,{...s,loading:true},32,now+50000).confirmed,false);
  assert.equal(T.update(m,sample(),32,now+60000).positionFault,false);
});
test('reload recovery cannot loop across process restarts or exceed three per hour',()=>{
  const m={gameTelemetry:{confirmed:true},positionRecovery:{at:now,history:[now-1200000,now-600000,now]}};
  assert.equal(T.recoveryDue(JSON.parse(JSON.stringify(m)),now+600001),false);
  m.positionRecovery.history=[now];assert.equal(T.recoveryDue(m,now+1000),false);assert.equal(T.recoveryDue(m,now+600001),true);
});
