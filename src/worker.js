import { DurableObject } from 'cloudflare:workers';
import { reconcile, LIMITS, InputError } from './reconcile.js';
import { initMeter, recordSuccess } from './meter.js';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const encoder = new TextEncoder();
async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
async function fingerprint(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
async function boundedBody(request) {
  if (!request.body) throw new InputError();
  const reader = request.body.getReader(); const bytes = new Uint8Array(LIMITS.bytes); let size = 0; let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { reader.cancel().catch(() => {}); reject(new InputError('timeout')); }, 2000); });
  try {
    return await Promise.race([deadline, (async () => {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        if (size + value.byteLength > LIMITS.bytes) { await reader.cancel(); throw new InputError('too_large'); }
        bytes.set(value, size); size += value.byteLength;
      }
      try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, size)); }
      catch { throw new InputError('invalid_utf8'); }
    })()]);
  } finally { clearTimeout(timer); }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/v1/check') {
      if (request.method === 'GET' && env.ASSETS) return env.ASSETS.fetch(request);
      return json({ error: 'not_found' }, 404);
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    // Closed by default. No production credentials are created by this repository.
    if (env.API_ENABLED !== 'true' || !env.CREDENTIALS || !env.FINGERPRINT_SECRET || !env.ACCOUNTS) return json({ error: 'not_available' }, 503);
    try {
      const auth = request.headers.get('authorization') || '';
      if (!/^Bearer [A-Za-z0-9_-]{43,128}$/.test(auth)) return json({ error: 'unauthorized' }, 401);
      const credential = JSON.parse(env.CREDENTIALS)[await hash(auth.slice(7))];
      if (!credential || credential.enabled !== true || !/^[a-zA-Z0-9_-]{1,64}$/.test(credential.account) || !Number.isFinite(credential.expiresAt) || credential.expiresAt <= Date.now()) return json({ error: 'unauthorized' }, 401);
      if (!Number.isSafeInteger(credential.maxMonthlySuccessfulCalls) || credential.maxMonthlySuccessfulCalls < 1 || credential.maxMonthlySuccessfulCalls > 1000) return json({ error: 'not_available' }, 503);
      const idem = request.headers.get('idempotency-key');
      if (!idem || !/^[A-Za-z0-9_-]{16,128}$/.test(idem)) return json({ error: 'invalid_idempotency_key' }, 400);
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'unsupported_media_type' }, 415);
      if (request.headers.has('content-encoding')) return json({ error: 'unsupported_encoding' }, 415);
      const body = await boundedBody(request);
      const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(credential.account));
      return await stub.fetch('https://internal/check', { method: 'POST', body, headers: {
        'x-idempotency': await fingerprint(env.FINGERPRINT_SECRET, 'id:' + idem),
        'x-cap': String(credential.maxMonthlySuccessfulCalls)
      }});
    } catch (error) {
      if (error instanceof InputError) return json({ error: ['too_large', 'timeout'].includes(error.message) ? error.message : 'invalid_input' }, error.message === 'too_large' ? 413 : error.message === 'timeout' ? 408 : 400);
      return json({ error: 'unavailable' }, 503);
    }
  }
};
export class AccountMeter extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.storage = ctx.storage; this.env = env; initMeter(this.storage); }
  async fetch(request) {
    try {
      const text = await request.text();
      if (encoder.encode(text).length > LIMITS.bytes) return json({ error: 'too_large' }, 413);
      const input = JSON.parse(text);
      const result = reconcile(input);
      // Hash raw body: retries must use exactly the same UTF-8 body. No body/results in storage.
      const digest = await fingerprint(this.env.FINGERPRINT_SECRET, 'v1:' + text);
      const receipt = recordSuccess(this.storage, request.headers.get('x-idempotency'), digest, Number(request.headers.get('x-cap')), new Date().toISOString().slice(0,7));
      if (receipt.status !== 200) return json({ error: receipt.status === 409 ? 'idempotency_conflict' : 'usage_limit' }, receipt.status);
      return json({ result, usage: { billableCalls: receipt.replay ? 0 : 1, replay: receipt.replay, successfulCalls: receipt.count, successfulCallsThisMonth: receipt.monthlyCount, proposedUnitPrice: { amount: 1, unit: 'money:JPY:0' }, paymentCollected: false } });
    } catch (error) {
      if (error instanceof InputError || error instanceof SyntaxError) return json({ error: 'invalid_input' }, 400);
      return json({ error: 'unavailable' }, 503);
    }
  }
}
