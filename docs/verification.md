# Verification — 2026-10-13

Local independent checkout: `/workspace/api-cost-outcome-check`. Base main: `99a50312d9fb7e9e1e6439a46d2c6a3a00b8a830`. No edits to `/workspace/recalm-ops`; its status remained clean before/after. No production/customer keys created. No Stripe writes or purchases. No input body/results logged or persisted by application code.

## Checks

- Node v24.19.0; fixed Miniflare 4.20260730.0 using actual workerd and SQLite Durable Objects.
- `npm test`: 10/10 tests passed (19.56s). Skill's normal/retry/missing-join synthetic examples; amounts/units/estimate separation; no invented joins; deposits/balances excluded; duplicate suspicion; unknown/zero-success ratios; invalid schemas/UTF-8; concurrency; month boundary; transaction rollback; authentication/expiry/stop; persistence; exact maximum input; static assets and OpenAPI.
- 20 concurrent identical account/key/body requests: 20 HTTP 200, total new successful calls = 1.
- 12 concurrent distinct keys after one success, monthly test cap = 5: 4 HTTP 200, 8 HTTP 429. Count remains 5 after restart; original key replay increments 0.
- Same key/different valid body: HTTP 409, no increment. Invalid JSON/schema/UTF-8 and oversized bodies do not increment. Another account using the same key has a separate count.
- Direct SQLite tests verify UTC monthly reset, replay across months without increment, receipt's metadata-only schema, transaction rollback with no orphan receipt or count, and lifetime receipt safety ceiling.
- Static asset requests return the demo and OpenAPI with security headers. Demo has only three synthetic examples. POST to the static demo cannot run the operational API.
- `npm run build:demo` is reproducible: copies the same reconciliation module and OpenAPI to static assets.
- `npm audit --omit=dev`: 0 vulnerabilities; runtime dependency tree is empty. This does not certify dev dependencies or overall security.
- Wrangler 4.149.0 `deploy --dry-run --config wrangler.jsonc`: success; total bundle 12.50 KiB / gzip 4.24 KiB. API_ENABLED remains false. Static-only demo config also passed dry-run. No deployment performed.
- `git diff --check`: passed.

## CPU evidence and remaining deployment blocker

[Recorded Node microbenchmark](benchmark-node.json): 1,000 warm iterations, 16,384 UTF-8 bytes, 40 rows per array, a 40-attempt retry chain. CPU p50 0.242 ms, p95 1.282 ms, p99 2.885 ms, maximum 4.902 ms. Includes parsing, validation, reconciliation, serialization and Node hash/HMAC. It excludes Workers ingress/WebCrypto/RPC/storage, platform cold starts and account contention. These numbers **do not establish deployed Workers Free CPU <=10 ms**.

Actual workerd correctness tests pass at the maximum input. Before activation, profile Worker and DO execution on the authorized target account, including worst/cold/warm/concurrent cases; lower row/byte limits if needed. No decision to upgrade a plan is authorized.

No Cloudflare connector tools are available in this session, no CLOUDFLARE/WRANGLER environment credential names were found, and no cached Wrangler credential file exists at either standard location checked. The existing ops deployment workflow refers to Actions secrets, which were not obtained or copied. Read-only `wrangler whoami` also reports unauthenticated (no OAuth/login performed). Thus actual Workers deployment, target plan/free-quota confirmation and production CPU measurements are blocked by absence of an authorized usable Cloudflare connection. Static-only config is prepared and contains no operational API or storage.

GitHub connector confirms `push/admin` access to this public repository. Clone and Git push are usable even though this environment's `gh api` returns Forbidden. Use the existing GitHub connector for the draft PR; no OAuth or token creation needed.

Commercial conditions and seller display are reflected from explicit user approval. Real sales remain blocked on production credential approval, deployment/CPU tests, billing setup by the parent, legal/retention/refund details, seller-information disclosure operations, and end-to-end payment/entitlement/cancellation verification. No live sales URL is claimed.
