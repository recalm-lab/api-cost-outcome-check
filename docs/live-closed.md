# 本番を閉じた状態でのコード準備（2026-10-14）

この手順はコード実装済みで、実際の配置・live設定変更・Secret保存・Webhook作成は未実施。既存sandboxの実E2Eは再実行していない。通常のブランチcommitによる自動CIは合成入力・モック通信のみを使う。

## 既存live Workerへのコード専用uploader

`scripts/upload-live-closed-worker.mjs` は Cloudflare account `9a2e48df6882d20c2d1c4398184215a9` / Worker `recalm-api-cost-check` / production環境だけを対象にする。配置先のbindingを読み、`STRIPE_MODE=live` と `API_ENABLED=BILLING_ENABLED=BILLING_VERIFIED=false` が重複のないplain_textであることを確認する。test・不明・一部true・Secret型flagではPUTしない。現在のsandboxからliveへ切り替える機能はない。

ACCOUNTSは既存のAccountMeter / namespace `0b8d1c5cea78485d9d9ae6a62ed98b6f` が必要。新規namespace、migration、vars、routes、domainsを指定しない。既存exportsが明示されている場合はAccountMeter/sqliteの同一宣言だけを保持し、state等の応答専用fieldは送らない。他のexportや不明な設定では停止する。`keep_bindings` にsecret_text / secret_key / plain_text / json / durable_object_namespaceを指定し、assetsも保持する。既存varsの内容、Secretの名前と型、namespace bindingをPUT直前と保存後に読み戻して比較する。`GET /scripts/{name}/settings` でcompatibility_date / flags / observability / logpush / tags / tail_consumers、返されているplacement / limits / usage_model / cache_options / exportsを読む。事前レビュー済みの設定JSONとの完全一致を必須とし、日付をローカル値で上書きしない。保持対象をupload metadataへ明示して保存後も比較する。必須fieldが欠落・不明・未対応ならPUT前に停止し、省略をfalseや空配列と推定しない。[公式設定GET](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/get/) とupload schemaに基づく。Secret値は取得・再構築・出力しない。Cloudflare APIの同時編集をロックする機能はないため、実行中は他の設定編集を行わない。保存後の不一致はエラーにするが自動rollbackはしない。

`scripts/build-reviewed-worker.mjs` が、明示した40桁のレビュー済みSHAとclean checkoutのHEAD一致を確認し、そのcommitの入力を `git show` から新規bundleへ組み立てる。古い `/tmp` bundleは一切読み込まない。入力ごとのSHA-256・bundle SHA-256・source commitをmanifestへ記録する。CIでも同じbuilderを実行し、生成した単一moduleをworkerdでコンパイルして閉鎖HTTPを確認する。Cloudflare deploy credentialは承認済みの実行環境だけから注入する。uploaderの追加は実行承認・実行完了を意味しない。[公式upload API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/) の保持指定に基づく実装で、mock APIでの検証済み。実際のlive uploadでの保持確認は残件。

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

成功時も **503** と `{error:"billing_closed",verification:"signature_and_configured_catalog_only",eventProductVerified:false,received:false}` を返す。200で受領確定せず、DO呼出し、台帳/event receipt保存、契約有効化、計量、invoice更新・finalize・回収を行わない。重複通知も同じ閉鎖応答。Stripeは失敗通知を再送するが、[公式の再送期間](https://docs.stripe.com/webhooks#automatic-retries)には限りがあり、この分岐はイベント保管の代用にはならない。

3flag=falseのまま、check/Checkout/cancel/billingは閉鎖、health.saleActive=false。既存の実稼働分岐は従来どおりbillingConfigの有効化条件とDOの整合性確認を必要とする。BILLING_VERIFIEDをコードや署名確認だけでtrueにしない。閉鎖検証結果は購入・請求処理の実稼働確認ではない。同じcustomerの別商品のsnapshotでも署名と設定catalog確認は成立し得るため、eventProductVerifiedは必ずfalseであり、通知自体の商品検証済みとは表現しない。この場合もDO・課金処理へは転送しない回帰テストを追加した。

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

1. 親が別途進める配置工程で、先に現在のtest Workerを3flag=falseへ閉じる（このコード作業では設定変更しない）。レビュー済みSHAのclean checkout、事前にread/reviewしたremote保持設定JSONを用意する。JSONはcheckout外へ保存し、秘密値は含めない。
2. `node scripts/upload-test-closed-worker.mjs <REVIEWED_SHA> <REVIEWED_SETTINGS_JSON>` で同じ閉鎖コードをtestのまま配置する。uploaderはremoteもtest・3flag=falseを要求し、どのflag/modeも変更しない。保存後binding/settingsとHTTPを読み戻し、healthの3flag/saleActiveがfalse、snapshot/thin無署名POSTが400/503、全応答の `x-recalm-source-commit` が期待SHAに一致することを確認する。違えば後続工程へ進まない。
3. ユーザーが本日14:27 JSTに承認した同一Stripe本番アカウント全体のsnapshot13 / thin2通知先作成と署名Secret生成は親の別工程で行う。新Secretがまだないtest-closed受信側は既存署名設定と一致しないlive通知を安全拒否し、課金を開始しない。本人が各専用Secretを対象WorkerのSecret型へ直接保存する。既存sandbox Secretは本人管理の安全な手段で復旧できることを確認し、チャット/ログへ取得しない。
4. 本人のSecret保存後に、3flag=falseを維持したままlive account / Price / Meter / rk_live / 顧客対応へ設定を切り替える別工程を進める。sandbox台帳の同じlogical accountをliveへ流用しない。閉鎖署名確認とcatalog読戻しを確認するが、実稼働・販売有効化は別工程。以後のコード更新は `node scripts/upload-live-closed-worker.mjs <REVIEWED_SHA> <REVIEWED_SETTINGS_JSON>`。配置後HTTP確認は毎回必須。Webhook生成やSecret設定はこのuploaderから行わない。
5. 利用条件、保存期間/削除/backup、訂正・返金運用、責任上限、販売者表示、支払失敗通知、key更新/失効/解約の案内を販売者が確定。TERMS_VERSIONと公開本文・Checkout同意を揃える。責任上限・保存期間は未確定値を補完しない。
6. 最大入力の実Worker CPU/cold-warm/保持台帳規模での余裕確認。既存の平均分布は最大入力専用の測定ではない。Free HTTP CPUとDOの別制限を混同しない。

公開準備とlive_enabledを表示するローカル設定検査の実装は済みだが、公開販売が承認・検証済みであることをhealthだけで証明できない。

実配置の成功はmock CIでは確定しない。read APIが必要設定を返さない、保持不能な設定がある場合は事前停止する。PUT後の不一致やHTTP不一致は自動rollbackせず、3flag=falseを維持して原因を確認する。設定の同時編集を止め、署名通知の再送期限内に準備を完了できない場合の再取得・再送は別運用として扱う。
