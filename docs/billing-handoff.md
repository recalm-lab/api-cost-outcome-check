# 決済担当への引き継ぎ — sandboxのみ

2026-10-13、親担当からsandbox設定完了の連絡あり。ここではStripe writeをしていません。以下は非秘密の識別子で、runtimeへの接続・本番有効化を意味しません。

|項目|sandbox設定|
|---|---|
|Account|acct_1TqptzD1AvIZkMfK|
|Product|recalm_api_cost_check_v1 (`active=false`)|
|Meter|mtr_test_61VZKPnRudfS37Kdz41D1AvIZkMfK1J2|
|Event|recalm_api_cost_check_success_v1|
|Aggregation|sum / raw|
|Customer payload|stripe_customer_id|
|Value payload|value|
|Price|price_1UPwToD1AvIZkMfK9yFCs9xN|
|Price terms|JPY unit_amount=1, tax_behavior=inclusive, interval=month, usage_type=metered, active=true|

## 最低限の接続要件

1. API credential/Cloudflare利用は別承認待ち。本番認証キー・customer key・webhook・新規OAuthは未作成。販売者情報の開示窓口運用と本番提供導線も未検証。
2. サービスaccountとStripe customer/subscriptionを一意に対応付け、本人の契約同意・請求期間・利用権開始/停止・全鍵失効を管理する。契約期間をUTC暦月に合わせるか、APIの月次計量と請求サイクルを対応付ける。現在のcapはUTC月の新規成功1,000call。繰越分を含む請求金額上限との扱いは親担当が確定し、必要ならcapを調整する。
3. 成功記録からの送信はprivateな信頼された処理で行う。永続transactional outbox/送信cursor、安定event ID、送信状態と訂正監査を用意する。入力本文や原本を送らず、customer識別子と件数だけ。現コードはprovider-neutralなUTC月次件数とreceiptまでで、exporter/送信済み状態はまだない。
4. Stripe側のevent重複排除は永続保証ではない。送信後の応答不明を、後日無条件再送してはいけない。受付記録・月次集計と突合し、不明なら請求を保留する。顧客retryはAPI receiptで再計量0にする。顧客APIの処理に同期した外部決済API呼び出しは不要。
5. 税込1円の数量計量をsandboxで突合する。50円未満繰越、解約時50円未満免除、上限停止はpriceやmetadataだけでは実現しない。請求を確定・回収する前の処理で強制し、49→翌月50、0、50、1000、月跨ぎ、同一key retry、解約時49免除/50処理、storage/外部送信障害を検証する。1円ずつの決済はしない。
6. webhookを採用する場合は別承認のsecretと署名検証、event重複管理、契約状態の一貫した停止を作る。現段階で公開のmeter送信/admin/provisioning endpointは追加していない。
7. 親担当が本番商品・価格を設定し、決済・計量・回収・停止を通して検証した後に、合意した契約条件とAPIを有効にする。sandboxの価格がactiveでも本番販売は未開始。

参考: [Stripe meter event](https://docs.stripe.com/api/billing/meter-event/create)、[Billing integration](https://docs.stripe.com/billing/subscriptions/design-an-integration)。設定の証拠は親担当の確認報告であり、この作業環境からsandboxを再検証したとは主張しない。
