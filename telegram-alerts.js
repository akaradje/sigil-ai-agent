'use strict';

// Read-only observer. It never calls game controls or consumes Telegram updates.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const MIN = 60_000;
const HOUR = 60 * MIN;
const num = (v) => {
  if (v == null || v === '') return null;
  const match = String(v).replaceAll(',', '').match(/\d+/);
  return match ? Number(match[0]) : null;
};

function readEnv(file) {
  const result = {};
  if (!fs.existsSync(file)) return result;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) result[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return result;
}

function normalize(agent) {
  const s = agent?.state;
  if (!s || !s.name || num(s.lv) == null) return null;
  // Existing perception can match old death messages in chat. Require current evidence.
  const reviveVisible = (agent.buttons || []).some((v) => /^(?:Revive Here|Back to Cathedral|Revive\b)/i.test(v));
  const dead = Boolean(s.dead && (s.hp?.[0] === 0 || reviveVisible));
  return {
    name: s.name, job: s.job, lv: num(s.lv), jl: num(s.jobLv),
    gold: num(s.gold), hp: s.hp, mp: s.mp, zone: s.zone, quest: s.quest,exp:s.exp,
    dead, disconnected: Boolean(s.disconnected || s.atCharSelect),
    auto: Boolean(s.autoQuestRunning), paused: Boolean(agent.paused),
    cycle: agent.cycle, brain: agent.brain || {},
  };
}

function statusText(s) {
  if (!s) return 'อ่านสถานะเกมไม่ได้ในขณะนี้';
  return `${s.name} · ${s.job || '?'} Lv ${s.lv} / Job ${s.jl ?? '?'}\n` +
    `Gold ${s.gold == null ? '?' : s.gold.toLocaleString('en-US')} · ${s.zone || '?'}\n` +
    `เควส: ${s.quest || 'ไม่พบข้อมูล'}`;
}

function levelRanking(agent, now = Date.now()) {
  const r = agent?.strategy?.rank;
  const name = agent?.state?.name;
  // Only a recent, explicitly selected level leaderboard for this character is evidence.
  if (!r || r.kind !== 'lv' || r.character !== name || !name ||
      !Number.isFinite(r.at) || now - r.at > 20 * MIN || r.at > now + MIN) return null;
  const own = (Array.isArray(r.rows) ? r.rows : []).filter(row => row.own === true);
  if (own.length !== 1) return null;
  const lines = String(own[0].text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (lines[1] !== name) return null;
  const rank = ({ '🥇': 1, '🥈': 2, '🥉': 3 })[lines[0]] || (/^[1-9]\d*$/.test(lines[0]) ? Number(lines[0]) : null);
  if (!Number.isSafeInteger(rank) || rank < 1) return null;
  return { name, rank, at: r.at };
}

class AlertEngine {
  constructor(saved = {}, now = Date.now()) {
    this.db = { version: 1, incidents: {}, pending: [], sequence: 0,
      lastSummary: now, summaryBase: null, deaths: [], goldSamples: [], ...saved };
  }
  enqueue(key, text, critical = false, incident = null) {
    if (this.db.pending.some((e) => e.key === key)) return;
    if (this.db.pending.length >= 80) this.db.pending.shift();
    this.db.pending.push({ id: ++this.db.sequence, key, text, critical, incident });
  }
  condition(key, active, now, delay, text, critical = false, recovery = true) {
    let issue = this.db.incidents[key];
    if (!active) {
      if (issue) {
        this.db.pending = this.db.pending.filter((e) => e.incident !== key);
        if (issue.delivered && recovery) this.enqueue(`recovered:${key}`, `✅ กลับมาปกติ: ${issue.title}`);
        delete this.db.incidents[key];
      }
      return;
    }
    if (!issue) issue = this.db.incidents[key] = { since: now, title: text, queued: false, delivered: false };
    if (!issue.queued && now - issue.since >= delay) {
      this.enqueue(`incident:${key}`, text, critical, key);
      issue.queued = true;
    }
  }
  acknowledge(events, receipt = null) {
    const ids = new Set(events.map((e) => e.id));
    for (const e of events) {
      if (e.incident && this.db.incidents[e.incident]) this.db.incidents[e.incident].delivered = true;
      if (e.key.startsWith('e2e-failed:') && Number.isSafeInteger(receipt?.messageId) && receipt.messageId > 0) {
        this.db.e2eReceipts ||= [];
        this.db.e2eReceipts.push({runId:e.key.slice('e2e-failed:'.length),messageId:receipt.messageId,at:receipt.at});
        this.db.e2eReceipts=this.db.e2eReceipts.slice(-40);
      }
    }
    this.db.pending = this.db.pending.filter((e) => !ids.has(e.id));
  }
  observeRanking(agent, now) {
    const r = levelRanking(agent, now);
    if (!r) return;
    const previous = this.db.levelRanking;
    if (previous?.name === r.name && r.at <= previous.at) return;
    if (!previous || previous.name !== r.name) {
      if (r.rank <= 5) this.enqueue(`rank:${r.name}:${r.at}`, `🏆 ยืนยันติด Top 5 ด้านเลเวลแล้ว!\n${r.name} อันดับ ${r.rank}`);
      else if (r.rank <= 10) this.enqueue(`rank:${r.name}:${r.at}`, `🏆 ยืนยันติด Top 10 ด้านเลเวลแล้ว!\n${r.name} อันดับ ${r.rank}`);
    } else if (r.rank < previous.rank) {
      const enteredTop5 = previous.rank > 5 && r.rank <= 5;
      const enteredTop10 = previous.rank > 10 && r.rank <= 10;
      this.enqueue(`rank:${r.name}:${r.at}`, `${enteredTop5 ? '🏆 ติด Top 5 ด้านเลเวลแล้ว!' : enteredTop10 ? '🏆 ติด Top 10 ด้านเลเวลแล้ว!' : '📈 อันดับด้านเลเวลดีขึ้น!'}\n` +
        `${r.name}: อันดับ ${previous.rank} → ${r.rank}${r.rank <= 10 && !enteredTop10 ? ' · อยู่ใน Top 10' : ''}`);
    }
    // Declines update the baseline silently, so a later genuine recovery can be reported.
    this.db.levelRanking = r;
  }
  observeCatchUp(agent,now) {
    const data=agent?.strategy?.catchUp,c=data?.current;
    if(!c||data.character!==agent.state?.name||now-c.at>2*MIN||c.at>now+MIN||!Number.isFinite(c.rankAt)||now-c.rankAt>20*MIN||c.rankAt>now+MIN)return;
    let t=this.db.catchUp;
    if(!t||t.character!==data.character)t=this.db.catchUp={character:data.character,at:0};
    if(c.rankAt<=t.at)return;
    t.at=c.rankAt;t.current={...c};
    t.candidate=t.candidate?.status===c.status?{status:c.status,count:t.candidate.count+1}:{status:c.status,count:1};
    if(!['closing','falling','flat'].includes(c.status)||t.candidate.count<2||t.announced===c.status||now-(t.notifiedAt||0)<30*MIN)return;
    const target=c.targetRank===5?5:10;
    const labels={closing:'กำลังตีตื้น',falling:'เส้น Top '+target+' โตเร็วกว่าตัวเรา',flat:'EXP ตัวเรายังไม่เพิ่ม'};
    const eta=c.etaMovingMinutes?.every(Number.isFinite)?` · ETA โดยประมาณ ${c.etaMovingMinutes.join('–')} นาที`:'';
    this.enqueue(`catchup:${data.character}:${c.rankAt}`,`📊 ${labels[c.status]} · อันดับ ${target}: ${c.cutoff?.name||'?'} Lv${c.cutoff?.level||'?'}${eta}`);
    t.announced=c.status;t.notifiedAt=now;
  }
  observeAutonomy(agent) {
    const a=agent?.strategy?.autonomy;if(!a)return;
    const d=this.db;d.autonomySeen ||= {};
    const character=agent.state?.name||agent.strategy?.uiHealth?.character;if(!character)return;
    const cursor=d.autonomySeen[character]||0;
    const types={
      dna_evolved:e=>`🧬 DNA Evolved: ${e.metric==='potions'?'ใช้ยาลดลง':e.metric==='gold'?'Gold/min เพิ่ม':'EXP/min เพิ่ม'} ${e.gainPercent}% ในช่วงทดสอบ · ${e.map} · รุ่น ${e.generation} (ผลสังเกต ไม่รับประกันผลรอบถัดไป)`,
      dna_rollback:e=>`↩️ DNA กลับใช้ Elite เดิม: ${e.reason}`,
      dna_drift:e=>`🧬 ผลฟาร์มเปลี่ยนต่อเนื่องที่ ${e.map} กำลังเก็บ baseline ใหม่และเพิ่มรอบตรวจกลยุทธ์`,
      session_refreshing:()=>`🔄 จัดกระเป๋าและตรวจยาในเมืองแล้ว กำลังรีเฟรชเซสชันตามรอบอายุ`,
      session_refreshed:()=>`✅ รีเฟรชเซสชันสำเร็จ ตรวจตำแหน่งและกลับมาเล่นต่อแล้ว`,
      position_invalid:()=>`⚠️ ตำแหน่งตัวละครอยู่นอกขอบแผนที่ต่อเนื่อง กำลังกู้ด้วยการโหลดหน้าเกมใหม่`,
      position_recovered:()=>`✅ โหลดเกมใหม่และตรวจพบตำแหน่งกลับเข้าแผนที่แล้ว กลับมาเล่นต่อ`,
      ui_changed:e=>`⚠️ UI Structure Changed: เข้าสู่ Safe Idle หยุดคำสั่งใช้ทรัพยากร คงการฟาร์มเดิมที่เกมกำลังรัน · อ่านไม่ได้: ${(e.missing||[]).join(', ')}`,
      ui_recovered:()=>`✅ อ่าน UI ได้ครบตามเกณฑ์ต่อเนื่องแล้ว กลับมาควบคุมเกมอัตโนมัติ`,
      cbt_claimed:e=>`🎁 รับของขวัญ CBT สำเร็จ: +${e.crystals} คริสตัล · ${e.vip||'ตรวจ VIP จากเกม'}`,
      cap_expanded:e=>`🚀 ตรวจพบเพดานเลเวลใหม่ ${e.from} → ${e.to} กำลังกลับเข้าสู่ลูปพัฒนา`,
      catalog_changed:e=>`🔄 ข้อมูลเกมเปลี่ยน กำลังวิเคราะห์สูตรใหม่ · Lv cap ${e.levelCap??'?'} / refine +${e.refineMax}`,
      gear_crafted:e=>`⚒ ${e.kind==='upgrade'?'อัปขั้น':'คราฟต์'} ${e.name} สำเร็จ${e.topTier?' · เทียร์สูงสุดที่พบในข้อมูลแพตช์':''}`,
      wing_completed:e=>`🪽 สร้างและสวม ${e.name} สำเร็จ!\nพลังอุปกรณ์ ${e.before??'?'} → ${e.after??'?'}${Number.isFinite(e.delta)?` (${e.delta>=0?'+':''}${e.delta})`:' · ยืนยันส่วนเพิ่มเฉพาะปีกไม่ได้'}\nวัดจากหน้าอุปกรณ์จริงก่อน–หลังสวมปีก`,
      refine_max:e=>`✨ ${e.name} ตีบวกถึง +${e.cap} ตามเพดานปัจจุบันแล้ว`,
      capacity_bought:e=>`🎒 เพิ่มช่อง ${e.id} สำเร็จ ใช้ ${e.cost} คริสตัล`,
    };
    for(const e of (a.events||[]).filter(e=>Number.isSafeInteger(e.id)&&e.id>cursor).sort((x,y)=>x.id-y.id)) {
      if(types[e.type])this.enqueue(`autonomy:${character}:${e.id}`,types[e.type](e.detail||{}));
      d.autonomySeen[character]=e.id;
    }
  }
  observe(sample, now = Date.now()) {
    const cognition=sample.agent?.strategy?.cognitive;
    if(cognition?.enabled && /^[a-f0-9-]{36}$/.test(cognition.identity||'') &&
      Number.isFinite(cognition.updatedAt) && now-cognition.updatedAt>=-5000 && now-cognition.updatedAt<2*MIN &&
      Number.isSafeInteger(cognition.totalExperiences) && cognition.totalExperiences>0 &&
      Number.isFinite(cognition.masteryIndex) && cognition.masteryIndex>=1 && cognition.masteryIndex<=100) {
      const milestone=Math.floor(cognition.masteryIndex/10)*10;
      const saved=this.db.cognitiveMilestones ||= {};
      const previous=saved[cognition.identity]||0;
      if(milestone>=10 && milestone>previous) {
        this.enqueue('cognitive:'+cognition.identity+':'+milestone,
          '🧠 ความชำนาญจากประสบการณ์ถึงระดับ '+milestone+'/100 · '+cognition.totalExperiences+' รอบที่สังเกต (คะแนนการเรียนรู้ ไม่ใช่การรับประกันผลเล่น)');
        saved[cognition.identity]=milestone;
        const ids=Object.keys(saved);for(const id of ids.slice(0,Math.max(0,ids.length-16)))delete saved[id];
      }
    }
    const d = this.db;
    const check=sample.selfHealingTest;
    if(check?.version===1&&check.kind==='isolated-e2e'){
      d.e2eFailures ||= [];
      for(const run of [...(Array.isArray(check.history)?check.history.slice(0,30):[]),check]){
        if(run?.notificationPolicy!=='failed_runs_only'||run.stage!=='FAILED'||!Number.isFinite(run.finishedAt)||run.finishedAt>now+60000||
          !/^[a-f0-9-]{36}$/.test(run.runId||'')||d.e2eFailures.includes(run.runId))continue;
        const reason=/^[A-Z][A-Z0-9_]{1,63}$/.test(run.failureCode||'')?run.failureCode:'ISOLATED_CHECK_FAILED';
        this.enqueue('e2e-failed:'+run.runId,'⚠️ [TEST] Self-Healing รายวันทดสอบไม่ผ่าน\nรอบ '+run.runId.slice(0,8)+' · '+reason+'\nโปรดตรวจการ์ด ISOLATED TEST บน Dashboard · เหตุการณ์นี้เป็นผลทดสอบแยก ไม่ใช่การ rollback ตัวละครจริง',true);
        d.e2eFailures.push(run.runId);d.e2eFailures=d.e2eFailures.slice(-40);
      }
    }
    const deployment=sample.deployment;
    const publication=sample.publication;
    if(publication&&/^[a-f0-9-]{36}$/.test(publication.identity||'')){
      d.publication ||= {identity:publication.identity,cursor:0};
      if(d.publication.identity!==publication.identity)d.publication={identity:publication.identity,cursor:0};
      for(const e of (publication.events||[]).filter(e=>Number.isSafeInteger(e.id)&&e.id>d.publication.cursor).sort((a,b)=>a.id-b.id)){
        if(/^[a-f0-9-]{36}$/.test(e.jobId||'')){
          if(e.status==='PUBLISHED'&&/^[a-f0-9]{40}$/.test(e.commit||''))this.enqueue('publication:'+publication.identity+':'+e.jobId,
            '🧬 พัฒนากลยุทธ์/ความสามารถผ่านเทสต์และ canary แล้ว · บันทึกขึ้น GitHub สำเร็จ\n'+
            (['PUBLIC_CATALOG_EXPANDED','UNSUPPORTED_PUBLIC_SYSTEM','VERIFIED_GROWTH_PLATEAU','BEHIND_TOP_TEN','VERIFIED_CAP_STOCKPILE','UI_SCHEMA_CHANGED'].includes(e.purpose)?e.purpose+'\n':'')+
            (e.files||[]).filter(f=>['game-intelligence.js','game-telemetry.js','ui-resilience.js','cognitive-brain.js','cognitive-brain.test.js','progression.js','character-development.js','strategy-dna.js'].includes(f)).join(', ')+'\nhttps://github.com/akaradje/sigil-ai-agent/commit/'+e.commit);
          if(e.status==='PUBLICATION_FAILED')this.condition('publication:'+e.jobId,true,now,0,'⚠️ โค้ดผ่าน canary แต่เผยแพร่ GitHub ยังไม่สำเร็จ · '+(/^[A-Z_]{3,64}$/.test(e.reason||'')?e.reason:'PUBLICATION_FAILED'),true);
        }
        d.publication.cursor=e.id;
      }
    }
    if(deployment&&/^[a-f0-9-]{36}$/.test(deployment.identity||'')){
      if(d.deployment?.identity!==deployment.identity)d.deployment={identity:deployment.identity,cursor:0,announced:[]};
      const messages={COMMITTED:'✅ Self-Healing: นำแพตช์ขึ้นใช้จริงอัตโนมัติแล้ว ผ่านการเฝ้าดูสุขภาพ 10 นาที',
        ROLLED_BACK:'↩️ Self-Healing: ตรวจพบปัญหาหลังอัปเดต ย้อนกลับไฟล์รุ่นเดิมและยืนยันว่าโปรเซสรุ่นเดิมเริ่มทำงานแล้ว',
        ROLLBACK_FAILED:'🚨 Self-Healing: ย้อนกลับยังไม่สำเร็จ ต้องตรวจบริการและไฟล์สำรอง ระบบจำกัดการลองกู้ซ้ำไว้ 3 ครั้ง'};
      for(const e of (deployment.events||[]).filter(e=>Number.isSafeInteger(e.id)&&e.id>d.deployment.cursor).sort((a,b)=>a.id-b.id)){
        const key=e.jobId+':'+e.status;
        if(messages[e.status]&&/^[a-f0-9-]{36}$/.test(e.jobId||'')&&!d.deployment.announced.includes(key)){
          this.enqueue(`deployment:${deployment.identity}:${key}`,messages[e.status],e.status!=='COMMITTED');
          d.deployment.announced.push(key);d.deployment.announced=d.deployment.announced.slice(-80);
        }
        d.deployment.cursor=e.id;
      }
    }
    const healing=sample.selfHealing;
    if(healing&&/^[a-f0-9-]{36}$/.test(healing.identity||'')) {
      if(d.selfHealing?.identity!==healing.identity)d.selfHealing={identity:healing.identity,cursor:0,announced:[]};
      d.selfHealing.announced ||= [];
      const messages={REPAIRING:'🛠 Self-Healing: ตรวจพบปัญหา UI ต่อเนื่อง กำลังเตรียมแพตช์ในพื้นที่แยก',
        READY_REVIEW:healing.mode==='automatic-deployment'?'🧪 Self-Healing: แพตช์ผ่านชุดทดสอบแล้ว รอจังหวะพร้อมเพื่อนำขึ้นใช้จริงอัตโนมัติ':'🧪 Self-Healing: แพตช์ผ่านชุดทดสอบใน sandbox แล้ว รอตรวจโค้ดก่อนใช้จริง ระบบฟาร์มยังใช้โค้ดเดิม',
        FAILED:'⚠️ Self-Healing: งานซ่อมไม่สำเร็จ เก็บหลักฐานไว้ตรวจ โปรดดูสถานะการอัปเดต/ย้อนกลับแยก',
        INTERRUPTED:'⚠️ Self-Healing: งานซ่อมถูกขัดจังหวะ ตัวเฝ้าอิสระจะตรวจและกู้รุ่นที่กำลังใช้งาน'};
      for(const e of (healing.events||[]).filter(e=>Number.isSafeInteger(e.id)&&e.id>d.selfHealing.cursor).sort((a,b)=>a.id-b.id)) {
        const key=e.jobId+':'+e.status;
        if(messages[e.status]&&/^[a-f0-9-]{36}$/.test(e.jobId||'')&&!d.selfHealing.announced.includes(key)){
          this.enqueue(`self-healing:${healing.identity}:${e.jobId}:${e.status}`,messages[e.status]);
          d.selfHealing.announced.push(key);d.selfHealing.announced=d.selfHealing.announced.slice(-60);
        }
        d.selfHealing.cursor=e.id;
      }
    }
    // Schema incidents must still reach Telegram when the HUD name cannot be read.
    this.observeAutonomy(sample.agent);
    this.observeCatchUp(sample.agent,now);
    this.condition('dna-persistence',Boolean(sample.agent?.strategy?.dna?.issue),now,2*MIN,'⚠️ พักการเรียนรู้ DNA เพราะตรวจฐานความจำไม่ได้ ใช้กลยุทธ์อนุรักษ์ทรัพยากรต่อ');
    const pendingRefresh=sample.agent?.strategy?.sessionHygiene?.pending;
    this.condition('session-refresh',Boolean(pendingRefresh&&now-pendingRefresh.at>2*MIN),now,0,
      '⚠️ รีเฟรชตามรอบแล้วแต่ยังยืนยันการกลับมาเล่นไม่ได้เกิน 2 นาที',true,false);
    const s = normalize(sample.agent);
    this.condition('agent', !s, now, 90_000, '🚨 อ่านสถานะบอต/เกมไม่ได้เกิน 90 วินาที', true);
    if (sample.supervisorOk != null) this.condition('supervisor', !sample.supervisorOk, now, 90_000,
      '🚨 ตัวดูแลเกมไม่ตอบเกิน 90 วินาที', true);
    if (sample.viewerOk != null) this.condition('viewer', !sample.viewerOk, now, 90_000,
      '⚠️ หน้า Live Viewer ไม่ตอบเกิน 90 วินาที');
    if (!s) return null;
    const last = d.last;
    // Do not credit time during an observation outage toward a gameplay stall.
    if (!last || now - (d.observedAt || 0) > 2 * MIN) {
      d.progressAt = now; d.cycleAt = now; d.llmFailureAt = null;
    }
    d.observedAt = now;
    this.condition('disconnect', s.disconnected, now, 90_000,
      '🚨 เกมหลุด/ค้างหน้าเลือกตัวละครเกิน 90 วินาที', true);
    this.condition('paused', s.paused, now, 2 * MIN, '⚠️ AI ถูกพักเกิน 2 นาที');
    this.condition('dead', s.dead, now, 90_000, '🚨 ตัวละครล้มและยังฟื้นไม่ได้เกิน 90 วินาที', true);
    const autonomous=sample.agent?.strategy?.autonomy;
    const managed=Boolean(autonomous?.trip||autonomous?.farm||autonomous?.resume||sample.agent?.strategy?.uiHealth?.safeIdle||sample.agent?.strategy?.gameTelemetry?.positionFault||sample.agent?.availability?.status==='down');
    this.condition('auto', !s.auto && !managed && !s.disconnected && !s.dead && !s.paused, now, 2 * MIN,
      '⚠️ Auto Quest หยุดเกิน 2 นาที');
    if (s.dead && !last?.dead) d.deaths.push(now);
    d.deaths = d.deaths.filter((t) => t >= now - 10 * MIN);
    this.condition('deaths', d.deaths.length >= 3, now, 0,
      '🚨 พบการล้มอย่างน้อย 3 ครั้งใน 10 นาที ควรตรวจพื้นที่ฟาร์มและยาฟื้นฟู', true);
    if (!last || s.cycle !== last.cycle || s.paused) d.cycleAt = now;
    this.condition('cycle', !s.paused && now - d.cycleAt >= 15 * MIN, now, 0,
      '🚨 AI ไม่จบรอบการทำงานใหม่เกิน 15 นาที', true);
    const b = s.brain;
    const restarted = last && (s.cycle < last.cycle || b.llmOk < last.brain.llmOk || b.llmFail < last.brain.llmFail);
    if (restarted || (last && b.llmOk > last.brain.llmOk)) d.llmFailureAt = null;
    if ((!last && b.llmFail > 0 && b.llmDownUntil > now) || (last && b.llmFail > last.brain.llmFail)) {
      d.llmFailureAt ??= now;
    }
    // brain.ready means retry is allowed, not that a model call succeeded.
    this.condition('llm', d.llmFailureAt != null && now - d.llmFailureAt >= 5 * MIN,
      now, 0, '⚠️ LLM เรียกใช้งานไม่สำเร็จต่อเนื่องเกิน 5 นาที บอตอาจใช้ policy สำรอง');
    const previousJob = d.lastKnownJob || last?.job;
    if (s.job === 'Starweaver') {
      d.starweaverMilestones ||= {};
      if (!d.starweaverMilestones[s.name]) {
        this.enqueue('job:Starweaver', `🎉 เปลี่ยนเป็น Starweaver สำเร็จแล้ว!\n${s.name} · Lv ${s.lv} / Job ${s.jl ?? '?'}`);
        d.starweaverMilestones[s.name] = true;
      }
    } else if (s.job && previousJob && s.job !== previousJob) {
      this.enqueue(`job:${s.job}`, `🎉 เปลี่ยนอาชีพสำเร็จ: ${previousJob} → ${s.job}`);
    }
    if (s.job) d.lastKnownJob = s.job;
    this.observeRanking(sample.agent, now);
    this.condition('autonomy-blocked',Boolean(autonomous?.blocked),now,5*MIN,`⚠️ งานอัตโนมัติต้องตรวจเพิ่ม: ${autonomous?.blocked||''}`);
    if (last && !restarted) {
      if (s.lv > last.lv && Math.floor(s.lv / 5) > Math.floor(last.lv / 5)) {
        this.enqueue(`level:${Math.floor(s.lv / 5)}`, `🎉 ถึง Lv ${s.lv} แล้ว`);
      }
    }
    const cap = autonomous?.cap?.jobCap ?? { Novice: 10, Mage: 40, Starweaver: 50 }[s.job];
    this.condition('jobcap', Boolean(cap && s.jl >= cap), now, 0,
      `✨ ${s.job} Job ${s.jl}: ถึงเกณฑ์เปลี่ยนอาชีพแล้ว`, false, false);
    if (!last || s.lv !== last.lv || s.jl !== last.jl || s.job !== last.job || s.exp!==last.exp ||
        (s.quest && s.quest !== last.quest) || s.disconnected || s.paused) d.progressAt = now;
    this.condition('stall', !managed && !s.disconnected && !s.paused && now - d.progressAt >= 30 * MIN,
      now, 0, '⚠️ เลเวล/Job/ความคืบหน้าเควสไม่เปลี่ยนเกิน 30 นาที');
    if (s.gold != null) {
      // Hysteresis prevents repeated alerts around the low-gold threshold.
      this.condition('gold', s.gold < (d.incidents.gold ? 8000 : 3000), now, MIN,
        '⚠️ Gold ต่ำกว่า 3,000 ควรตรวจค่ายาและต้นทุนฟาร์ม');
      d.goldSamples.push({ t: now, value: s.gold });
      d.goldSamples = d.goldSamples.filter((v) => v.t >= now - 15 * MIN);
      const first = d.goldSamples[0];
      const drop = first && now - first.t >= 10 * MIN && first.value - s.gold >= Math.max(5000, first.value * 0.2);
      this.condition('gold-drop', Boolean(drop), now, MIN,
        '⚠️ Gold ลดอย่างน้อย 20% และ 5,000 ภายในช่วง 15 นาที อาจเป็นค่าใช้จ่ายหรือการซื้อของ');
    }
    d.summaryBase ||= { lv: s.lv, jl: s.jl, job: s.job, gold: s.gold };
    if (now - d.lastSummary >= 4 * HOUR) {
      const base = d.summaryBase;
      const gain = s.gold != null && base.gold != null ? s.gold - base.gold : null;
      this.enqueue('summary', `📊 สรุป 4 ชั่วโมง\nLv ${base.lv} → ${s.lv} · ${base.job} Job ${base.jl} → ${s.job} Job ${s.jl}\n` +
        `Gold เปลี่ยน ${gain == null ? '?' : (gain >= 0 ? '+' : '') + gain.toLocaleString('en-US')}`);
      d.lastSummary = now;
      d.summaryBase = { lv: s.lv, jl: s.jl, job: s.job, gold: s.gold };
    }
    d.last = s;
    return s;
  }
}

function quietHours(now = Date.now()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hourCycle: 'h23' }).format(now));
  return hour >= 23 || hour < 8;
}

async function telegram(token, method, body) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw Object.assign(new Error('Telegram network/timeout error'), { retryMs: MIN });
  }
  let payload;
  try { payload = await response.json(); } catch { throw new Error(`Telegram HTTP ${response.status}`); }
  if (!response.ok || !payload.ok) {
    throw Object.assign(new Error(`Telegram API error ${payload.error_code || response.status}`), {
      retryMs: (Number(payload.parameters?.retry_after) || 60) * 1000,
    });
  }
  return payload.result;
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('Upstream unavailable');
  return response.json();
}

async function collect() {
  const settled = await Promise.allSettled([
    getJson('http://127.0.0.1:4801/state'),
    getJson('http://127.0.0.1:4800/state'),
    fetch('http://127.0.0.1:8080/', { signal: AbortSignal.timeout(5000) }),
  ]);
  return {
    agent: settled[0].status === 'fulfilled' ? settled[0].value : null,
    supervisorOk: settled[1].status === 'fulfilled' && Boolean(settled[1].value?.state?.name),
    selfHealing: settled[1].status === 'fulfilled' ? settled[1].value?.selfHealing : null,
    deployment: readDeployment(),
    publication: readDeployment('/run/sigil-self-healing/publication.json'),
    selfHealingTest: readTestReport(),
    viewerOk: settled[2].status === 'fulfilled' && [200, 401].includes(settled[2].value.status),
  };
}
function readDeployment(file=process.env.SELF_HEAL_STATUS_FILE||'/run/sigil-self-healing/events.json'){
  try{if(fs.statSync(file).size>256*1024)return null;const d=JSON.parse(fs.readFileSync(file,'utf8'));return Array.isArray(d.events)&&d.events.length<=40?d:null;}catch{return null;}
}
function readTestReport(file=process.env.SELF_HEAL_TEST_FILE||'/var/lib/sigil-self-healing-reports/e2e.json'){
  try{if(fs.statSync(file).size>256*1024)return null;const d=JSON.parse(fs.readFileSync(file,'utf8'));return d.version===1&&d.kind==='isolated-e2e'?d:null;}catch{return null;}
}

function save(file, db) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(db), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

async function main() {
  const paths = require('./runtime-paths').ensureStateDir(require('./runtime-paths').resolveRuntimePaths());
  const dir = paths.stateDir;
  const stateFile = path.join(dir, 'telegram-alerts-state.json');
  let saved = {};
  if (fs.existsSync(stateFile)) saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const engine = new AlertEngine(saved);
  let validated = '', nextSendAt = 0, failures = 0;
  const health = { configured: false, validated: false, lastPoll: null, lastSent: null, lastMessageId: null, error: null };
  function config() {
    return { ...readEnv(path.join(paths.configDir, '.env')), ...readEnv(path.join(paths.configDir, 'telegram.env')), ...process.env };
  }
  function viewerLink() {
    // A clean authenticated viewer URL can be supplied privately. No access token in notifications.
    const value = config().VIEWER_PUBLIC_URL;
    if (!value) return null;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
      return url.href;
    } catch { return null; }
  }
  async function tick(checkOnly = false) {
    const cfg = config();
    const token = cfg.TELEGRAM_BOT_TOKEN, chat = cfg.TELEGRAM_CHAT_ID;
    health.configured = Boolean(token && chat);
    if (!health.configured) { health.error = 'Missing TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID'; return; }
    const fingerprint = crypto.createHash('sha256').update(`${token}:${chat}`).digest('hex');
    if (validated !== fingerprint && Date.now() < nextSendAt && !checkOnly) return;
    if (validated !== fingerprint) {
      health.validated = false;
      const me = await telegram(token, 'getMe', {});
      const recipient = await telegram(token, 'getChat', { chat_id: chat });
      if (recipient.type !== 'private') throw new Error('Recipient must be a private Telegram chat');
      validated = fingerprint;
      health.validated = true;
      health.bot = me.username;
      health.error = null;
    }
    const sample = await collect();
    const current = engine.observe(sample);
    health.lastPoll = new Date().toISOString();
    health.gameReadable = Boolean(current);
    health.levelRanking = engine.db.levelRanking || null;
    health.starweaverNotified = Boolean(current && engine.db.starweaverMilestones?.[current.name]);
    if (checkOnly) { console.log(JSON.stringify({ ...health, pending: engine.db.pending.length })); return; }
    if (engine.db.welcomed !== fingerprint) {
      // A changed recipient must never inherit queued messages from the previous chat.
      if (engine.db.welcomed) engine.db.pending = [];
      engine.enqueue('welcome', '✅ Sigil เปิดแจ้งเตือนแล้ว\nปัญหาค้าง / เปลี่ยนอาชีพ / Lv ทุก 5 เลเวล / สรุปทุก 4 ชั่วโมง\n23:00–08:00 เวลาไทย: เฉพาะเรื่องเร่งด่วนมีเสียง');
    }
    save(stateFile, engine.db);
    if (Date.now() < nextSendAt) return;
    const events = [...engine.db.pending].sort((a, b) => Number(b.critical) - Number(a.critical)).slice(0, 4);
    if (!events.length) return;
    const urgent = events.some((e) => e.critical);
    const timestamp = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }).format(new Date());
    const body = {
      chat_id: chat,
      text: (events.map((e) => e.text).join('\n\n') + '\n\n' + statusText(current) + `\n🕒 ${timestamp} (ไทย)`).slice(0, 3900),
      disable_notification: !urgent && (quietHours() || events.every((e) => e.key === 'summary' || e.key.startsWith('recovered:'))),
      link_preview_options: { is_disabled: true }, protect_content: true,
    };
    const link = viewerLink();
    if (link) body.reply_markup = { inline_keyboard: [[{ text: 'ดูสด · อ่านอย่างเดียว', url: link }]] };
    const sent = await telegram(token, 'sendMessage', body);
    engine.acknowledge(events, {messageId:sent.message_id,at:Date.now()});
    if (events.some((e) => e.key === 'welcome')) engine.db.welcomed = fingerprint;
    save(stateFile, engine.db);
    failures = 0; nextSendAt = 0; health.error = null;
    health.lastSent = new Date().toISOString(); health.lastMessageId = sent.message_id;
    console.log(`${health.lastSent} Telegram delivered ${events.map((e) => e.key).join(',')} message_id=${sent.message_id}`);
  }
  async function guardedTick() {
    try { await tick(); }
    catch (error) {
      failures++;
      nextSendAt = Date.now() + Math.max(error.retryMs || 0, Math.min(15 * MIN, 30_000 * 2 ** Math.min(failures, 5)));
      health.error = error.message;
      console.error(`${new Date().toISOString()} ${error.message}; retry delayed`);
    }
  }
  if (process.argv.includes('--check')) { await tick(true); return; }
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/health') { res.writeHead(404); return res.end(); }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ...health, pending: engine.db.pending.length }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4802, '127.0.0.1', resolve); });
  console.log(`${new Date().toISOString()} read-only Telegram observer started`);
  async function loop() { await guardedTick(); setTimeout(loop, 30_000); }
  await loop();
}

module.exports = { AlertEngine, normalize, statusText, quietHours, readEnv, telegram, levelRanking, readDeployment };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
