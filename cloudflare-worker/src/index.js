/**
 * Sigil model relay — a Cloudflare Worker that forwards chat-completion calls to the Meta endpoint.
 *
 * Optional authenticated relay. Configure an upstream you are authorized to use.
 *
 * Security shape:
 *  - The Meta key lives in the Worker secret META_API_KEY and never travels to the VPS.
 *  - Callers must present RELAY_KEY in the x-relay-key header, so the relay is not an open proxy.
 *  - The model is pinned here as well: anything other than ALLOWED_MODEL is rejected before it is
 *    forwarded, so a compromised agent still cannot spend the account on another model.
 */

const DEFAULT_UPSTREAM = 'https://api.meta.ai/v1';
const DEFAULT_MODEL = 'muse-spark-1.3-contributor';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Liveness probe — no auth, no secrets, useful from the VPS before wiring anything up.
    if (url.pathname === '/health') {
      return json({ ok: true, relay: 'sigil-model-relay', model: env.ALLOWED_MODEL || DEFAULT_MODEL });
    }

    // Shared secret so the worker is not a public proxy for the account.
    const presented = request.headers.get('x-relay-key') || '';
    if (!env.RELAY_KEY || presented !== env.RELAY_KEY) {
      return json({ error: 'unauthorized', hint: 'missing or wrong x-relay-key' }, 401);
    }

    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed', hint: 'POST /v1/chat/completions' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'bad_json' }, 400);
    }

    // Pin the model at the relay: the operator allowed exactly one.
    const allowed = env.ALLOWED_MODEL || DEFAULT_MODEL;
    if (body.model !== allowed) {
      return json({ error: 'model_not_allowed', allowed, requested: body.model ?? null }, 403);
    }

    const upstream = (env.UPSTREAM || DEFAULT_UPSTREAM).replace(/\/+$/, '');
    const path = url.pathname.replace(/^\/v1(?=\/)/, '');
    const target = upstream + (path.startsWith('/') ? path : '/' + path);

    const headers = new Headers();
    headers.set('content-type', 'application/json');
    // trim(): a pasted secret often carries a trailing newline, which breaks the header
    headers.set('authorization', `Bearer ${String(env.META_API_KEY || '').trim()}`);
    // Forward the caller's accept header so streaming still works if it is ever used.
    const accept = request.headers.get('accept');
    if (accept) headers.set('accept', accept);

    const started = Date.now();
    let upstreamRes;
    try {
      upstreamRes = await fetch(target, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (e) {
      return json({ error: 'upstream_unreachable', detail: String(e).slice(0, 200) }, 502);
    }

    const text = await upstreamRes.text();
    return new Response(text, {
      status: upstreamRes.status,
      headers: {
        'content-type': upstreamRes.headers.get('content-type') || 'application/json',
        'x-relay-upstream-status': String(upstreamRes.status),
        'x-relay-ms': String(Date.now() - started),
      },
    });
  },
};
