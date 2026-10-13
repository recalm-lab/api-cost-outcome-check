# 実配置結果 — 2026-10-13

配置済みコードSHA: `33c25882ab2b3d9ff1f6a9e1ebae3414a9e390a5`。
専用tag: `recalm-sandbox-scoped-deploy-20261013-01`。
公開URL: https://recalm-api-cost-check.rough-sound-e8d7.workers.dev

[配置run38357985068](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38357985068)でtest/build/dry-runと公式Worker PUTが成功した。結果はuploaded=true、secretBindingsRetained=true、storage=sqlite、exportsCreated=[AccountMeter]。routesChanged/domainsChanged=false。tokenの権限を追加せず、既存商品Workerだけを更新した。Secret値は読み出していない。

直後06:40:18UTCのpublic /healthは404だったためrun全体はfailureになった。**再deployせず**読み取りだけを行い、[診断run38358380671](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38358380671)の06:44:10UTCで以下を確認した。

|チェック|結果|
|---|---|
|対象service/environment|200、lastDeployedFrom=api|
|既存workers.dev|enabled=true、previews=false|
|/health|200|
|stripeMode|test|
|apiEnabled / billingEnabled / billingVerified|全false|
|saleActive|false|
|/openapi.json|200、OpenAPI3.1.0、version0.3.0|
|routes/domains read|403のまま。配置に追加権限を使っていない|

upload resultのstartupMs=1は**startup時間**で、請求照合requestのCPUではない。正式API/DOのcold/warm/max-input CPUとStripe E2Eはまだ未検証。現段階は販売・有料API利用無効で、静的合成demo/説明/OpenAPIを公開している。

## 次の安全な本人入力

保存済みSTRIPE_RESTRICTED_KEYを移送・取得しない。Cloudflareの**このWorker** Settings→Variables and Secretsで次だけを設定する。

- 通常vars: deploy/sandbox-vars.jsonの非秘密値。mode=testを維持。専用sandbox cus_IDをBILLING_ACCOUNTSへ実値で設定し、account名はsandbox-e2e-20261013でCREDENTIALSと一致させる。値を推測しない。
- Secret STRIPE_WEBHOOK_SECRET: sandbox endpoint `/v1/stripe/webhook` のwhsec_を本人が直接保存する。必須event/versionはsandbox-activation.mdを参照。
- Secret FINGERPRINT_SECRET:専用256-bit以上、base64url43..128文字。
- Secret CREDENTIALS:本人のテストキーのSHA256 lowercase hex→account/enabled/数値expiresAt/maxMonthlySuccessfulCallsのmap。原本のキーではない。
- 原本テストキー:同じapi repoのActions encrypted secret RECALM_TEST_API_KEYへ本人が直接保存する。モデル/ログ/repo filesへ表示しない。

入力完了後のみ、sandbox試験としてAPI_ENABLED/BILLING_ENABLEDをtrueにし、BILLING_VERIFIED=falseを維持してCheckout/署名/計量/回収/解約を検証する。liveに切り替えず、price/product/planを重複作成しない。追加scopeが必要なら操作/HTTP/error codeを報告して止める。
