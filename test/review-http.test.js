import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,createHmac} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {billingEnv,stripeMock,webhookSecret} from './stripe-mock.js';
import {testTerms,testTermsDocuments,invoice} from './helpers.js';
import {normal} from '../scripts/fixtures.mjs';

// Set only when reproducing the immutable reviewed baseline. No production clock or registry override exists.
const baseline=process.env.RECALM_REVIEW_BASELINE;
const names=baseline?['worker','reconcile','meter','stripe','billing']:['worker','reconcile','meter','stripe','terms-registry','terms','billing'];
const modules=await Promise.all(names.map(async name=>({type:'ESModule',path:resolve('src/'+name+'.js'),contents:baseline?execFileSync('git',['show',baseline+':src/'+name+'.js'],{encoding:'utf8'}):await readFile('src/'+name+'.js','utf8')})));
const tokens=['review_http_synthetic_credential_a_'.padEnd(50,'x'),'review_http_synthetic_credential_b_'.padEnd(50,'x')];
const credentials=Object.fromEntries(tokens.map((t,i)=>[createHash('sha256').update(t).digest('hex'),{account:i?'other-account':'test-account',enabled:true,expiresAt:Date.now()+86400000,maxMonthlySuccessfulCalls:5}]));
function runtime(persist,bindings={},provider=stripeMock(),clock){
 const loaded=clock===undefined?modules:modules.map(m=>m.path.endsWith('worker.js')?{...m,contents:m.contents.replace('new BillingService(this.storage,client,c.accounts[account].customerId)','new BillingService(this.storage,client,c.accounts[account].customerId,()=>Number(this.env.TEST_SECONDS))')}:m);
 return new Miniflare({modules:loaded,compatibilityDate:'2026-07-30',durableObjects:{ACCOUNTS:{className:'AccountMeter',useSQLite:true}},durableObjectsPersist:persist,serviceBindings:{STRIPE_HTTP:provider.fetch},bindings:Object.fromEntries(Object.entries({...billingEnv,API_ENABLED:'true',FINGERPRINT_SECRET:'synthetic-review-only-fingerprint'.padEnd(50,'x'),CREDENTIALS:JSON.stringify(credentials),...bindings,...(clock===undefined?{}:{TEST_SECONDS:String(clock)})}).filter(([,v])=>v!==undefined))});
}
const request=(body,key='review-checkout-0001',index=0)=>({method:'POST',headers:{authorization:'Bearer '+tokens[index],'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)});
const checkout=(mf,version='2026-10-13',key='review-checkout-0001',index=0)=>mf.dispatchFetch('https://example.test/v1/checkout',request({termsVersion:version},key,index));
const check=(mf,key='review-call-0000001')=>mf.dispatchFetch('https://example.test/v1/check',request(normal,key));
const billing=async mf=>{const response=await mf.dispatchFetch('https://example.test/v1/billing',{headers:{authorization:'Bearer '+tokens[0]}});assert.equal(response.status,200);return response.json();};
async function notify(mf,id,type='checkout.session.completed',object={id:'cs_test',customer:'cus_test'}){
 const thin=type==='v1.billing.meter.error_report_triggered',t=Math.floor(Date.now()/1000),body=JSON.stringify(thin?{id,type,livemode:false,object:'v2.core.event',related_object:{id:'mtr_test',type:'billing.meter'}}:{id,type,livemode:false,data:{object}}),secret=thin?billingEnv.STRIPE_METER_WEBHOOK_SECRET:webhookSecret,sig=createHmac('sha256',secret).update(t+'.'+body).digest('hex');
 return mf.dispatchFetch('https://example.test/v1/stripe/'+(thin?'meter-webhook':'webhook'),{method:'POST',headers:{'stripe-signature':`t=${t},v1=${sig}`},body});
}

test('review HTTP: version rotation preserves old contracts and pending retries while new old-version requests fail',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'recalm-review-version-')),provider=stripeMock();let mf=runtime(directory,{},provider);
 try{
  assert.equal((await checkout(mf)).status,200);assert.equal((await notify(mf,'evt_version_initial')).status,200);
  const pending=await checkout(mf,'2026-10-13','review-other-checkout',1);assert.equal(pending.status,200);const original=await pending.json();
  await mf.dispose();mf=runtime(directory,{TERMS_VERSION:'test-only-v2'},provider);
  const replay=await checkout(mf,'2026-10-13','review-other-checkout',1);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),original);
  assert.equal((await checkout(mf,'2026-10-13','review-new-oldversion',1)).status,400);assert.equal((await check(mf)).status,200);
  assert.equal((await notify(mf,'evt_version_delayed')).status,200);assert.equal((await billing(mf)).active,true);
  const document=await (await mf.dispatchFetch('https://example.test/v1/terms',{headers:{authorization:'Bearer '+tokens[0]}})).json();assert.equal(document.body,testTerms('2026-10-13').body);assert.equal(document.sha256,testTerms('2026-10-13').sha256);
  await mf.dispose();mf=runtime(directory,{TERMS_VERSION:undefined,TERMS_DOCUMENTS:'{}'},provider);
  assert.equal((await billing(mf)).active,true);assert.equal((await check(mf,'review-unchanged-contract')).status,200);
  assert.equal((await checkout(mf,'2026-10-13','review-other-checkout',1)).status,200);
  const archived=await mf.dispatchFetch('https://example.test/v1/terms',{headers:{authorization:'Bearer '+tokens[0]}});assert.equal(archived.status,200);assert.equal((await archived.json()).body,document.body);
  assert.equal((await notify(mf,'evt_unknown_current')).status,200);
  assert.equal((await mf.dispatchFetch('https://example.test/v1/cancel',request({}))).status,202);assert.equal((await billing(mf)).cancelRequested,true);
  assert.equal(provider.calls.filter(c=>c.path==='/v1/checkout/sessions'&&c.method==='POST').length,2);
 }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
});

test('review HTTP: pre-webhook cancellation persists before contract ID and blocks same-key checkout across restart and reordered events',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'recalm-review-cancel-')),provider=stripeMock();let mf=runtime(directory,{},provider);
 try{
  assert.equal((await checkout(mf)).status,200);
  const stopped=await mf.dispatchFetch('https://example.test/v1/cancel',request({}));assert.equal(stopped.status,202);assert.deepEqual(await stopped.json(),{cancelRequested:true,usageStopped:true,settlementPending:true});
  assert.equal((await mf.dispatchFetch('https://example.test/v1/cancel',request({}))).status,202);assert.equal((await billing(mf)).active,false);
  assert.equal((await checkout(mf)).status,409);assert.equal((await check(mf)).status,503);
  await mf.dispose();mf=runtime(directory,{},provider);assert.equal((await checkout(mf)).status,409);
  assert.equal((await notify(mf,'evt_cancel_sub_first','customer.subscription.created',{id:'sub_test',customer:'cus_test'})).status,200);
  assert.equal((await notify(mf,'evt_cancel_delayed')).status,200);assert.equal((await notify(mf,'evt_cancel_delayed')).status,200);
  assert.equal((await check(mf)).status,503);assert.equal((await billing(mf)).cancelRequested,true);assert.equal((await billing(mf)).active,false);
  await mf.dispose();mf=runtime(directory,{},provider);assert.equal((await check(mf)).status,503);assert.equal((await checkout(mf)).status,409);
  assert.equal(provider.calls.filter(c=>c.path==='/v1/checkout/sessions'&&c.method==='POST').length,1);
 }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
});

test('review HTTP: immutable document bytes and URLs match digests; absent, changed or wrong-URL documents stop new Checkout',async()=>{
 const document=testTerms('2026-10-13'),provider=stripeMock(),mf=runtime(false,{},provider);
 try{
  assert.equal((await checkout(mf)).status,200);const shown=await mf.dispatchFetch(document.url);assert.equal(shown.status,200);assert.equal(await shown.text(),document.body);
  const sent=provider.calls.find(c=>c.path==='/v1/checkout/sessions').params;assert.ok(sent['custom_text[terms_of_service_acceptance][message]'].includes(']('+document.url+')'));assert.equal(sent['metadata[terms_sha256]'],document.sha256);
 }finally{await mf.dispose();}
 const cases=[{}, {'2026-10-13':{...document,body:document.body+'changed'}},{'2026-10-13':{...document,body:undefined}},{'2026-10-13':{...document,url:'https://example.test/terms.html'}},{'2026-10-13':{...document,status:'draft'}}];
 for(const documents of cases){const provider=stripeMock(),mf=runtime(false,{TERMS_DOCUMENTS:JSON.stringify(documents)},provider);try{assert.equal((await checkout(mf)).status,503);assert.equal((await mf.dispatchFetch(document.url)).status,404);assert.equal(provider.calls.length,0);}finally{await mf.dispose();}}
});

test('review HTTP: checkout expires at the exact saved second; old bytes survive changed same-version configuration',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'recalm-review-expiry-')),provider=stripeMock(),now=Math.floor(Date.now()/1000);let mf=runtime(directory,{},provider,now);
 try{
  const first=await checkout(mf);assert.equal(first.status,200);const {expiresAt}=await first.json();
  await mf.dispose();mf=runtime(directory,{TERMS_VERSION:'test-only-v2'},provider,expiresAt-1);assert.equal((await checkout(mf)).status,200);
  await mf.dispose();mf=runtime(directory,{},provider,expiresAt);assert.equal((await checkout(mf)).status,409);
  const changed=testTerms('replacement-bytes');changed.url='https://example.test/terms/2026-10-13/'+changed.sha256+'.html';
  await mf.dispose();mf=runtime(directory,{TERMS_DOCUMENTS:JSON.stringify({'2026-10-13':changed})},provider,expiresAt+1);
  assert.equal((await checkout(mf,'2026-10-13','review-same-version-change')).status,503);assert.equal((await checkout(mf)).status,409);
  assert.equal(provider.calls.filter(c=>c.path==='/v1/checkout/sessions'&&c.method==='POST').length,1);
 }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
});

test('review HTTP: subscription first remains held until paid Checkout confirmation; manual and invoice holds never clear',async()=>{
 for(const hold of ['initial','manual','invoice','invoice-transport']){
  const mock=stripeMock();let paid=false,consent=true;
  const provider={async fetch(request){if(new URL(request.url).pathname==='/v1/invoices/in_anomaly')return hold==='invoice-transport'?Response.json({error:'synthetic_unavailable'},{status:503}):Response.json({id:'in_anomaly',customer:'cus_test',livemode:false,currency:'usd',subscription:'sub_test'});const response=await mock.fetch(request);if(request.method==='GET'&&new URL(request.url).pathname==='/v1/checkout/sessions/cs_test'){const session=await response.json();return Response.json({...session,payment_status:paid?session.payment_status:'unpaid',consent:consent?session.consent:null});}return response;}};
  const mf=runtime(false,{},provider);
  try{
   assert.equal((await checkout(mf)).status,200);paid=true;
   assert.equal((await notify(mf,'evt_order_sub','customer.subscription.created',{id:'sub_test',customer:'cus_test'})).status,200);
   assert.equal((await billing(mf)).active,false);assert.equal((await billing(mf)).hold,true);assert.equal((await check(mf)).status,503);
   if(hold==='manual')assert.equal((await notify(mf,'evt_order_manual','v1.billing.meter.error_report_triggered')).status,200);
   if(hold.startsWith('invoice'))assert.equal((await notify(mf,'evt_order_invoice','invoice.payment_failed',{id:'in_anomaly',customer:'cus_test'})).status,503);
   if(hold!=='initial'){consent=false;assert.equal((await notify(mf,'evt_order_bad_consent')).status,503);consent=true;}
   paid=false;assert.equal((await notify(mf,'evt_order_unpaid')).status,200);assert.equal((await check(mf)).status,503);
   paid=true;assert.equal((await notify(mf,'evt_order_paid','checkout.session.async_payment_succeeded')).status,200);
   assert.equal((await billing(mf)).active,hold==='initial');assert.equal((await check(mf)).status,hold==='initial'?200:503);
  }finally{await mf.dispose();}
 }
});

async function initialBindingRecovery(failure){
 for(const hold of ['initial','initial-direct','manual','invoice','cancel']){
  const directory=await mkdtemp(join(tmpdir(),'recalm-initial-binding-')),mock=stripeMock();let sessionReady=false;
  const provider={async fetch(request){
   const path=new URL(request.url).pathname;
   if(path==='/v1/invoices/in_anomaly')return Response.json({id:'in_anomaly',customer:'cus_test',livemode:false,currency:'usd',subscription:'sub_test'});
   if(request.method==='GET'&&path==='/v1/checkout/sessions/cs_test'&&!sessionReady){
    if(failure==='temporary-get')return Response.json({error:'synthetic_session_unavailable'},{status:503});
    const response=await mock.fetch(request),session=await response.json();return Response.json({...session,payment_status:'unpaid'});
   }
   return mock.fetch(request);
  }};
  let mf=runtime(directory,{},provider);
  try{
   assert.equal((await checkout(mf)).status,200);
   assert.equal((await notify(mf,'evt_initial_sub_pending','customer.subscription.created',{id:'sub_test',customer:'cus_test'})).status,503);
   assert.equal((await billing(mf)).active,false);assert.equal((await billing(mf)).hold,true);assert.equal((await check(mf)).status,503);
   await mf.dispose();mf=runtime(directory,{},provider);
   if(hold==='manual')assert.equal((await notify(mf,'evt_initial_manual','v1.billing.meter.error_report_triggered')).status,200);
   if(hold==='invoice')assert.equal((await notify(mf,'evt_initial_invoice','invoice.payment_failed',{id:'in_anomaly',customer:'cus_test'})).status,503);
   if(hold==='cancel')assert.equal((await mf.dispatchFetch('https://example.test/v1/cancel',request({}))).status,202);
   sessionReady=true;
   if(hold==='initial'){
    assert.equal((await notify(mf,'evt_initial_sub_pending','customer.subscription.created',{id:'sub_test',customer:'cus_test'})).status,200);
    assert.equal((await billing(mf)).active,false);assert.equal((await check(mf)).status,503);
   }
   assert.equal((await notify(mf,'evt_initial_paid_checkout','checkout.session.async_payment_succeeded')).status,200);
   assert.equal((await notify(mf,'evt_initial_paid_checkout','checkout.session.async_payment_succeeded')).status,200);
   const status=await billing(mf),recovered=hold.startsWith('initial');assert.equal(status.active,recovered);assert.equal((await check(mf)).status,recovered?200:503);
   if(hold==='manual')assert.equal(status.manualReconciliationRequired,true);
   if(hold==='cancel'){assert.equal(status.cancelRequested,true);assert.equal((await checkout(mf)).status,409);}
  }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
 }
}
test('review HTTP: initial unpaid subscription binding recovers only after valid paid Checkout; independent holds remain',()=>initialBindingRecovery('unpaid'));
test('review HTTP: initial temporary Session GET failure recovers only after valid paid Checkout; independent holds remain',()=>initialBindingRecovery('temporary-get'));

test('review HTTP: delayed initial zero invoice records payment without clearing unrelated invoice, manual or cancel holds',async()=>{
 for(const hold of ['mismatch','unpaid-other','manual','cancel']){
  const directory=await mkdtemp(join(tmpdir(),'recalm-invoice-hold-')),mock=stripeMock(),now=Math.floor(Date.now()/1000);
  const zero=invoice(now-1,now,0,{id:'in_initial_zero',billing_reason:'subscription_create',created:now-1,lines:{has_more:false,data:[]}});
  const other={...zero,id:'in_other',status:'open',amount_paid:0};
  const provider={async fetch(request){const path=new URL(request.url).pathname;if(path==='/v1/invoices/in_initial_zero')return Response.json(zero);if(path==='/v1/invoices/in_other')return Response.json(hold==='mismatch'?{...other,currency:'usd'}:other);return mock.fetch(request);}};
  let mf=runtime(directory,{},provider);
  try{
   assert.equal((await checkout(mf)).status,200);assert.equal((await notify(mf,'evt_invoice_initial_checkout')).status,200);
   if(hold==='mismatch'||hold==='unpaid-other')assert.equal((await notify(mf,'evt_other_invoice','invoice.payment_failed',{id:'in_other',customer:'cus_test'})).status,hold==='mismatch'?503:200);
   if(hold==='manual')assert.equal((await notify(mf,'evt_invoice_manual','v1.billing.meter.error_report_triggered')).status,200);
   if(hold==='cancel')assert.equal((await mf.dispatchFetch('https://example.test/v1/cancel',request({}))).status,202);
   assert.equal((await billing(mf)).active,false);assert.equal((await check(mf)).status,503);
   await mf.dispose();mf=runtime(directory,{},provider);
   assert.equal((await notify(mf,'evt_delayed_zero','invoice.paid',{id:'in_initial_zero',customer:'cus_test'})).status,200);
   assert.equal((await notify(mf,'evt_delayed_zero_retry','invoice.paid',{id:'in_initial_zero',customer:'cus_test'})).status,200);
   const status=await billing(mf);assert.equal(status.active,false);assert.equal(status.hold,true);assert.equal((await check(mf)).status,503);
  }finally{await mf.dispose();await rm(directory,{recursive:true,force:true});}
 }
});

test('review HTTP: paid invoices resolve only their own collection waits and cannot replace paid Checkout confirmation',async()=>{
 for(const confirmed of [false,true]){
  const mock=stripeMock(),now=Math.floor(Date.now()/1000);
  const zero=id=>invoice(now-1,now,0,{id,billing_reason:'subscription_create',created:now-1,lines:{has_more:false,data:[]}});
  const invoices={in_first:{...zero('in_first'),status:'open'},in_second:{...zero('in_second'),status:'open'}};
  const provider={async fetch(request){const id=new URL(request.url).pathname.split('/').at(-1);return invoices[id]?Response.json(invoices[id]):mock.fetch(request);}};
  const mf=runtime(false,{},provider);
  try{
   assert.equal((await checkout(mf)).status,200);
   if(confirmed)assert.equal((await notify(mf,'evt_collection_checkout')).status,200);
   else assert.equal((await notify(mf,'evt_collection_sub_first','customer.subscription.created',{id:'sub_test',customer:'cus_test'})).status,200);
   for(const id of Object.keys(invoices))assert.equal((await notify(mf,'evt_open_'+id,'invoice.payment_failed',{id,customer:'cus_test'})).status,200);
   invoices.in_first=zero('in_first');assert.equal((await notify(mf,'evt_paid_first','invoice.paid',{id:'in_first',customer:'cus_test'})).status,200);
   assert.equal((await billing(mf)).active,false);assert.equal((await billing(mf)).hold,true);assert.equal((await check(mf)).status,503);
   assert.equal((await notify(mf,'evt_paid_first_again','invoice.paid',{id:'in_first',customer:'cus_test'})).status,200);assert.equal((await check(mf)).status,503);
   invoices.in_second=zero('in_second');assert.equal((await notify(mf,'evt_paid_second','invoice.paid',{id:'in_second',customer:'cus_test'})).status,200);
   assert.equal((await billing(mf)).active,confirmed);
   if(!confirmed){assert.equal((await check(mf)).status,503);assert.equal((await notify(mf,'evt_collection_checkout_after_paid')).status,200);}
   assert.equal((await check(mf)).status,200);
  }finally{await mf.dispose();}
 }
});
