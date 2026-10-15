import {readFile,writeFile} from 'node:fs/promises';
// Mutable draft preview only. Checkout uses digest-addressed registered documents;
// this script never approves/releases terms or overwrites their archived bytes.
const text=await readFile('docs/terms-draft.md','utf8');const escaped=text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
await writeFile('public/terms.html',`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recalm API Cost Check — 利用条件の下書き</title><link rel="stylesheet" href="/style.css"></head><body><main><h1>利用条件の下書き — 販売開始前</h1><p>料金・販売者表示は承認済みですが、提供導線と残る契約条件の検証前です。</p><pre class="terms">${escaped}</pre><p><a href="/">商品説明へ戻る</a> · <a href="mailto:info@recalm.jp">info@recalm.jp</a></p></main></body></html>\n`);
