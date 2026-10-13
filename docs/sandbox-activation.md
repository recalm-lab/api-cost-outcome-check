# 承認済みsandbox接続 — PC設定担当への実行表

対象は**既存recalm-api-cost-checkだけ**。本番Stripe請求を有効にしない。初回は最新版branchから本体を配置する。static Dashboard bundleは実APIではなく、secretを入力してもAPIへ切り替わらない。

## 非秘密値（通常vars）

[deploy/sandbox-vars.json](../deploy/sandbox-vars.json)は初期値の完全な対応表。全有効化flagはfalse、STRIPE_MODE=test。次の値は秘密ではない。

|設定名|値|
|---|---|
|Cloudflare account_id|9a2e48df6882d20c2d1c4398184215a9|
|Worker name|recalm-api-cost-check|
|PUBLIC_BASE_URL|https://recalm-api-cost-check.rough-sound-e8d7.workers.dev （末尾pathなし）|
|STRIPE_MODE|test|
|STRIPE_ACCOUNT_ID|acct_1TqptzD1AvIZkMfK|
|STRIPE_PRICE_ID|price_1UPwToD1AvIZkMfK9yFCs9xN|
|STRIPE_METER_ID|mtr_test_61VZKPnRudfS37Kdz41D1AvIZkMfK1J2|
|STRIPE_EVENT_NAME|recalm_api_cost_check_success_v1|
|TERMS_VERSION|2026-10-13|
|BILLING_ACCOUNTS|初期`{}`。専用sandbox customer作成後、`{"sandbox-e2e-20261013":{"customerId":"実際のcus_ID"}}`|
|API_ENABLED/BILLING_ENABLED/BILLING_VERIFIED|初期全false。接続試験時だけ前2つをtrue、VERIFIEDはfalseのまま|

account文字列 `sandbox-e2e-20261013` はアプリ内の識別子で、新しいCloudflare/Stripe accountではない。既存の実customer IDがまだない場合は勝手に推測しない。テスト名の新規専用customerをsandboxで用意し、その非秘密IDを設定する。既存subscription/invoice/cash balance/未精算残高のあるcustomerは使えない。

## 秘密の入力先（値を共有しない）

|設定名|安全な入力先・形式|
|---|---|
|CLOUDFLARE_API_TOKEN|**対象repo `recalm-lab/api-cost-outcome-check` のActions repository secret `CLOUDFLARE_API_TOKEN`**。GitHub Settings → Secrets and variables → Actions → New repository secretへユーザーが直接入力。WorkerのSecret・recalm-ops・一時タスク環境へ入れない。既存商品WorkerだけWorkers Editor|
|STRIPE_RESTRICTED_KEY|対象Worker → Settings → Variables and Secrets → **Secret**。承認済みsandbox限定rk_test_。本番rk_live_や通常sk_を使わない|
|STRIPE_WEBHOOK_SECRET|同WorkerのSecret。**このsandbox endpoint専用**whsec_。API keyとは別。Stripe Dashboardのendpoint signing secretからユーザーが直接入力|
|FINGERPRINT_SECRET|同WorkerのSecret。専用256-bit以上ランダム、base64url43..128文字。テスト中も変更しない|
|CREDENTIALS|同WorkerのSecret。**APIキー原本ではなくSHA256 hex→認証設定のJSON map**。次の構造を使う|
|RECALM_TEST_API_KEY|同じapi repoのActions repository secret `RECALM_TEST_API_KEY`（クライアント側）。WorkerのCREDENTIALSにはこの原本を入れず、SHA256だけ。チャット/GitHub/実行ログへ表示しない|

CREDENTIALSの構造（山括弧は未確定の説明で、そのまま設定しない）:

```json
{
  "<APIキー原本のSHA256 lowercase hex 64文字>": {
    "account": "sandbox-e2e-20261013",
    "enabled": true,
    "expiresAt": "<UTC epoch millisecondsの数値、stringではない>",
    "maxMonthlySuccessfulCalls": 1000
  }
}
```

原本は256-bit以上のbase64url43..128文字。ユーザーの安全なローカル/vault画面内でSHA256を算出し、原本をモデルへ出さずに上記Secretへhashのみ入れる。expiresAtはテスト開始から最大24時間の**数値**。`API_TEST_SECRET`、`STRIPE_SECRET_KEY`、`WEBHOOK_SECRET`等の別名ではコードは読まない。Secretの値や環境変数一覧をcat/printenvせず、設定完了の有無だけ確認する。

## 本体配置（deploy環境側）

PC shell不要のstatic公開は従来の単一bundleを使える。本体のSQLite初回exportは承認済みWrangler deploymentで行う。deploy tokenはWorker Secretから取り出さない。GitHub repository secretへの直接入力を使えば、一時タスク環境へtokenを注入する必要はない。

1. 対象clone/branch/SHAを確認し、設定のWorker name/account_idが上表と一致することを確認する。opsには触らない。
2. 全3flagfalseを維持し、`npm ci --ignore-scripts`、`npm run build:demo`、`npm test`、`node scripts/deploy-existing-worker.mjs dry-run`（固定Wrangler4.149.0）。
3. ユーザーが上記repo secret保存を完了したら、担当者が**レビュー済みSHAを指す新規タグ `recalm-sandbox-deploy-<一意の識別子>`**を通常pushする。`.github/workflows/deploy-sandbox.yml`はそのtagのコードをtest/build/dry-runし、最終deploy stepだけにsecretを注入して `node scripts/deploy-existing-worker.mjs deploy` を実行する。通常branch pushではdeployしない。新Worker・他namespace・routes・planは作らない。初回 `exports.AccountMeter={type:'durable-object',storage:'sqlite'}` とbinding `ACCOUNTS` により、このWorkerのSQLite namespaceを作る。
4. ASSETS binding、exports/SQLite、Free plan、既存Secret維持をDashboardで確認する。`keep_vars=true`でDashboard通常varsを消さないが、config内の3flagはfalseへ戻すので**deploy後に試験flagを設定する**。秘密はWranglerの既定で保持される。namespace/HMACを作り直さない。
5. 上表の通常vars・Secret・専用customer対応を設定。現時点のTERMSは未発効下書きで販売を開かない。sandbox Checkoutのterms同意設定/URLもStripe Dashboardで確認する。
6. sandbox webhookを `https://recalm-api-cost-check.rough-sound-e8d7.workers.dev/v1/stripe/webhook` へ登録。REST/API version2026-08-26.dahliaに合わせ、billing-handoffの必須eventを選ぶ。署名secretを直接Worker Secretへ入力。
7. **sandbox試験だけ**API_ENABLED=true/BILLING_ENABLED=true、BILLING_VERIFIED=falseを設定。コードはtest modeだけ未verified試験を許す。live modeではVERIFIED=trueを要求し、今回liveには切り替えない。

## 接続後の確認順

- まずroot/demo/OpenAPI3.1をGET。全flagfalseではv1/check/checkoutは503。static bundleを本体と誤認しない。
- 未認証401、未契約check503、同意版不一致400、署名なしwebhook400を確認する。設定不備では503で止まる。403等を見ても自動でkey scopeを増やさない。
- 認証付きCheckout → Stripeの**テスト支払方法**だけを登録 → signed completion → subscriptionのcustomer/price/meter/UTC anchor/item periodsを読み取り確認する。成功ページだけで利用権を付与しない。
- 正常call1→同key/body retry増分0→異本文409→未精算1。本文をログしない。alarmでoutbox.sentとprovider meter summary1を確認する（集計遅延/minute境界を待つ）。
- 実sandboxの初月・UTC月更新・49円繰越＋951新call・前月未回収停止・50円回収・解約49円免除を検証する。テスト時計を使う場合は既存権限とAPI実装の時刻整合を確認し、過去receiptの日付/単価を書き換えない。
- WorkerとDOの実CPUをDashboard Metrics/DevToolsで記録。最大16KiB/各40件、cold/warm、並列、保持ledgerを含める。/healthやstaticのCPUは本体結果に流用しない。10ms不適合なら上限を狭め、設定/テスト/OpenAPIを更新する。
- 試験終了でAPI_ENABLED/BILLING_ENABLEDをfalseへ戻す。sandbox secretとreceiptを保持し、勝手にliveへ切り替えない。実接続結果・CPU・提供導線と残る契約条件が揃うまで販売中にしない。

## 現在の具体的な未確定事項

ユーザーの承認は得たが、target repoのActions encrypted secret保存、実際のsandbox cus_ID、hash registryの入力、同じapi repoへのクライアントテストキーencrypted secret保存、endpoint署名secret設定が完了したとの通知はまだない。WorkerのSecret欄だけではCF deployとクライアントE2Eの両方を実行できない。この入力先の差をPC設定担当と合わせてから接続する。

[Wrangler keep_vars/secrets保持](https://developers.cloudflare.com/workers/wrangler/configuration/#source-of-truth)、[DO exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)を2026-10-13確認。

準備済みの稼働確認コマンド: `node scripts/sandbox-smoke.mjs readiness` は公開GETだけ。契約成立後、クライアントキーを安全に注入し、`RECALM_SANDBOX_E2E=true` と固定の非秘密 `RECALM_SMOKE_IDEMPOTENCY_KEY`（同じ論理試験で変更しない）を設定して `node scripts/sandbox-smoke.mjs check`。このscriptはremote healthのstripeMode=testを確認し、成功call/retry/conflictだけを合成入力で検証する。キー/ヘッダー/本文/Checkout URL/支払URLは出力せず、HTTP status・増分だけを報告する。wallMsはCPU実測ではない。

## CF token保存とtag deployの確定手順

1. ユーザーがCFレビュー画面で**この既存WorkerだけEditor**を確認して発行する。モデルは値を要求/読み取りしない。
2. ユーザーが `https://github.com/recalm-lab/api-cost-outcome-check/settings/secrets/actions` のNew repository secretで名前を `CLOUDFLARE_API_TOKEN`、Secret欄へ値を直接保存する。保存完了のみ通知する。Stripe/顧客キーはここへ移送しない。
3. 担当者が最新レビュー済みSHAを確認し、タグを作ってpushする。例 `git tag recalm-sandbox-deploy-20261013-01 <レビュー済みSHA>` と `git push origin refs/tags/recalm-sandbox-deploy-20261013-01`。既存タグの移動/force pushをしない。
4. ActionsのDeploy approved sandbox Workerを確認。コードテストにtokenは渡さず、deploy stepだけで使う。secret欠落時はdeployを拒否する。logはtoken値を表示しない。出力はWorker URL/deploy IDと非秘密binding名のみ。
5. 通常branch pushやfork PRでこのdeployは発火しない。workflow_dispatchのdefault-branch制約を避け、draft branchの承認SHAをそのままimmutable tagで配置できる。default branchへの未レビューのbootstrap pushやmain mergeは不要。

このtag workflowでは実行環境の切断や別タスクへの再接続に依存せず、ユーザーの入力はrepo secretへ一度だけ。tokenはこのWorker限定なので他のops/Gmail/wake Workerへの権限を持たせない。

契約成立後のsmokeも同じrepoのencrypted secretで環境間依存をなくす。ユーザーは `RECALM_TEST_API_KEY` を同じGitHub Actions Secret画面へ直接保存し、原本のSHA256 registryをWorker CREDENTIALSへ入力する。担当者が `recalm-sandbox-smoke-<一意の識別子>` tagをレビューSHAへ通常pushすると、別workflowがtest-only remote healthを確認し、固定の論理試験キーで1回/retry/conflictを検証する。未契約や失効ではfailし、Checkout/契約作成やcard登録を自動で行わない。CF deploy tokenをsmoke jobへ渡さない。全タグでのscript nonce `sandbox-smoke-v1-20261013` を維持し、再実行でも同じ1論理callを使う。API key原本やURL capabilityをログしない。

Customer/Invoice groupsにAccount Read、Invoice Payments Read、cash balance Readが包含されるかは、sandboxの403とStripe Workbenchの**endpoint/statusだけ**で確認する。追加権限を自動選択しない。不足が判明したoperationを報告し、その最小groupだけを別確認する。API key/Authorization/カード値やWorkbench本文をチャットへ転載しない。
