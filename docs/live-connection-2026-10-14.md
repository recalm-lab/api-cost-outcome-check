# 閉鎖状態の本番接続確認 — 2026-10-14

本人がAccounts/Products/Prices/Billing MetersのReadのみ、他権限/Connect列Noneの本番キー作成を承認した。キー名 `recalm-api-cost-check-live`。Stripeの「新しいAPIキー」表示で作成を確認し、本人からWorkerの既存Secret型 `STRIPE_RESTRICTED_KEY` への保存完了を受領。値は取得していない。

Meter通知先 `ed_61VZjIA2JGNbpTnh416V0Dr7RqHNpbTY9mEkqeEfwPR2` のSecret更新ダイアログで有効期限「即時」(0)を選択し、最終実行と新しい値のSecret型 `STRIPE_METER_WEBHOOK_SECRET` 保存は本人が行ったと報告。更新ダイアログが閉じた状態を読み戻した。署名Secretの値・画面は記録しない。旧Secret即時失効は画面選択と本人完了報告に基づく。独立したStripe失効履歴や旧値で署名したリクエストの拒否は未確認。ローテーション後の現在署名は下記の実HTTPで検証済み。

対象通知先への無料のStripe Pingを送信し、`v2.core.event_destination.ping` の実形式を確認した。これはMeter usageイベントではなく、Subscription/invoice/paymentを作成しない接続確認通知。[公式イベント定義](https://docs.stripe.com/api/v2/core/events/event-types#api-event-types)に記載がある。現test/閉鎖設定での503 `billing_unavailable` は署名成功の証拠ではない。

## 閉鎖検証の最小修正

`billingConfig(...,'closed')` の場合だけ空customer mapping `{}` を許可する。runtimeでは従来どおり非空mappingが必須。本番customerをsandbox DOへ紐付けず、既存sandboxのmappingを本番へ流用しない。

既存 `/v1/stripe/meter-webhook` は、live・3flag=false・固定account/Price/Meter・専用Secretが揃う場合だけ、署名検証済み `v2.core.event_destination.ping` を閉鎖検証へ通す。related_object.id/type/urlを上記作成済みMeter通知先へ完全固定。通常runtimeではPingを拒否する。billingのsnapshot受信は引き続き既知customerだけで、空mappingでは拒否する。

成功しても503、`error=billing_closed` / `verification=signature_and_configured_catalog_only` / `received=false` / `eventProductVerified=false`。StripeへのGETはaccount、Price(product展開)、Meterだけ。DO dispatch・本文/結果/通知保存・Subscription作成・meter usage送信・invoice操作・決済はない。同一Ping再送も同じ閉鎖応答。実稼働時の重複台帳検証とは区別する。

## 非秘密設定変更と影響

本人のキー・新Meter署名Secret保存完了後に、検証済みコードをまずtest/3flag=falseのまま既存content-only uploaderで配置した。続く `scripts/configure-live-closed.mjs` のPATCHで次の5項目だけ変更した。

|項目|変更後|
|---|---|
|STRIPE_MODE|live|
|STRIPE_ACCOUNT_ID|acct_1TqptlRUIufKFmuE|
|STRIPE_PRICE_ID|price_1UQKQ0RUIufKFmuEMN1jt6OU|
|STRIPE_METER_ID|mtr_61VZYWJ5ULlQs4CCm41RUIufKFmuE4IC|
|BILLING_ACCOUNTS|{}|

API_ENABLED/BILLING_ENABLED/BILLING_VERIFIED=falseは読み取り必須条件とし、PATCHではinherit。他vars、Secret、ACCOUNTS/sqlite/export宣言、namespace、settingsは保持する。customer対応を空にするが、DOデータを削除・移行・再初期化しない。CREDENTIALS/FINGERPRINT_SECRETを触らない。既存test利用も停止のまま、本番API/契約/課金は提供しない。

source SHA、testの現account/Price/Meter/sandbox専用mapping、全flag、保持settings、100%配置と最新versionの一致、AccountMeter/sqliteのexportを確認してから、既存WorkerのみをPATCH。保存後に全bindings/settings/exportとhealthを比較。不一致・未知の設定・一部有効化・別workerでは停止。Secretを値なしで再構成せずinheritで保持。自動rollbackや一般deployへのfallbackは行わない。

実行は既存GitHub repository secretのCF credentialを安全注入する狭いworkflowを使い、秘密値の追加共有やtoken生成はしない。コード/通常pushの完了と実配置の完了を分ける。

## 判定

Meterの新署名: ローテーション後の正規Stripe Pingで上記503 verification markerが返れば、新しいWorker Secretが現在のStripe署名と一致し、読み取りkeyの固定catalog GETが通ったことを確認できる。失敗時は固定エラーを記録し、料金flagを有効にして解決しない。

旧Secret: [公式ローテーション説明](https://docs.stripe.com/webhooks#roll-endpoint-signing-secrets-periodically)では即時失効と猶予失効が区別される。本人の即時更新報告と画面選択、Stripe履歴の成功確認を分けて記録する。旧Secretを取得・保存して署名を捏造しない。即時失効後の正規新署名成功だけから「古い秘密値での偽造拒否を実送信で確認した」とは推論しない。

billing snapshotの専用Secret確認と本番課金検証は別。実顧客の契約・usage・確定・決済を作って受信試験しない。必要な安全な通知が得られなければ未検証として残す。

## 実行結果と現在の読み戻し

- 現Worker source: `01e29255e421ede7f0e9999051d224fac92f4ac5`。文書・workflowを含むブランチHEADとは別。
- `GET /health`: HTTP 200、`status=preparing`、`stripeMode=live`、`apiEnabled=false`、`billingEnabled=false`、`billingVerified=false`、`saleActive=false`。上表の固定live ID、空mapping、Secret名/型、既存DO namespace、settings/export保持は[GET-only run 38542750410](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38542750410)でsuccess。Secret値は読み出していない。
- 正規Stripe Ping: `evt_65VZmPmCjoEQ5nPwNWZ16V0Dr7RqHNpbTY9mEkqeEfwA6i`、2026-10-14 18:26:46 JST、live、関連先が既存Meter通知先と完全一致。レスポンスHTTP 503、`billing_closed` / `signature_and_configured_catalog_only` / `eventProductVerified=false` / `received=false`。HMAC・時刻・形式・宛先と、RAKによるaccount/Price(product展開)/MeterのGETが成立した。税込JPY1・月次従量・sum/raw・`stripe_customer_id`/`value`はコードのstrict検査を通った。
- 同一eventを18:28:29 JSTに手動再送。同じverification markerと503を読み戻した。Stripeの配信一覧は「失敗」だが、閉鎖状態で受領をackしない設計どおり。閉鎖分岐にDO dispatch/保存/課金がないことはコード・回帰試験で確認しており、実稼働台帳の本番重複試験とは区別する。
- 両Webhookに現在時刻・全ゼロの不正HMAC、本文 `{}` を送り、それぞれHTTP 400 `invalid_signature`。直前のhealthでlive・全flag=false・source SHAを確認。秘密値を使わない拒否試験で、旧Secretの個別失効証明ではない。
- billing snapshotの正規署名・再送は未検証。既存snapshot通知先には安全なPing操作が確認できず、空mappingは実顧客通知を拒否する。通すための本番customer作成・mapping追加・課金有効化は行っていない。

## 配置時の停止と再確認

[run 38541637026](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38541637026)はtest閉鎖content-only uploadと保持比較の後、即時HTTP healthチェックが失敗したため設定切替を実行せず停止した。その後の独立GETでsource `01e2925` とtest閉鎖を確認した。

再uploadせずconfig-only経路を使用。[run 38542044877](https://github.com/recalm-lab/api-cost-outcome-check/actions/runs/38542044877)はlive設定PATCH後の比較で失敗。独立healthではlive閉鎖を確認できたため、PATCHを繰り返さずGET-only検証を追加し、上記38542750410で全保持比較が成功した。失敗時の原因をedge伝播と断定せず、失敗runを成功証跡へ置き換えない。

## 開発確認と販売残件

配置source `01e2925` の全85 testsとdemo buildは成功。後続のread-only verifierを含む全86 testsは38542750410でpass 86 / fail 0。変更JSは構文確認済み、生成public差分なし。独立した型検査設定のないJavaScriptプロジェクトのため型検査済みとは表現しない。料金・成功定義・UTC月境界・上限・runtime重複処理・照合アルゴリズムを変更せず、LLM呼出しを追加していない。

販売用権限への拡張は未承認・未実行。顧客invoice balance取引、cash_balance展開、invoice_payments、Meter event_summariesのRAK group対応を、Credit Balances等と混同せず確定する必要がある。既存キー編集を優先し、次の権限承認前に確定差分を提示する。

[販売開始残件表](launch-readiness-2026-10-14.md#販売開始の残件)にある規約・プライバシー、保持/削除期間、返金/異議/紛争/責任、顧客対応、APIキー安全配布/失効、実Worker最大入力CPU、実稼働請求シナリオは未完。未発効のterms-draftから法的約束を新規確定せず、保存期間を推測して削除しない。sandbox/mockの成功を本番課金検証済みと扱わない。販売開始・有料契約・3flag有効化は行っていない。
