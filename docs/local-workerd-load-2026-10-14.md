# 最大入力のローカルworkerd確認 — 2026-10-14

`node scripts/bench-workerd.mjs`。実Worker/DOの5つのsrc moduleとSQLiteを使用。Stripeは合成mock、一般outboundは拒否。実Worker・Stripeへリクエストせず、実顧客・契約・課金を作成しない。synthetic credentialのみ、ローカル台帳は一時状態。

|項目|結果|
|---|---|
|runtime|Node v24.18.0 / 既存Miniflare 4.20260730.0|
|互換日付|2026-07-30。配置済み2026-10-01とは異なる|
|runtime5ファイルSHA256|185c0985d5372712831335f53f1521dbdf1a373612fcccc582ece794dff16451|
|入力|16,384 bytes、tasks/attempts/bills各40件、40段retry chain|
|台帳|新規1,000 call成功、未精算1,000円|
|並列|20 callのwave、計900件。前段は初回1+逐次99件|
|上限後の新規|429|
|上限後の同一call20並列retry|すべて200、追加計量0、累計/未精算1,000を維持|
|16,385 bytes|413|
|一般outbound|0件|

Node側のwall latencyは、activation後最初の最大入力26.429ms、逐次99件p50 10.515ms / p95 13.909ms / p99 18.011ms、並列900件p50 100.626ms / p95 144.156ms / p99 318.707ms / max 503.795ms。同一DOへの直列処理待ち、ローカルHTTP/RPC/SQLite、JSON response読取を含む。Worker CPUではない。

初回は合成activation後で、cold isolate試験ではない。100,000件までのstorage増大、基盤quota、実DO/WorkerのCPUは未検証。既存ローカルworkerdは2026-10-01をサポートせず起動拒否したため、既存回帰試験と同じ2026-07-30で測定した。本番互換性・Workers Free CPU枠の証拠へ読み替えない。depsのforce変更はしていない。
