# 本人PC内だけで作るsandbox test設定

Cloudflare/GitHubの公式Secret入力欄は安全な保存先だが、独立した顧客APIキーとHMAC、SHA256 registry、数値expiryを一括生成する機能ではない。手計算を避けるため、**通信しない単一ローカルHTML**だけを用意した。新しいkey/token/OAuthを代理発行するserver機能ではない。

## 本人の操作

1. [tools/offline-sandbox-setup.html](../tools/offline-sandbox-setup.html)のGitHubページで**Download raw file**を押し、本人PCへHTMLとして保存する。zip展開・PC shell・npmは不要。ダウンロード済みHTMLをPCブラウザで開く。URLが `file:` であることを確認する。Web/https上では生成ボタンを無効にする。
2. 本人が「専用テスト値をPC内で生成」を1回押す。標準Web Cryptoで別々の256-bit値を生成し、キーのSHA256と実行時刻+24hの数値expiryをPC内で自動計算する。秘密・registryは非表示。コピー操作を本人が行い、準備済み公式設定画面へ直接貼り付ける。
3. 上から順にコピー/保存する。テストAPIキー → api repo Actions encrypted secret `RECALM_TEST_API_KEY`。fingerprint → 対象Worker Secret `FINGERPRINT_SECRET`。registry JSON → 同Worker Secret `CREDENTIALS`。customer対応JSON → 同Worker通常var `BILLING_ACCOUNTS`。
4. すべて保存するまでページを閉じたり再生成したりしない。最後に「ページ内の値を消去」を押して閉じる。ページは自動保存せず、再取得機能もない。クリップボード・公式Secret保存先は別に残る。モデル/PC操作担当は値を読み取り・チャット・ログへ転記しない。

既存fingerprintを変更したり既存利用済みregistryを丸ごと上書きするための道具ではない。今回の**初回専用sandbox**用。すでに保存した値/利用記録がある場合は止めて担当者へ伝える。生成後はボタンを無効にし、誤った二重生成を防ぐ。生成中の消去/ページ離脱も世代番号で保護し、後から結果を再表示しない。

## 既定の非秘密値

- account: `sandbox-e2e-20261013`
- customer: `cus_VQrJWHFdsVqzJG`（親取得済み。invoice0/balance0/cash balanceなし/livemode=falseの最終確認待ち）
- expiresAt: 本人が押した実行時刻から24hのUTC epoch milliseconds数値
- maxMonthlySuccessfulCalls:1000

customer IDは入力済みで4つ目のJSONをそのままコピーできる。必要なら本人が非秘密ID欄だけ編集でき、不正な形式はコピーを拒否する。customer最終検証前に有効化しない。

## 安全性と確認

単一HTMLに依存と秘密の埋込みはなく、外部script/style/font/image/importなし。fetch/XHR/WebSocket/beacon/cookie/localStorage/sessionStorage/IndexedDB/consoleを使用しない。CSPはconnect-src none、form-action none、script/styleは内容のSHA256 hashで固定する。外部リンク・フォーム送信・ダウンロード送信はない。コピーは本人操作でローカルclipboardへだけ書く（読み出さない）。アプリが通信しないことと、OS clipboard同期や公式保存先の動作は区別する。

テストは固定の公開合成bytesを注入し、実乱数で秘密を生成していない。SHA256、正しい数値期限、弱い乱数fallback拒否、customer map、CSP hash、無通信/無保存、自動生成なし、本人click後だけの生成、local copy、消去、httpsでの生成拒否を確認した。VMのDOMテストであり、本人PCのclipboard権限・fileブラウザ操作の実確認はPC担当が行う。**現時点で秘密は未生成、未保存、設定・契約・請求・再deployは行っていない。**

再生成は開発環境で `node scripts/build-offline-setup.mjs`。これはHTML sourceを組み立てるだけで、keyは生成しない。実行する本人PCではこの開発コマンドは不要。
