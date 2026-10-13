# 残る本人操作（sandbox、販売停止維持）

署名Secret2つは本人の保存完了報告を受領。値の取得・表示・比較は行わない。接続の最終確認はsigned webhookとsandbox E2Eで行う。存在だけで署名が正しいとは判定しない。

準備済み [単一ローカルHTML](https://github.com/recalm-lab/api-cost-outcome-check/blob/5c72dea4babaa2821f06b8e4da4b5a7d22bbb5f1/tools/offline-sandbox-setup.html) を **Download raw file** で保存し、本人PCでfile:として開く。zip/PC shell/npm不要。公式保存画面を準備してから「専用テスト値をPC内で生成」を1回だけ押す。モデル/操作担当へ値を渡さず、本人がcopyして直接保存する。

|HTMLのcopy欄|保存先|
|---|---|
|テストAPIキー原本|api-cost-outcome-check repo Settings → Secrets and variables → Actions → repository Secret `RECALM_TEST_API_KEY`|
|fingerprint|既存recalm-api-cost-check Worker Settings → Variables and Secrets → Secret `FINGERPRINT_SECRET`|
|registry JSON（原本ではなくSHA256）|同Worker Secret `CREDENTIALS`|
|customer対応JSON|同Worker通常Variable `BILLING_ACCOUNTS`|

非秘密対応は `sandbox-e2e-20261013` → `cus_VQrJWHFdsVqzJG`。HTMLに入力済みで4つ目のJSONをそのままcopyできる。registryのexpiryは本人が押した時刻+24時間、数値UTC epoch millisecondsで自動作成。maxMonthlySuccessfulCalls1000。HTMLのenabled:trueはcredential registry内の状態で、停止flagを解除しない。

全保存後はページ内の値を消去して閉じ、保存完了だけを伝える。署名Secretやキーを再投稿しない。3flags API_ENABLED / BILLING_ENABLED / BILLING_VERIFIED はすべてfalse、STRIPE_MODE=testを維持。値の再生成や既存fingerprintの上書きはしない。

この案内自体は生成・保存・契約・有効化を実行しない。既存fingerprint/registryが見つかった場合は初回用HTMLで上書きせず止める。本人保存後にSecret名のみ確認し、sandbox接続確認を行う。新しいStripe key・CF token・本番権限は不要。
