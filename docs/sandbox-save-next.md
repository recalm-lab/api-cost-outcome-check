# 過去資料: sandbox初回保存の引継ぎ（現在の再生成・上書きは不要）

この文書は初回未設定時のhelper案内を振り返る過去資料です。現在の本人操作一覧として使用しません。**helperを再生成せず、FINGERPRINT_SECRET/CREDENTIALS/BILLING_ACCOUNTS/保存済みtest keyをこの案内で上書きしないでください。**

2026-10-13 20:42 UTCのmetadata診断ではFINGERPRINT_SECRET/CREDENTIALS等のSecret名/型が存在し、API_ENABLED=true、BILLING_ENABLED=true、BILLING_VERIFIED=false、STRIPE_MODE=test、saleActive=falseでした。初回の未保存/全flagsfalseという前提は現在の状態ではありません。diagnosticは値の一致や署名を検証するものではなく、[既存E2E証跡](sandbox-connection-evidence.md#既存sandbox実証診断とは別の証拠)と区別します。

初回helperは専用のtest原本、fingerprint、SHA256 registry、customer対応JSONを生成して保存するためのものでした。保存先と生成時24時間expiryは過去の初回設定仕様であり、期限更新・再発行・HMAC変更の指示ではありません。[当時の案内](https://github.com/recalm-lab/api-cost-outcome-check/blob/3cf745f71416d0c64598091b0fabb4880324dee6/docs/sandbox-save-next.md)と[helper](https://github.com/recalm-lab/api-cost-outcome-check/blob/5c72dea4babaa2821f06b8e4da4b5a7d22bbb5f1/tools/offline-sandbox-setup.html)は履歴として参照できます。

専用account `sandbox-e2e-20261013` / customer `cus_VQrJWHFdsVqzJG` では、既にCheckout・署名Webhook・1call・retry増分0・解約1円免除まで実証済みです。解約済み台帳を初回helperで初期化し直しません。別のStripe clock合成customerでは49円繰越＋翌月1円＝50円回収と1000円回収も確認しました。

RECALM_TEST_API_KEY名の直接readはmetadata診断では確認できていませんが、それをキー未保存・E2E未実行とは解釈しません。値を照会せず、必要なら既存の期限内認証結果で状態を確認します。期限切れ未確認のまま再生成を依頼しません。

現在のlive準備は[resumption-status](resumption-status.md)と[production](production.md)を参照してください。live meterは本人作成報告済み・正確ID確認待ちで、重複作成不要です。live Product/Price/Webhook、未発効規約、live秘密値3つは未完です。本記録の更新で保存・生成・契約・有効化・再配置は実行していません。
