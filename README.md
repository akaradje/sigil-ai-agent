# Sigil AI Agent

โค้ด AI เล่นเกมผ่าน UI พร้อมหน้าเว็บดูสดแบบ read-only และแจ้งเตือน Telegram

สำเนานี้เตรียมสำหรับ GitHub สาธารณะ โดยแยกจาก deployment จริง ใช้ค่าตั้งต้นทั่วไป
และไม่รวม `.env`, บัญชีเกม, access token, log, ภาพหน้าจอ, ฐานข้อมูลสถานะ หรือไฟล์เกมที่ดาวน์โหลดมา
ประวัติ Git เริ่มใหม่จากสำเนานี้

## ส่วนประกอบ

| ไฟล์ | หน้าที่ |
| --- | --- |
| `agent.js` | LLM วางแผนด้วย tool ที่อ้างอิง UI พร้อมจำกัดความถี่และบันทึกผล |
| `game-intelligence.js` | อ่าน DOM ที่แสดงอยู่ วางลำดับเควสต์/อาชีพ สกิล อุปกรณ์และอันดับ |
| `supervisor.js` | ตรวจการเชื่อมต่อและช่วยกู้การเล่นผ่าน UI |
| `viewer.js` | แสดงภาพและสถานะแบบดูอย่างเดียว ต้องมี token และ bind loopback เป็นค่าเริ่มต้น |
| `telegram-alerts.js` | แจ้งเปลี่ยนอาชีพ อันดับดีขึ้น เข้า Top 10 และปัญหาการทำงาน พร้อมคิวส่งซ้ำ |
| `uptime-worker/` | ตัวตรวจภายนอกบน Cloudflare แจ้งเมื่อเข้า VPS/viewer ไม่ได้และเมื่อกลับมาปกติ |
| `cloudflare-worker/` | Relay สำหรับ model API ที่ต้องใช้ shared secret |

## เตรียมใช้งาน

ต้องมี Node.js 22+, Linux/X11, `curl`, `xdotool` และ browser harness ของผู้ใช้งานเอง
ตาม [สัญญา API](docs/harness-api.md) โค้ดนี้เจาะจงกับโครงสร้าง UI ของ Sigil และต้องปรับเมื่อเกมเปลี่ยน
**ไม่มี browser harness หรือขั้นตอนล็อกอินที่พร้อมใช้งานรวมอยู่ใน repo** เพราะไฟล์ deployment เดิม
มีข้อมูลเข้าบัญชี ให้ทำ adapter ของคุณเองและเก็บข้อมูลล็อกอินเป็น secret ภายนอก Git

```bash
cp .env.example .env
cp agent-goal.example.txt agent-goal.txt
# เติมค่าใน .env บนเครื่องของคุณเท่านั้น
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
# นำค่าที่สุ่มได้ใส่ VIEWER_TOKEN; ไม่ส่งขึ้น Git
npm test
npm start
```

เปิดอีก terminal สำหรับแต่ละบริการ:

```bash
npm run supervisor
npm run viewer
npm run alerts
```

ตัวอย่าง systemd อยู่ใน `sigil-*.service` ต้องสร้าง service user `sigil`, ติดตั้งที่
`/opt/sigil-agent` และแก้พาธ Node ให้ตรงเครื่องก่อน ใช้ `EnvironmentFile` เพื่ออ่าน `.env`
สิทธิ์ไฟล์ secret ควรเป็น `0600` และ directory ของ runtime ควรเขียนได้เฉพาะ service user

Agent/supervisor/observer ใช้พอร์ต loopback 4801/4800/4802 ส่วน harness ใช้ 4799
ห้ามเปิดพอร์ตควบคุมเหล่านี้สู่อินเทอร์เน็ต หน้า viewer เริ่มที่ `127.0.0.1:8080`
เข้า `/` พร้อม `?k=<VIEWER_TOKEN>` และใช้ HTTPS/authentication ผ่าน reverse proxy สำหรับดูจากภายนอก
ผู้ที่มีลิงก์ token จะดูภาพและบันทึกได้ เก็บลิงก์ไว้เป็นความลับ
`xdotool` ต้องส่งคีย์ไปยังหน้าต่างเกมที่ active บน DISPLAY ที่ระบุ

โมเดลตั้งได้ด้วย `AGENT_MODEL` และ endpoint แบบ chat completions ด้วย `AGENT_BASE`
หากใช้ relay ให้ตั้งโมเดลเดียวกันใน Worker `ALLOWED_MODEL` และเก็บ `META_API_KEY` / `RELAY_KEY`
ด้วย Cloudflare Secrets; ฝั่ง agent ใช้ `AGENT_RELAY_KEY` เดียวกัน
ไฟล์ `data/tables.json` เป็นข้อมูลเสริมเท่านั้น ไม่ได้แจกใน repository นี้

## Telegram และตัวตรวจภายนอก

ตั้ง `TELEGRAM_BOT_TOKEN` และ `TELEGRAM_CHAT_ID` ใน `.env` ส่วนตัว บอตตรวจว่าเป็นแชตส่วนตัว
ก่อนส่งจริง การตรวจอันดับใช้ leaderboard ประเภท level ของตัวละครเดียวกันและข้อมูลล่าสุดเท่านั้น
มีการจำอันดับ/คิวแจ้งเตือนข้ามการ restart ไม่ส่งข้อความทดสอบเองระหว่าง unit tests

ติดตั้งตัวตรวจภายนอกตาม [uptime-worker/README.md](uptime-worker/README.md)
ต้องแยกจาก VPS เพื่อให้แจ้งได้เมื่อ VPS ดับ ตรวจทุกนาที แจ้งล่มเมื่อผิดพลาด 3 ครั้งติดกัน
และแจ้งกลับมาปกติเมื่อผ่าน 2 ครั้งติดกัน การ probe ใช้ HTTP 401 จาก viewer ที่เปิดการยืนยันตัวตน
ไม่ได้ล็อกอินเข้าควบคุมเกม

## ตรวจสอบก่อน push

```bash
npm test
python scripts/check-public-files.py
gitleaks dir . --redact --no-banner
gitleaks git . --redact --no-banner --log-opts=--all
```

GitHub Actions รัน tests, ตรวจรายการไฟล์ต้องห้าม และ Gitleaks สำหรับประวัติที่ checkout มา
การตรวจช่วยลดความเสี่ยง แต่ผู้ดูแลยังต้องตรวจ diff ทุกครั้งก่อนเผยแพร่ โดยเฉพาะไฟล์ใหม่
หากเคย push secret ให้เพิกถอน/หมุนค่า secret นั้นทันที การลบไฟล์ใน commit ถัดไปไม่ล้างประวัติ

ใช้งานเฉพาะบัญชีและระบบที่คุณมีสิทธิ์ และตรวจข้อกำหนดของเกมก่อนเปิดระบบอัตโนมัติ
การจัดอันดับขึ้นอยู่กับเกม ผู้เล่นอื่น ทรัพยากร และเสถียรภาพ ไม่มีการรับประกัน Top 10

## Dynamic autonomous progression

`SIGIL_AUTONOMY=1` enables the deterministic town/farm/craft controller in `autonomy.js`.
Set `SIGIL_LEVELING_FOCUS=1` to prefer measured EXP routes while leveling and defer
secondary crafting trips. Without NPC sales, town storage clears identified spare gear
to 70% bag occupancy over short verified transactions, preserving worn gear, items and potions.
With explicit authorization and `SIGIL_SELL_SURPLUS=1`, every town arrival and every
town-service return passes through the shop. Sales continue across short, rate-limited
workflows until all identified surplus weapons have been checked; weapons have no
eight-item visit cap and take priority over other equipment. Secondary equipment checks
remain bounded to eight per visit so a large armor backlog does not delay the farm return.
The agent never deposits weapons or uses bulk storage in this mode. It preserves worn,
locked/favorite, carded, future and better gear. Compatible weapons, including options
and refinements, require a live inferior verdict, a loss of the job's primary attack stat,
and no extra card slots. Unknown or ambiguous comparisons stay in the bag.
Each confirmed sale updates the dashboard only after item disappearance and exact gold
credit. Uncertain settlement blocks new sales. The agent then replenishes supplies,
closes its panels and restores the previous farming route.
Leveling hunts select a specific normal monster, excluding bosses and rare elite spawns.
`SIGIL_LEVELING_MAX_GAP` defaults to three levels above the character and is bounded to
3–5; increase it only after observing survival and measured EXP. A changed target starts
a separate EXP measurement.
Return Scrolls stop native movement before casting and are replenished during potion trips.
If a saved home is a field, town service continues via the verified public town route;
selling starts only after the town's actual zone is observed.
The regular crafting and stockpiling policy resumes at the detected level cap.
Copy `agent-goal.example.txt` to the private `agent-goal.txt`. Set `GOLD_RESERVE` (default 100000)
and `CBT_CRYSTAL_BUDGET` (default 0, maximum 5000) in your private `.env`. The separate public
repository never contains the runtime budget, character inventory, cached catalog or alert state.

- `game-catalog.js` reads immutable public definitions served to the game page: recipes, drops,
  maps, job caps, EXP curve and refine cap. It does not access player memory, private APIs or send
  game intents. The current character cap is parsed from the public UI's `EXP MAX` condition;
  unknown formats remain unknown. This is adaptive metadata discovery, not a promise that every
  future game UI or protocol will remain compatible.
- Catalog refresh runs on reconnect and every six hours. A changed fingerprint discards stale plans;
  cap expansion produces a durable Telegram event. Current visible controls and materials must
  independently authorize a craft or refinement before normal mouse/keyboard input is sent.
- Inventory/gear snapshots identify upgrade targets and material deficits. Resource routes are
  bounded ten-minute trials, restricted by monster level; predicted drop chance is separate from
  measured EXP/min. Native story progression resumes afterward. Historical samples are not proof
  of a globally optimal map.
- Capacity purchases are restricted to bag/storage products shown by the UI and only when near full.
  Budget is reserved and persisted before a purchase. An ambiguous result retains that reservation
  and stops further automated purchases for operator reconciliation. No cosmetics or unverified
  paid buffs are purchased. EXP/drop CBT bonuses are already provided by the event.
- Forge work handles one equipped item per visit/transaction. It preserves a sustain reserve,
  verifies live material quantities and acknowledges success before notifying. Refinements that
  can lose a level require Guardian Stone protection. Missing or inaccessible materials remain a
  visible bottleneck; the controller does not invent a drop route or a successful action.
- Confirmed cap plus verified maxed equipped gear selects stockpiling instead of stopping.
  Town tasks remember the previous map, restock low potion slots and return via visible map controls.
- `server-availability.js` checks `GAME_HEALTH_URL` each minute. Three failures pause agent and
  supervisor controls; two successes resume. HTTP availability alone does not prove a game session
  or WebSocket is healthy, so existing connection recovery still observes the game UI.

The read-only dashboard displays mode, crystals, bag usage, current caps, measured EXP/min,
material completion and reserved/spent crystal budget. Telegram includes verified CBT claims,
crafts, refine caps and catalog/cap changes, with persisted deduplication across restarts.

## UI resilience and measured farming

`ui-resilience.js` validates ten live HUD fields against a fixed schema. More than 30% missing,
or a missing name, level or valid HP pair, immediately blocks new game inputs except Escape cleanup
and uniquely verified Play at character selection. Existing native AUTO is left running. After 15
seconds of bad observations, Telegram receives one persisted UI incident, including when the name
is unreadable; ten continuous seconds of healthy HUD readings allow recovery and one recovery alert.
The supervisor also checks the schema before fallback actions. An unreadable HUD cannot guarantee
survival, and new layouts without semantic labels still require adapter updates.

HUD readers accept a unique explicit `aria-label`, `data-hud` or `data-testid` when an ID changes.
Navigation has scoped text fallbacks; ambiguous labels are rejected. Craft, purchase and confirmation
controls keep their existing exact item/resource checks. `game-telemetry.js` also reads a narrow
allowlist from `window.SIGIL`, explicitly exposed for console inspection in the game's public main
module: map dimensions, position, loading flags and target identity. It never serializes the player,
network link, tokens or inventory, and never writes game state. If that optional object changes or
vanishes, UI observations remain the input source. No network interceptor or private API is installed.

Read-only one-second samples estimate target HP-bar duration, discarding visible target switches,
healing, overlays, disappearance and long sampling gaps. Public target IDs distinguish same-name
switches when available; without them, identical-name switches remain uncertain. Samples do not
establish a hit count. Five short completed bars,
a measured EXP baseline, HP above 75% and at least 20 of each potion permit a bounded higher-map trial.
Trials retreat after low HP/death, a measured EXP regression after three minutes, or ten minutes total.
Recent measured EXP rates help select repeat farming routes; travel/menu time is excluded. Sampling
is conservative and may miss fast kills, so missing evidence never triggers a blind map jump.

Bag servicing starts at 95% capacity (95/100), with more frequent checks near full. Potion replenishment
starts at ten or fewer, uses verified gold prices and the reserve, and does not buy premium buffs.
Native automatic learned skills and the game's existing CBT bonus remain responsible for buffs.

## Bracket planning, catch-up estimates and session refresh

- Levels ending in 9 with EXP above 50% pause secondary crafting, tier upgrades and refinements.
  Verified primary-weapon work and survival purchases remain available. Secondary-only material
  detours return to native EXP progression while the hold is active; ordinary drops are still kept.
  This is a level-bracket
  policy, not a claim that every tenth level unlocks a tier. Actual unlocks come from the catalog;
  same-tier higher-level gear is considered when core stats improve without regression. On crossing
  the bracket, a forced catalog refresh must succeed before secondary spending resumes. The policy
  does not apply at a verified character cap. The click boundary also enforces it for LLM tools.
- Dashboard catch-up telemetry records the current level-rank cutoff and real cumulative EXP.
  A rival's hidden in-level EXP is an interval, not zero. Stationary-cutoff ETA is labelled as a
  conditional range; moving-cutoff ETA appears only when observed growth bounds establish closing.
  Own wall-clock growth includes trips and downtime. Rival growth requires at least 20 minutes of
  fresh leaderboard history; stale, wrong-character/category and cap-tie data cannot invent an ETA.
  Telegram stores the cutoff and reports a changed trend after two new leaderboard samples, with
  deduplication and a 30-minute notification cooldown. Existing rank/Top10 notifications remain.
- `SESSION_REFRESH_HOURS` defaults to 6 and is clamped to 6–8. Browser `performance.timeOrigin`
  supplies session age, which survives agent restarts. Refresh waits for an ordinary completed town
  trip, a freshly verified bag below 95% and at least 20 of each potion. Storage and the gold-priced
  shop may service these prerequisites with existing safeguards; unresolved inventory, insufficient
  reserves or unsafe UI defer optional refresh and return to play. It never forces a town trip merely
  because the session is old. Refresh intent and the return route persist before normal page reload.
  Successful recovery requires a newer browser session, valid position and observed native gameplay;
  Telegram reports start, completion or a recovery stalled beyond two minutes. This is preventive
  maintenance, not evidence of a diagnosed memory leak or a guarantee against all crashes.

## Bounded evolutionary strategy memory

With autonomy enabled, `SIGIL_DNA=1` (default) enables `strategy-dna.js`. This evolves strategy
parameters, not executable code or permissions. It combines a finite contextual UCB selector with
one-locus crossover/mutation, retaining elites across restarts in private `dna-memory.json`.
Set `SIGIL_DNA=0` to keep the conservative native profile. That file and all checkpoints are ignored
by Git; the supervisor reads only a summary and never competes with the agent as a second writer.

- Real applied genes are HP potions at 40% or 60% (the current UI's supported safe choices), bag
  service at 90% or 95%, a 3–6 second HP-bar trial tolerance, and all-learned versus hotbar skill scope.
  Hotbar scope must visibly retain Energy Coat and at least four enabled skill controls, or it is
  rejected and all-learned scope restored. No invented skill-weight vector is sent to the game.
  Secondary bracket holds, gold/crystal reserves, no-potion stop, loss-protected refinements and
  ambiguity checks remain fixed. Craft priority is not mutated because crafting cannot be undone.
- Contexts separate character, public patch fingerprint, job, two-level bands, job-level bands,
  equipped build/refinement and farm map. Town trips count as elapsed cost within a window. A new
  context retains old knowledge but collects new baseline evidence; safe bag/TTK alleles can be
  seeded with zero confidence, never inherited performance claims. Memory is bounded to 64 recent
  contexts, 12 strategies per context and 256 hazard cells.
- Normal windows last 15 minutes. Two baseline windows precede experiments; two repeated candidate
  windows are needed for promotion. Candidates alter only one applied gene and are read back through
  ordinary UI before measurement starts. Fitness combines normalized real EXP, net gold, verified
  positive rare-material snapshot deltas, restock-adjusted potion consumption and downtime penalties.
  Rare here means a public drop chance at most 3%; counts are lower bounds, with no invented prices.
  Potion counts are a resource-cost proxy, not a claimed exact gold cost per consumed bottle.
- Promotion requires repeat evidence: EXP improves beyond both 5% and a noise margin, or potion
  consumption drops by 25% with EXP preserved, or verified cap stockpiling yields more net gold.
  Fitness must also improve and potion consumption cannot materially worsen. These are observational
  comparisons; competition, buffs and progression can still confound attribution. Telegram reports
  the measured metric, not a guaranteed future gain or proof of globally optimal play.
- Death, low HP, position faults, excessive potion use, stalls or severe early EXP regression abort
  a trial and request the prior native profile. Failed arms are quarantined for six hours. Sampling
  gaps, UI outages and restarts discard unobserved windows rather than crediting a success. Profile
  application waits for healthy HP and supplies; unverified restoration blocks further measurement.
- Patch/bracket changes and sustained baseline degradation enter faster ten-minute validation
  windows; mutation size and safety limits do not expand. Hazard cells are retained privately for
  24 hours; repeated same-cell outside/stuck failures suppress optional map experiments for six hours
  on that patch. This avoids replaying risky optional routes; it does not provide arbitrary pixel
  pathfinding or guarantee that native quest routing avoids every recorded coordinate.
- State uses atomic writes plus a previous valid checkpoint. The agent transfers durable evolution,
  drift and rollback events to Telegram with a persisted cursor. The read-only dashboard shows genes,
  context generation, evidence-window progress and immunity count. A persistence failure pauses
  learning, requests the conservative profile and leaves ordinary progression available.

The same read-only telemetry detects coordinates outside validated live map dimensions. New game
inputs pause while the fault is present; after 30 seconds it permits a normal browser reload, then
verified Play/quest recovery. Reload attempts persist across restarts, with a ten-minute cooldown and
three-per-hour ceiling. Telegram reports the fault and confirmed in-bounds gameplay recovery. Loading
frames or unknown tile size cannot establish a fault. This handles a diagnosed game-side town-return
position error without writing coordinates or sending game intents directly.


`sigil-viewer.service` keeps the read-only viewer running after a process exit. The optional
`sigil-harness.service` runs an **operator-supplied private** browser adapter; it does not contain
any login code or credentials. Match its user, display, Node path and directory to your environment.
For a non-root supervisor to restart it, grant only `systemctl restart sigil-harness.service` through
a narrowly scoped sudoers rule, validate that rule with `visudo`, then opt into
`HARNESS_RESTART_SYSTEMD=1`. Do not grant general passwordless shell/systemctl access.
A pre-existing 16-character viewer link can be retained explicitly with
`VIEWER_ALLOW_LEGACY_TOKEN=1`; new deployments should generate a token of at least 24 characters.

Enable `sigil-display.timer` for a display fallback after reboot or display failure. Its service
first probes DISPLAY :99 and skips startup when an existing X server is healthy; it never kills
or replaces that display. Otherwise it starts Xvfb without a TCP listener and waits for X clients
before the harness starts. Install Xvfb/xdotool, select the correct service user and adjust the
display geometry for your browser. This requires access only from trusted local processes.

### Automatic self-healing and rollback

`self-evolution-runner.js` observes the agent's loopback health endpoint every 30 seconds. Three
minutes of continuously observed UI Safe Idle can open a repair job; paused play, maintenance,
login screens, expected reloads and stale observations cannot. Jobs are limited to one per hour
and three per day, with one outstanding candidate. The root-only state directory defaults to
`/var/lib/sigil-self-healing`; jobs, bounded failure history, cooldown and event cursors survive
restarts. Interrupted repairs retain their baseline; an independent guard restores an interrupted
live deployment before new repair work is accepted.

The configured `AGENT_MODEL` receives only enumerated public source files, missing HUD field
names and redacted test feedback. It returns bounded JSON edits, without tools or shell access.
Only `game-intelligence.js`, `game-telemetry.js` and `ui-resilience.js` can be proposed for change;
existing tests, controllers, supervisor, credentials and this repair engine are protected. A new
regression test is required. Both the unchanged baseline and each candidate run syntax checks
and the complete fixed test suite. Failed attempts restart from the baseline, up to three times.

The Linux worker uses systemd 255 or later, a separate root filesystem, a read-only bind of the
public snapshot and Node runtime, a private network namespace and temporary filesystem, an
unprivileged test user, no capabilities and fixed resource/time limits. It never executes model
commands, installs dependencies, reads arbitrary source paths or falls back to host execution.
The coordinator and guard run from a separate root-owned `/opt/sigil-self-healing` directory,
including a root-owned Node binary under `runtime/bin/node`. Copy the reviewed coordinator files
(`self-evolution.js`, `self-evolution-runner.js`, `self-deployment.js`, `telegram-alerts.js`) there,
and copy the enumerated public sources into its root-owned `source/` directory. Protected source
and test hashes must match this trusted copy. Keep model configuration in root-owned mode-0600
`/etc/sigil-self-healing.env`, containing only the selected model endpoint, model, keys and worker
settings; never load arbitrary environment variables from an agent-writable file into a root
service. The agent and supervisor both run as the unprivileged game user. Match service paths to
your installation. Curl receives credentials and prompts on stdin; tests receive a minimal
environment. No general sudoers grant or additional coding CLI login is needed.

With `SELF_HEAL_AUTO_DEPLOY=1`, passing patches enter a separately journaled deployment. It
rechecks the complete source baseline, defers human pauses/maintenance/reloads, pauses controls,
backs up only the changed allowlisted modules, stops the agent/supervisor, replaces files with
fsync plus atomic rename, then restarts both services. Existing tests are never deployed as model
changes. Git is never committed/pushed/reset/cleaned by the worker. Without the flag, candidates
remain at **READY_REVIEW**. Enabling it later revalidates pending candidates before deployment.

Success requires a ten-minute canary, checked every five seconds, with a new process boot ID,
the exact expected build, fresh HUD observations, progressing cycle timestamps and sufficient
continuous healthy samples. Runtime errors abort immediately; startup has a 45-second grace for
normal initialization. Invalid/stale heartbeats, UI Safe Idle, invalid positions, death or another
agent restart trigger rollback once initialization has completed. This checks observed runtime
health; it cannot prove every gameplay decision correct or guarantee improved EXP/rank.

Enable `sigil-self-healing-guard.timer` alongside the worker. The independent five-second guard
also rolls back a worker lease older than 25 seconds, recovers journaled partial installations
after a reboot, and keeps watching the last committed build for later regressions. Explicit
operator source changes supersede the previous guard. Pauses, known game maintenance, login and
expected browser reloads defer post-canary checks. Rollback restores only matching before/after
file hashes, preserves unrelated files and verifies that a new process started with the original
build; the original UI bug may still exist. A rejected patch is quarantined for 24 hours. Three
failed rollback attempts stop automatic retries and generate an urgent operator alert.

Root-owned status projections in `/run/sigil-self-healing/` contain only event metadata. Telegram
reads deployment results directly, so successful updates and rollbacks reach its persistent
outbox even when the supervisor is down. Success is announced only after the canary; rollback
failure has its own urgent alert. No raw DOM, errors, source, prompt or credentials appear in
notifications. Private journals and original backups remain in `/var/lib/sigil-self-healing`.

The authenticated read-only dashboard polls `/self-healing.json` every five seconds. Its
Self-Healing card shows the deployment phase, the running build's SHA, changed module names,
canary progress and the latest 30 repair/deployment events with Bangkok timestamps. Version
labels require a fresh agent heartbeat matching the journal's expected build: an uncommitted
canary, a committed patch and a confirmed restored build have separate labels. Missing/stale
health cannot establish which patch is running, while recorded history remains visible if
the agent is down. A full canary progress bar still waits for the coordinator's confirmation.
Empty history is shown explicitly. Only allowlisted public metadata is served; journals,
backups, source contents and credentials are not exposed. Optional `SELF_HEAL_STATUS_FILE`
and `SELF_HEAL_REPAIR_FILE` select the public projections for another installation.

A separate **ISOLATED TEST** card appears when a root-owned end-to-end report exists at
`/var/lib/sigil-self-healing-reports/e2e.json` (`SELF_HEAL_TEST_FILE` can override this).
`/self-healing-test.json` uses the same authentication and read-only route restrictions.
It displays the simulated process's canary, deployment/rollback events, test checks and
Telegram message receipts without adding them to live deployment history. A passing report
requires a complete ten-minute canary, confirmed original-build restoration, both distinct
Telegram receipts and evidence that the production process/build stayed unchanged. Completed
reports remain visible as historical results; unfinished stale reports cannot imply success.

`sigil-self-healing-check.timer` runs a separate daily exercise at 07:00 Asia/Bangkok, with
persistent missed-run handling. Install `self-healing-check.js` beside the trusted root coordinator,
add its reviewed public sources/tests to `source/`, create root-owned private
`/var/lib/sigil-self-healing-e2e` and public `/var/lib/sigil-self-healing-reports` directories,
and enable the timer. The service mounts production files read-only, uses low CPU/I/O priority,
and restricts writes to those test/report directories. Fixtures stop/start only their verified
mock process, never the live agent. Baseline/candidate tests run through the existing OS sandbox;
a distinct guard process checks every five seconds and verifies a real ten-minute canary,
post-commit error detection and original-build restoration. Test notification routing is checked
locally without sending successful-update or intentional-rollback messages. The normal Telegram
observer queues only finalized unexpected test failures and retries them using its durable
outbox; no recovery/success message is generated for this exercise. Its failure receipt appears
on the dashboard after Telegram acknowledges delivery. Production deployment alerts keep their
existing behavior.

A root-owned daily ledger permits at most one exercise per Bangkok calendar date, including
failed/interrupted runs, and an atomic process lock prevents overlap. A stopped/timed-out service
finalizes an unfinished report as failed; after a host reboot the next run also reconciles any
unfinished ledger record. The dashboard retains the most recent 30 daily results and shows the
next scheduled run. The completed manual test format with real Telegram receipts remains supported;
quiet daily results instead require evidence that both expected test messages were suppressed.

The dashboard separates the HUD's current online population from the overall level leaderboard;
a leaderboard rank is never capped by the online count. The table may display only its leading
rows, so the displayed row count is not a total account count. Combat cards show the game's own
**Gear Power** equipment score and the displayed MATK/ATK/DEF/MDEF/HP/ASPD totals. They do not invent
a combined combat-power formula or add equipment bonuses a second time. The agent records these
only from the visible self-character Bag/Gear screen during ordinary observation, then keeps the
snapshot after the panel closes. Time/level labels identify cached observations; unknown or
other-character data stays blank. Reading statistics never opens or leaves a panel on screen.

`SIGIL_POWER_PROGRESSION=1` adds character development alongside leaderboard farming. Earned
stats/skills cannot starve behind town work. The optional controller accepts expiring companion
offers, summons a pet, feeds owned treats, verifies eligible evolution, inscribes and equips
Mage-line runes, upgrades collected duplicate cards, uses owned food/Focus Tonic, and checks
free skill evolutions and rewards. Each short transaction closes its panels and verifies the
rendered result. Rune prices come from public definitions and must match the current UI.

Wings are a separate class slot: the first Mage wing needs mined materials and boss trophies;
its second stage has a High-class and level requirement. Missing mining materials queue bounded
five-minute gathering trips starting at the character's **life-skill** tier. Node navigation reads
only narrow public scene coordinates and uses normal pointer/keyboard input. Required bosses
must be alive on the native board and at least 15 levels below the character before an automatic
trial. Trips return to the saved leveling area on timeout, low health or low potion supplies.

Town forging can improve secondary gear while leveling. It keeps a gold reserve, caps a visit
at 12 steps / 150,000 G of refinement spending, equips newly crafted pieces, and checks eligible
enchant grades and Tier II wing stars. Refinements that can lose a level require the game's
protection. Crafting a ready wing has priority over other ready secondary crafts. Gear rarity
colour describes options/card slots, separately from equipment tier; a blue Tier 5 piece is not
evidence that it is obsolete. The dashboard shows development history, companion/rune snapshots,
life-skill observations and the remaining wing recipe. Locked systems are requirements to work
toward, not successful upgrades. There is no real-money purchase or account-setting workflow.

When the configured model is available, a bounded development review also checks less common
solo systems such as earned supply boxes, cooking, pet league and spare-pet breeding through
the existing typed UI tools. Reviews run at most every two hours, or after a newly reached
five-level bracket/class with a 15-minute cooldown. The deadline persists across restarts.
Survival, bag/potion emergencies, active trips and UI recovery retain priority; reviews preserve
the elite companion, useful equipment, wing materials, gold reserve and farming destination.
