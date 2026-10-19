# External uptime monitor

This Worker probes your authenticated viewer independently of the VPS. It expects unauthenticated
`GET /` to return HTTP 401. Three failed checks open an incident; two successful checks recover it.
Telegram events are persisted in D1, retried after delivery errors and serialized with a lease.

Use your Cloudflare account with Workers/D1 enabled and an authenticated Wrangler CLI:

```bash
cd uptime-worker
npx wrangler d1 create sigil-uptime-state
# Put the returned database_id in wrangler.toml locally.
# Set TARGET_HOST to your VPS IP/hostname and TARGET_PORT to your viewer port.
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put ADMIN_KEY
npx wrangler deploy
```

Choose a strong random `ADMIN_KEY`. Never put secret values on command lines, into TOML,
or in Git. The scheduled check runs every minute. If the viewer only listens on loopback,
provide an authenticated HTTP listener reachable from the Worker with the same 401 behavior;
the TCP probe in this version uses plain HTTP and does not implement a TLS handshake.
Restrict public access to the viewer and use HTTPS for actual viewing.

Public `GET /health` reports only Worker liveness, not VPS health. Authenticated routes require
`Authorization: Bearer <ADMIN_KEY>`: `GET /admin/status`, `POST /admin/check`, `POST /admin/test`.
The test route sends explicitly labeled simulated down/recovery Telegram messages; it does not
stop the VPS. Do not call it unless you want those messages. Secrets and database identifiers in
your deployment should stay outside the public source tree.


Optional `GAME_HEALTH_URL` adds an independent HTTPS probe of the game's public site with a
separate D1 incident/outbox named `game`. VPS and game checks cannot overwrite each other's
incidents. Both keep the same three-failure / two-success hysteresis. `/admin/status` includes
both channels. The local agent/supervisor separately observe availability to pause/resume controls;
the external Worker sends alerts only and has no access to game control endpoints.
