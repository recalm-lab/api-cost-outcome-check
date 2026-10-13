# 最小Billing Meters連携 — 実装済み、実売は未有効

親の指定によりBilling Meters + Stripe-hosted Checkoutを採用。Metronomeの新契約、price/product/payment-linkの重複作成は行わない。runtimeは最小のinstance-based REST wrapperで公式 `api.stripe.com` のv1へ接続し、Stripe-Versionはskillで指定された `2026-08-26.dahlia` に固定。SDK依存・独自カードフォーム・1円個別決済はない。

2026-10-13、接続済みStripeの**sandboxだけread**で以下のpriceを再確認した。価格はactive、productも最新readではactive=true。meter自体のobject readと本番設定は親担当の管理で、こちらからwriteはしていない。

|項目|sandbox設定|
|---|---|
|Account|acct_1TqptzD1AvIZkMfK|
|Product|recalm_api_cost_check_v1|
|Meter|mtr_test_61VZKPnRudfS37Kdz41D1AvIZkMfK1J2|
|Event|recalm_api_cost_check_success_v1|
|Aggregation|sum / raw（親担当の設定報告。runtimeは初回Checkoutで検証）|
|Customer payload|stripe_customer_id|
|Value payload|value|
|Price|price_1UPwToD1AvIZkMfK9yFCs9xN|
|Price read結果|JPY unit_amount=1, tax_behavior=inclusive, interval=month, interval_count=1, usage_type=metered, recurring.meter=上記ID|

## できた処理

- 招待方式の既存customer/accountに限定したHosted Checkout。customer・price・meter・mode一致を確認。line_itemsにquantityを渡さない。支払方法を登録し、明示的なterms同意を求める。
- anchorを次の**UTC月1日00:00:00のUNIX timestamp**に設定し、初月の部分期間もmetered usageとして照合。毎月同じUTC境界でAPI capと請求が揃うことを取得したsubscription itemのperiodでも検証する。
- Raw-body HMAC SHA256 + 300秒の署名時刻検証。webhookのevent IDを保存し、重複を処理済みにする。最新のStripe objectを再取得し、遅れたイベントによる状態巻戻しを防ぐ。success redirectだけで利用権は付与しない。
- 成功receipt・単価1円の未精算額・meter outboxを同transactionに保存。Stable event IDはaccountごとに異なるHMAC由来。並列call/顧客retry/同一eventの再送で量を増やさない。
- senderは1alarmあたり最大10件。送信状態・初回試行時刻・attempt数を永続化。応答不明の同じeventを23時間未満だけ同じidempotency ID/bodyでretry。それを越える、34日を越えたtimestamp、非retryable拒否、meter errorでは利用と請求をmanual holdへ停止する。期限をリセットしない。
- 月次draft invoiceをauto_advance=falseへ止める。receiptの送信済み状態、provider summary、invoiceの単価/数量/範囲、未精算額との一致を確認後finalizeする。集計のstart/endはStripeの要求に合わせてminute境界に揃える。
- invoice.paidの文字だけで入金と判定しない。InvoicePaymentのpaid + payment_intent記録を確認して回収額をidempotentに反映する。少額をbalanceへ移しただけなら未精算額は減らさない。
- 支払失敗/不一致/期限切れ/解約で新規利用停止。未精算合計1,000円を月跨ぎで維持し、49円繰越なら次月951回で止まる。50円以上の前月未回収・請求状態不明は新枠を付与しない。
- 解約受付は即時に利用を止め、outboxとStripe集計が揃ってからinvoice_now=true/prorate=falseで解約。全receipt対応とdebit balanceが一致する50円未満を同額だけ免除。50円以上は免除しない。Stripeが解約時に止める既知の未払いinvoiceの自動回収は、検証済み金額に限り再開する。
- 認証付きbilling statusに未精算/入金/免除/保留とStripe hosted invoiceの支払リンクを返す。アプリにカード入力欄はない。

## 必要最小のrestricted permissions（作成は別承認）

以下は**実装が使うAPI操作の完全なallowlist**。Stripe Dashboardの表示名がresourceをまとめる場合は、この操作を許可する最小のgroupだけを選ぶ。sandboxで403が出ても自動でscopeを広げず、欠けた操作を特定して親担当へ返す。

|Resource /権限|使用する操作|
|---|---|
|Account Read|GET /v1/account のaccount IDとcharges/payouts確認のみ。Write不要|
|Products Read / Prices Read (`plan_read`)|GET /v1/prices/{id}?expand=product。product/price Write不要|
|Customers Read|GET /v1/customers/{id}、cash_balance確認。APIはcustomerを作成しない。cash balance展開に必要なRead groupが分離されている場合はそのReadのみ|
|Customer invoice balance transactions Write|POST /v1/customers/{id}/balance_transactions。解約時50円未満の検証済みdebitだけを相殺。DashboardでCustomersに統合されている場合、その最小Write groupが必要|
|Checkout Sessions Read/Write|POST /v1/checkout/sessions、GET /v1/checkout/sessions/{id}|
|Subscriptions Read/Write|GET /v1/subscriptions（専用customer検査）、GET /v1/subscriptions/{id}、DELETE同idによる解約。新規作成はHosted Checkoutだけ|
|Billing Meters Read / Event Summaries Read|GET /v1/billing/meters/{id}、GET同id/event_summaries|
|Billing Meter Events Write|POST /v1/billing/meter_events|
|Invoices Read/Write|GET /v1/invoices（customerが新規・専用か検査）、GET /v1/invoices/{id}、POST同id(auto_advance変更)、POST同id/finalize。新規one-off invoice作成・直接pay呼出しはない|
|Invoice Payments Read|GET /v1/invoice_payments?invoice=...&status=paid。InvoicePayment作成不要|

PaymentIntents/Charges/Refunds/Products/PricesのWrite、payouts/bank/token/OAuth/webhook管理のAPI権限、Metronome/Connectは不要。Webhook endpoint作成は承認済みDashboardの別工程で、このruntime keyに管理権限を付けない。SDK税登録未確認のためautomatic_taxは有効にせず、承認済み税込priceを厳格に検査する。税務表示/登録の最終確認は販売者担当が行う。

安全な入力先は、**対象Worker Settings → Variables and Secrets → Secret型**の `STRIPE_RESTRICTED_KEY` と `STRIPE_WEBHOOK_SECRET`。sandboxとliveを混ぜない。値をチャット、GitHub、ログ、通常vars、ブラウザ公開codeへ貼らない。この作業では新key/secretを作成・取得・表示していない。

## 非秘密の設定

`STRIPE_MODE=test/live`、`STRIPE_ACCOUNT_ID`、`STRIPE_PRICE_ID`、`STRIPE_METER_ID`、`STRIPE_EVENT_NAME=recalm_api_cost_check_success_v1`、`PUBLIC_BASE_URL`（HTTPS originのみ）、`TERMS_VERSION=2026-10-13`、`BILLING_ACCOUNTS={account:{customerId}}`（専用customerを重複せず32件以下）。顧客キーregistryとHMACも別承認後にSecretへ設定する。

有効化flag `API_ENABLED/BILLING_ENABLED/BILLING_VERIFIED` は全て既定false。sandbox試験では前2つをtrueにし、STRIPE_MODE=test/BILLING_VERIFIED=falseのまま実接続を検証できる。liveではVERIFIED=trueが必要。`BILLING_VERIFIED` は以下のsandbox/live実測結果を確認してから設定する担当者の確認flagで、コードやmetadataだけで検証完了にはならない。

## 必須webhookとsandbox残件

宛先 `/v1/stripe/webhook`。署名secretはendpoint専用。少なくともcheckout.session.completed / async_payment_succeeded / async_payment_failed、customer.subscription.created / updated / deleted、invoice.created / updated / finalized / paid / payment_failed / voided / marked_uncollectibleを設定する（snapshot 13イベント）。イベントAPI versionは固定REST versionに揃える。billingが一時停止しても既存精算を完了できるよう、webhookは新規API利用flagから独立させている。

実sandboxの初月・更新・UTC境界・meter処理遅延・card登録・49→翌月50・解約49免除/50回収・失敗・署名再送・期限を超えた送信不明・rollback/復旧を通して検証する。invoice.createdのhandlerが成功したときにauto_advance=falseになったことを確認する。他のwebhook receiverによるfinalizationやStripeのinvoice grace設定も確認し、アプリ未検証のinvoiceが先に回収される設定では売らない。既存sandbox customer/署名secret/RAKを安全に入力できる手段がなく、現時点では**real sandbox Checkout/subscription/collectionは未実行**。

[Stripe meter event](https://docs.stripe.com/api/billing/meter-event/create)、[Billing anchor](https://docs.stripe.com/billing/subscriptions/billing-cycle)、[Meter summaryのminute境界](https://docs.stripe.com/api/billing/meter-event-summary/list)、[Customer invoice balance](https://docs.stripe.com/billing/customer/balance)、[InvoicePayment](https://docs.stripe.com/api/invoice-payment/object)、[解約時のinvoice回収停止](https://docs.stripe.com/api/subscriptions/cancel)、[RAK](https://docs.stripe.com/keys)。Stripe CLI 1.53.1のdocs取得はこの環境でForbiddenだったため、公式skillのreferences・接続済みStripe docs tool・公式Web docsで確認した。

限定認証設定が承認された後の正確な入力先と値は[sandbox-activation](sandbox-activation.md)を参照。CF deploy token/クライアントtest keyは実行環境の安全な注入欄、Stripe/署名/HMAC/hash registryはWorker Secret。これらは異なる入力先。


### Meter thin通知（snapshotと別の宛先が必須）

公式仕様: [イベント形式](https://docs.stripe.com/events/how-events-work)、[Meter thinイベント導入](https://docs.stripe.com/changelog/acacia/2024-09-30/api-v2-thin-events)。正しい種類は `v1.billing.meter.error_report_triggered` と `v1.billing.meter.no_meter_found`。`billing.meter.error_report_triggered` は使わない。thin通知には `data.object` がなく、snapshot endpointに混ぜられない。

sandboxの専用thin Event destinationを `/v1/stripe/meter-webhook` に追加し、上記2種類を選ぶ。その専用signing secretを本人がWorker Secret `STRIPE_METER_WEBHOOK_SECRET` に直接保存する。snapshot secretを共有しない。thin payloadはunversioned。既存snapshot 13イベントは `/v1/stripe/webhook`、version2026-08-26.dahlia、`STRIPE_WEBHOOK_SECRET` のまま。宛先作成とSecret保存は追加設定で、まだ実施していない。REST用RAKにEvents v2 read権限は追加しない。

署名・mode・event IDを検証し、error_reportのrelated_objectが設定meterであることを確認する。no_meter_foundはmeterを特定できないため全設定アカウントを保守的に停止する。通知URLはfetchしない。詳細原因・該当利用量・返金可否を推測せず、event IDと永続manual holdのみを保存する。全アカウントへの停止保存後に200、途中失敗は503で同じ通知のretryを求める。新規利用・outbox・自動finalize・cancel精算は止まり、既存成功receiptの同一retryは0円。手動解除手順は未実装で、再照合と個別の運用承認が必要。

missing/reused meter secretでは全課金経路をfail closedにする。現在公開済みSHA33c2588にはこの修正が入っていないため、販売停止flagを維持して修正版の承認済みdeploy後に2宛先を登録する。

manual hold後のinvoice.updated再送でもcancel後回収再開のauto_advance=trueを送らない。支払済み証跡は台帳へ反映するがmanual holdを解除しない。Checkout/subscription再通知も利用を有効化せず、billing statusのpaymentUrlはnullとする。自動finalize/outbox/cancel精算を含めmanual holdは自動解除しない。
