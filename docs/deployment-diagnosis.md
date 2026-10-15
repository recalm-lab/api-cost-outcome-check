# 配置診断 — 2026-10-13、追加配置は未起動

承認済みSHA `aae8d95591cc174b9a27b01ea981d91b7568046d`へ専用tag `recalm-sandbox-deploy-20261013-01`をpushし、[deploy run38355943330](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38355943330)を実行した。test/build/生成一致/dry-run成功、実deployのDashboard metadata取得で失敗。upload/readiness成功とは主張しない。

同じ保存済みtokenによる[読み取り専用診断38356375303](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38356375303)結果:

|このWorkerに絞った操作|HTTP|
|---|---|
|service/bindings/subdomain/environment/schedules|200|
|routes/domains|403, error10000|

token値やbinding値を取得/表示せず、HTTP statusとerror codeだけを出した。tokenの一部権限は機能しており、認証全体が失敗したわけではない。権限の追加・再発行は行っていない。ops/他Worker変更なし。

## Wranglerの失敗原因

固定Wrangler4.149.0の公式配布sourceを確認すると、直前の配置元がDashboard (`last_deployed_from='dash'`) のWorkerについて設定差分を取得する。fetchWorkerConfigがbindings/routes/domains/subdomain/environment/schedulesをPromise.allで読み、routes/domains403をまとめて「Unable to fetch bindings, routes, or services metadata」とする。今回、workers.devだけのコード配置でもその追加readが発生した。

## 同じWorkerだけの公式API経路候補

[Upload Worker Module](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/)の `PUT /accounts/{account}/workers/scripts/{script_name}` は公式APIで、metadataにSQLite `exports` と `keep_bindings` を指定できる。必要なwriteはWorker script writeで、route/domain APIを操作しない。この経路の実token PUT権限はまだ未検証。追加route/domain権限が必須とは現時点で判断しない。

候補のreviewable実装:

- `src/inline-worker.js`:既存API/AccountMeterをそのまま使い、説明/OpenAPI/合成デモを同じmoduleへ閉じ込める。ASSETSの新規アップロード工程を避ける。全3flagfalse、STRIPE_MODE=test。
- `wrangler.inline.jsonc`:既存Worker/account限定、同じSQLite exports/ACCOUNTS。route/custom domain/他resource指定なし。
- `scripts/upload-existing-worker.mjs`:既存serviceとbinding形状を確認し、未知のresource bindingがあれば停止。公式multipart PUTだけでcode/bindingを更新する。既存secret_text/secret_key/plain_text/jsonをkeep_bindingsで保持し、Secret名の保持をpost-checkする。値/HTTP headers/bodyは出力しない。
- `.github/workflows/deploy-scoped-sandbox.yml`:候補専用tagだけで発火し、test/build/dry-run→target-only PUT→3flagsfalse readinessの順。**最新の指示によりこのtagは作成・pushしていない。**

inline bundle dry-run成功:133.98KiB/gzip26.61KiB。ランタイム試験で同じAPI/DOとstatic pagesが動き、3flagsfalse・有料route503を確認。readinessも各flag有効/欠落/stringを拒否する。関連4test成功。これらは本番CF upload/CPUの実測ではない。

## 次の判断

親の確認後にのみ、この候補のレビュー済みSHAへ新規scoped-deploy tagを作る。既存tokenで公式対象Worker PUTが成功すれば追加権限は不要。拒否されたら操作/HTTP/error codeを報告し、個別Worker承認範囲を越える権限を勝手に追加しない。旧Wrangler deploy tagを同条件で再実行してもroutes/domains403は解消しないので、現時点では再起動しない。

配置後のStripe疎通には未設定の署名secret・HMAC/hash registry・専用sandbox customer/非秘密vars・クライアントtest keyが必要。安全な入力手順はsandbox-activation.mdを使い、保存済みStripe keyをrepo/ログへ移送しない。

## 2026-10-15: isolated initial deployment safety review (not executed)

The initial multipart script PUT is no longer used for the isolated target. Unspecified workers.dev and Version URL settings can default to enabled ([official default behavior](https://developers.cloudflare.com/changelog/post/2025-10-23-preview-url-default-behavior/)). Disabling them after uploading the bundle would leave an exposure window for the bundled draft terms.

The reviewed replacement uses the [Create Worker API](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/methods/create/) to create a code-free Worker with `subdomain.enabled=false`, `subdomain.previews_enabled=false`, observability/logpush disabled and no tail consumers. It verifies identity, disabled URL settings and no custom-domain references before uploading any code. The [Create Worker Version API](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/create/) accepts `deploy=true` and SQLite `exports`; it carries version configuration without changing Worker URL settings. After deployment, metadata must still show both URL settings false, no routable version URLs, the closed flags, fresh SQLite namespace and exact active version. No public `/health` or terms fetch, route/domain registration, URL enabling, authenticated API or Stripe request is made. Unknown metadata, name conflicts and 401/403 stop without legacy fallback or permission expansion. This is preparation and synthetic verification; the deployment tag has not been pushed.

Network diagnosis: normal sandbox execution returned access denied for `Resolve-DnsName github.com` and Git name-resolution failure. The same read-only operation through the standard approved `require_escalated` execution succeeded, followed by a normal branch push and successful CI runs [38739305889](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38739305889) and [38739312808](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38739312808). No DNS, VPN, proxy, security or authentication settings were changed. A normal-sandbox access denial must not be reported as proof of a general PC/network outage; the earlier approved-path DNS timeouts were separate observed failures.
