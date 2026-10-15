# Recalm API Cost Check

**開発版。APIの実売・顧客キー発行・決済受付は未開始です。** 承認済み料金は、成功call 1回あたり **1円（税込・JPY）**、月次後払いです。月次精算額が50円未満なら翌月へ繰り越し、解約時の未精算額が50円未満なら免除します。1アカウントごとにUTC月の新規利用1,000円で停止し、繰越・未請求・請求済未払いを含む未精算総額も1,000円で停止します。49円繰越なら次月の新規利用は最大951回です。照合APIの成功回数の計量とカード決済は別で、決済・提供導線の検証は未完了です。1円ずつカード決済する実装はありません。

請求明細と実行結果のJSONを、明示的なrequest IDで決定論的に照合する最小APIです。照合処理にLLM・外部モデルの呼び出しはありません。課金連携や閉鎖中の接続確認ではStripe APIを使用します。対応不明 (`unknown_attribution`)、重複疑い (`duplicate_suspected`)、失敗後のretry (`failed_retry`) を区別します。成功の定義は利用者が指定し、タスク結果を `success / failure / unknown` として申告します。HTTP 200をタスク成功の根拠にしません。

## 無料で確認する

既存の[無料チェックリストと3つの合成例](skills/api-cost-outcome-check/SKILL.md)を利用できます。このskillはローカル・read-onlyの手順で、データ送信を許可しません。APIは別の任意機能で、利用には本人の明示的な入力送信許可と契約が必要です。skill内に残るUSD 49の診断案は過去の未販売仮説で、このAPIの価格ではありません。

[合成デモのソース](public/index.html)は架空の3例だけをブラウザ内で処理します。実データ入力欄・アップロード・checkoutはありません。[既存Worker](https://recalm-api-cost-check.rough-sound-e8d7.workers.dev)には閉鎖状態の本体を配置済みで、現在の配置・接続証跡は[本番閉鎖接続確認](docs/live-connection-2026-10-14.md)を参照してください。PC shell不要の[Dashboard貼付用単一bundle](public/dashboard-demo-worker.js)と[配置手順](docs/dashboard-publish.md)もあります。ローカル表示は `npm run build:demo` の後 `python3 -m http.server 8000 --directory public`。開いた `http://localhost:8000` で例を選びます。

## APIと入力

[OpenAPI 3.1](docs/openapi.json)と[本番準備一覧](docs/production.md)、[利用条件の下書き](docs/terms-draft.md)、[決済担当への引き継ぎ](docs/billing-handoff.md)を参照してください。`POST /v1/check` は閉鎖中503です。最小のBilling Meters連携、Hosted Checkout、必須webhook、解約・精算処理まで実装しています。本番のカタログ読み取りとMeter通知の署名接続確認は一部完了していますが、販売・課金は停止中です。本番billing通知の正規署名、本番の利用・請求・決済の検証完了を意味しません。[接続証跡と未検証項目](docs/live-connection-2026-10-14.md)を確認してから、販売開始の承認を別に得ます。

```json
{
  "scope": "single-provider-account-window",
  "successCriterion": "owner-usable-artifact",
  "tasks": [{"id": "A", "outcome": "success"}],
  "attempts": [{"requestId": "A1", "taskId": "A", "outcome": "success"}],
  "bills": [{"id": "b1", "requestId": "A1", "amount": 20, "unit": "money:USD:2", "evidence": "confirmed", "kind": "usage"}]
}
```

同じprovider・account・期間・成功基準の記録だけを1入力にまとめます。`scope` と `successCriterion` は公開してもよい任意の識別子で、本文や個人情報ではありません。請求のrequestIdがなければ対応はunknownです。attemptは存在するtaskを参照し、retryOfは同じtaskの既存attemptを参照します。循環・重複IDは入力不備です。任意フィールドの追加やHTTP状態による推定は受け付けません。

金額は非負整数、各明細最大1,000,000,000最小単位。`money:USD:2` の20はUSD 0.20、`money:JPY:0` の1は1円、`credits:vendor:0` は別のcredits単位です。末尾は小数桁数を明示します。通貨コードの実在や各通貨の標準小数桁は検証しません。利用者が正しい単位を指定してください。異通貨・credits・小数桁・確定/推定/不明の根拠区分は別集計です。換算はしません。

`kind: topup / balance` は利用料から除外し二重計上を避けます。利用料の同じrequest IDに複数明細がある場合は重複疑いです。複数の正当な料金項目の場合もあり、不正の判定ではありません。総額から疑い分を勝手に差し引きません。

成功タスクあたりの費用は、失敗attemptも含む同じscopeの費用を成功タスク数で割る**整数の分子・分母**で返します。ゼロ成功、結果不明、対応不明、重複疑い、根拠区分unknownの場合は `null`。入力の完全性と根拠は自己申告で、独立した請求・成果の検証ではありません。成功タスク数は入力全体のscopeです。通貨別の成功タスク数や配賦は推測しません。

## 計量・認証・保存

成功call = 有効な入力の照合完了後、SQLiteの成功記録を原子的に確定した1論理call。unknownや疑いが含まれる結果も有効な処理完了です。成果達成や節約の成功とは異なります。入力不備、認証拒否、409、上限超過、確定前の処理エラーは増分0。同じ利用者・同じidempotency key・同一UTF-8本文のretryは増分0、異なる有効本文は409です。空白、キー順序も本文の一部なのでretryでは元の本文をそのまま送ります。

logical account単位のSQLite Durable Objectで、idempotency記録と成功回数を同じtransactionSyncに入れます。同じaccountの複数キーは同じ台帳と上限を共有します。別キーの並列callも契約安全上限を越えて消費しません。上限は回数券の残高ではなく、UTC月ごとの成功回数の契約上限（最大1,000）。別途、receipt保存を制限する生涯100,000callの安全上限があります。UTC月別の成功回数も保存します。同じtransactionで税込1円の未精算額と永続outboxを追加し、Stripe Billing Metersへ非同期送信します。Stripe-hosted Checkoutと署名済みwebhookから利用権を確認し、請求の自動処理はStripeの機能を使います。未精算額を月替わりにリセットせず、前月請求未回収・状態不明では新規利用を止めます。

本文・照合結果・平文顧客キーは永続保存しません。保存するのはidempotency key/本文のHMAC、algorithm version、成功日時・固定単価・回数・未精算額、Stripeのcustomer/subscription/invoice/event識別子、送信・精算状態、Hosted Checkoutの返却URL等です。全体のTERMS_VERSION照合とCheckoutでの同意要求はありますが、契約ごとの独立した同意版・同意時刻の保存は未実装です。Checkout URLは公開ログへ出しません。webhook本文やカード・住所情報は保存しません。入力をログ出力しません。結果はretryごとに再計算します。高エントロピー顧客キーはSHA-256ハッシュだけを認証registryに登録し、期限・enabled・account・上限を設定します。キー生成・発行は別承認が必要です。

初版はreceiptを自動削除しません。重複排除は同じaccount namespace・HMAC秘密値・algorithm v1・receiptが維持される間だけ有効です。**永久保証ではありません。** 顧客credentialの失効後はretryも401です。解約による利用停止後は、credentialが有効な間、既存receiptの結果再取得と精算状態確認は可能で、新規計量は拒否します。削除・秘密値変更・namespace移行・旧アルゴリズム廃止時は停止して移行条件を決めます。障害復旧でreceiptを失うと二重計量の危険があるため、復旧後に自動で請求を再開してはいけません。確定後の通信切断では利用者が応答を受け取れない場合があり、同じkey/bodyの再送で回数増分0にできます。

## 上限・検証・公開状態

最大16 KiB（UTF-8本文）、請求・attempt・task各40件。本文読み取りは2秒で打ち切ります。Cloudflare Workers Freeの10ms CPU枠は別の上限です。Nodeベンチマークは代替証明になりません。デプロイ先で最大入力・cold/warm・並列時のCPU計測を完了してから有効化し、超過する場合は件数/サイズを狭めます。[検証記録](docs/verification.md)を参照してください。

Runtime依存はありません。開発テストだけ固定版Miniflare/workerdを使います。

```sh
npm ci --ignore-scripts
npm test
npm run bench
npm run build:demo
```

[SQLite Durable ObjectsはWorkers Free対応](https://developers.cloudflare.com/durable-objects/platform/pricing/)です。無料枠の超過時はエラーになります。親PC担当が既存accountのFree/current $0を確認しましたが、この実装環境にはCloudflare認証がありません。有料資源は作成していません。既存opsのwake/Gmail Workerに商品コードを混入しません。opsへの商品コード混入や、秘密値の取得は行っていません。

## 決済導線と未精算の扱い

本体の利用・課金処理は `API_ENABLED`、`BILLING_ENABLED`、本番用の`BILLING_VERIFIED`、approved price/meter/customer、restricted key、webhook secret、顧客credential/HMACなどが揃わなければfail closedです。2026-10-15の `/health` 読み戻しは `stripeMode=live`、3つのflagすべてfalse、`saleActive=false`。閉鎖接続確認では空の顧客mappingを使用しました。承認済みsandbox試験ではSTRIPE_MODE=testとして前2つだけtrueにし、VERIFIED=falseのまま検証できます。本番modeの利用・課金はVERIFIED=trueになるまで拒否します。別の閉鎖検証分岐では、条件を満たす署名通知に対して設定カタログのGETだけを許し、DOへ振り分けず503を返します。受領ackや課金成功ではありません。初版は専用Stripe customerと顧客キーを承認後に手動発行する小規模の招待方式で、自動キー発行・顧客作成・price作成はありません。

`POST /v1/checkout` は `{ "termsVersion": "2026-10-13" }` と顧客Bearer/Idempotency-Keyを受け、Stripe-hostedの契約・支払方法登録URLを返します。成功ページで利用権を付与せず、署名検証済みwebhookとStripeの最新objectを確認します。請求anchorは**毎月1日00:00:00 UTC（日本時間09:00）**。初月は契約成立後から同じ月末までの成功利用だけを計量します。末尾の30分はCheckout生成を停止し、翌UTC月に再試行できます。初月・更新・解約時の実sandbox検証が発売条件です。

50円未満の請求繰越は、cash balanceのない専用customerに対するStripeの最小請求額処理を利用します。`invoice.paid` だけで実入金とは見なさず、InvoicePaymentのStripe支払記録を検証します。繰越額を成功済み未精算額へ重ねて足しません。draft invoiceはauto_advanceを止め、receipt送信・Stripe集計・単価/期間/数量/未精算額の一致を確認してからfinalizeします。不明なら請求も利用も保留します。

`POST /v1/cancel`（本文 `{}`）は新規利用を即時停止し、未送信usageの集計を確認してからStripe契約を解約します。解約時未精算総額が50円未満なら、全receiptの請求対応とStripe debit balanceを確認して同額だけ免除します。50円以上は免除せず最終請求を精算します。`GET /v1/billing` で未精算額・回収額・免除額・保留状態、利用可能なStripe hosted invoice支払リンクを確認できます。解約受付や応答喪失は、精算完了の証明ではありません。

meter送信は安定event IDと保存済み状態で管理し、応答不明の同一送信を最初の試行から**23時間未満**だけ再試行します。それを越えた不明状態は再送せず手動照合へ保留します。これはStripeの少なくとも24時間の重複排除に対して余裕を持たせた外部送信制限で、API側のreceipt保持期間とは別です。確定後のRPC/回線障害で503になった場合は「無料確定」と解釈せず、同じkey/bodyで再取得してください。再取得は計量増分0ですが、結果の送達を保証しません。

## 販売者表示（販売開始前）

販売者: **園田敏之**。連絡先・特商法に関する開示請求窓口: **[info@recalm.jp](mailto:info@recalm.jp)**。住所・電話番号は常時公開せず、購入検討者から同窓口へ請求があった場合に購入手続き前に開示する方式です。メール件名を「Recalm API Cost Check 事業者情報の開示請求」とし、購入検討中である旨と返信先をお知らせください。実住所・電話はこの公開repoには記載しません。開示対応の運用確認も提供導線の検証に含めます。

その他の契約条件は[利用条件の下書き](docs/terms-draft.md)に明記しています。料金承認だけで本番APIや決済が有効になったとは表示しません。

## ライセンス

[MIT](LICENSE)。合成例は顧客実績ではなく、需要・節約・返金・売上・SLAを保証しません。無料の確認で解決する場合はそこで終了できます。

限定認証設定承認後の配置・入力先・非秘密値・稼働チェックは[sandbox接続手順](docs/sandbox-activation.md)を参照してください。CF deploy credentialとWorker runtime Secretは別の入力先です。
