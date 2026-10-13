# 本番準備と操作の境界

## 完成したコード

- 決定論的JSON照合、厳格なschema、サイズ/件数/読み取り時間上限。
- hashed credential registry、期限/利用停止、account共通月次成功回数上限。
- SQLite Durable Objectの原子的なidempotency receipt、総回数、UTC月別回数。
- API_ENABLED=falseでfail closed。本文・結果非保存、アプリのconsole/logなし。
- OpenAPI、固定合成例の無料静的デモ、利用条件の下書き。

## 発売前の設定・検証（未実行）

1. 承認済み: 園田敏之・info@recalm.jp、住所/電話は購入検討者の請求により購入前開示、税込JPY 1/call、月次後払い、50円未満繰越、解約時50円未満免除、利用者UTC月1,000円停止。支払期日、返金/障害計量訂正とreceipt保持期間は残る。Stripeは担当者から本番read成功・charges/payouts enabledとの連絡あり。価格・商品設定は親担当が行い、ここでは重複作成しない。開示請求の受信/返信運用とStripeから提供までの導線を別途検証する。Payment Linksの従量課金対応を仮定しない。
2. 既存Cloudflareアクセスを認証し、対象アカウントがWorkers FreeでSQLite DO利用可能なこと、共有quota、配置/データ取り扱いを確認する。この環境はCloudflare認証未提供。opsのActions secretsは取得・移送していない。plan upgrade、有料資源、OAuth権限追加は禁止。
3. 静的デモだけなら `wrangler.demo.jsonc` でassetsのみを既存無料権限で公開できる。実APIもDOも含まない。実データPOSTは提供しない。必要な既存権限がない場合は公開を止める。
4. 本番secret作成・顧客キー発行には別承認が必要。承認後、256-bit以上の暗号学的乱数からbase64urlの顧客キーを発行し、SHA-256 hex digestだけをCREDENTIALS secretのmap keyに登録する。値は `{account, enabled, expiresAt, maxMonthlySuccessfulCalls}`。expiresAtはUTC epoch ms、capは1..1000。accountは1..64の英数/underscore/hyphen。鍵の再発行でも同じaccountを維持し、accountの全鍵に同じ契約cap/停止を適用する。registryは小規模用でWorkersの変数サイズ制約内にする。
5. FINGERPRINT_SECRETを256-bit以上の専用ランダムsecretとして設定する（未作成）。idempotencyと本文のHMAC用。値や顧客キーはterminal/CIログ/公開文書に表示しない。コード/configに平文を入れない。変更には既存receiptとの移行が必要。
6. `wrangler.jsonc` のSQLite DOと静的assetsを、無料プランが確認できた場合だけデプロイする。API_ENABLED=falseを維持。observability/body loggingを無効に維持する。運用の基盤ログについて契約条件を確認する。
7. 閉じた検証で最大16KiB/40件、cold/warm、連続・競合call、storage障害、quota、期限切れ/失効、restart、response切断、同一keyの異本文を検証する。CPU10msを満たすまでAPIを売らない。CPUはpayloadを出さないDevTools/Cloudflareメトリクスで測る。最悪入力が超過したら件数・サイズを下げOpenAPIとテストも更新する。
8. 実回収との照合方法を決定する。現在はUTC月の件数とreceiptのみ。請求業者への送信状態や請求額/税/回収状態は未実装。外部請求を統合する場合はtransactional outbox/安定event ID/送信済み状態/訂正監査を追加し、外部側の重複排除期間に依存せず再送を管理する。大きなMeter/Metronome統合は初版に入れない。1円の個別カード決済、未承認price/payment link/webhook作成をしない。
9. 決済から利用権付与、認証、計量、集約回収、停止/解約、訂正までの提供導線を検証し、別途承認後のみAPI_ENABLED=trueと販売表示に切り替える。

## 障害・互換性

receiptは上限100,000/ accountまで残し、TTLやevictionはしない。結果はalgorithm v1で再計算する。新アルゴリズムは旧receiptを保護し、既存keyを再課金しない移行を設計してから導入する。namespace/HMAC keyを変更・削除しない。退会時の削除は利用権を先に永久停止し、請求と監査の保持条件を解決してから行う。

復旧/rollbackでreceiptと月次回数を巻き戻した場合はAPIを停止し、請求先と突合するまで自動再開しない。成功記録確定後に応答が失われる可能性はある。同一key/body retryは新規計量0だが、再計算障害や契約失効では結果を再取得できないこともある。未確定エラーに対して請求を創作しない。

## 参照

[Workers Free CPU10ms](https://developers.cloudflare.com/workers/platform/limits/)、[SQLite Durable Objectsの無料プランとquota](https://developers.cloudflare.com/durable-objects/platform/pricing/)、[transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync)。2026-10-13確認。プラットフォームの無料quota対応は、実アカウントのplan確認の代用ではない。

運用費の目安: 決済担当の確認では通常決済+Billing合計約4.3%。返金/紛争などの追加条件は別。これは購入者に追加課金する規約ではなく、価格・回収設計の運用前提です。
