# Test closed deployment evidence — 2026-10-14

対象は既存 Cloudflare account `9a2e48df6882d20c2d1c4398184215a9`、Worker `recalm-api-cost-check` のみ。

[実行run 38519747808](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38519747808)、job `115706485524` は成功。UTC 06:00:59に3flag閉鎖と保持比較、06:01:03にcontent-only uploadと保存後のHTTP確認が完了した。

## 配置内容・読み戻し

- source commit: `4c42a85efa3e4e31f00039e692a323f63128f2f7`
- fresh bundle SHA-256: `2999bc199c8a1271581524dfbe55cba6febb9d2a0d8e08b5d38318506b29385f`
- STRIPE_MODE=testを維持
- API_ENABLED / BILLING_ENABLED / BILLING_VERIFIED = false
- 既存vars / json binding / Secret binding / namespaceを保持。Secret値は取得・表示・再生成・上書きしていない。
- ACCOUNTS / AccountMeter / sqlite / namespace `0b8d1c5cea78485d9d9ae6a62ed98b6f`を保持
- compatibility_date=2026-10-01、flags=[]、logpush=false、tags=[]、tail_consumers=[]、placement={}、usage_model=standardを保持
- **observability未返却、content-only APIの保持仕様に基づき変更なし**。無効化済みとは扱わない。
- 保存後に設定とbindingを比較して一致。HTTPの `x-recalm-source-commit` がsource SHAと一致し、healthの3flagとsaleActiveがfalse、snapshot/thinへの無署名本文が安全拒否されることをuploaderが確認した。
- [期待設定JSON](../deploy/test-closed-expected-settings.json)にはobservabilityを追加していない。

## HTTP 400の原因と修正

認証エラーやJSON解析エラーではなかった。公式PATCH settingsのmultipart `settings` JSON部分からexportsを省略していたため、Cloudflareがcode `100402` / `provisioned_class_missing_from_config`を返した。

既存100%配置版と最新upload版の一致を確認し、version GETの `resources.script_runtime.exports` から既存AccountMeterの `{type:"durable-object",storage:"sqlite"}` を読み取った。同じ宣言をPATCHへ保持し、その他全bindingは `inherit`、変更する3flagだけplain_text=falseとした。secret_textを値なしで再送していない。保存後にもexport宣言とnamespaceを比較した。新namespaceの作成・移行は行っていない。

[公式PATCH schema](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/edit/) と [content-only API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/content/methods/update/) に基づく。実配置には旧uploaderを使用していない。

## 残る工程

この完了はtestの販売停止状態での受信コード配置に限る。本番mode、販売開始、Stripe destination作成、顧客請求は未実施。親が進める承認済みdestination作成と本人の専用Secret保存、その後のlive-closed設定と署名/catalog確認へ引き継ぐ。本番切替まではlive通知をtest閉鎖受信側が安全拒否する。

合成sandbox実E2Eは再実行していない。規約・保存期間・責任上限・返金運用・最大入力CPU等の販売開始条件は別途確定が必要。
