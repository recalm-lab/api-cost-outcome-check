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


## 2026-10-13 07:23 UTC 修正版sandbox配置

公開URL: https://recalm-api-cost-check.rough-sound-e8d7.workers.dev

- 配置SHA: `c09e34f0aa196de4ee2902bf5b4574a32b983c82`（runtime修正bbd2474 + closed probe/非秘密registry準備）。
- 公式PUT run: https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38362209929 。46/46 tests、compile、upload成功。既存Secret binding保持、SQLite維持、exports追加なし、route/domain変更なし。startup 2msはリクエストCPU測定ではない。直後のreadinessは新OpenAPI反映前に失敗し、このrunの総合結果はfailure。
- 再deployせず診断: https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38362300836 。07:23:11 UTCにhealth200、OpenAPI200（新meter routeあり）、POST空JSON `/v1/stripe/meter-webhook` 503 billing_unavailable、全3flagsfalse、mode test、saleActivefalseを確認しsuccess。署名やSecret値は取得していない。
- bindings照合はSecretの名前/型の保持を確認したもの。値比較ではない。専用Secret欠落/共有時の課金開始拒否はworkerdテストで検証。公開probeは停止設定の入口拒否であり、Secretの有無や実署名検証の証拠ではない。
- customer/account対応の非秘密準備はsandbox-registry-preparation.json。秘密CREDENTIALSは本人のローカル補助HTMLからWorkerへ直接保存する。対応JSON/registryをWorkerへ適用しておらず、契約作成も行っていない。
- thin/snapshotの2宛先と専用Secret、sandbox E2E、実リクエストCPU、本番決済・提供導線の検証が残る。販売停止維持。
