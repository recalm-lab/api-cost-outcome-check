# 販売前の最小運用案 — 未承認・未発効

2026-10-14。実装正本は `src/worker.js` / `src/meter.js` / `src/billing.js`。本書は運用準備案であり、販売開始・有料契約・権限追加・削除・返金の実行承認ではない。料金、成功定義、UTC境界、上限を変更しない。[現在の本番閉鎖証跡](live-connection-2026-10-14.md)と[未発効の規約](terms-draft.md)を基点にする。

本人は一般個人・個人事業主・法人を対象とし、事業目的だけには限定しないと決定した。後から既存利用者の権利を一方的に弱めない。[消費者向け条項・申込み表示のレビュー案](consumer-terms-review-draft.md)は未承認であり、90日保持案を含む保存期間の一括承認ではない。

## 保存する情報と目的

|保存場所|コードが保持するもの|用途と削除上の制約|
|---|---|---|
|calls|Idempotency-KeyのHMAC、入力のHMAC、algorithm版、月、成功時刻、1円単価、安定Meter event ID、送信/再試行状態、invoice ID|二重計量防止・未送信照合・請求数量対応。本文・照合結果・平文のIdempotency-Keyは保存しない|
|meter / periods|累計成功数、月間数、未精算/回収/免除額|別々の1,000円上限と繰越。利用中に月間数や未精算額を消さない|
|billing|logical account、customer/subscription/invoiceの識別子、mode/catalog識別、利用/解約/保留/照合状態等|顧客と台帳を固定し、未知の残高・応答不明を保留する。顧客ごとの独立した同意版/時刻は現在保存していない。JSON blobであることを本文保存と混同しない|
|actions|Checkout/免除のidempotency識別、digest、初回試行/金額/完了状態、session ID/Checkout URL等|外部処理の再作成防止。Checkout URLは能力を持つリンクとして扱い、公開ログ/問い合わせ資料へ出さない|
|invoices / webhooks|invoice範囲/状態/回収額、event IDと処理日時|回収額と通知の重複反映防止。Webhook本文は台帳へ保存しない|
|Worker Secret CREDENTIALS|APIキーのSHA256とlogical account、有効/無効、期限、利用cap|平文APIキーは保存しない。これはStripe customer mappingとは別|

Stripe側には顧客/請求/決済情報が別に存在する。Cloudflareの標準ネットワーク・基盤メタデータも別である。入力本文を保存しない実装だけで、外部基盤全体の削除完了を証明したとは表現しない。

## 保持・削除の候補

**候補: 解約・最終精算完了・全APIキー失効のうち最後の時点から90日で、利用receiptと不要な操作/通知記録を削除対象にする。未承認・削除処理未実装。** 90日は法定期間を意味せず、問い合わせ対応の運用案。本人が別の期間を選べる。財務記録・進行中の異議/紛争・法令上必要な記録は、保存する項目と適用期間を別途決める。必要性が不明なまま全receiptを財務記録として無期限に残す方針にはしない。

削除前提は、全credentialが無効/期限切れ、解約確認済み、未精算0、未送信/応答不明のMeter/免除/Checkout操作なし、未払い/未照合invoiceなし、未解決の異議なし。`requiresManual`/holdを消してこの条件を満たしたことにしない。監査用の必要最小集計を分離し、削除対象をdry-runで確認、本人の実削除承認、バックアップ/復元時にも失効を保つ手順が必要。現在の自動削除なし/100,000receipt・100,000webhook停止を、90日削除済みと表示しない。

receipt削除後は同じnonceを新規として認識し得るため、旧キーを再有効化しない。削除済みlogical accountを再契約へ流用せず、新しいaccountを使う。利用中のHMAC Secret・namespace・accountを変更して重複保証を失わせない。

## 顧客対応とAPIキー配布

1. 販売条件と受取人を確定後、testとは異なる本番専用logical accountを選ぶ。既存sandbox DOのaccountを流用しない。再作成ではなく既存の対応有無をまず照合する。
2. 本番Stripe customerは対象account・livemode・本人対応を確認する。他商品と共有せず、既存invoice/subscription、credit/debit balance、cash balanceがないことをコード条件と照合する。新customer作成/有料契約は別承認。現在の `BILLING_ACCOUNTS={}` は変更しない。
3. APIキーの生成・平文コピー・受取人への安全な配布は本人操作。受取人確認済みの秘密共有経路を先に選び、チャット/通常メール/公開Git/ログへ平文を置かない。現 `offline-sandbox-setup.html` は初回sandbox専用で、本番キー発行/既存registry更新には使わない。本番用の生成・registry追加経路は未実装。
4. 新しいSHA256 recordを既存CREDENTIALSへ追加する。無関係なaccountのrecordを保持。同じaccountのキー更新は同じ台帳へ対応させる。expiresAtは本人指定の数値、有効capは承認済み条件内。FINGERPRINT_SECRETを再生成しない。更新差分を非秘密メタデータで比較してから本人がSecret欄へ保存する。
5. 受領を確認してから旧キーを `enabled=false` にする。漏えい時は対象キーを即停止し、同accountの再発行へ進む。解約・精算確認手段を残す順序を確認し、最後の有効キーを無計画に削除しない。新規利用停止、認証失効、最終精算は別状態として扱う。

上記は手順案。配布経路・受領確認・失効の実運用、本番customer mapping、正式条件同意の導線が未完のため、APIキーをまだ顧客へ発行しない。

## 返金・計量異議・紛争の候補

窓口は既存 `info@recalm.jp`。受付項目案はlogical account、対象UTC月、請求書ID、問題の日時、二重計上/数量/単価などの主張。入力JSON・結果全文・APIキー・カード情報を求めない。署名やCheckout/hosted invoiceの能力URLを問い合わせ証跡へ転記しない。

**候補: 台帳とStripe請求を照合し、誤計量/二重回収/誤単価が確認された分を訂正する。未回収の請求訂正と回収済み返金を分ける。** unknownという照合結果や期待した節約が出なかったことだけで、自動的に成功callを未課金へ変更する案ではない。通信障害時は同じnonce/本文retryで新規増分0という既存条件を案内する。

返金・credit・invoice訂正・紛争への回答/証拠提出は金銭/対外操作として本人承認を得る。処理ID・対象金額・根拠・前後残高だけを記録し、二度実行しない。現コードに一般返金APIはない。返金運用のためにCharges and Refunds/Disputes権限をWorkerキーへ追加しない。

受付期限、回答期限、Stripe紛争期限への対応担当、返金手段/手数料負担は未決定。無条件返金、応答SLA、成功/節約保証、責任上限を勝手に約束しない。一般個人を含む対象方針は本人決定済み。責任・準拠法・紛争条項は上記レビュー案で個別に確認する。

## 権限確認の残件を閉じる方法

保存済みRAKの編集画面を読み戻した。Accounts / Products / Prices / Billing MetersのReadだけで、他権限・表示されるConnect列はNone。編集画面を変更適用せずキャンセルした。

顧客invoice balanceは `/v1/customers/{id}/balance_transactions`。これは `/v1/billing/credit_balance_summary` 等のBilling Creditsとは別機能。[公式API](https://docs.stripe.com/api/customer_balance_transactions/create)のimmutable取引で、現在コードは解約時50円未満の検証済み残高免除だけに使う。

|未確定subresource|候補と実証方法|本番への現時点の判断|
|---|---|---|
|customers/{id} + cash_balance展開|Customers Readが候補。既存sandbox customerへのGETで、RAK拒否時のrequired permission名を採取。展開が別権限を要求するか確認|追加しない|
|customers/{id}/balance_transactions POST|Customers Writeが候補。合成sandboxの専用残高と固定idempotencyによる小額免除試験で対応を実証。これは別承認のsandbox操作|追加しない|
|invoice_payments GET|Invoices Readが候補。既存sandbox invoiceへのGETで実証。Payment Intentsは展開せずID/状態を読むコード|追加しない|
|billing/meters/{id}/event_summaries GET|Billing Meters Readが候補。既存sandbox customer・期間へのGETで実証。Billing Meter Eventsとの関係を実エラーで確認|追加しない|

既存sandbox RAKは値を取得できず、現在Workerには本番キーが保存されている。GitHubにはStripeキーのSecretは存在しない。このため現在の実Workerをtestへ戻したり、キーを別保存先へ移したりして権限試験を代用しない。[RAK公式手順](https://docs.stripe.com/keys/restricted-api-keys#review-the-restricted-keys-request-logs-for-errors-and-adjust-permissions)に従い、既存sandboxキーの安全な実行経路を確保し、未確定groupを実証後、既存本番キーの確定編集差分を提示して本人承認を得る。新キー再作成・広いテンプレート採用は既定にしない。

billingの正規署名試験は、既存通知先の「イベント配信は見つかりません」をChromeで再確認した。安全な既存通知の再送/Pingがない現状では未検証。実顧客Subscription/usage/invoice確定/決済を作って代用しない。Meterは正規Pingで検証済みだが、billing Secretの一致証明とは別。

公式Stripe CLI v1.53.1を作業フォルダへ取得し公式checksumを確認した。docs searchは401で利用不可。CLIログインや権限拡張、既存キー値の取得は行わず、公開公式資料を利用した。

## 開始判定

本人による販売対象/条件決定、保持削除実装と運用、顧客とキー配布/失効、販売用RAK、billing正規署名、本番と同互換日付の最大入力/台帳増大/CPU測定、請求シナリオの残件が揃うまで準備中。販売表示、TERMS_VERSION、3flagの有効化は別の最終承認で扱う。
