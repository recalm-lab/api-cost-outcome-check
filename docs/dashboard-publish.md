# Cloudflare Dashboardで無料デモだけを公開する

この手順は新しい鍵・Git/OAuth接続・DO・assets bindingを必要としません。既存ログインのDashboard editorへ**1ファイル**を貼り付けます。実API・Stripe・データ受付は含みません。親PC担当の2026-10-13確認では既存account `9a2e48df6882d20c2d1c4398184215a9` はFree、workers.dev suffixは `rough-sound-e8d7.workers.dev`。この環境からアカウントを再検証したわけではありません。

1. レビュー対象branchの [public/dashboard-demo-worker.js](../public/dashboard-demo-worker.js) をGitHubで開き、RawまたはCopy raw fileから全文をコピーする。`git clone`、zip、PC shellは不要。
2. 既存Cloudflare Dashboard → Workers & Pages → Create application → Hello Worldから、既存の無課金placeholder `recalm-api-cost-check` を選んでEdit codeへ進む（未作成ならHello Worldで商品用Workerを作る）。既存wake/Gmail Workerは編集しない。支払い・有料plan・Git/OAuth追加を要求される場合は止める。
3. Edit codeで既存のHello Worldコードを、このファイルの**全文**に置き換える（module syntaxの `export default`）。Save and deploy。Bindingとmigrationは**ゼロ**。API_ENABLEDは参照せず常にAPI無効なので、secretもvarsも不要。
4. workers.devの公開URLを実際に開き、販売未開始、園田敏之、info@recalm.jp、価格条件、3例の合成デモ、OpenAPIを確認する。想定hostnameは `recalm-api-cost-check.rough-sound-e8d7.workers.dev` だが、実公開が確認されるまで公開済みと記載しない。
5. `/v1/check`、`/v1/checkout`、`/v1/cancel` は常に503。POST本文を読まず、保存・ログ出力・外部送信しない。`/examples.json` に架空の3例しかなく、実データ入力欄がないことを確認する。観測/ログ設定は本文を記録しない状態にする。

再生成: `npm run build:demo`。元のdemoとOpenAPIを閉じ込めた自己完結static bundleです。ブラウザは同じoriginから合成JSONを読むだけです。

## API本体のDO配置は別工程

本体の `wrangler.jsonc` は `AccountMeter` のSQLite Durable Object、`exports.AccountMeter={type:"durable-object",storage:"sqlite"}`、binding `ACCOUNTS` を使います。現行exports方式をWrangler 4.149.0 dry-runで検証済みです。旧migrations方式もまだ対応していますが、この新Workerではexportsだけを使い、両方を混在させません。単一static bundleにこのDOはありません。DashboardのHello World経路だけで本体のmigrationを済ませたとは主張しません。本体はWranglerの検証済みconfigを使う経路を推奨します。

既存権限でWranglerが使えない場合に**後で承認が必要**な最小権限: Dashboardで本体Workerを先に作れば、対象accountの**そのWorkerだけWorkers Editor**。既存Workerへのdeploy/secret設定に必要なroleで、DOは実装Workerの権限を継承し専用DO/KV権限は不要。新WorkerをWranglerから作るならWorkers product-level Adminが必要なので、最小権限のため既存Dashboardから先に空Workerを作る方法を優先する。account_idをconfigへ明示し、Zone/routes/custom domain/R2/D1/KV/Pages/User-token-editの権限を付けない。旧Dashboardのlegacy Workers Scripts:Editはproduct-wide Editor相当なので、現行per-Worker Editorを優先する。新tokenは作成していない。CF deploy tokenの入力先は対象api repoのGitHub Actions repository secret CLOUDFLARE_API_TOKEN。Stripe/runtime Secretの入力先は対象Worker Settings → Variables and Secrets のSecret型。チャット・GitHub本文・PC操作ログへ値を貼らない。

公式根拠: [Workers roles](https://developers.cloudflare.com/workers/authorization/workers/)、[Durable Objects roles](https://developers.cloudflare.com/workers/authorization/durable-objects/)。2026-10-13確認。

初回namespace作成の公式根拠: [Durable Object class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)。namespaceがないDashboard binding選択だけでは初回作成ができないため、本体の承認後deployでexportを宣言する。SQLiteであることをData Studio/設定で確認してからbillingを有効にする。
