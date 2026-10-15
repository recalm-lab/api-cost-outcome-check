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
    const examples=await (await mf.dispatchFetch('https://demo/examples.json')).json();assert.equal(Object.keys(examples).length,4);for(const input of Object.values(examples)) assert.equal(reconcile(input).algorithmVersion,'1');
    assert.equal(await readFile('public/reconcile.js','utf8'),await readFile('src/reconcile.js','utf8'));
  }finally{await mf.dispose();}
});
test('Dashboard pasteable single module contains demo/OpenAPI/terms and no live routes or bindings',async()=>{
 const mf=new Miniflare({modules:true,script:await readFile('public/dashboard-demo-worker.js','utf8'),compatibilityDate:'2026-07-30'});
 try{
  assert.equal((await mf.dispatchFetch('https://demo/')).status,200);assert.equal((await mf.dispatchFetch('https://demo/openapi.json')).status,200);assert.equal((await mf.dispatchFetch('https://demo/terms.html')).status,200);
  const health=await (await mf.dispatchFetch('https://demo/health')).json();assert.equal(health.apiEnabled,false);assert.equal(health.saleActive,false);
  for(const path of ['check','checkout','cancel','stripe/webhook'])assert.equal((await mf.dispatchFetch('https://demo/v1/'+path,{method:'POST',body:'do not read this body'})).status,503);
  assert.equal((await mf.dispatchFetch('https://demo/checkout-result.html')).status,200);
 }finally{await mf.dispose();}
});
