# 再開確認と本番キー承認案 — 2026-10-14

この文書は再開時点の調査・承認案を保持する履歴資料。後続の本人承認・RAK保存・Meter Secret更新と実署名検証、live閉鎖配置は[本番閉鎖接続確認](live-connection-2026-10-14.md)が最新。下記のtest設定・キー未作成・非空mapping必須・Secret再生成候補という時点記述は更新済み。料金の実装確認と販売開始残件は引き続き有効。

この文書が、以前の「本人の署名Secret保存待ち」「本番通知先未作成」という記述を更新する。正式規約、販売開始、課金有効化の承認ではない。dotへの再委任は行っていない。

## 正本と現在の配置

- 正本: `recalm-lab/api-cost-outcome-check` / `feat/deterministic-cost-check` / [PR #1](https://github.com/recalm-lab/api-cost-outcome-check/pull/1)。再開時remote HEADは `9efce168c45c2148ef6d238bb927176bdcad4ead`。ローカル開始ディレクトリはGitではなく、既存checkoutは見つからなかった。指定ブランチを新規取得し、初期statusがclean、remoteが指定repoと一致することを確認した。他プロジェクトは変更していない。
- 公開 `GET /health` を読み戻し、HTTP 200、`stripeMode=test`、`apiEnabled=false`、`billingEnabled=false`、`billingVerified=false`、`saleActive=false` を確認。
- 応答header `x-recalm-source-commit` は `4c42a85efa3e4e31f00039e692a323f63128f2f7`。再開時HEADとSHAは異なるが、その範囲の `src/`・`public/` 差分はない。今回のテスト・文書変更をWorkerへ再配置したとは扱わない。
- [指定read-only run](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38521717361)は上記HEADでsuccess。Cloudflareの現在画面でも同じtest・3flag=false、既存ACCOUNTS namespace、test用account/Price/Meter/customer対応、Secret名/型を確認した。Logs/Traces/Issuesは画面でoff。本文保存のないことを基盤全体で証明したとは扱わない。
- 本人の最新報告: `STRIPE_WEBHOOK_SECRET` と `STRIPE_METER_WEBHOOK_SECRET` は各本番通知先の値で上書き済み。画面で存在・Secret型は確認できた。値一致・本番署名検証は未検証。`STRIPE_RESTRICTED_KEY` は既存Secret型だが、本番キーは本人報告により未作成。

## 料金の実装確認（変更なし）

`src/worker.js`・`src/meter.js`・`src/billing.js` を正とする。JSONの照合を完了し、transactionSyncで成功receipt・1円未精算額・outboxを記録した処理が課金対象。入力内のタスクoutcomeがsuccessであることは課金条件ではない。unknownの照合結果も有効な完了結果。同じaccount・同じIdempotency-Key・同じ本文の再取得は増分0、本文が異なると409。本文や結果は保存せず再計算する。確定後の通信障害は未計量の証拠ではない。

月境界は毎月1日00:00:00 UTC（日本時間09:00）。月間新規利用1,000円と繰越・請求済未払いを含む未精算総額1,000円は別上限。上限で新規処理429、同一receiptの再取得は先に判定する。49円繰越なら次月の新規利用は最大951回。前月の未照合請求や保留状態では503になり得る。50円未満の翌月繰越、解約時50円未満の検証済み残高免除を実装済み。契約capを変更する操作はしていない。

この成功定義・UTC境界・通信障害時の説明は公開条件の最終承認対象。未承認の別解釈を実装へ反映しない。

## 既存Stripe設定の再利用

対象は本番 `acct_1TqptlRUIufKFmuE`。Product `recalm_api_cost_check_v1` は有効、default Priceは `price_1UQKQ0RUIufKFmuEMN1jt6OU`。Price画面でJPY1・毎月・従量課金・同Meterへの関連付けを確認。税込inclusiveは既存API証跡と本人提示条件を保持し、今回のキーによるAPI再取得は未実施。

Meter `mtr_61VZYWJ5ULlQs4CCm41RUIufKFmuE4IC` は有効、イベント名 `recalm_api_cost_check_success_v1`、未加工/raw、合計/sum、ペイロード上書きなし。画面の送信例は `stripe_customer_id` / `value`。直接APIでcustomer_mapping/value_settingsを確認するのはキー保存後。

|通知先|読み戻した内容|
|---|---|
|`we_1UQLJYRUIufKFmuEOSxzKfNH`|active、`/v1/stripe/webhook`、snapshot、2026-08-26.dahlia、Checkout 3 + subscription 3 + invoice 7の計13イベントがコードと一致|
|`ed_61VZjIA2JGNbpTnh416V0Dr7RqHNpbTY9mEkqeEfwPR2`|active、`/v1/stripe/meter-webhook`、thin、v1.billing.meter.error_report_triggered / v1.billing.meter.no_meter_foundの2イベントがコードと一致|

商品・Price・Meter・通知先を再作成していない。既存Grok通知先には操作していない。

## キー作成前の承認案

現在の閉鎖分岐の実API呼出しは次の3本だけ。ProductはPrice展開のためReadが必要。[RAK公式手順](https://docs.stripe.com/keys/restricted-api-keys)と[展開の権限説明](https://docs.stripe.com/stripe-apps/reference/permissions#object)を参照。

|実API|今回のDashboard権限案|
|---|---|
|GET `/v1/account`|Accounts: Read（Accounts v2やCore一括ではない）|
|GET `/v1/prices/{price}` + product展開|Prices: Read、Products: Read|
|GET `/v1/billing/meters/{meter}`|Billing Meters: Read|

キー名案 `recalm-api-cost-check-live`。**上記4項目だけRead、その他すべてNone、Connect権限列もすべてNone**。Accounts行は画面のConnectカテゴリ内にあるが、本コードは@selfの `/v1/account` だけを使い、Stripe-Account/contextを送らない。接続先アカウントへのアクセスを許可する右列とは区別する。

Chromeの未送信作成フォームでテンプレート権限を外し、この4項目だけの選択状態を確認。キー作成ボタンは押しておらず、継続アクセスはまだ発生していない。本人承認後、生成値の閲覧・コピー・入力・保存は本人操作へ渡す。保存先は既存WorkerのSecret型 `STRIPE_RESTRICTED_KEY`。同じキーを後で編集することで権限不足を修正できるため、追加キー作成を既定の解決にしない。

### 販売用コードの呼出し一覧と未確定の対応

|実API（src/billing.js）|必要な操作|Dashboard対応の判定|
|---|---|---|
|GET customers/{id}、cash_balance展開|Read|Customers。cash_balanceを含むRAKの実許可は未検証|
|POST customers/{id}/balance_transactions|Write|Customersが候補。顧客invoice balance用であり、Credit Balances・Credit GrantsやStripe自身のBalanceではない。個別対応の実証は未完|
|POST/GET checkout/sessions|Write/Read|Checkout Sessions。顧客作成APIは呼ばない|
|GET subscriptions、GET/DELETE subscriptions/{id}|Read/Write|Subscriptions。DELETEは解約であり、今回の接続確認では実行しない|
|GET invoices、GET/POST invoices/{id}、POST invoices/{id}/finalize|Read/Write|Invoices。auto_advance変更・finalizeを含むためReadだけでは足りない。今回実行しない|
|GET invoice_payments|Read|独立行がない。Invoicesとの権限対応を実RAKの許可/固定エラーで確認する必要あり|
|GET billing/meters/{id}/event_summaries|Read|独立行がない。Billing Meters/Billing Meter Eventsのどちらが必要かを実RAKで確認する必要あり|
|POST billing/meter_events|Write|Billing Meter Events。今回の接続確認では送信しない|

HTTP方法に必要な操作は確定したが、上記subresourceのRAK group対応を断定しない。Stripe Appsのpermission名をそのままDashboardのRAK名と同一視しない。上記不明点を埋めるためにCredit Balances等を広く与えない。現コードはProducts/Prices/Metersの作成、Payment Intents/Charges/Refunds、Credit Grants、Event Destination管理、v2 event fetch、Payouts/Transfersを呼ばない。

今回の閉鎖用キーに販売用Writeを加える承認は求めない。実稼働のRAK対応をsandboxで確認し、既存キーの編集内容を別途提示してから販売工程へ進む。sandboxの請求試験を本番課金検証済みと報告しない。

## 本番閉鎖接続へ進むための条件

キー保存後に非秘密設定変更を説明し、3flag=falseを維持する。候補差分はSTRIPE_MODE=test→live、STRIPE_ACCOUNT_ID/PRICE_ID/METER_IDを上記本番IDへ変更。EVENT_NAME・PUBLIC_BASE_URLは一致しているため変更不要。既存sandboxの `BILLING_ACCOUNTS` は本番へ流用せず、別logical accountと専用本番customerの対応を確定するまで設定切替を保留する。

現在のbillingConfigは閉鎖用でも非空のcustomer mappingを要求し、snapshotは対応済みcustomerだけを許す。mapping未準備を `{}` や架空IDで回避しない。既存sandbox DOに本番customerを付け替えない。継続中のalarmもruntimeのlive未検証ゲートで閉じる設計だが、これを実運用試験済みとは扱わない。

閉鎖分岐は署名と固定catalogのGETだけを検証し、成功でも503 `billing_closed`、received=false、eventProductVerified=false。同じ署名通知の重複でも503のまま、DO dispatch・event保存・計量はない。これは稼働分岐のイベント重複receiptを実本番で試験したことにはならない。200にするために課金flagを有効にしない。

2宛先の正規署名通知と再送、誤署名・誤modeの拒否を、秘密値を取らず結果の固定コードだけで確認する手段を確定する。実顧客Subscription作成、Meter送信、invoice finalize、決済は含めない。既存通知だけで対象イベントを得られなければ、その項目を未検証として残す。Pingを商品イベントの検証の代わりにしない。

## 販売開始の残件

|項目|できていること|開始前に残ること|
|---|---|---|
|規約・プライバシー|terms-draftと生成経路、非保存方針、料金説明|保存目的/解約後期間/削除/backup、支払・返金・計量異議・紛争・責任・準拠法・販売者開示の本人決定と本文/TERMS_VERSIONの一致。今回は法的条件を追加しない|
|保存と削除|receipt/webhook各100,000/accountで停止、自動削除なし、本文/結果は保存なし|承認された期間と未精算/重複保証を両立する削除手順。先に全キーを失効、未送信/応答不明/請求残高を照合してから削除可能かを判定。実削除は別承認|
|顧客対応|1 logical account→専用Stripe customer、同accountのキー更新でも同台帳|本番専用customerの選択、重複/他商品/既存invoice/subscription/cash balance検査、sandbox台帳との分離。接続確認のために実契約を作らない|
|APIキー配布・失効|SHA256 registry、有効期限/enabled/cap、同accountでの更新と失効、認証付き解約|本人確認した受取人へ安全な一回配布、平文をチャット/メール/ログに残さない経路、受領確認、旧キー無効化。全失効前に解約/精算確認の経路を残す手順。キー発行の実操作は未実施|
|負荷|最大16KiB/各40件/40段retryのworkerd機能回帰、Node microbenchmark|実WorkerとDOの最大入力cold/warm/並列/台帳増大のCPU・storage・quota測定。閉鎖本番へ有料callを投げて代用しない。Nodeの結果をFree CPU判定に使わない|
|請求|mock/workerdの月境界・二重計量防止、過去sandboxの1call/retry0/少額免除・49→50/1000回収証跡|実Worker時刻の月境界・初月・grace/他receiver・失敗/50円以上解約回収、販売用権限、提供導線の未完項目を閉じる|

販売表示、3flagの有効化、有料契約は、残件確認後に本人へ最終承認を求める。

## 今回の開発検証

変更は `.gitattributes` のLF指定、sandbox-smokeテストのpreloadパスを `pathToFileURL` へ変換するWindows互換修正、関連文書だけ。課金/照合runtime・料金・LLM呼出しは変更していない。

コミット `f98ccc5` のclean checkoutで `node --test --test-concurrency=1 test/*.test.js` は82/82 pass、0 fail。最大入力のworkerd回帰、署名・重複・上限・閉鎖分岐、正本SHAからの単一bundle compileを含む。`npm run build:demo`、生成publicとの一致、変更JSの `node --check`、`git diff --check` も成功。JavaScriptプロジェクトで独立した型検査設定はないため、型検査済みとは表現しない。

初回のsandbox内localhost EACCES、自動CRLFによるCSP/生成物不一致と、Windows絶対パスのESM preload不備を切り分けた。LFの別checkoutとlocalhostを使える検証実行で確認した。既存checkoutの全ファイル上書きは自動承認レビューが未コミット作業消失の危険として拒否したため行わず、元checkoutを保持した。Windowsの既定並列実行では一部startup timeoutが出たが、対象の直列再確認と上記全件直列実行では成功した。安全ゲートやassertionは緩めていない。

Node最大入力microbenchmarkは16KiB/40件/40段を実行できたが、このWindowsでprocess.cpuUsageが0/16msへ量子化され、Worker性能の判断に使えない。実Worker/DOのCPU測定は未完のまま。

`npm audit` は既存devDependenciesのminiflareと推移依存sharp/undiciにhigh 3件を報告。今回の修正で入れた依存ではなく、runtime bundleはこれらをimportしない。開発環境依存の対応を残件として記録し、提示された過去版へのforce変更はしていない。実運用の検証済み状態と混同しない。

## UI読み取りの秘密値事故

本人が開いていたmeter errorsページで署名Secretが表示状態だったため、初回getTabの自動AX結果に値が含まれた。本人へ報告済み。値を文書・Git・ファイルへ記録せず、検証に利用しない。以後はread-only DOMから非秘密項目だけを返し、通知先の画面をスクリーンショットへ保存しない。

当該meter署名Secretの再生成とWorkerへの差替えは本人管理の候補措置。必要な承認・本人入力を経て行い、通知先そのものの再作成やGrokの変更へ広げない。APIキーの承認とは別の操作として扱う。
