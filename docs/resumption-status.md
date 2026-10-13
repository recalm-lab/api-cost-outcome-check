# API販売準備の引継ぎ確認 — 2026-10-13 20:42 UTC

事業は継続する。停止した旧タスクの試験を新たに重複実行せず、既存draft PR #1 / `feat/deterministic-cost-check` を引き継ぐ。Gmail復旧は対象外。

## 引き継いだ状態

- 独立checkout: `/workspace/api-cost-outcome-check`。`/workspace/recalm-ops` は変更なし、作業前後のstatusはclean。
- 取得HEAD: `012810836bd6149c5554f25d3a57c4ca537eed25`。元の `5c72dea4babaa2821f06b8e4da4b5a7d22bbb5f1` 以後の33commitを確認。PRはopen/draft。
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
4. live専用商品/価格/meter/2種類Webhook・非秘密manifest・customer/account/認証導線と、closed配置・古いsandbox deployment権限の扱いを準備する。実行は本番開始承認の対象。sandbox DOの請求先/modeをliveへ付け替えない。

本記録の作業ではcode再配置、flag変更、新契約・実課金、権限拡張、秘密の再生成を行っていない。事業継続と実売開始は別の状態であり、実売検証完了とは報告しない。
