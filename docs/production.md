# 本番準備と操作の境界 — 0.3.0

現在状態は[2026-10-14の本番閉鎖接続証跡](live-connection-2026-10-14.md)。下記は時点別の準備履歴であり、live未適用/キー未保存/通知先未作成という過去記述を現在状態として扱わない。[販売前の最小運用案](sale-operations-draft.md)に残件・本人決定事項をまとめた。

初期販売は一般個人・個人事業主・法人を対象とし、事業目的だけには限定しない。既存利用者の権利を後から一方的に弱めない本人方針を採用。[消費者向け条項案](consumer-terms-review-draft.md)の承認・同意版保全・最終確認/解約導線は別工程で、対象決定を未提示条項や保存期間の承認に読み替えない。

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

2026-10-13の別担当による独立読み取り時点では、live `acct_1TqptlRUIufKFmuE` に本API用Product/Price/Webhookは未作成だった。2026-10-14にProduct/Price作成・読み戻し報告を受領した（正確IDは最新節）。本API用live Webhookは未設定。既存の別商品・別サービスWebhookには触れない。live meterは、その後の本人作成報告で本API用を作成済みと確認した（event_name recalm_api_cost_check_success_v1、sum/raw/default payload）。2026-10-14に本人から正確ID `mtr_61VZYWJ5ULlQs4CCm41RUIufKFmuE4IC` を受領した。対象live mode/account/設定の直接読み戻しは別途照合し、本人受領と区別する。重複作成は不要。

本人に入力いただくlive SecretはSTRIPE_RESTRICTED_KEY、STRIPE_WEBHOOK_SECRET、STRIPE_METER_WEBHOOK_SECRETの3つを準備後にまとめて案内する。これだけで販売可能とは扱わない。live商品/価格/2種類のWebhook設定、受領済みmeter IDの対象/設定照合、非秘密manifest、live専用customer/account/認証対応、正式条件、提供導線を別途整える。新キー生成・権限拡張・実決済は現在の準備範囲に含まない。


### 追加の安全準備コード（再配置なし）

- sandbox uploaderはPUT前の既存bindingsのSTRIPE_MODEが一意なplain_text/testの場合だけ進む。live・欠落・不明・異種binding・重複は `existing_worker_not_sandbox` でPUTゼロ。Secret値を読み取らず、既存Secret保持と読み戻しを維持する。
- `scripts/deploy-existing-worker.mjs` は `legacy_deployment_disabled_use_scoped_uploader` で直ちに停止し、`deploy-sandbox.yml` の旧jobもfalse条件で無効化した。旧Wrangler経路は使用しない。
- **古いSHA/既存sandboxタグの再実行には新しいガードは適用されない。** GitHub ActionsはそのSHAのworkflow/scriptを使う。live設定後は過去sandbox run/tagを再実行しない。新しいコードだけでは過去SHAの権限行使を止められないため、live開始前に既存deployment credentialの適用範囲・古いrunの実行権限を確認する。新しい権限やsecretを勝手に作らない。
- health準備コードはlive＋3flags=true＋billingConfigとACCOUNTS/HMAC/credential registryのローカル構造検証成功時だけsaleActive=true。これは設定状態であり、外部接続や個別キーの有効期限・契約利用権の証明ではない。Stripe通信と秘密出力を行わず、static-only demoはfalseを維持する。
- live-closed uploadは**設計のみ**。配置先が既にmode=live/3flags=falseであることを事前条件とし、mode・通常vars・Secret・SQLite bindingを保持するcode-only経路を想定する。test→live切替をuploadで行わず、target不明なら変更しない。今回はこの経路を実装・実行せず、実際のsandbox flagsも変更していない。
- 正式条件は承認後に `docs/terms-draft.md` → `scripts/build-terms.mjs` → `public/terms.html` の既存経路で生成する。未承認本文の公開・発効は行わない。


### 旧タスク文書整合の基点

`3cf745f71416d0c64598091b0fabb4880324dee6` を取得して関連文書のみを整合した。[基点CI38465298320](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38465298320)成功、70回帰と本体/ガードは保持。初回helper手順は[sandbox-save-next](sandbox-save-next.md)の過去資料として扱い、現在の再生成/上書き指示にしない。[診断と既存実証](sandbox-connection-evidence.md)を区別する。当時は本人作成済みlive meterの正確ID確認待ちだった。2026-10-14の受領記録と最新残件は次節を参照。


## 2026-10-14 live Meter ID受領と開始条件（文書のみ・未適用）

確認基点head: `7a279dc20e0cc6f0fce928c0ba30f9dc61b41f92`。70回帰とsandbox E2E・Stripe境界実績は既存証跡を再利用し、手動再実行しない。本節は非秘密の設定候補であり、test vars/Secret/デプロイ先を上書きするmanifestではない。

|候補項目|値・確認範囲|
|---|---|
|STRIPE_MODE|live（未適用）|
|STRIPE_ACCOUNT_ID|`acct_1TqptlRUIufKFmuE`|
|STRIPE_METER_ID|`mtr_61VZYWJ5ULlQs4CCm41RUIufKFmuE4IC`（本人から正確ID受領）|
|STRIPE_EVENT_NAME|`recalm_api_cost_check_success_v1`|
|meter条件|sum/raw/default payload、stripe_customer_id/value（本人作成報告。対象account/livemode/設定の直接読み戻しは別確認）|
|Product / STRIPE_PRICE_ID|`recalm_api_cost_check_v1` / `price_1UQKQ0RUIufKFmuEMN1jt6OU`。Stripe担当の作成・直接読み戻し報告を受領。本タスクは作成していない|
|origin / TERMS_VERSION / live customer mapping|正式条件・提供導線・live専用customer/account決定後に確定。sandbox対応を流用しない|

受領済みmeterを重複作成しない。価格は成功call税込JPY1、基本料/最低利用料なし、月次後払い、50円未満繰越・解約時50円未満免除、UTC月新規1000円と未精算合計1000円停止の承認済み条件を維持する。

### 実装済みと実環境未完を分ける

|項目|実装済み・既存証跡|本番開始までの残件|
|---|---|---|
|mode保護/配置|sandbox uploaderの既存mode=test事前検査、live/不明でPUTゼロ、Secret保持検査。旧Wrangler経路停止。70回帰成功|準備コードは再配置していない。live-closed code-only uploaderは設計のみ。既存mode=live/3flags=falseを保持する別経路が必要。uploadでtest→liveに切り替えない。古いSHA/tag再実行を避ける|
|health|live・3flags=true・ローカル必須設定検証成功時だけsaleActive=true。Stripe通信/Secret出力なし、static demoはfalse|外部接続・規約発効・個別契約を保証しない。正式条件の承認とTERMS_VERSION固定検査/公開表示の整合が必要|
|本番Webhook|snapshot/thin別経路、署名/時刻/mode検査、thin manual hold等を実装。sandbox snapshotの200・契約/精算実証あり|本API用live snapshot/ thin destinationは未設定。snapshotは/v1/stripe/webhook・13events・REST version2026-08-26.dahlia、thinは/v1/stripe/meter-webhook・v1.billing.meter.error_report_triggered/no_meter_found。対象live accountと2宛先の読み戻し/署名確認が必要|
|3 Secret|runtimeはmode一致restricted keyと異なる2署名Secretを要求。既存HMAC/registryは保存済みとして保全|本人が準備後にSTRIPE_RESTRICTED_KEY、STRIPE_WEBHOOK_SECRET、STRIPE_METER_WEBHOOK_SECRETへlive値をまとめて設定する工程は未実施。値を読出し/転記しない。restricted scopeと宛先の同一live account対応を確認する|
|account継続|同じ論理accountの更新用合成credentialはreceipt/月上限/解約を共有するworkerd回帰済み|同一live account内の更新は同じcustomer/契約/DOを保つ。test accountのDOをliveへ付け替えることとは別。live専用customer/新しい論理accountと有効credentialの対応、期限切れ窓口を確定。HMAC・既存namespace・sandbox台帳は維持。自動キー発行/契約移行は未実装|
|正式条件|docs/terms-draft.md→scripts/build-terms.mjs→public/terms.html生成経路あり、現在未発効|保持期間/削除・バックアップ、訂正/返金運用、責任/SLA/準拠法、支払再試行日程、キー更新/期限切れ解約/販売者開示の実運用と開始日を本人承認。未承認本文を公開/発効しない|
|性能と期間|最大入力workerd機能回帰、既存CPU集計、mock月境界・Stripe clock境界・sandbox Worker成功を区別して保存済み|最大入力に対応付けた個別実環境CPU等の未完は残る。既存成功試験をやり直して未完に代えない|

### 販売停止状態での設定準備

1. 文書上の候補/担当成果だけを集める。今回test環境・既存Secret・実行flagsを変更しない。
2. 作成済みProduct/Priceとmeterの対象live account・条件、2種類WebhookのID/宛先/対象events、非秘密mappingを確認してから、本人入力を3 Secret分まとめて案内する。3値だけで開始可能とは扱わない。
3. 実際の環境切替は別承認の設定工程とする。live-closed配置は既にlive/3flags=falseの配置先へcodeだけを載せ、mode/vars/Secret/SQLiteを保つ設計。現在のsandbox uploaderはこの目的には使用できない。
4. 現行billingConfigはliveでBILLING_ENABLED=trueとBILLING_VERIFIED=trueを要求するため、3flags=falseのままlive WebhookやCheckoutが200になるとは約束しない。閉鎖状態の署名/対象確認をどう分離して行うかと、検証後の段階的flag操作は未確定の開始手順であり、勝手に有効化して代用しない。
5. 正式条件、提供導線、確認結果と承認した開始判定が揃ってから販売表示とflagsの開始を判断する。公開募集・有料契約・実顧客請求をこの準備で行わない。


### 2026-10-14 Product/Price成果受領と次の設定項目

Stripe担当の作成・直接読み戻し報告:
- live account `acct_1TqptlRUIufKFmuE`、Product `recalm_api_cost_check_v1`、表示名 Recalm API Cost Check、unit label 成功リクエスト。
- Price `price_1UQKQ0RUIufKFmuEMN1jt6OU`: JPY/unit_amount1/tax_behavior=inclusive、month/interval_count1/usage_type=metered、billing_scheme=per_unit、meter `mtr_61VZYWJ5ULlQs4CCm41RUIufKFmuE4IC`。
- Product.default_priceは同Price。lookup_key `recalm_api_cost_check_success_jpy1_monthly_v1` はactive1/inactive0で重複なし。
- Priceのmeter関連付けのAPI読み戻しと、meter本体のsum/raw/event/payloadは別証拠。本体API直接読取りは未対応で、後者は以前の本人作成画面確認に依拠する。この文書担当は追加のProduct/Price/meterを作成しない。

次に用意するlive Webhookは、別サービスの既存endpointに追加せず本API用の2宛先を対象live accountの@selfに設定する案。まだ実行していない。

|形式|候補URL|必要events/条件|
|---|---|---|
|snapshot|`https://recalm-api-cost-check.rough-sound-e8d7.workers.dev/v1/stripe/webhook`|version `2026-08-26.dahlia`。checkout.session.completed、checkout.session.async_payment_succeeded、checkout.session.async_payment_failed、customer.subscription.created、customer.subscription.updated、customer.subscription.deleted、invoice.created、invoice.updated、invoice.finalized、invoice.paid、invoice.payment_failed、invoice.voided、invoice.marked_uncollectible（13）|
|thin|`https://recalm-api-cost-check.rough-sound-e8d7.workers.dev/v1/stripe/meter-webhook`|v1.billing.meter.error_report_triggered、v1.billing.meter.no_meter_found（2）。snapshotとは別destination・別signing Secret。thinはunversioned。runtimeはv2詳細fetchをしない|

上記originは既存Workerの候補であり、現在test設定の実環境へlive通知を送って検証してよいという指示ではない。live destination作成時は準備した閉鎖状態・宛先の分離・開始手順と順序を確認する。作成後はdestination ID、enabled/形式/@self/account/URL/event list/versionを秘密値なしで読み戻す。現状のmode不一致でliveイベントを送れば拒否されるため、配信成功を未確認のまま記載しない。

非秘密設定の候補: STRIPE_MODE=live、STRIPE_ACCOUNT_ID=acct_1TqptlRUIufKFmuE、STRIPE_PRICE_ID=price_1UQKQ0RUIufKFmuEMN1jt6OU、STRIPE_METER_ID=mtr_61VZYWJ5ULlQs4CCm41RUIufKFmuE4IC、STRIPE_EVENT_NAME=recalm_api_cost_check_success_v1。PUBLIC_BASE_URLは上記origin候補。BILLING_ACCOUNTSと有効credentialの同一論理account対応、正式TERMS_VERSIONは未確定で、空のmappingを有効設定と扱わない。これらをsandbox-vars.jsonや既存Secretへ適用していない。


## 2026-10-14 閉鎖コード実装の更新

[live-closed手順](live-closed.md)に既存live-closed Workerへのコード専用uploader、署名付き通知での読み取り専用catalog確認、API別の最小権限、現在の配置/設定/規約の残件をまとめた。旧記述の「3flag=falseでは署名確認できない」はこのブランチでは解消した。実配置・Secret保存・本番Webhook作成は未実施で、現Workerのtest→live切替はuploaderの範囲外。既存sandbox E2Eの完了証跡はresumption-statusを参照し、過去の未実行記述を現在の結論に使わない。
