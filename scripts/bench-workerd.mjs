// Local workerd + SQLite only. No real customer, key, Stripe request or deployment.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Miniflare } from 'miniflare';
import { normal } from './fixtures.mjs';
import { billingEnv, stripeMock, webhookSecret } from '../test/stripe-mock.js';

const files = ['worker', 'reconcile', 'meter', 'stripe', 'billing'];
const modules = await Promise.all(files.map(async name => ({
  type: 'ESModule', path: resolve('src/' + name + '.js'),
  contents: await readFile('src/' + name + '.js', 'utf8')
})));
const runtimeHash = createHash('sha256');
for (let i = 0; i < modules.length; i++) runtimeHash.update(files[i] + '\n' + modules[i].contents + '\n');
const token = 'synthetic_local_workerd_load_only'.padEnd(50, 'x');
const credentials = JSON.stringify({ [createHash('sha256').update(token).digest('hex')]: {
  account: 'test-account', enabled: true, expiresAt: Date.now() + 3600000,
  maxMonthlySuccessfulCalls: 1000
} });
const provider = stripeMock();
let unexpectedOutbound = 0;
const mf = new Miniflare({
  name: 'local-load-only', modules, compatibilityDate: '2026-07-30',
  durableObjects: { ACCOUNTS: { className: 'AccountMeter', useSQLite: true } },
  durableObjectsPersist: false,
  bindings: { ...billingEnv, API_ENABLED: 'true', CREDENTIALS: credentials,
    FINGERPRINT_SECRET: 'synthetic-local-load-fingerprint-only'.padEnd(50, 'x') },
  serviceBindings: { STRIPE_HTTP: provider.fetch },
  outboundService: () => { unexpectedOutbound++; return new Response(null, { status: 403 }); }
});
const input = { ...normal, tasks: [], attempts: [], bills: [] };
for (let i = 0; i < 40; i++) {
  input.tasks.push({ id: 't' + i, outcome: 'success' });
  input.attempts.push({ requestId: 'r' + i, taskId: 't0', outcome: i === 39 ? 'success' : 'failure',
    ...(i ? { retryOf: 'r' + (i - 1) } : {}) });
  input.bills.push({ ...normal.bills[0], id: 'b' + i, requestId: 'r' + i });
}
const body = JSON.stringify(input).padEnd(16384, ' ');
assert.equal(Buffer.byteLength(body), 16384);
const request = (text, id) => ({ method: 'POST', body: text, headers: {
  authorization: 'Bearer ' + token, 'content-type': 'application/json', 'idempotency-key': id
} });
const rounded = n => Math.round(n * 1000) / 1000;
const stats = xs => {
  const sorted = [...xs].sort((a, b) => a - b);
  return { samples: sorted.length, p50: rounded(sorted[Math.ceil(sorted.length * 0.5) - 1]),
    p95: rounded(sorted[Math.ceil(sorted.length * 0.95) - 1]),
    p99: rounded(sorted[Math.ceil(sorted.length * 0.99) - 1]), max: rounded(sorted.at(-1)) };
};
const timedCall = async id => {
  const start = performance.now();
  const response = await mf.dispatchFetch('https://local.test/v1/check', request(body, id));
  const output = await response.json();
  return { status: response.status, usage: output.usage, wallMs: performance.now() - start };
};
try {
  const checkout = await mf.dispatchFetch('https://local.test/v1/checkout',
    request(JSON.stringify({ termsVersion: '2026-10-13' }), 'local-load-checkout-0001'));
  assert.equal(checkout.status, 200);
  const timestamp = Math.floor(Date.now() / 1000);
  const event = JSON.stringify({ id: 'evt_local_load', type: 'checkout.session.completed',
    livemode: false, data: { object: { id: 'cs_test', customer: 'cus_test' } } });
  const signature = createHmac('sha256', webhookSecret).update(timestamp + '.' + event).digest('hex');
  const webhook = await mf.dispatchFetch('https://local.test/v1/stripe/webhook', {
    method: 'POST', body: event, headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` }
  });
  assert.equal(webhook.status, 200);
  const first = await timedCall('local-load-call-0000');
  assert.equal(first.status, 200); assert.equal(first.usage.billableCalls, 1);
  const sequential = [];
  for (let i = 1; i < 100; i++) sequential.push(await timedCall('local-load-call-' + String(i).padStart(4, '0')));
  const parallel = [];
  for (let i = 100; i < 1000; i += 20) parallel.push(...await Promise.all(
    Array.from({ length: 20 }, (_, n) => timedCall('local-load-call-' + String(i + n).padStart(4, '0')))));
  for (const result of [...sequential, ...parallel]) {
    assert.equal(result.status, 200); assert.equal(result.usage.billableCalls, 1);
  }
  assert.equal(Math.max(...parallel.map(r => r.usage.successfulCalls)), 1000);
  assert.equal(Math.max(...parallel.map(r => r.usage.outstandingJpy)), 1000);
  const blocked = await timedCall('local-load-call-over-cap');
  assert.equal(blocked.status, 429);
  const replays = await Promise.all(Array.from({ length: 20 }, () => timedCall('local-load-call-0000')));
  for (const result of replays) {
    assert.equal(result.status, 200); assert.equal(result.usage.billableCalls, 0);
    assert.equal(result.usage.successfulCalls, 1000); assert.equal(result.usage.outstandingJpy, 1000);
  }
  const oversize = await mf.dispatchFetch('https://local.test/v1/check',
    request(body + ' ', 'local-load-oversized-0001'));
  assert.equal(oversize.status, 413);
  assert.equal(unexpectedOutbound, 0);
  console.log(JSON.stringify({ runtime: process.version, engine: 'local workerd / Miniflare',
    compatibilityDate: '2026-07-30',
    runtimeFilesSha256: runtimeHash.digest('hex'), bytes: 16384, recordsPerArray: 40, retryChain: 40,
    ledgerSuccessfulCalls: 1000, concurrency: 20, outboundRequests: unexpectedOutbound,
    wallMs: { firstAfterSyntheticActivation: rounded(first.wallMs),
      sequential: stats(sequential.map(r => r.wallMs)), parallel: stats(parallel.map(r => r.wallMs)),
      replayAtCap: stats(replays.map(r => r.wallMs)) },
    assertions: { newAtCap429: true, replayAtCapAddsZero: true, oversize413: true },
    limitations: 'Local wall latency, not CPU or deployed Workers/DO quota evidence; local compatibility date differs from deployed 2026-10-01; 1000 receipts, not 100000; first call follows activation, not a cold isolate. Stripe is mocked.'
  }, null, 2));
} finally { await mf.dispose(); }
