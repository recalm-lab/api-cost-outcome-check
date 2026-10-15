# 最小Billing Meters連携 — 実装済み、実売は未有効

最新のキー作成案とDashboardで未確定のsubresource権限対応は [2026-10-14再開確認](launch-readiness-2026-10-14.md#キー作成前の承認案)を参照。閉鎖用はRead4項目だけとし、以下の機能別scopeを、そのまま実証済みRAK権限名と扱わない。

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

## 2026-10-15 同意版保全と申込期限の実装

独立レビューで4009896のHTTP経路に版切替・Webhook前解約・共通URL・請求保留解除の不足を確認し、test/review-http.test.js の5ケースを対象SHAで失敗再現した。以下は追加修正後の実装で、正式条件の承認・公開・デプロイを意味しない。

現行TERMS_VERSIONは新規申込だけに適用する。既存申込は同じkey/bodyのHMACと保存済み版で再送し、既存契約の利用・解約・通知・文書取得は現行版の変更/欠落から独立させる。新規旧版申込や未登録版は拒否する。本番の文書はsrc/terms-registry.jsのレビュー対象レジストリに限定し、現在は空。環境変数から本番承認を作れない。testモードのTERMS_DOCUMENTSだけが明示した合成文書を使用できる。test-onlyやdraftを本番承認へ昇格しない。

各文書はversion/body/sha256/status/urlを対応付け、SHA-256をUTF-8の正確な本文から検証する。表示先は /terms/{version}/{sha256}.html のみ。本文欠落・改変・URL不一致では新規申込を止める。申込前にterms_documentsへ版・本文・ダイジェスト・状態・URLを保存し、同版の上書きを拒否する。actionsの版/ダイジェスト/表示URLも固定し、Stripeの版/ダイジェストmetadataと一致させる。旧文書は現行設定から削除されても認証付きGET /v1/termsで保存本文を再取得・検証できる。公開済み版のレジストリentryは保持し、新版は別entryに追加する。scripts/build-terms.mjsが上書きする /terms.html は下書きプレビューだけで、Checkoutは参照しない。今回、草案の正式化や版別公開ファイル作成は行っていない。

利用開始前にSessionを再取得し、customer/mode/契約/完了・支払状態、`consent_collection.terms_of_service=required`、`consent.terms_of_service=accepted`、版metadata、作成/失効時刻を照合する。subscription通知が先でも同じ検査を通す。根拠は[Stripeの同意確認仕様](https://docs.stripe.com/payments/checkout/custom-components?platform=web&payment-ui=embedded-page#collect-a-terms-of-service-agreement)。契約別consentsの保存とcheckoutCompleteは同一transaction。版/URL/Session作成時刻/初回verifiedAtを保存し、再送で上書きしない。verifiedAtは受信側の初回確認時刻で、利用者の正確な同意時刻を意味しない。Session本文・カード・住所・IPは保存しない。

新規利用は同意証跡と本文検証も必須。旧台帳は本文/ハッシュを推定補完せず閉じ、既存receiptの同一再取得は追加計量しない。旧sandbox台帳も勝手に移行/削除しない。保存済みCheckout URLは失効秒以降返さず、pending申込も同じ境界で再送を止める。保存済み申込があればWebhook到着前・subscription ID未特定でも解約意思と最初の受付秒を保存する。202のusageStopped/settlementPendingは受付状態で、Stripe解約完了ではない。契約未特定では解約API操作を送らず、後続通知で照合してから精算へ進む。受付後は同一keyのCheckout URL返却も拒否し、遅延/順序逆転/再送/再起動でも新規利用を再開しない。

subscription通知が先なら同意確認ができても初期collectionHoldを維持し、/billing.active=false・/check=503。後続の支払条件を満たすCheckout確認が揃った場合だけ初期保留を解除する。手動照合・未払いinvoice・pendingInvoice・解約・請求不一致の保留は解除しない。state.activeだけで利用可能と判断せず、実HTTPのbilling/checkで検証する。

初回契約IDの確定前に、保存済み申込の文書対応を確認した上でSession GETが一時失敗した場合、またはSessionのID/顧客/mode/契約対応が一致してunpaidの場合だけ、初回Checkout確認待ちとして区別する。subscription通知を再送できても、その後の正当なpaid/no_payment_required Checkout通知と既存の同意・商品・顧客照合が揃うまで新規利用を許可しない。invoice通知内の確認失敗はこの回復扱いに含めず、請求・手動照合・解約の保留を維持する。

invoice_holdsは請求IDごとに未解決理由だけを保存する。既知のcollection_pendingだけを、そのinvoiceの検証済みpaid処理と同じtransactionで解消する。別invoice・照合不一致・不明な支払状態の保留は消さず、残る保留/未払い/別pending invoice/手動照合/解約を確認する。初回0円paid invoiceはCheckout通知の代わりに利用権を付与しない。異常保留の自動解除や手動解除APIは追加していない。HTTP回帰でunpaid→paid、一時GET失敗→正常、別原因保留、SQLite再開、複数請求の個別解消、初回Checkout確認前後を検証する。

合成テストは版不一致/同意欠落/旧申込、保存失敗・通知再送、SQLite再オープン、Webhook前解約、応答喪失時の固定params、失効秒/UTC月境界、版切替の実HTTP、同版本文改変/表示URL不一致、通知順序と各保留を対象とする。正式本文の承認・版別登録、Dashboard表示との一致、正確な同意時刻を必要とするか、保存期間、実sandboxでの新metadata/同意フィールド検証は残る。法的有効性、本番署名・権限・CPUの検証完了を意味しない。本番設定・販売停止・権限は変更していない。

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


## 2026-10-14 閉鎖コード実装の更新

[live-closed手順](live-closed.md)に既存live-closed Workerへのコード専用uploader、署名付き通知での読み取り専用catalog確認、API別の最小権限、現在の配置/設定/規約の残件をまとめた。旧記述の「3flag=falseでは署名確認できない」はこのブランチでは解消した。実配置・Secret保存・本番Webhook作成は未実施で、現Workerのtest→live切替はuploaderの範囲外。既存sandbox E2Eの完了証跡はresumption-statusを参照し、過去の未実行記述を現在の結論に使わない。
