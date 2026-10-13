# Cloudflare Dashboardで無料デモだけを公開する

この手順は新しい鍵・Git/OAuth接続・DO・assets bindingを必要としません。既存ログインのDashboard editorへ**1ファイル**を貼り付けます。実API・Stripe・データ受付は含みません。親PC担当の2026-10-13確認では既存account `9a2e48df6882d20c2d1c4398184215a9` はFree、workers.dev suffixは `rough-sound-e8d7.workers.dev`。この環境からアカウントを再検証したわけではありません。

1. レビュー対象branchの [public/dashboard-demo-worker.js](../public/dashboard-demo-worker.js) をGitHubで開き、RawまたはCopy raw fileから全文をコピーする。`git clone`、zip、PC shellは不要。
2. 既存Cloudflare Dashboard → Workers & Pages → Create application → Hello Worldから、別名 `recalm-api-cost-check-demo` のWorkerを作る。既存wake/Gmail Workerは編集しない。支払い・有料plan・Git/OAuth追加を要求される場合は止める。
3. Edit codeで既存のHello Worldコードを、このファイルの**全文**に置き換える（module syntaxの `export default`）。Save and deploy。Bindingとmigrationは**ゼロ**。API_ENABLEDは参照せず常にAPI無効なので、secretもvarsも不要。
4. workers.devの公開URLを実際に開き、販売未開始、園田敏之、info@recalm.jp、価格条件、3例の合成デモ、OpenAPIを確認する。想定hostnameは `recalm-api-cost-check-demo.rough-sound-e8d7.workers.dev` だが、実公開が確認されるまで公開済みと記載しない。
5. `/v1/check`、`/v1/checkout`、`/v1/cancel` は常に503。POST本文を読まず、保存・ログ出力・外部送信しない。`/examples.json` に架空の3例しかなく、実データ入力欄がないことを確認する。観測/ログ設定は本文を記録しない状態にする。

再生成: `npm run build:demo && node scripts/build-dashboard-demo.mjs`。元のdemoとOpenAPIを閉じ込めた自己完結static bundleです。ブラウザは同じoriginから合成JSONを読むだけです。

## API本体のDO配置は別工程

本体の `wrangler.jsonc` は `AccountMeter` のSQLite Durable Objectとmigration `tag=v1,new_sqlite_classes=[AccountMeter]`、binding `ACCOUNTS` を必要とします。単一static bundleにこのDOはありません。DashboardのHello World経路だけで本体のmigrationを済ませたとは主張しません。本体はWranglerの検証済みconfigを使う経路を推奨します。

既存権限でWranglerが使えない場合に**後で承認が必要**なCloudflare token権限: 対象accountに限定したWorkers Scripts:Edit、Workers KV/DOではSQLite DO namespace作成/管理に必要なWorkersスコープ、Account Settings:Read（Wrangler account探索）、必要なら既存workers.devの設定を参照できる権限。Zone/custom domain/R2/D1/Pages/他accountの権限は本体configに不要。正確なDashboard permission名称・DO migrationの認可は現行公式資料と対象アカウントで最終確認する。新tokenはここでは作成しない。Static公開にはこのtokenは不要。
