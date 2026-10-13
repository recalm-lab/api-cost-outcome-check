# Sandbox connection metadata — 2026-10-13 20:42 UTC

Worker再配置なし、Secret値の取得・比較・生成・上書きなし。

## Worker診断

[run38464934242](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38464934242) のmetadata step成功。STRIPE_RESTRICTED_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_METER_WEBHOOK_SECRET / FINGERPRINT_SECRET / CREDENTIALSは全てSecret名/型として存在する。bindings GET200、workers.dev enabled、preview disabled。公開health200、test mode、apiEnabled=true/billingEnabled=true/billingVerified=false/saleActive=false。最終変更metadata15:07:28Z、lastDeployedFrom=dash。3flagsfalseを要求するreadinessは差分によりfailure。falseへリセットする操作は実施していない。

依頼時点の公開SHAc09e34f/3flagsfalse/FP・registry未保存という状態を現在の事実とみなさない。Worker runtime SHAはこのmetadataだけでは判別しない。Secret名存在は正しい値や署名検証成功の証拠ではない。GitHub repo encrypted RECALM_TEST_API_KEY名はread手段から確認できず、未保存とも保存済みとも断定しない。

## Stripe非秘密読み取り

sandbox account acct_1TqptzD1AvIZkMfK、livemode=falseに限定。snapshot endpoint we_1UQ21uD1AvIZkMfKybIVx2LZ、URL /v1/stripe/webhook、enabled、snapshot、version2026-08-26.dahlia、@self。13eventsはcheckout completed/async success/async failed、subscription created/updated/deleted、invoice created/updated/finalized/paid/payment_failed/voided/marked_uncollectible。

thin destination ed_test_61VZQ0613d6RRGITa16V0DrLRqHNrrzGCgXpGTLHUSFE、URL /v1/stripe/meter-webhook、enabled、thin、@self、v1.billing.meter.error_report_triggered / v1.billing.meter.no_meter_foundのみ。署名Secretは取得しない。宛先enabledは配信成功の証拠ではない。新契約・meter event・請求・支払い・有効化は実行していない。

親担当へ現況差分を引き継ぎ、初回用helperでの再生成/上書きは保留。準備済み保存先はsandbox-save-next.md。
