# Optional model relay

Authenticated relay for an upstream you are authorized to use. The caller must present
`x-relay-key`; only the configured model is forwarded. No real keys or deployment URLs are included.

```bash
cd cloudflare-worker
npx wrangler secret put META_API_KEY
npx wrangler secret put RELAY_KEY
npx wrangler deploy
```

Set `ALLOWED_MODEL` and `UPSTREAM` as non-secret Worker vars if changing the defaults.
Point the agent's `AGENT_BASE` at your Worker's `/v1`, set `AGENT_RELAY_KEY` privately,
and use the same `AGENT_MODEL` as the Worker's allowed model.
Public `/health` is read-only. Treat the relay URL and shared secret as private deployment data.
