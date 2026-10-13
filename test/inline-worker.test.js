import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Miniflare} from 'miniflare';
test('scoped upload package exposes the same API/DO and static pages with no assets binding',async()=>{
 const files=['src/inline-worker.js','src/worker.js','src/reconcile.js','src/meter.js','src/stripe.js','src/billing.js','public/dashboard-demo-worker.js'];
 const modules=await Promise.all(files.map(async path=>({type:'ESModule',path:resolve(path),contents:await readFile(path,'utf8')})));
 const mf=new Miniflare({modules,compatibilityDate:'2026-07-30',durableObjects:{ACCOUNTS:{className:'AccountMeter',useSQLite:true}},bindings:{STRIPE_MODE:'test',API_ENABLED:'false',BILLING_ENABLED:'false',BILLING_VERIFIED:'false'}});
 try{
  const health=await (await mf.dispatchFetch('https://test/health')).json();assert.equal(health.stripeMode,'test');for(const key of ['apiEnabled','billingEnabled','billingVerified','saleActive'])assert.equal(health[key],false);
  for(const path of ['/','/openapi.json','/examples.json','/terms.html'])assert.equal((await mf.dispatchFetch('https://test'+path)).status,200);
  for(const path of ['/v1/check','/v1/checkout','/v1/cancel','/v1/stripe/webhook'])assert.equal((await mf.dispatchFetch('https://test'+path,{method:'POST',body:'{}'})).status,503);
 }finally{await mf.dispose();}
});
