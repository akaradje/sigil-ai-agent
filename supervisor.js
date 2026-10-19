/**
 * Sigil supervisor — state-driven, rate-limited, self-healing.
 *
 * Design rules learned the hard way:
 *  - Every click MUST come from a DOM bounding box. Guessed canvas coordinates are walk orders and
 *    trip the "abnormal movement" anti-cheat.
 *  - Never more than one action per ACTION_GAP ms, and at most BURST_MAX actions per minute.
 *  - The character is never lost on a disconnect: it returns to Choose Character, so "click Play"
 *    is the recovery action.
 *  - Nothing here may throw out of the loop; a crash means the farm stops.
 */
const http = require('http');
const fs = require('fs');
const IQ = require('./game-intelligence');
const UI = require('./ui-resilience');
const {createAvailability}=require('./server-availability');
const availability=createAvailability({url:process.env.GAME_HEALTH_URL||''});
availability.probe().catch(()=>{});
setInterval(()=>availability.probe().catch(()=>{}),60000);

const path = require('node:path');
const DIR = process.env.AGENT_DIR || __dirname;
const HARNESS = process.env.HARNESS || 'http://127.0.0.1:4799';
const LOG = path.join(DIR, 'supervisor.log');
const METRICS = path.join(DIR, 'metrics.jsonl');
const TICK_MS = 20000;
const ACTION_GAP = 1500;
const BURST_MAX = 18;
const STATUS_PORT = 4800;

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  fs.appendFileSync(LOG, line + '\n');
  console.log(line);
}

function metric(obj) {
  fs.appendFileSync(METRICS, JSON.stringify({ t: Date.now(), ...obj }) + '\n');
}

function req(path, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const r = http.get(HARNESS + path, { timeout }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d));
    });
    r.on('timeout',()=>r.destroy(new Error('harness timeout')));
    r.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- action gate
let lastAction = 0;
const actionTimes = [];

async function gate() {
  const now = Date.now();
  const wait = Math.max(0, lastAction + ACTION_GAP - now);
  if (wait) await sleep(wait);
  // rolling one-minute budget
  const cutoff = Date.now() - 60000;
  while (actionTimes.length && actionTimes[0] < cutoff) actionTimes.shift();
  if (actionTimes.length >= BURST_MAX) {
    const waitMore = actionTimes[0] + 60000 - Date.now();
    if (waitMore > 0) await sleep(waitMore);
  }
  const state=await readState();
  if(!state||UI.assess(state).blocked)throw Error('UI schema unavailable: fallback controller idle');
  lastAction = Date.now();
  actionTimes.push(lastAction);
}

async function clickXY(x, y, why) {
  await gate();
  await req(`/click?x=${x}&y=${y}`);
  log(`CLICK ${why} @${x},${y}`);
}

async function pressKey(k, why) {
  await gate();
  await req(`/type?key=${encodeURIComponent(k)}`);
  log(`KEY ${k} (${why})`);
}

async function typeStr(s, why) {
  await gate();
  await req(`/typestr?str=${encodeURIComponent(s)}`);
  log(`TYPE ${why}`);
}

// ------------------------------------------------------- DOM helpers (in page)
const DOM = {
  // Match only one currently visible, hit-tested control; never choose the first ambiguous label.
  btn: re => `(function(){const s=${IQ.PERCEPTION};const a=s.controls.filter(c=>new RegExp(${JSON.stringify(re)},'i').test(c.label));return a.length===1?a[0].x+','+a[0].y:'nf';})()`,
  state: 'JSON.stringify('+IQ.PERCEPTION+')',
};

async function evalIn(expr) {
  const out = await req('/eval?expr=' + encodeURIComponent(expr));
  return out;
}

async function readState() {
  const raw = await evalIn(DOM.state);
  try {
    const s=JSON.parse(raw);return {...s,jl:s.jobLv,choosing:s.atCharSelect,autoRunning:s.autoQuestRunning,blocked:s.statBlocked};
  } catch {
    return null;
  }
}

async function clickBtn(re, why) {
  const pos = await evalIn(DOM.btn(re));
  if (!pos || pos === 'nf' || !pos.includes(',')) return false;
  const [x, y] = pos.split(',').map(Number);
  if (!x && !y) return false;
  await clickXY(x, y, why);
  return true;
}

// ------------------------------------------------------------------- decisions
const mem = {
  deaths: 0,
  lastLv: null,
  lastJl: null,
  lastGold: null,
  goldPerMin: 0,
  samples: [],
  restarts: 0,
  consecutiveFails: 0,
  lastClassChangeCheck: 0,
  lastProgressAt: Date.now(),
  stalled: false,
  goldWarned: false,
  dailyClaimedOn: null,
  potionLoop: 0,
  lastQuest: null,
};

async function tick() {
  if(availability.blocked()){log('game unavailable; recovery controls paused');return;}
  let s;
  try {
    s = await readState();
    if(!s)throw Error('harness returned no readable game state');
    mem.consecutiveFails = 0;
  } catch (e) {
    mem.consecutiveFails++;
    log(`state read failed (${mem.consecutiveFails}): ${e.message}`);
    if (mem.consecutiveFails >= 3) await restartHarness();
    return;
  }
  if (!s) { log('state unparsable'); return; }
  if(UI.assess(s).blocked){mem.controller='safe-idle';return;}
  // One controller owns the UI. The supervisor observes while the agent is responsive.
  const agentAlive=await new Promise(resolve=>{
    const r=http.get('http://127.0.0.1:4801/health',{timeout:2500},res=>{res.resume();resolve(res.statusCode===200);});
    r.on('timeout',()=>r.destroy());r.on('error',()=>resolve(false));
  });
  if(agentAlive) {
    metric({event:'observer',lv:s.lv,jl:s.jl,hp:s.hp,gold:s.gold,auto:s.autoRunning});
    mem.controller='agent-v3';return;
  }
  mem.controller='supervisor-fallback';

  // --- 0. connection recovery ---------------------------------------------
  if (s.choosing || s.disconnected) {
    log('at character select / disconnected -> click Play');
    const ok = await clickBtn('^\\s*(\\u25b6\\s*)?Play\\s*$', 'play');
    if (!ok) await clickBtn('Play', 'play-loose');
    await sleep(9000);
    return;
  }

  // --- 1. death ------------------------------------------------------------
  if (s.dead) {
    mem.deaths++;
    log(`DEATH #${mem.deaths} -> revive with feather`);
    const ok = await clickBtn('Revive Here', 'revive-feather');
    if (!ok) await clickBtn('Back to Cathedral', 'revive-cathedral');
    metric({ event: 'death', deaths: mem.deaths, lv: s.lv, gold: s.gold });
    await sleep(3000);
    return;
  }

  // --- 2. blocked on stat points ------------------------------------------
  if (s.blocked) {
    log(`blocked: ${s.blocked} stat points`);
    await clickBtn('Spend points \\(recommended\\)', 'spend-points-shortcut');
    await sleep(1200);
    if (await clickBtn('Suggested', 'suggested')) {
      await sleep(1000);
      await clickBtn('Confirm', 'confirm-points');
      await sleep(1200);
      await clickBtn('^\\s*Confirm\\s*$', 'confirm-dialog');
    }
    return;
  }

  // --- 3. auto quest stalled ---------------------------------------------
  if (!s.autoRunning) {
    log('auto quest stopped -> start');
    await clickBtn('Auto Quest', 'auto-quest');
    await sleep(2000);
    return;
  }

  // --- 3b. daily login (once per calendar day) ---------------------------
  const today = new Date().toISOString().slice(0, 10);
  if (mem.dailyClaimedOn !== today) {
    const claimed = await clickBtn('Claim day \\d+', 'daily-claim');
    if (claimed) {
      mem.dailyClaimedOn = today;
      log('daily login claimed');
      metric({ event: 'daily', day: today });
      await sleep(1500);
      await pressKey('Escape', 'close-daily');
      return;
    }
  }

  // --- 3c. potion-buy loop detector -------------------------------------
  if (/Low on potions/i.test(await req('/text'))) {
    mem.potionLoop++;
  } else {
    mem.potionLoop = 0;
  }
  if (mem.potionLoop === 6) {
    log('WARN potion loop: 6 consecutive ticks low on potions (gold ' + s.gold + ')');
    metric({ event: 'potion_loop', gold: s.gold, lv: s.lv });
  }

  // --- 3d. gold guard ----------------------------------------------------
  if (s.gold != null && s.gold < 3000 && !mem.goldWarned) {
    mem.goldWarned = true;
    log(`WARN gold low (${s.gold}) — farming costs more than it earns`);
    metric({ event: 'gold_low', gold: s.gold });
  } else if (s.gold != null && s.gold > 8000) {
    mem.goldWarned = false;
  }

  // --- 3e. no-progress detector -----------------------------------------
  const stalledFor = Date.now() - mem.lastProgressAt;
  if (stalledFor > 20 * 60000 && !mem.stalled) {
    mem.stalled = true;
    log(`STALL: no level/job change for ${Math.round(stalledFor / 60000)} min (${s.lv} ${s.jl})`);
    metric({ event: 'stall', lv: s.lv, jl: s.jl, gold: s.gold, quest: s.quest });
    try { await req('/screenshot'); } catch { /* ignore */ }
  }

  // --- 4. low mana warning ------------------------------------------------
  if (s.mp && s.mp[1] > 0) {
    const pct = s.mp[0] / s.mp[1];
    if (pct < 0.18) log(`low MP ${Math.round(pct * 100)}% (${s.mp[0]}/${s.mp[1]})`);
  }

  // --- 5. class change at job cap ----------------------------------------
  const jobTier = { Novice: 10, Mage: 40, Starweaver: 50, Sage: 60 }[s.job];
  if (jobTier && s.jl && parseInt(s.jl.replace(/\D/g, ''), 10) >= jobTier) {
    const now = Date.now();
    if (now - mem.lastClassChangeCheck > 300000) {
      mem.lastClassChangeCheck = now;
      log(`JOB CAP reached (${s.job} ${s.jl}) -> class change available`);
      metric({ event: 'jobcap', job: s.job, jl: s.jl, lv: s.lv });
    }
  }

  // --- metrics ------------------------------------------------------------
  const lvNum = s.lv ? parseInt(s.lv.replace(/\D/g, ''), 10) : null;
  const jlNum = s.jl ? parseInt(s.jl.replace(/\D/g, ''), 10) : null;
  if (lvNum !== mem.lastLv || jlNum !== mem.lastJl) {
    log(`PROGRESS ${s.lv} ${s.jl} gold=${s.gold}`);
    metric({ event: 'progress', lv: lvNum, jl: jlNum, gold: s.gold, crystals: s.crystals, job: s.job });
    mem.lastLv = lvNum;
    mem.lastJl = jlNum;
    mem.lastProgressAt = Date.now();
    mem.stalled = false;
  }

  mem.samples.push({ t: Date.now(), gold: s.gold });
  if (mem.samples.length > 60) mem.samples.shift();
  if (mem.samples.length > 1) {
    const a = mem.samples[0], b = mem.samples[mem.samples.length - 1];
    const mins = (b.t - a.t) / 60000;
    if (mins > 0.5) mem.goldPerMin = Math.round((b.gold - a.gold) / mins);
  }

  metric({
    event: 'tick', lv: lvNum, jl: jlNum, hp: s.hp, mp: s.mp, gold: s.gold,
    target: s.target, weak: s.weak, auto: s.autoRunning, goldPerMin: mem.goldPerMin,
  });
  log(`tick ${s.lv} ${s.jl} hp=${s.hp ? s.hp[0] : '?'} mp=${s.mp ? s.mp[0] : '?'} g=${s.gold} gold/min=${mem.goldPerMin}`);
}

async function restartHarness() {
  mem.restarts++;
  log(`harness unreachable -> restart #${mem.restarts}`);
  try {
    // Operator must opt in; the supervisor never kills an arbitrary port owner.
    if (process.env.HARNESS_RESTART_SYSTEMD !== '1') {
      log('Automatic harness restart disabled; configure sigil-harness.service');
      return;
    }
    const { execFileSync } = require('node:child_process');
    execFileSync('/usr/bin/sudo', ['-n','/usr/bin/systemctl', 'restart', 'sigil-harness.service'], { stdio: 'ignore', timeout: 20000 });
    await sleep(22000);
    mem.consecutiveFails = 0;
  } catch (e) {
    log('restart failed: ' + e.message);
  }
}

// --------------------------------------------------------------- status server
http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/state')) {
      const s = await readState();
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ state: s, mem: { ...mem, samples: undefined } }, null, 1));
    }
    if (req.url.startsWith('/log')) {
      return res.end(fs.readFileSync(LOG, 'utf8').split('\n').slice(-40).join('\n'));
    }
    res.end('supervisor ok');
  } catch (e) {
    res.end('err ' + e.message);
  }
}).listen(STATUS_PORT, '127.0.0.1', () => log(`supervisor up, status on ${STATUS_PORT}`));

log('supervisor start');
let ticking=false;
async function guardedTick(){if(ticking)return;ticking=true;try{await tick();}catch(e){log('tick: '+e.message);}finally{ticking=false;}}
setInterval(guardedTick,TICK_MS);guardedTick();
