# Verification — 0.3.0 / 2026-10-13

Independent checkout: `/workspace/api-cost-outcome-check`. Base main: `99a50312d9fb7e9e1e6439a46d2c6a3a00b8a830`. Branch `feat/deterministic-cost-check`, draft PR #1. `/workspace/recalm-ops` remained clean. No production/customer keys, Stripe writes, OAuth changes, or purchases performed.

## Test and build evidence

- **32/32 tests pass** on Node v24.19.0 with fixed Miniflare4.20260730.0, actual workerd and SQLite. Stripe responses/credentials used by tests are synthetic, not real keys.
- Reconciliation: original skill's three synthetic examples, currency/credits/evidence separation, failed retries, unknown joins, duplicate suspicion, top-up/balance exclusions, invalid schemas/UTF-8, no HTTP-status success inference, undefined ratios, exact16KiB/40 rows/40-step retry chain.
- 20 parallel same-key/body calls:20 HTTP200, one new receipt/liability/outbox.12 distinct calls after one success under test cap5:4 HTTP200/8 HTTP429. Restart preserves count5 and original replay increments0.
- Current billing integration tests drive mock Hosted Checkout and signed completion through real Worker/DO modules. Config, consent, keys, expiry, mode, price/meter and period mismatches fail closed. Success redirect alone does not grant access.
- 49 carried plus951 new calls stops at exactly1000 outstanding. Unverified previous-period invoice blocks new calls after month boundary; no month reset of outstanding debt. Carry is not added twice.
- InvoicePayment-backed collection is idempotent. invoice.paid/minimum-charge balance movement alone is not actual cash. Canonical object retrieval handles duplicate/delayed failed events without regressing verified paid state. Different invoice IDs cannot re-invoice assigned receipts.
- Persistent sender retries accepted/lost response with identical event/body within23h; after that it holds automatically. Raw-body HMAC, multiple v1 signatures, timestamp tolerance300s and tamper checks pass. Meter summaries use minute-aligned ranges and must agree before finalization/cancellation.
- Cancellation immediately stops new usage; existing receipt replay increments0. Sub-50 waiver retries accepted/lost response once locally;50+ is not waived. SQLite rollback leaves no orphan receipt/liability/outbox. Additive legacy migration preserves every receipt, conservatively holds unknown records, and uses indexes for retained-ledger guards.
- Caller-response-loss test commits one receipt, discards response, then retrieves with same key/body:count1 and increment0.503/RPC failures are documented as potentially ambiguous, not guaranteed free.
- Static asset and single Dashboard-module tests verify demo/OpenAPI/terms/checkout-information pages, CSP and no operational/v1 route. All/v1 paths in the single module return503 without reading POST bodies. /health reports apiEnabled=false/saleActive=false.
- `npm run build:demo` reproducibly copies source/OpenAPI, generates terms and a self-contained **76,038-byte** Dashboard module. No binding, migration, secret, model, Stripe call or storage is required for that static module.
- Runtime dependency tree is empty; `npm audit --omit=dev` reports0 vulnerabilities. This does not certify dev dependencies or overall security.
- Wrangler4.149.0 dry-run succeeds for both full API and static configs. Full API uses current `exports.AccountMeter={type:'durable-object',storage:'sqlite'}`, ACCOUNTS/ASSETS bindings and all3 activation flags false; bundle53.00KiB/gzip13.60KiB. Static config has no bindings. No remote deployment from this environment.
- JavaScript syntax and `git diff --check` pass. GitHub Actions for `24e4da69fb3d03b8388ba758dd32fa1f81890041` passed (run38346572625). Latest commit/CI status is reported separately in the final outcome.

## Real connection evidence and remaining boundary

Authorized Stripe connector read confirms the existing sandbox price `price_1UPwToD1AvIZkMfK9yFCs9xN` is active, JPY1 inclusive, monthly metered, interval_count1 and mapped to the supplied meter; expanded product is active. No real sandbox Checkout/customer/subscription/meter-event/invoice/collection was created here. All integration exercise remains mock/workerd until approved secrets are entered and end-to-end sandbox checks pass.

Parent PC confirms the existing Cloudflare account is Free/current$0 and created product placeholder `https://recalm-api-cost-check.rough-sound-e8d7.workers.dev`. Parent is placing the static module. This environment's browser tool cannot fetch that URL, and local Wrangler reports unauthenticated. Static-demo completion/URL verification is therefore a parent-PC check; this document does not claim it is already deployed. New token creation is still awaiting separate approval. No ops Actions secrets were retrieved or copied.

## CPU evidence

[Node core microbenchmark](benchmark-node.json):1000 warm runs,16384 bytes,40 rows per array/40-attempt chain. CPU p50 .242ms,p95 1.282ms,p99 2.885ms,max4.902ms. Includes parsing/validation/reconciliation/serialization and Node hash/HMAC; excludes Worker ingress/WebCrypto/DO/storage/billing/cold starts/contention. **It does not establish Workers Free CPU≤10ms.** Parent's placeholder p99 .82ms is also not the API benchmark.

Actual workerd correctness at maximum input passes. After approved deployment, profile both Worker and DO on actual target hardware, including retained-ledger size and cold/warm/concurrent cases. Narrow byte/row limits if necessary. No plan upgrade is authorized.

## Launch blockers

Approved safe-input path for Worker-scoped CF Editor, sandbox restricted key, webhook signing secret and test customer/HMAC credentials; initial SQLite namespace/secret settings; real sandbox mid-month/renewal/carry/cancellation/grace/collection verification; Worker/DO CPU; final retention/refund/terms/disclosure operations; parent-owned live price/settings and end-to-end offering validation. API_ENABLED/BILLING_ENABLED/BILLING_VERIFIED remainfalse. No active sales URL is claimed.

Sandbox activation preparation: explicit test mode can begin approved E2E with BILLING_VERIFIED=false; missing verification flag and unverified live remain closed. GET /health exposes only non-secret mode/flag metadata, never proves entitlement or live readiness. Wrangler keep_vars=true preserves Dashboard vars while declared activation flags reset false on deployment. scripts/deploy-existing-worker.mjs preflights exact existing Worker/account/closed flags; scripts/sandbox-smoke.mjs requires remote test mode and safe client injection for billable test calls, never prints keys/headers/bodies/Checkout/payment URLs. At preparation time, environment credential-presence booleans for CF deployment and client test key are both false; no secret values were inspected.

CF credential destination is finalized as the target api repo Actions encrypted repository secret CLOUDFLARE_API_TOKEN, not Worker Secret or recalm-ops. Dedicated immutable deploy tags trigger the new workflow; normal push/fork PR do not deploy. Token is provided only to the final deploy step. Client sandbox smoke uses a separate RECALM_TEST_API_KEY repository secret and fixed logical test id, with no CF token in its job. No tag has yet been pushed and no secret value was requested/read.
