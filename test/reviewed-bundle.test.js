import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {Miniflare} from 'miniflare';
import {buildReviewedBundle} from '../scripts/build-reviewed-worker.mjs';
test('reviewed single-module bundle compiles in workerd and rejects all billing routes while test closed',async()=>{
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),built=buildReviewedBundle(sha);
 const mf=new Miniflare({modules:true,script:built.bundle,compatibilityDate:'2026-07-30',durableObjects:{ACCOUNTS:{className:'AccountMeter',useSQLite:true}},bindings:{STRIPE_MODE:'test',API_ENABLED:'false',BILLING_ENABLED:'false',BILLING_VERIFIED:'false'}});
 try{
  const response=await mf.dispatchFetch('https://test/health');assert.equal(response.headers.get('x-recalm-source-commit'),sha);const health=await response.json();
  assert.equal(health.stripeMode,'test');for(const key of ['apiEnabled','billingEnabled','billingVerified','saleActive'])assert.equal(health[key],false);
  for(const path of ['/v1/check','/v1/checkout','/v1/cancel','/v1/stripe/webhook','/v1/stripe/meter-webhook']){
   const response=await mf.dispatchFetch('https://test'+path,{method:'POST',body:'{}'});assert.equal(response.status,503);assert.equal(response.headers.get('x-recalm-source-commit'),sha);
  }
  assert.equal((await mf.dispatchFetch('https://test/')).status,200);
 }finally{await mf.dispose();}
});
