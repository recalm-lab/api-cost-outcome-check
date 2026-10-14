import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {billingEnv,webhookSecret} from './stripe-mock.js';
import {StripeClient,billingConfig} from '../src/stripe.js';
// Run the actual HTTP handler in Node; the closed path must never instantiate a DO.
const source=(await readFile(new URL('../src/worker.js',import.meta.url),'utf8'))
 .replace("import { DurableObject } from 'cloudflare:workers';",'class DurableObject {}')
 .replace(/from '\.\/([^']+)'/g,(_,path)=>"from '"+new URL('../src/'+path,import.meta.url).href+"'");
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const account='acct_1TqptlRUIufKFmuE',price='price_1UQKQ0RUIufKFmuEMN1jt6OU',meter='mtr_61VZYWJ5ULlQs4CCm41RUIufKFmuE4IC';
const env={...billingEnv,STRIPE_MODE:'live',STRIPE_RESTRICTED_KEY:'rk_live_synthetic_only_not_a_real_key',STRIPE_ACCOUNT_ID:account,STRIPE_PRICE_ID:price,STRIPE_METER_ID:meter,API_ENABLED:'false',BILLING_ENABLED:'false',BILLING_VERIFIED:'false',ACCOUNTS:{idFromName(){throw Error('closed_DO_dispatch');},get(){throw Error('closed_DO_dispatch');}}};
const snapshot={id:'evt_closed',type:'invoice.paid',livemode:true,data:{object:{id:'in_closed',customer:'cus_test'}}};
const thin={id:'evt_meter_closed',object:'v2.core.event',type:'v1.billing.meter.error_report_triggered',livemode:true,related_object:{id:meter,type:'billing.meter'}};
function signed(event,path='/v1/stripe/webhook',secret=webhookSecret,t=Math.floor(Date.now()/1000)){
 const body=JSON.stringify(event),sig=createHmac('sha256',secret).update(t+'.'+body).digest('hex');
 return new Request('https://example.test'+path,{method:'POST',headers:{'stripe-signature':'t='+t+',v1='+sig},body});
}
function catalog(overrides={}){
 const calls=[];
 return {calls,fetch:async(url,options)=>{
  const path=new URL(url).pathname;calls.push({method:options.method,path});assert.equal(options.method,'GET');
  let body;
  if(path==='/v1/account')body={id:account,charges_enabled:true,payouts_enabled:true};
  else if(path==='/v1/prices/'+price)body={id:price,livemode:true,active:true,product:{id:'recalm_api_cost_check_v1',active:true},billing_scheme:'per_unit',currency:'jpy',unit_amount:1,tax_behavior:'inclusive',recurring:{interval:'month',interval_count:1,usage_type:'metered',meter}};
  else if(path==='/v1/billing/meters/'+meter)body={id:meter,livemode:true,status:'active',event_name:env.STRIPE_EVENT_NAME,default_aggregation:{formula:'sum'},customer_mapping:{type:'by_id',event_payload_key:'stripe_customer_id'},value_settings:{event_payload_key:'value'},event_time_window:null};
  else throw Error('unexpected_read');
  return Response.json({...body,...(overrides[path]||{})});
 }};
}
test('closed live signed snapshot and thin verify only GET catalog, never acknowledge or dispatch; repeats stay closed',async()=>{
 const original=globalThis.fetch,mock=catalog();globalThis.fetch=mock.fetch;
 try{
  for(const [event,path,secret]of [[snapshot,'/v1/stripe/webhook',webhookSecret],[snapshot,'/v1/stripe/webhook',webhookSecret],[thin,'/v1/stripe/meter-webhook',env.STRIPE_METER_WEBHOOK_SECRET],[{...thin,type:'v1.billing.meter.no_meter_found',related_object:undefined},'/v1/stripe/meter-webhook',env.STRIPE_METER_WEBHOOK_SECRET]]){
   const response=await worker.fetch(signed(event,path,secret),env);assert.equal(response.status,503);const body=await response.text();
   assert.deepEqual(JSON.parse(body),{error:'billing_closed',verification:'signature_and_configured_catalog_only',eventProductVerified:false,received:false});
   for(const secretValue of [env.STRIPE_RESTRICTED_KEY,webhookSecret,env.STRIPE_METER_WEBHOOK_SECRET])assert.ok(!body.includes(secretValue));
  }
  assert.equal(mock.calls.length,12);assert.ok(mock.calls.every(c=>c.method==='GET'));
  for(const [path,method]of [['/v1/check','POST'],['/v1/checkout','POST'],['/v1/cancel','POST'],['/v1/billing','GET']]){
   assert.equal((await worker.fetch(new Request('https://example.test'+path,{method}),env)).status,503);
  }
  assert.equal(mock.calls.length,12);
  assert.equal((await (await worker.fetch(new Request('https://example.test/health'),env)).json()).saleActive,false);
 }finally{globalThis.fetch=original;}
});
test('closed rejects bad signature, expired time, mode, account, context, event type, customer and meter before Stripe reads',async()=>{
 const original=globalThis.fetch,mock=catalog();globalThis.fetch=mock.fetch;
 try{
  const requests=[
   signed(snapshot,undefined,'whsec_wrong_signature'),signed(snapshot,undefined,webhookSecret,Math.floor(Date.now()/1000)-301),
   signed({...snapshot,livemode:false}),signed({...snapshot,account:'acct_wrong'}),signed({...snapshot,context:'acct_wrong'}),
   signed({...snapshot,type:'charge.succeeded'}),signed({...snapshot,data:{object:{id:'in_closed',customer:'cus_unknown'}}}),
   signed({...thin,related_object:{id:'mtr_wrong',type:'billing.meter'}},'/v1/stripe/meter-webhook',env.STRIPE_METER_WEBHOOK_SECRET),
   signed(thin,'/v1/stripe/meter-webhook',webhookSecret)
  ];
  for(const request of requests)assert.equal((await worker.fetch(request,env)).status,400);
  assert.deepEqual(mock.calls,[]);
 }finally{globalThis.fetch=original;}
});
test('closed rejects wrong target configuration and catalog, and partial flags never bypass runtime gate',async()=>{
 const original=globalThis.fetch,mock=catalog({['/v1/billing/meters/'+meter]:{default_aggregation:{formula:'count'}}});globalThis.fetch=mock.fetch;
 try{
  const response=await worker.fetch(signed(snapshot),env);assert.equal(response.status,503);assert.equal((await response.json()).error,'catalog_mismatch');
  const count=mock.calls.length;
  for(const extra of [{STRIPE_ACCOUNT_ID:'acct_other'},{STRIPE_PRICE_ID:'price_other'},{STRIPE_METER_ID:'mtr_other'},{STRIPE_RESTRICTED_KEY:billingEnv.STRIPE_RESTRICTED_KEY},{API_ENABLED:'true'},{BILLING_ENABLED:'true'},{BILLING_VERIFIED:'true'},{API_ENABLED:undefined}]){
   assert.equal((await worker.fetch(signed(snapshot),{...env,...extra})).status,503);
  }
  assert.equal(mock.calls.length,count);
  assert.throws(()=>billingConfig(env));
  const client=new StripeClient(env,mock.fetch,'closed');
  for(const [method,path]of [['POST','/v1/billing/meter_events'],['GET','/v1/customers/cus_test'],['DELETE','/v1/subscriptions/sub_test']])await assert.rejects(client.request(method,path),/closed_read_only/);
  assert.equal(mock.calls.length,count);
 }finally{globalThis.fetch=original;}
});

test('same-customer other-product notifications never reach billing and never claim product verification',async()=>{
 const original=globalThis.fetch,mock=catalog();globalThis.fetch=mock.fetch;
 try{
  const event={...snapshot,data:{object:{...snapshot.data.object,lines:{data:[{pricing:{price_details:{price:'price_unrelated'}}}]}}}};
  const response=await worker.fetch(signed(event),env);assert.equal(response.status,503);
  const body=await response.json();assert.equal(body.received,false);assert.equal(body.eventProductVerified,false);assert.equal(body.verification,'signature_and_configured_catalog_only');
  assert.ok(mock.calls.every(c=>c.method==='GET'));assert.equal(mock.calls.length,3);
 }finally{globalThis.fetch=original;}
});
