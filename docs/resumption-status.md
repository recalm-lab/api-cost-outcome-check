# API販売準備の引継ぎ確認 — 2026-10-13 20:42 UTC

最新の再開確認・本番キーの承認案・販売残件は [2026-10-14確認](launch-readiness-2026-10-14.md)を参照。本番通知先2件は作成済み、本人の署名Secret上書き報告も受領済み。本稿の古い「未設定/保存待ち」は再入力や再作成の指示ではない。

事業は継続する。停止した旧タスクの試験を新たに重複実行せず、既存draft PR #1 / `feat/deterministic-cost-check` を引き継ぐ。Gmail復旧は対象外。

## 引き継いだ状態

- 独立checkout: `/workspace/api-cost-outcome-check`。`/workspace/recalm-ops` は変更なし、作業前後のstatusはclean。
- 旧引継ぎ時の取得HEAD: `012810836bd6149c5554f25d3a57c4ca537eed25`。元の `5c72dea4babaa2821f06b8e4da4b5a7d22bbb5f1` 以後の33commitを確認。PRはopen/draft。
- GitHubの最新確認でin_progress / queued / waitingは各0件。[最新HEADのCI](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38445450302)はsuccess、job115462503066のログは70 tests / 70 pass / 0 fail。未確認の旧承認要求を実行し直していない。
- 当初の46テストという引継ぎより作業が進んでいる。現在のsandbox実績とCPU集計は[production.md](production.md#2026-10-13-確認済みsandbox実績と本番切替の設計案)を正とする。古い文書の「未保存」「未配置」「未接続」は当時の記録であり、再入力・再配置の指示として使わない。

## 既に確認された試験を再利用する

- [実Worker成功・retry・conflict](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38420958389/job/115377821874): 合成customerのCheckout・Webhook、成功1回、同じkey/本文の増分0、変更本文409、meter受付・invoice数量1。
- [解約](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38422369133/job/115382770995)と[解約後状態](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38420707095/job/115383865311): canceled、回収0、1円免除、未精算0。解約済みaccountを新規契約の試験にそのまま再利用しない。
- Stripe test clockによる49円繰越＋翌月1円＝50円回収、1000円回収はproduction.mdの証跡を再利用する。Workerの実時刻に基づく月境界E2Eとは区別する。
- 旧sandboxタグやrunを再実行しない。最新コードのmode事前確認ガードは古いSHAには適用されない。

## この新環境で確認できたことと制約

- `.agents` は空、両checkoutにAGENTS.mdなし。APIの同梱skillとStripe実装skillを確認。API同梱skillは無料の照合チェックリストであり、販売準備の外部操作権限を追加しない。
- `npm run build:demo` 成功、生成物はgitのpublicと一致、`git diff --check` 成功。
- Node24/実SQLite/Miniflare/workerdでローカルも70 tests / 70 pass / 0 fail。最大入力、renewed credential、healthとmodeガードの回帰を含む。
- CF tokenとクライアントtest keyの安全注入はこのshellにはない。存在のbooleanだけを確認し、GitHub/Workerに保存済みの秘密値を取得・コピーしていない。
- shellからGitHub RESTとWorkerへの接続は環境側でForbidden。Worker URLはCONNECT tunnel段階の403であり、WorkerのHTTP応答やStripe keyのscope不足を示すものではない。設定やscopeを変更して解決しない。
- Gitの通常pushは既存環境認証でもAuthentication failed。新規credentialや権限を作らず、接続済みGitHubのContents APIでこの引継ぎ文書だけを既存draft branchへ追加する。
- runtimeの現在のflags、Secret名一覧、DO状態をこの環境では再確認できていない。保存済みtest keyは生成後24時間の期限なので、再開時にまず認証結果を確認する。期限切れを確認する前に再生成を依頼しない。

## 販売開始までの残作業

1. 実Worker最大16KiB/各40件/40段retry、cold/warm、並列、保管receipt増加条件を対象リクエストに対応付けてCPU測定する。既存24時間集計やNode benchmarkをこの結果の代わりにしない。
2. Worker月境界と初月、invoice grace、回収失敗・50円以上解約回収の実runtime検証範囲を確認する。mock/workerdやStripe clockのみの確認結果を実Worker結果に置き換えて表示しない。
3. 正式条件の保持期間・計量訂正/返金・責任・支払時期と、購入前の販売者情報開示運用を確定し、既存terms生成経路とCheckout同意版へ反映する。
4. 本人受領済みlive meter IDの対象account/mode/条件を照合し、live専用商品/価格/2種類Webhook・非秘密manifest・customer/account/認証導線と、closed配置・古いsandbox deployment権限の扱いを準備する。meterを重複作成しない。実行は本番開始承認の対象。sandbox DOの請求先/modeをliveへ付け替えない。

本記録の作業ではcode再配置、flag変更、新契約・実課金、権限拡張、秘密の再生成を行っていない。事業継続と実売開始は別の状態であり、実売検証完了とは報告しない。


## 遅れて届いた旧資料との整合

今回の文書修正基点headは `3cf745f71416d0c64598091b0fabb4880324dee6` と再取得で一致した。旧61002a7系と01281083系は既に統合済みで、本体・modeガード・70回帰を保持している。[基点のCI38465298320](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38465298320)は成功済み。コードを巻き戻さない。

live `acct_1TqptlRUIufKFmuE` の本API用meterは**本人の作成報告済み**。event_name `recalm_api_cost_check_success_v1`、sum/raw/default payload（stripe_customer_id/value）という報告を引き継ぎ、2026-10-14に正確meter ID `mtr_61VZYWJ5ULlQs4CCm41RUIufKFmuE4IC` を本人から受領した。対象account/mode/設定の直接読み戻しは別確認とし、受領と区別する。**新しいmeterの重複作成は不要**。

live Product `recalm_api_cost_check_v1` / Price `price_1UQKQ0RUIufKFmuEMN1jt6OU` は2026-10-14にStripe担当の作成・読み戻し完了報告を受領した。税込JPY1/month/metered/per_unit、default_priceとlookup_key重複なしも同報告で確認。本API用snapshot・thin Webhookは未設定。未発効規約とlive Secret3つ（STRIPE_RESTRICTED_KEY、STRIPE_WEBHOOK_SECRET、STRIPE_METER_WEBHOOK_SECRET）も未完のまま。3秘密値の設定だけで開始可能とは案内しない。

[sandbox-save-next](sandbox-save-next.md)を過去資料へ変更し、現在のhelper再生成・上書きは不要と明記。[sandbox-connection-evidence](sandbox-connection-evidence.md)にはmetadata診断の値未検証と、既存の署名Webhook/契約/1call/retry0/解約免除/49→50回収の実証を区別して併記した。今回の整合は関連文書のみであり、Secret・実workflowタグ・デプロイ・Stripe/CF設定は変更していない。


## 2026-10-14 Meter ID受領後の引継ぎ

最新確認基点head `7a279dc20e0cc6f0fce928c0ba30f9dc61b41f92` を確認。本人受領済みlive Meter ID `mtr_61VZYWJ5ULlQs4CCm41RUIufKFmuE4IC` / live account `acct_1TqptlRUIufKFmuE` を[productionの非秘密候補](production.md#2026-10-14-live-meter-id受領と開始条件文書のみ未適用)へ記録した。meter重複作成不要。Stripe担当のProduct/Price成果（recalm_api_cost_check_v1 / price_1UQKQ0RUIufKFmuEMN1jt6OU）も受領した。このタスクでは商品・価格を作成していない。

70回帰・sandbox E2E・49→50/1000回収の既存証跡を再利用し、手動再実行しない。実装済み署名/台帳/同一account更新/modeガード/healthと、未配置コード・未実装live-closed uploader・未設定live Webhook/3 Secret/customer対応・未承認規約を分けた。現行live billingConfigでは3flags=falseのまま課金経路やWebhookが200になるわけではないため、安全な閉鎖検証と段階的開始手順は別途確定する。

今回の変更はproduction/resumptionの文書だけ。test vars・Secret・デプロイ・Stripe切替・請求・キー生成・公開募集・有料契約・正式条件発効は行っていない。

本API用live Webhook2宛先、3 Secret、live専用customer/同一論理accountの有効credential対応、安全なclosed設定/署名検証/開始順序、正式条件の未承認事項は残る。必要event一覧と非秘密live設定候補をproduction.mdに記録した。Priceとmeter IDの関連付けはStripe担当API読み戻し報告、meter本体のsum/raw/event/payloadは本人作成画面確認であり、API直接読取り済みとはしない。


## 2026-10-14 06:01 UTC — test閉鎖配置完了

[実配置証跡](test-closed-deployment-evidence.md)。Workerはtestのまま3flag=false。source SHA `4c42a85efa3e4e31f00039e692a323f63128f2f7` のfresh buildをcontent-only APIで配置し、保存後settings/bindings/namespace、HTTP source SHA、health.saleActive=false、snapshot/thinの安全拒否を確認した。run38519747808 / job115706485524成功。observability未返却、content-only APIの保持仕様に基づき変更なし。旧来の「test閉鎖コードが未配置」という記述はこの更新で解消した。本番mode切替・Stripe操作・Secret生成/取得/上書き・販売開始はこの工程では行っていない。


## 本番通知先2件作成完了・本人入力待ち（親のreadback報告）

本番 `acct_1TqptlRUIufKFmuE` / @self のsnapshot `we_1UQLJYRUIufKFmuEOSxzKfNH` とthin `ed_61VZjIA2JGNbpTnh416V0Dr7RqHNpbTY9mEkqeEfwPR2` はenabledで、指定URL・13/2イベント・snapshot API版2026-08-26.dahliaのreadbackが完了。既存Grokを含め計3件、重複なし。[詳細と本人入力待ち](test-closed-deployment-evidence.md#本番通知先のreadback完了本人secret入力待ち)を参照。

本人による `STRIPE_WEBHOOK_SECRET` / `STRIPE_METER_WEBHOOK_SECRET` のCloudflare保存は返答待ち。既存rk_liveキーの作成有無も未確認。秘密値は扱っていない。test・3flag=false・配置source SHA4c42a85を保持し、本番切替や再配置は行っていない。この更新は引継ぎ文書のみで、テスト再実行を避けるためcommitにskip ciを指定した。
