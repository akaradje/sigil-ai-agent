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
