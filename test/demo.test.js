import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Miniflare} from 'miniflare';
import {reconcile} from '../src/reconcile.js';
test('static assets serve demo, OpenAPI, headers and no operational API',async()=>{
  const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("not_available",{status:503})}}',compatibilityDate:'2026-07-30',assets:{directory:resolve('public')}});
  try{
    const page=await mf.dispatchFetch('https://demo/');assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes('園田敏之'));assert.ok(html.includes('info@recalm.jp'));assert.ok(html.includes('未開始'));
    assert.ok(page.headers.get('content-security-policy').includes("form-action 'none'"));
    const api=await mf.dispatchFetch('https://demo/openapi.json');assert.equal(api.status,200);assert.equal((await api.json()).openapi,'3.1.0');
    assert.notEqual((await mf.dispatchFetch('https://demo/v1/check',{method:'POST',body:'{}'})).status,200);
    const examples=await (await mf.dispatchFetch('https://demo/examples.json')).json();assert.equal(Object.keys(examples).length,3);for(const input of Object.values(examples)) assert.equal(reconcile(input).algorithmVersion,'1');
    assert.equal(await readFile('public/reconcile.js','utf8'),await readFile('src/reconcile.js','utf8'));
  }finally{await mf.dispose();}
});
