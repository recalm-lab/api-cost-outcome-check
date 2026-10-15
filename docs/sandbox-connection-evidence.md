# Sandbox connection metadata — 2026-10-13 20:42 UTC

Worker再配置なし、Secret値の取得・比較・生成・上書きなし。

## Worker診断

[run38464934242](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38464934242) のmetadata step成功。STRIPE_RESTRICTED_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_METER_WEBHOOK_SECRET / FINGERPRINT_SECRET / CREDENTIALSは全てSecret名/型として存在する。bindings GET200、workers.dev enabled、preview disabled。公開health200、test mode、apiEnabled=true/billingEnabled=true/billingVerified=false/saleActive=false。最終変更metadata15:07:28Z、lastDeployedFrom=dash。3flagsfalseを要求するreadinessは差分によりfailure。falseへリセットする操作は実施していない。

依頼時点の公開SHAc09e34f/3flagsfalse/FP・registry未保存という状態を現在の事実とみなさない。Worker runtime SHAはこのmetadataだけでは判別しない。Secret名存在は正しい値や署名検証成功の証拠ではない。GitHub repo encrypted RECALM_TEST_API_KEY名はread手段から確認できず、未保存とも保存済みとも断定しない。

## Stripe非秘密読み取り

sandbox account acct_1TqptzD1AvIZkMfK、livemode=falseに限定。snapshot endpoint we_1UQ21uD1AvIZkMfKybIVx2LZ、URL /v1/stripe/webhook、enabled、snapshot、version2026-08-26.dahlia、@self。13eventsはcheckout completed/async success/async failed、subscription created/updated/deleted、invoice created/updated/finalized/paid/payment_failed/voided/marked_uncollectible。

thin destination ed_test_61VZQ0613d6RRGITa16V0DrLRqHNrrzGCgXpGTLHUSFE、URL /v1/stripe/meter-webhook、enabled、thin、@self、v1.billing.meter.error_report_triggered / v1.billing.meter.no_meter_foundのみ。署名Secretは取得しない。宛先enabledは配信成功の証拠ではない。このmetadata診断では新契約・meter event・請求・支払い・有効化を実行していない。プロジェクト全体の既存sandbox実証は下記を参照。

親担当へ現況差分を引き継ぐ。初回helperの再生成・既存値上書きは現在不要。[sandbox-save-next.md](sandbox-save-next.md)は過去資料であり実行指示ではない。


## 既存sandbox実証（診断とは別の証拠）

metadataで「値未検証」「Secret名のみ存在」「宛先enabled」と記録したことは、その診断の範囲です。以下の実接続試験まで未実行とする意味ではありません。秘密値の取得・比較をせず、署名検証を含むruntime受信結果、Stripeと台帳の読み戻しで確認しました。

- 契約: 専用合成customer `cus_VQrJWHFdsVqzJG` / subscription `sub_1UQ7QDD1AvIZkMfKhR3fAYaN`。Checkout完了event `evt_1UQ7QFD1AvIZkMfKLBjQ6LAR` は対象Worker /v1/stripe/webhookへ200。success pageだけを利用可能の証拠にしていない。
- [実Worker 1call/retry/conflict](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38420958389/job/115377821874): firstIncrement1、同じkey/本文retryIncrement0、変更本文409。meter200だけでなくinvoice数量1を確認した。
- [解約1回](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38422369133/job/115382770995)と[最終台帳](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38420707095/job/115383865311): Stripe canceled、invoice `in_1UQ7dSD1AvIZkMfK1uYWHVir` 数量1/合計1円/回収0円。既存自動waive処理で−1円adjustment `cbtxn_1UQ7ehD1AvIZkMfKWFvGRVas` / Stripe balance0。API outstandingJpy0/collectedJpy0/waivedJpy1/cancelRequestedtrue/activefalse/holdfalse/manualReconciliationRequiredfalse。
- 解約通知 `evt_1UQ7dSD1AvIZkMfKeCV1C849` と最終invoice.paid `evt_1UQ7eSD1AvIZkMfKskqYOsIH` は対象Workerへ200。これはsnapshotの実証で、thin destinationの配信実証を推測しない。
- Stripe clockの別合成customer `cus_VQoavxGaZUgnF9`: [49円invoice](https://dashboard.stripe.com/acct_1TqptzD1AvIZkMfK/test/invoices/in_1UQ7uaD1AvIZkMfK2fFkNfV3)は数量49/amount_paid0/customer balance49。翌月の1円は公式UIから一度だけ送信し、request `req_CPyt7BlVbyJO7L` 200・今月数量1/繰越49/予定請求50を確認。
- [49→50円回収invoice](https://dashboard.stripe.com/acct_1TqptzD1AvIZkMfK/test/invoices/in_1UQ892D1AvIZkMfKTj1UnfBc)はtotal1/starting_balance49/amount_paid50/remaining0/ending_balance0、InvoicePayment `inpay_1UQ89zD1AvIZkMfKrw9AwvKm` paid50、customer balance0。共有clockは11/1 01:00 UTC readyで停止した。
- [1000円invoice](https://dashboard.stripe.com/acct_1TqptzD1AvIZkMfK/test/invoices/in_1UQ7udD1AvIZkMfK7chQt2kI)は数量1000/InvoicePayment paid1000/balance0。曖昧だった別50円customerのイベントは再送せず判定から除外した。

Stripe clockでの境界確認はWorkerの実時刻による月境界E2Eと区別します。mock/注入時刻/workerdの回帰とCPU集計・残件は[production](production.md)を参照。この文書更新では試験・再送・契約・設定変更を新たに実行していません。
