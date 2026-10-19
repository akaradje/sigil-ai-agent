'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {dayAt,schedule,canRun,quietEvent,failureCode}=require('./self-healing-check');
const {AlertEngine}=require('./telegram-alerts');
const JOB='12345678-1234-1234-1234-123456789abc';
test('daily exercise uses Bangkok dates and the exact 07:00 boundary',()=>{
  assert.equal(dayAt(Date.parse('2026-10-19T17:01:00Z')),'2026-10-20');
  assert.equal(schedule(Date.parse('2026-10-19T23:59:00Z')).nextRunAt,Date.parse('2026-10-20T00:00:00Z'));
  assert.equal(schedule(Date.parse('2026-10-20T00:00:00Z')).nextRunAt,Date.parse('2026-10-21T00:00:00Z'));
});
test('daily slot cannot rerun completed, failed or interrupted exercises',()=>{
  for(const stage of ['PASSED','FAILED','PREPARING'])assert.equal(canRun({runs:[{day:'2026-10-20',stage}]},'2026-10-20'),false);
  assert.equal(canRun({runs:[{day:'2026-10-19',stage:'PASSED'}]},'2026-10-20'),true);
});
test('expected commit and rollback exercise notification routing without a Telegram send',()=>{
  const identity=JOB,events=[{id:1,jobId:JOB,status:'COMMITTED',at:Date.now()}],engine=new AlertEngine();
  assert.equal(quietEvent(engine,{identity,events},'COMMITTED'),'COMMITTED');
  events.push({id:2,jobId:JOB,status:'ROLLED_BACK',at:Date.now()});
  assert.equal(quietEvent(engine,{identity,events},'ROLLED_BACK'),'ROLLED_BACK');
  const reloaded=new AlertEngine(JSON.parse(JSON.stringify(engine.db)));
  reloaded.observe({deployment:{identity,events},agent:null,supervisorOk:true,viewerOk:true});
  assert.equal(reloaded.db.pending.filter(e=>e.key.startsWith('deployment:')).length,0);
  assert.throws(()=>quietEvent(reloaded,{identity,events},'COMMITTED'));
});
test('daily failures expose enum codes rather than private raw exception messages',()=>{
  assert.equal(failureCode({code:'TESTS_FAILED',message:'PRIVATE'}),'TESTS_FAILED');
  assert.equal(failureCode({code:'raw PRIVATE text'}),'ISOLATED_CHECK_FAILED');
});
