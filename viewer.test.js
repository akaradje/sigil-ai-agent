'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('viewer fails closed without a token', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigil-viewer-test-'));
  try {
    const child = spawn(process.execPath, [path.join(__dirname, 'viewer.js')], {
      env: { ...process.env, AGENT_DIR: dir, VIEWER_TOKEN: '' }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    const [code] = await once(child, 'exit');
    assert.notEqual(code, 0);
    assert.match(error, /Set VIEWER_TOKEN/);
  } finally { fs.rmdirSync(dir); }
});

test('viewer requires authentication, limits routes to read-only and sets privacy headers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigil-viewer-test-'));
  const token = crypto.randomBytes(32).toString('hex');
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, 'viewer.js')], {
    env: { ...process.env, AGENT_DIR: dir, VIEWER_TOKEN: token, VIEWER_PORT: String(port), VIEWER_HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch(base); ready = r.status === 401; if (ready) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.equal(ready, true);
    const denied = await fetch(base + '/?k=wrong');
    assert.equal(denied.status, 401);
    const page = await fetch(base + '/?k=' + token);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    const cookie = page.headers.get('set-cookie').split(';')[0];
    const allowed = await fetch(base, { headers: { cookie } });
    assert.equal(allowed.status, 200);
    const post = await fetch(base, { method: 'POST', headers: { cookie } });
    assert.equal(post.status, 405);
    const control = await fetch(base + '/eval?expr=1', { headers: { cookie } });
    assert.equal(control.status, 404);
  } finally {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    fs.rmdirSync(dir);
  }
});
