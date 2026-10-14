# 本番を閉じた状態でのコード準備（2026-10-14）

この手順はコード実装済みで、実際の配置・live設定変更・Secret保存・Webhook作成は未実施。既存sandboxの実E2Eは再実行していない。通常のブランチcommitによる自動CIは合成入力・モック通信のみを使う。

## 既存live Workerへのコード専用uploader

`scripts/upload-live-closed-worker.mjs` は Cloudflare account `9a2e48df6882d20c2d1c4398184215a9` / Worker `recalm-api-cost-check` / production環境だけを対象にする。配置先のbindingを読み、`STRIPE_MODE=live` と `API_ENABLED=BILLING_ENABLED=BILLING_VERIFIED=false` が重複のないplain_textであることを確認する。test・不明・一部true・Secret型flagではPUTしない。現在のsandboxからliveへ切り替える機能はない。

ACCOUNTSは既存のAccountMeter / namespace `0b8d1c5cea78485d9d9ae6a62ed98b6f` が必要。新規namespace、exports、migration、vars、routes、domainsを指定しない。`keep_bindings` にsecret_text / secret_key / plain_text / json / durable_object_namespaceを指定し、assetsも保持する。既存varsの内容、Secretの名前と型、namespace bindingをPUT直前と保存後に読み戻して比較する。Secret値は取得・再構築・出力しない。Cloudflare APIの同時編集をロックする機能はないため、実行中は他の設定編集を行わない。保存後の不一致はエラーにするが自動rollbackはしない。

既存のscoped inline build成果物 `/tmp/recalm-inline-build/inline-worker.js` を使う。Cloudflare deploy credentialは承認済みの実行環境だけから注入する。uploaderの追加は実行承認・実行完了を意味しない。[公式upload API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/) の保持指定に基づく実装で、mock APIでの検証済み。実際のlive uploadでの保持確認は残件。

## 署名と対象の閉鎖検証

既存の `/v1/stripe/webhook`（snapshot）と `/v1/stripe/meter-webhook`（thin）に、3flagがすべてfalseかつliveの場合だけ別分岐を設けた。新しい公開デバッグURLはない。raw本文・専用Secret・5分以内の署名・event ID・mode・13種類のsnapshot / 2種類のthinを検証する。@self用途のためaccount/contextが指定された通知は拒否し、snapshotは設定済み専用customerだけを許す。error_reportのrelated_objectは指定meterと一致が必要。no_meter_foundはmeterを特定できないため、署名と設定catalogの確認だけを示し、通知原因を特定したとは扱わない。

閉鎖分岐の対象は次に固定する。

|項目|対象|
|---|---|
|Stripe account|acct_1TqptlRUIufKFmuE|
|Product|recalm_api_cost_check_v1|
|Price|price_1UQKQ0RUIufKFmuEMN1jt6OU|
|Meter|mtr_61VZYWJ5ULlQs4CCm41RUIufKFmuE4IC|

署名確認後に `GET /v1/account`、`GET /v1/prices/{id}?expand[]=product`、`GET /v1/billing/meters/{id}` のみを呼ぶ。account一致、charges/payouts有効、live、Product/Price有効、JPY1・税込・月次・metered・per_unit（tier/quantity変換なし）、meter一致、sum・raw・stripe_customer_id/valueを読み取り検証する。閉鎖用StripeClientはこれ以外のGETや全POST/DELETEを拒否する。

成功時も **503** と `{error:"billing_closed",verification:"signature_and_catalog_verified",received:false}` を返す。200で受領確定せず、DO呼出し、台帳/event receipt保存、契約有効化、計量、invoice更新・finalize・回収を行わない。重複通知も同じ閉鎖応答。Stripeは失敗通知を再送するが、[公式の再送期間](https://docs.stripe.com/webhooks#automatic-retries)には限りがあり、この分岐はイベント保管の代用にはならない。

3flag=falseのまま、check/Checkout/cancel/billingは閉鎖、health.saleActive=false。既存の実稼働分岐は従来どおりbillingConfigの有効化条件とDOの整合性確認を必要とする。BILLING_VERIFIEDをコードや署名確認だけでtrueにしない。閉鎖検証結果は購入・請求処理の実稼働確認ではない。

## 必要な権限と安全な入力先

閉鎖検証だけならAccount Read、Prices Read、Products Read（expand用）、Billing Meters Readの4種類だけが必要。実稼働の最小範囲は以下。Dashboardの権限group名は表示を確認し、API呼出しに必要な範囲へ合わせる。

|runtime API|必要範囲|
|---|---|
|GET account / prices(product展開) / billing meters|Account・Prices・Products・Billing Meters Read|
|GET meters/{id}/event_summaries|Meter Event Summaries Read|
|POST billing/meter_events|Meter Events Write|
|GET customers/{id}（cash_balance展開）|Customers Read、cash balance Readが別groupならそのRead|
|POST customers/{id}/balance_transactions|Customer invoice balance transactions Write。Customersと統合表示ならその最小Write group|
|GET/POST checkout/sessions|Checkout Sessions Read/Write|
|GET subscriptions、GET/DELETE subscriptions/{id}|Subscriptions Read/Write|
|GET invoices、GET/POST invoices/{id}、POST invoices/{id}/finalize|Invoices Read/Write|
|GET invoice_payments|Invoice Payments Read|

PaymentIntents/Charges/Refunds Write、Product/Price Write、Webhook/Event destination管理、Events v2 Read、token/OAuth/bank/payouts権限をruntime keyへ追加する必要はない。APIはcustomerを新規作成しない。RAK作成・取得・権限変更はこのコード作業では行っていない。

本人による保存先は対象WorkerのSettings → Variables and Secrets、Secret型の `STRIPE_RESTRICTED_KEY`（rk_live）、`STRIPE_WEBHOOK_SECRET`（snapshot専用）、`STRIPE_METER_WEBHOOK_SECRET`（thin専用・別値）。既存FINGERPRINT_SECRETとCREDENTIALSを勝手に再生成しない。Secret値をチャット・GitHub・ログへ貼らない。

## 配置前・販売前の残件

1. 閉鎖受信コードを安全に配置できるlive-closed移行手順の別承認。現在のtest Workerにこのuploaderを実行しても拒否する。閉鎖コードがないまま有効なlive Webhookを作らない。
2. live設定の確認と専用customer / logical account / credential mappingの確定。既存sandbox DO台帳の同じlogical accountをliveへ書き換えない。namespaceを保ったまま新しいlive account instanceを使う。
3. 閉鎖受信側を準備した後にsnapshot13イベントとthin2イベントの宛先を作成し、本人が3Secretを直接保存する。作成時disabled指定が確認できていないため、作成後の即時無効化を代用にしない。現在Webhook作成は保留。
4. 閉鎖中の署名・catalog読戻しを確認。その後の実稼働処理/入金照合の検証と切替は別工程・別承認。既存sandbox E2Eは再利用する。
5. 利用条件、保存期間/削除/backup、訂正・返金運用、責任上限、販売者表示、支払失敗通知、key更新/失効/解約の案内を販売者が確定。TERMS_VERSIONと公開本文・Checkout同意を揃える。責任上限・保存期間は未確定値を補完しない。
6. 最大入力の実Worker CPU/cold-warm/保持台帳規模での余裕確認。既存の平均分布は最大入力専用の測定ではない。Free HTTP CPUとDOの別制限を混同しない。

公開準備とlive_enabledを表示するローカル設定検査の実装は済みだが、公開販売が承認・検証済みであることをhealthだけで証明できない。
