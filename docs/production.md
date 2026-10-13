# 本番準備と操作の境界 — 0.3.0

販売開始前のrunbook。sandbox実接続の確認結果は末尾の2026-10-13追記を参照。初期配置の3flagはすべてfalseだが、sandbox E2E時にはAPI_ENABLED/BILLING_ENABLED=true、BILLING_VERIFIED=falseで検証した。これはlive開始の承認・実行を意味しない。live商品/価格/Webhookと正式条件、live設定・提供導線の確認を終えるまで販売しない。

## 配置経路

- 無料の説明・合成デモ・OpenAPI・利用条件下書きだけは、[単一Dashboard bundle](../public/dashboard-demo-worker.js)を既存商品WorkerのEdit codeへ貼る。[手順](dashboard-publish.md)。binding/secret/migrationなし、/v1/*は常に503。親PC担当が商品placeholder URLとFree accountを確認済み。
- 本体は `wrangler.jsonc`。account_idを既存accountへ明示し、Worker名 `recalm-api-cost-check`、binding `ACCOUNTS` → `AccountMeter`、`exports.AccountMeter={type:"durable-object",storage:"sqlite"}`、assets binding `ASSETS`。現行exports方式をWrangler 4.149.0 dry-runで検証した。旧migrationsと混在させない。
- 初回SQLite namespaceはclass exportとdeployment configで作成される。Dashboardの未作成namespace選択欄だけでは作成できない。既存商品Workerへのdeployなら、そのWorker限定のWorkers Editorが最小。新WorkerをWranglerから作るproduct-level Adminを避け、既存Dashboardで先に商品Workerを用意する。DO/KV/Zone専用権限は不要。wake/Gmail/ops Workerは変更しない。
- この作業環境のWranglerは未認証。新tokenの作成は親の別承認後のみ。CF deploy tokenは対象api repoのActions repository secret CLOUDFLARE_API_TOKEN、Stripe/HMAC/hash registryはWorker Secretへ直接入力し、チャット・GitHub・PC操作記録に貼らない。

## 起動前の設定

[Billing handoff](billing-handoff.md)に操作allowlist、sandbox識別子、必要scope、webhook種類を記載。これ以外のprice/payment-link/plan/metronome/PayIntent統合を増やさない。

- Secret: STRIPE_RESTRICTED_KEY (`rk_test_` / `rk_live_`, mode一致)、STRIPE_WEBHOOK_SECRET、STRIPE_METER_WEBHOOK_SECRET（snapshotとは別）、FINGERPRINT_SECRET（256-bit以上ランダム、base64url43..128文字）、CREDENTIALS（SHA-256 hex → account/enabled/expiresAt/maxMonthlySuccessfulCalls）。顧客keyは256-bit以上のbase64url、平文をregistryに保存しない。キー生成・発行は別承認。
- 通常vars: STRIPE_MODE、STRIPE_ACCOUNT_ID、STRIPE_PRICE_ID、STRIPE_METER_ID、STRIPE_EVENT_NAME、TERMS_VERSION=2026-10-13、PUBLIC_BASE_URL（HTTPS originのみ）、BILLING_ACCOUNTS（account→専用customer、重複なし、最大32件）。Workersの1変数5KiB上限に収まる少人数で始める。
- 同じaccountの全顧客keyに同じ契約cap（最大1000）・停止条件を適用。解約はDOのaccountを止め、既存keyの結果再取得/billing確認は期限内で可能。完全失効は全registry keyをdisabledにする。
- API_ENABLED=falseのまま初回SQLiteとschema、secret/mode/object一致を確認。設定欠落はCheckout/利用/webhook/精算すべてfail closed。test modeはVERIFIED=falseのまま承認済みsandbox試験を開始でき、live modeではVERIFIED=trueが必要。
- 最小tenantモデル: API専用Stripe customer、cash balanceなし、初期invoice balanceゼロ、既存subscription/invoiceなし。1 account/1 contractだけ。自動キー発行、一般の複数商品customer共有、再加入の自動移行は初版対象外で手動確認する。
- Stripe Dashboardのterms URL/連絡先/販売者表示/税込価格と、公開したtermsページを一致させる。Hosted Checkoutは利用条件同意を必須とするが、このrepoの条件は未発効の下書き。残る保持・返金・責任等の条件を確定してからBILLING_VERIFIEDを立てる。

## 必須の実接続検証

1. Sandboxのprice/product/meterと専用customerを用い、Hosted Checkoutで保存済み支払方法とsigned completionを確認する。success pageだけでは利用可能にしない。動的支払方法を使い、直接カード/PANを扱わない。
2. 初月の部分期間、翌UTC月1日00:00:00（日本時間09:00）更新、月末直前session expiry、invoiceの期間とreceipt timestampを確認する。元の加入時刻へanchorがずれる、初月usageが無料扱いで消える、meter集計範囲が合わないなら有効化しない。
3. 49円→翌月1円で50円回収、49円繰越＋新規951callで合計1000停止、前月50円以上未回収/不明では月替わり後も停止、回収済み署名webhookでだけ減額する。carryをlocal ledgerへ足し直さない。
4. 署名HMAC/300秒、duplicate/out-of-order events、非同期Checkout成功/失敗、past_due/unpaid/incomplete/paused/解約、無効key/期限切れを検証。契約状態leaseは最大300秒で、期限後は最新subscription確認に失敗すると閉じる。Webhookが届くまでの遅延をゼロとは保証しない。
5. 処理完了後のRPC/ネットワーク応答喪失を検証し、503を無料確定と表示しない。同じkey/bodyを再送して増分0を確認。本文・結果・webhook本文・キー値がログ/永続storageへ出ないことを確認する。
6. outboxのack前/後のcrash、quota、Stripe 429/5xx、23時間経過、meter async errorを確認。unknownを時刻リセットして再送しない。invoice.createdがauto_advance=falseに止まること、他receiver/Stripe grace設定が未検証invoiceを先に回収しないことを確認する。receipt送信/Stripe集計/数量/金額の不一致は利用・請求を保留する。
7. 解約受付時の即時停止、meter集計待ち、invoice_now=true/prorate=false、最終49円のcarry相殺、50円以上の最終回収を確認。外部送信不明はholdにし、既存有効keyの結果再取得とbilling表示に二重課金がないことを確認する。
8. WorkerとDOを実アカウントでprofilingする。最大16KiB/各40件/40段retry、cold/warm、並列、保管receiptが増えた場合もWorkers Free CPU10msに適合することを確認。Node benchmarkやplaceholder p99 0.82msは本体の証明ではない。超過するならサイズ/件数を狭め、OpenAPI/テストを合わせる。plan upgradeは承認されていない。
9. Cloudflare Free quota/保存量/共有負荷、決済約4.3%の運用前提、販売者開示請求の受信/購入前返信、請求書表示、解約後保持・返金・障害訂正を確定する。本番設定と提供導線を通してからflagsと販売表示を有効にする。

## 復旧と保持

receipt/Webhookは各100,000/accountまで保持し、自動TTL/evictionしない。Checkout試行は20/accountで安全停止。本文・結果は再計算用に保存しない。索引を付けて旧receiptの全件走査を避ける。

namespace/HMAC/algorithm v1を変えない。旧開発schemaはreceiptを保持した加算的migrationを行い、時刻/請求先不明な記録をholdにする。解約後の削除は契約保持期間と精算/重複保証を解決してから、全keyを永久失効して行う。

storage rollback/PITRでreceipt・outbox・settlementが巻き戻ると外部送信と一致しなくなる。**復旧時は3つのflagをfalseにし、Stripeとの突合まで自動再開しない。** 23時間を越えた不明送信を再実行せず、請求を保留する。アプリだけでStripeの永久重複保証を仮定しない。

公式根拠: [Workers Free CPU/quota](https://developers.cloudflare.com/workers/platform/limits/)、[SQLite DO Free](https://developers.cloudflare.com/durable-objects/platform/pricing/)、[exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)、[Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/)、[DO permissions](https://developers.cloudflare.com/workers/authorization/durable-objects/)、[transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync)。2026-10-13確認。

限定認証設定の承認後の操作順は[sandbox-activation](sandbox-activation.md)。deploy tokenは実行環境の安全注入欄、Stripe/署名/HMAC/hash registryはWorker Secretへ入力し、混同しない。


## 2026-10-13 確認済みsandbox実績と本番切替の設計案

これは未発効の運用準備記録。ライブ設定・公開条件・credentialを変更する手順の実行記録ではない。追記前のbranch headは `dc481500de1c4d22240d2f7d989f165825e221eb` と一致した。本体の再配置は行っていない。

### 確認済み実績

対象はリカームサンドボックス `acct_1TqptzD1AvIZkMfK`。承認済み税込1円、月次後払い、50円未満繰越、解約時50円未満免除、月1000円と未精算総額1000円停止を維持した。

- Worker E2E: 専用合成customerのCheckout完了、対象Webhook 200、成功1回の計量、同一key/本文retry増分0、変更本文409、meter受付とinvoice数量1を確認。既存cancel workflowを1回実行し、Stripe canceled・最終invoice数量1/回収0、既存自動処理の−1円adjustment/Stripe balance0、API未精算0/回収0/免除1を読み戻した。
- [成功・retry・conflictの実行](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38420958389/job/115377821874)、[解約実行](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38422369133/job/115382770995)、[解約後状態](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38420707095/job/115383865311)。
- Stripe境界シミュレーション: 共有test clock `clock_1UPwxMD1AvIZkMfKCptEG9gM` のready・合成customer・livemode=falseを確認して10/1 00:00→01:00 UTCへ進めた。[49円invoice](https://dashboard.stripe.com/acct_1TqptzD1AvIZkMfK/test/invoices/in_1UQ7uaD1AvIZkMfK2fFkNfV3)は数量49/回収0/customer balance49。[1000円invoice](https://dashboard.stripe.com/acct_1TqptzD1AvIZkMfK/test/invoices/in_1UQ7udD1AvIZkMfK7chQt2kI)は数量1000/InvoicePayment paid1000/balance0。
- 49円専用customer `cus_VQoavxGaZUgnF9` に公式UIからvalue1/timestamp1790816400を一度だけ送信。request `req_CPyt7BlVbyJO7L` 200、event `2a6bc90b-c403-48a4-9089-fa8eada08583`。今月数量1と繰越49/請求予定50を確認後、11/1 00:00→01:00 UTCへ進めた。[invoice](https://dashboard.stripe.com/acct_1TqptzD1AvIZkMfK/test/invoices/in_1UQ892D1AvIZkMfKTj1UnfBc)はtotal1/starting_balance49/amount_paid50/remaining0/ending_balance0、InvoicePayment `inpay_1UQ89zD1AvIZkMfKrw9AwvKm` paid50、customer balance0、clock ready。曖昧だった別50円customerのイベントは再送せず合否から除外した。
- このStripe clock試験をWorker月境界E2Eとは扱わない。Workerは実時刻を用いる。月境界・支払失敗/解約50円回収・回収後同月cap維持・更新用合成credentialのaccount共有は既存mock/注入時刻/workerdで検証した。
- [66テスト成功/失敗0・build/demo生成物一致](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38428499439/job/115404135031)。最大16KiB/各40件/40段retry chain正常処理も含む。
- 既存24時間/全デプロイ/全経路のCPU集計: Worker P50 0.99ms/P90 1.74ms/P99・P999 2.27ms、wall time P50 27.79ms/P90 138ms/P99・P999 249ms。DO CPU P50 4.09ms/P90 8.98ms/P99・P999 10.74ms。Worker139 invocations/Errors0、DO36 requests/Errors0。保存Observabilityは無効で、最大入力に紐付けた個別実環境CPU・cold/warm・保管件数増加時の実測は未完了。DOのCPU枠をWorker Free HTTP10msと混同しない。

### 限定uploaderの最小設計案（一部コード準備済み・未配置）

現行 `scripts/upload-existing-worker.mjs` はtest・3flag=falseをmetadataへ常に含めるため、live設定後の再実行でtestへ戻す危険がある。

1. sandbox経路を維持し、既存bindingのSTRIPE_MODEをPUT前に読み取って `test` 以外なら停止する。mode不明・live・通常var対象不一致で書き込まない。既存live Workerにsandbox workflow/tagが向いても、変更前に拒否する回帰を追加する。
2. 環境移行は通常のcode uploadから分け、明示したtarget mode・expected current mode・許可済み非秘密manifestを照合する。引数省略時のlive移行、失敗時のsandbox fallback、暗黙のmode変更をしない。移行の実行には別の本番開始承認が必要。
3. 通常のcode uploadはmode・既存通常vars・flagsを保持し、設定移行は別工程にする。初回閉鎖配置は明示した閉鎖flagのみ扱う。Secret/HMAC/SQLite namespaceの保持を読み戻し、値は出力しない。route/domainは変更しない。
4. live account/price/meter/event/origin/正式terms版/customer mappingを別manifestで固定する。test clock/customer/priceをliveへ流用せず、対象customer/objectのlivemodeと合成/実運用範囲を取り違えない。
5. sandboxの既存account DOをlive請求先へ付け替えない。現行stateはmode/customer/price/meter/Stripe account変更を拒否する。liveは別のaccount識別子のDO instanceを使い、sandbox台帳・HMAC・namespace/classを保持する。credential/account対応は別確認が必要。

### healthと販売表示の最小設計案（一部コード準備済み・未配置）

現行healthはtest以外を `preparing`、saleActiveを常にfalseにしていた。準備コードではlocal設定の検証を含める。準備中のstatic demoはfalseのまま、本体の設定状態と区別する。

- `saleActive` は少なくともSTRIPE_MODE=live、API_ENABLED/BILLING_ENABLED/BILLING_VERIFIED=true、承認済み正式条件版、対象を固定したbillingConfigの検証成功を満たす場合だけtrue。それ以外はfalse。healthはStripeへ回収・契約変更を発行せず、Secretや顧客一覧を返さない。
- statusはsandbox/preparing/live_enabled等の「設定状態」を返し、外部接続検証・個別契約の利用可否を保証する表現にしない。個別契約状態は認証付きbillingで確認する。
- 3flagのどれかfalse、mode/key-prefix/object/terms不一致、config欠落でsaleActive=falseを確認する。BILLING_VERIFIEDは実検証の担当確認flagで、自動的にtrueにしない。
- `TERMS_VERSION='2026-10-13'` の固定検査、公開terms、Checkout同意版、同意証跡を正式承認版に一致させる。価格・cap・未発効状態を勝手に変えない。publicの「未開始」「下書き」表示は正式発効の別承認後にのみ変更する。

### live準備の残件と本人入力

2026-10-13の別担当による独立読み取りでは、live `acct_1TqptlRUIufKFmuE` に本API用Product/Price/Webhookは未作成。既存の別商品・別サービスWebhookには触れない。live meterは、その後の本人作成報告で本API用を作成済みと確認した（event_name recalm_api_cost_check_success_v1、sum/raw/default payload）。正確IDの本人貼付と対象live mode/設定の照合は待機中であり、直接読み戻し済みとは扱わない。重複作成は不要。

本人に入力いただくlive SecretはSTRIPE_RESTRICTED_KEY、STRIPE_WEBHOOK_SECRET、STRIPE_METER_WEBHOOK_SECRETの3つを準備後にまとめて案内する。これだけで販売可能とは扱わない。live商品/価格/2種類のWebhook設定、作成済みmeterの正確ID確認、非秘密manifest、live専用customer/account/認証対応、正式条件、提供導線を別途整える。新キー生成・権限拡張・実決済は現在の準備範囲に含まない。


### 追加の安全準備コード（再配置なし）

- sandbox uploaderはPUT前の既存bindingsのSTRIPE_MODEが一意なplain_text/testの場合だけ進む。live・欠落・不明・異種binding・重複は `existing_worker_not_sandbox` でPUTゼロ。Secret値を読み取らず、既存Secret保持と読み戻しを維持する。
- `scripts/deploy-existing-worker.mjs` は `legacy_deployment_disabled_use_scoped_uploader` で直ちに停止し、`deploy-sandbox.yml` の旧jobもfalse条件で無効化した。旧Wrangler経路は使用しない。
- **古いSHA/既存sandboxタグの再実行には新しいガードは適用されない。** GitHub ActionsはそのSHAのworkflow/scriptを使う。live設定後は過去sandbox run/tagを再実行しない。新しいコードだけでは過去SHAの権限行使を止められないため、live開始前に既存deployment credentialの適用範囲・古いrunの実行権限を確認する。新しい権限やsecretを勝手に作らない。
- health準備コードはlive＋3flags=true＋billingConfigとACCOUNTS/HMAC/credential registryのローカル構造検証成功時だけsaleActive=true。これは設定状態であり、外部接続や個別キーの有効期限・契約利用権の証明ではない。Stripe通信と秘密出力を行わず、static-only demoはfalseを維持する。
- live-closed uploadは**設計のみ**。配置先が既にmode=live/3flags=falseであることを事前条件とし、mode・通常vars・Secret・SQLite bindingを保持するcode-only経路を想定する。test→live切替をuploadで行わず、target不明なら変更しない。今回はこの経路を実装・実行せず、実際のsandbox flagsも変更していない。
- 正式条件は承認後に `docs/terms-draft.md` → `scripts/build-terms.mjs` → `public/terms.html` の既存経路で生成する。未承認本文の公開・発効は行わない。


### 旧タスク文書整合の基点

`3cf745f71416d0c64598091b0fabb4880324dee6` を取得して関連文書のみを整合した。[基点CI38465298320](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38465298320)成功、70回帰と本体/ガードは保持。初回helper手順は[sandbox-save-next](sandbox-save-next.md)の過去資料として扱い、現在の再生成/上書き指示にしない。[診断と既存実証](sandbox-connection-evidence.md)を区別する。本人作成済みlive meterの正確ID確認待ち、未設定live Product/Price/Webhook、未発効規約、未設定live Secret3つを残件として維持する。
