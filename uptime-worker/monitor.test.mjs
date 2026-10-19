import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// Cloudflare's sockets are exercised after deployment; isolate the pure state machine here.
const source = fs.readFileSync(new URL('./monitor.mjs', import.meta.url), 'utf8')
  .replace("import { connect } from 'cloudflare:sockets';", 'const connect = () => { throw new Error("not available in unit tests"); };');
const { initialState, advance, probeGame, default: worker } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const minute = 60_000;
test('game HTTP probe uses its separate HTTPS target and does not send any Telegram command',async()=>{
  const original=globalThis.fetch;const calls=[];
  try {
    globalThis.fetch=async url=>{calls.push(url);return new Response('',{status:200});};
    assert.equal((await probeGame({GAME_HEALTH_URL:'https://game.example.test/'})).healthy,true);
    globalThis.fetch=async()=>new Response('',{status:503});assert.equal((await probeGame({GAME_HEALTH_URL:'https://game.example.test/'})).healthy,false);
    globalThis.fetch=async()=>{throw Error('timeout');};assert.equal((await probeGame({GAME_HEALTH_URL:'https://game.example.test/'})).healthy,false);
    assert.deepEqual(calls,['https://game.example.test/']);
  }finally{globalThis.fetch=original;}
});

test('two failed checks are transient; third failure opens one incident', () => {
  let s = advance(initialState(), true, minute);
  for (let i = 2; i <= 3; i++) s = advance(s, false, i * minute);
  assert.equal(s.status, 'up'); assert.equal(s.pending.length, 0);
  s = advance(s, false, 4 * minute, 'timeout');
  assert.equal(s.status, 'down'); assert.equal(s.pending[0].kind, 'down');
  for (let i = 5; i < 30; i++) s = advance(s, false, i * minute);
  assert.equal(s.pending.length, 1);
});
test('a successful check resets the consecutive-failure streak', () => {
  let s = initialState();
  for (const [i, ok] of [true, false, false, true, false, false].entries()) s = advance(s, ok, i * minute);
  assert.equal(s.status, 'up'); assert.equal(s.pending.length, 0); assert.equal(s.failures, 2);
});
test('recovery needs two consecutive successes, with one recovery message', () => {
  let s = initialState();
  for (let i = 1; i <= 3; i++) s = advance(s, false, i * minute);
  s.pending.shift();
  s = advance(s, true, 4 * minute); assert.equal(s.status, 'down');
  s = advance(s, false, 5 * minute); assert.equal(s.successes, 0);
  s = advance(s, true, 6 * minute); assert.equal(s.status, 'down');
  s = advance(s, true, 7 * minute); assert.equal(s.status, 'up');
  s = advance(s, true, 8 * minute);
  assert.equal(s.pending.length, 1); assert.equal(s.pending[0].kind, 'up');
  assert.equal(s.pending[0].downAt, minute);
});
test('state/outbox persist across restarts and retain outage then recovery during TG failures', () => {
  let s = initialState();
  for (let i = 1; i <= 3; i++) s = advance(s, false, i * minute);
  s = JSON.parse(JSON.stringify(s));
  s = advance(s, true, 4 * minute); s = advance(s, true, 5 * minute);
  assert.deepEqual(s.pending.map((e) => e.kind), ['down', 'up']);
  assert.notEqual(s.pending[0].id, s.pending[1].id);
});
test('starting while target is already down still detects the outage', () => {
  let s = initialState();
  for (let i = 1; i <= 3; i++) s = advance(s, false, i * minute);
  assert.equal(s.status, 'down'); assert.equal(s.pending.length, 1);
});
test('advance does not mutate persisted input before it is saved', () => {
  const initial = initialState();
  advance(initial, false, minute);
  assert.equal(initial.failures, 0); assert.equal(initial.pending.length, 0);
});
test('public requests cannot trigger checks or Telegram messages', async () => {
  const denied = await worker.fetch(new Request('https://example.test/admin/check', { method: 'POST' }), { ADMIN_KEY: 'test-secret' });
  assert.equal(denied.status, 401);
  const health = await worker.fetch(new Request('https://example.test/health'), {});
  assert.equal(health.status, 200); assert.equal((await health.json()).service, 'sigil-uptime-monitor');
  const missing = await worker.fetch(new Request('https://example.test/admin/check', {
    method: 'POST', headers: { authorization: 'Bearer test-secret' },
  }), { ADMIN_KEY: 'test-secret' });
  assert.equal(missing.status, 503);
});
