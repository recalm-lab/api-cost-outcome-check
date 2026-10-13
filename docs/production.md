# 本番準備と操作の境界 — 0.3.0

実装は揃ったが、実接続・本番CPU・提供導線の検証が終わるまで販売しない。API_ENABLED/BILLING_ENABLED/BILLING_VERIFIEDはすべてfalse。Stripe/Cloudflare本番key・顧客key・OAuth権限は作成していない。商品/価格作成と販売設定は親担当のStripe接続で行う。

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
