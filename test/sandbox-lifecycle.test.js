import test from 'node:test';
import assert from 'node:assert/strict';
import {TARGET, execute, validateContext, validateHealth, validateCheckout, safeStatus} from '../scripts/sandbox-lifecycle.mjs';
const vars={STRIPE_MODE:'test',STRIPE_ACCOUNT_ID:TARGET.stripeAccount,PUBLIC_BASE_URL:TARGET.base,STRIPE_PRICE_ID:TARGET.price,STRIPE_METER_ID:TARGET.meter,TERMS_VERSION:TARGET.terms,BILLING_VERIFIED:'false'};
const health={status:'sandbox',stripeMode:'test',saleActive:false,billingVerified:false,apiEnabled:true,billingEnabled:true};
const status={outstandingJpy:0,collectedJpy:0,waivedJpy:0,active:false,cancelRequested:false,hold:false,manualReconciliationRequired:false,billingTimezone:'UTC',paymentUrl:'NEVER_OUTPUT_CAPABILITY'};
const key='t'.repeat(43), now=1000;
const response=b=>new Response(JSON.stringify(b),{status:200});
function mock(results,calls){return async(url,options)=>{calls.push({url,options});const r=results.shift();if(r instanceof Error)throw r;return response(r);};}
test('reject live mode, altered destination, account, catalog, and verified sale context',()=>{
  validateContext(vars,TARGET.account);
  for(const [k,v] of [['STRIPE_MODE','live'],['PUBLIC_BASE_URL','https://example.com'],['STRIPE_ACCOUNT_ID','acct_other'],['STRIPE_PRICE_ID','price_other'],['STRIPE_METER_ID','meter_other'],['BILLING_VERIFIED','true']])assert.throws(()=>validateContext({...vars,[k]:v},TARGET.account));
  assert.throws(()=>validateContext(vars,'another-account'));
});
test('remote live mode, public sales or verified billing fail before authenticated calls',async()=>{
  for(const change of [{stripeMode:'live'},{saleActive:true},{billingVerified:true},{apiEnabled:false}]){
    const calls=[];await assert.rejects(execute('checkout',{vars,key,fetchImpl:mock([{...health,...change}],calls),now}));assert.equal(calls.length,1);assert.equal(calls[0].options.headers.authorization,undefined);
  }
});
test('Checkout retry uses one fixed key/body and rejects unsafe response URLs',async()=>{
  const all=[];
  for(let i=0;i<2;i++){
    const calls=[];const result=await execute('checkout',{vars,key,fetchImpl:mock([health,status,{checkoutUrl:'https://checkout.stripe.com/c/pay/cs_test_fixture#test',expiresAt:2000}],calls),now});all.push(calls);
    assert.equal(result.checkout.expiresAt,2000);assert.equal(calls[2].url,TARGET.base+'/v1/checkout');assert.equal(calls[2].options.body,JSON.stringify({termsVersion:TARGET.terms}));assert.equal(calls[2].options.redirect,'error');
  }
  assert.equal(all[0][2].options.headers['idempotency-key'],all[1][2].options.headers['idempotency-key']);
  for(const url of ['https://checkout.stripe.com/c/pay/cs_live_fixture','https://checkout.stripe.com.evil.test/c/pay/cs_test_x','https://user:pass@checkout.stripe.com/c/pay/cs_test_x','http://checkout.stripe.com/c/pay/cs_test_x'])assert.throws(()=>validateCheckout({checkoutUrl:url,expiresAt:2000},now));
  assert.throws(()=>validateCheckout({checkoutUrl:'https://checkout.stripe.com/c/pay/cs_test_x',expiresAt:900},now));
});
test('hold, existing contract, cancellation and debt prohibit Checkout POST',async()=>{
  for(const change of [{active:true},{hold:true},{manualReconciliationRequired:true},{cancelRequested:true},{outstandingJpy:1}]){const calls=[];await assert.rejects(execute('checkout',{vars,key,fetchImpl:mock([health,{...status,...change}],calls),now}));assert.equal(calls.length,2);}
});
test('status returns only whitelisted counters and booleans, no URLs or identifiers',async()=>{
  const calls=[];const result=await execute('status',{vars,key,fetchImpl:mock([health,status],calls)});assert.equal(calls.length,2);assert.equal(calls[1].options.method,'GET');assert.equal(JSON.stringify(result).includes('NEVER_OUTPUT'),false);assert.deepEqual(result.status,safeStatus(status));assert.throws(()=>safeStatus({...status,outstandingJpy:NaN}));
});
test('cancel is a separate single empty-JSON POST with acknowledgement only',async()=>{
  const calls=[];const result=await execute('cancel',{vars,key,fetchImpl:mock([health,{...status,active:true},{cancelRequested:true,private:'DROP'}],calls)});assert.deepEqual(result,{cancelRequested:true});assert.equal(calls[2].url,TARGET.base+'/v1/cancel');assert.equal(calls[2].options.body,'{}');assert.equal(calls[2].options.method,'POST');
});
test('ambiguous POST and HTTP errors are never retried or surfaced as raw bodies',async()=>{
  const calls=[];await assert.rejects(execute('checkout',{vars,key,fetchImpl:mock([health,status,new Error('SECRET_DO_NOT_LOG')],calls),now}),/sandbox_lifecycle_failed/);assert.equal(calls.length,3);
  let count=0;await assert.rejects(execute('status',{vars,key,fetchImpl:async()=>{count++;return new Response('PRIVATE_BODY',{status:403});}}),/sandbox_lifecycle_failed/);assert.equal(count,1);
});
