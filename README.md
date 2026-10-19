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
