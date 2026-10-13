import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {BillingService} from '../src/billing.js';
import {StripeClient,billingConfig,verifyWebhook,subscriptionState,BillingError} from '../src/stripe.js';
import {recordSuccess,one,saveState,state} from '../src/meter.js';
import {storage,ready,eventId,config,subscription,invoice} from './helpers.js';
const env={BILLING_ENABLED:'true',BILLING_VERIFIED:'true',STRIPE_MODE:'test',STRIPE_RESTRICTED_KEY:'rk_test_synthetic_only_not_a_real_key',STRIPE_WEBHOOK_SECRET:'whsec_synthetic_only_not_a_real_secret',STRIPE_METER_WEBHOOK_SECRET:'whsec_synthetic_meter_only_not_a_real_secret',STRIPE_ACCOUNT_ID:'acct_test',STRIPE_PRICE_ID:'price_test',STRIPE_METER_ID:'mtr_test',STRIPE_EVENT_NAME:'recalm_api_cost_check_success_v1',TERMS_VERSION:'2026-10-13',PUBLIC_BASE_URL:'https://example.test',BILLING_ACCOUNTS:JSON.stringify({test:{customerId:'cus_test'}})};
const add=(s,key,now)=>recordSuccess(s,key,'body',1000,new Date(now*1000).toISOString().slice(0,7),now,eventId(key));
const client=handler=>({config,request:handler});
const ack=params=>({identifier:params.identifier,event_name:config.eventName,livemode:false,payload:{stripe_customer_id:'cus_test',value:'1'}});
const paidList=inv=>({has_more:false,data:inv.amount_paid?[{id:'inpay_test',invoice:inv.id,currency:'jpy',livemode:false,status:'paid',amount_paid:inv.amount_paid,payment:{type:'payment_intent',payment_intent:'pi_test'}}]:[]});
test('billing config every missing field fails closed; mode, price and signing secret never fall back',()=>{
 assert.equal(billingConfig(env).mode,'test');for(const field of Object.keys(env)){const v={...env};delete v[field];assert.throws(()=>billingConfig(v),BillingError);}
 assert.throws(()=>billingConfig({...env,STRIPE_MODE:'live'}));assert.throws(()=>billingConfig({...env,PUBLIC_BASE_URL:'https://example.test/bad'}));
});
test('REST pins official host/version, instance key, form params and stable idempotency; sanitizes errors',async()=>{
 const calls=[];const api=new StripeClient(env,async(url,options)=>{calls.push({url,options});return Response.json({id:'ok'});});
 await api.request('POST','/v1/billing/meter_events',{identifier:'stable','payload[value]':1},'same-key');assert.equal(calls[0].url,'https://api.stripe.com/v1/billing/meter_events');assert.equal(calls[0].options.headers['stripe-version'],'2026-08-26.dahlia');assert.equal(calls[0].options.headers['idempotency-key'],'same-key');assert.equal(new URLSearchParams(calls[0].options.body).get('payload[value]'),'1');
 const bad=new StripeClient(env,async()=>new Response('never-reflect-secret-body',{status:500}));await assert.rejects(()=>bad.request('GET','/v1/account'),e=>e.message==='stripe_upstream_unavailable');
});
test('webhook validates raw body signature, multiple v1 signatures and strict 5 minute replay tolerance',async()=>{
 const now=1790812900,body=JSON.stringify({id:'evt_test',type:'invoice.paid',livemode:false,data:{object:{id:'in_test'}}}),sig=createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(now+'.'+body).digest('hex');
 assert.equal((await verifyWebhook(body,`t=${now},v1=${'0'.repeat(64)},v1=${sig}`,env.STRIPE_WEBHOOK_SECRET,now)).id,'evt_test');
 for(const [text,header,time]of [[body+' ',`t=${now},v1=${sig}`,now],[body,`t=${now},v1=${sig}`,now+301],[body,`t=${now},t=${now},v1=${sig}`,now]])await assert.rejects(()=>verifyWebhook(text,header,env.STRIPE_WEBHOOK_SECRET,time));
});
test('UTC anchor, approved price, metering and subscription lifecycle must align',()=>{
 const sub=subscription(),now=sub.items.data[0].current_period_start+100;assert.equal(subscriptionState(sub,'cus_test',config,now).active,true);
 for(const s of [{...sub,billing_cycle_anchor:sub.billing_cycle_anchor+60},{...sub,collection_method:'send_invoice'},{...sub,automatic_tax:{enabled:true}}])assert.throws(()=>subscriptionState(s,'cus_test',config,now));
 for(const status of ['past_due','unpaid','incomplete','paused','canceled'])assert.equal(subscriptionState({...sub,status},'cus_test',config,now).active,false);
 assert.equal(subscriptionState({...sub,cancel_at_period_end:true},'cus_test',config,now).active,false);
});
test('hosted checkout exact approved price, calendar UTC anchor, explicit consent and no meter quantity',async()=>{
 const s=storage(),now=1790812900,calls=[];
 const provider=client(async(method,path,p,key)=>{calls.push({method,path,p,key});if(path==='/v1/account')return {id:'acct_test',charges_enabled:true,payouts_enabled:true};if(path==='/v1/prices/price_test')return {...subscription().items.data[0].price,livemode:false,active:true,product:{active:true}};if(path==='/v1/billing/meters/mtr_test')return {id:'mtr_test',livemode:false,status:'active',event_name:config.eventName,default_aggregation:{formula:'sum'},customer_mapping:{type:'by_id',event_payload_key:'stripe_customer_id'},value_settings:{event_payload_key:'value'},event_time_window:null};if(path==='/v1/customers/cus_test')return {livemode:false,balance:0,currency:'jpy',cash_balance:null};if(path==='/v1/subscriptions'||path==='/v1/invoices')return {data:[],has_more:false};if(path==='/v1/checkout/sessions')return {id:'cs_test',livemode:false,mode:'subscription',customer:'cus_test',url:'https://checkout.stripe.com/c/pay/test'};throw new Error('unexpected endpoint');});
 const service=new BillingService(s,provider,'cus_test',()=>now);const result=await service.checkout('a'.repeat(64),'same');assert.ok(result.checkoutUrl.startsWith('https://checkout.stripe.com/'));await service.checkout('a'.repeat(64),'same');assert.equal(calls.filter(c=>c.path==='/v1/checkout/sessions').length,1);
 const params=calls.at(-1).p;assert.equal(params['subscription_data[billing_cycle_anchor]'],1793491200);assert.equal(params['line_items[0][price]'],'price_test');assert.equal(params['line_items[0][quantity]'],undefined);assert.equal(params.payment_method_types,undefined);assert.equal(params['consent_collection[terms_of_service]'],'required');assert.equal(params['payment_method_collection'],'always');
 await assert.rejects(()=>service.checkout('a'.repeat(64),'different'),e=>e.status===409);s.db.close();
});
test('meter retry after accepted-but-lost response has stable event/body and one acceptance; >23h holds',async()=>{
 const s=storage();let now=ready(s),lost=true,requests=[];add(s,'call',now);const accepted=new Set();
 const service=new BillingService(s,client(async(method,path,p)=>{requests.push({...p});accepted.add(p.identifier);if(lost){lost=false;throw new BillingError('stripe_retryable');}return ack(p);}), 'cus_test',()=>now);
 await service.flush();assert.equal(one(s,'SELECT sendState FROM calls').sendState,'sending');now+=20;await service.flush();assert.equal(one(s,'SELECT sendState FROM calls').sendState,'sent');assert.equal(accepted.size,1);assert.deepEqual(requests[0],requests[1]);await service.flush();assert.equal(requests.length,2);
 add(s,'late',now);s.sql.exec("UPDATE calls SET sendState='sending',firstAttempt=? WHERE id='late'",now-23*3600);await service.flush();assert.equal(requests.length,2);assert.equal(one(s,"SELECT sendState FROM calls WHERE id='late'").sendState,'hold');assert.equal(state(s).collectionHold,true);s.db.close();
});
test('signed canonical invoice settlement is idempotent; small invoice retains debt, later aggregate clears once',async()=>{
 const s=storage(),start=ready(s)-100,end=1793491200;for(let i=0;i<49;i++)add(s,'old'+i,start+100+i);
 let canonical=invoice(start,end,49),sub=subscription('2026-11'),now=end+100;
 const service=new BillingService(s,client(async(method,path)=>path==='/v1/invoice_payments'?paidList(canonical):path.startsWith('/v1/invoices/')?canonical:sub),'cus_test',()=>now);
 await service.webhook({id:'evt_small',type:'invoice.paid',data:{object:{id:'in_test'}}});assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,49);assert.equal(one(s,'SELECT COUNT(*) AS count FROM calls WHERE invoiceId IS NULL').count,0);
 add(s,'new',now);assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,50);
 canonical=invoice(end,1796083200,1,{id:'in_next',amount_paid:50});now=1796083300;sub=subscription('2026-12');await service.observeInvoice(canonical,false);assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,50);
 await service.webhook({id:'evt_next',type:'invoice.paid',data:{object:{id:'in_next'}}});await service.webhook({id:'evt_next',type:'invoice.paid',data:{object:{id:'in_next'}}});await service.webhook({id:'evt_retrydifferent',type:'invoice.paid',data:{object:{id:'in_next'}}});assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,0);assert.equal(one(s,'SELECT paid FROM meter').paid,50);s.db.close();
});
test('old failed event cannot regress canonical paid state; unpaid and wrong subscription hold',async()=>{
 const s=storage(),start=ready(s)-100,end=1793491200;for(let i=0;i<50;i++)add(s,'old'+i,start+100+i);
 let canonical=invoice(start,end,50,{status:'open',amount_paid:0,amount_remaining:50});const service=new BillingService(s,client(async(method,path)=>path==='/v1/invoice_payments'?paidList(canonical):path==='/v1/invoice_payments'?paidList(canonical):path.startsWith('/v1/invoices/')?canonical:subscription('2026-11')),'cus_test',()=>end+100);
 await service.webhook({id:'evt_failed',type:'invoice.payment_failed',data:{object:{id:'in_test'}}});assert.equal(state(s).collectionHold,true);assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,50);
 canonical={...canonical,status:'paid',amount_paid:50,amount_remaining:0};await service.webhook({id:'evt_delayedfailure',type:'invoice.payment_failed',data:{object:{id:'in_test'}}});assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,0);assert.equal(state(s).collectionHold,false);
 canonical={...canonical,parent:{subscription_details:{subscription:'sub_other'}}};await assert.rejects(()=>service.webhook({id:'evt_wrong',type:'invoice.paid',data:{object:{id:'in_test'}}}));assert.equal(state(s).collectionHold,true);s.db.close();
});
test('draft invoice paused; meter summary/quantity mismatch cannot finalize',async()=>{
 const s=storage(),start=ready(s)-100,end=1793491200;add(s,'call',start+100);s.sql.exec("UPDATE calls SET sendState='sent'");let canonical=invoice(start,end,1,{status:'draft',amount_paid:0});const writes=[];
 const service=new BillingService(s,client(async(method,path,p)=>{if(method==='POST'){writes.push({path,p});return canonical;}if(path.includes('event_summaries'))return {data:[{aggregated_value:0}],has_more:false};return canonical;}),'cus_test',()=>end+100);
 await service.webhook({id:'evt_draft',type:'invoice.created',data:{object:{id:'in_test'}}});assert.deepEqual(writes[0].p,{auto_advance:false});await service.finalizePending();assert.equal(writes.length,1);
 canonical={...canonical,total:2};await assert.rejects(()=>service.finalizePending());assert.equal(writes.length,1);s.db.close();
});
test('cancel stops immediately; <50 waiver retries accepted-lost response once, never waives >=50',async()=>{
 const s=storage(),now=ready(s);for(let i=0;i<49;i++)add(s,'c'+i,now+i);s.sql.exec("UPDATE calls SET sendState='sent',invoiceId='in_small'");saveState(s,{...state(s),cancelConfirmed:true});let balance=49,first=true,posts=0;
 const service=new BillingService(s,client(async(method,path,p)=>{if(method==='GET')return {cash_balance:null,currency:'jpy',balance};posts++;balance=0;if(first){first=false;throw new BillingError('stripe_retryable');}return {id:'cbtxn_test',amount:-49,currency:'jpy',ending_balance:0};}),'cus_test',()=>now+100);
 assert.equal(service.requestCancel().usageStopped,true);assert.equal(state(s).active,false);await assert.rejects(()=>service.cancelAndWaive());await service.cancelAndWaive();await service.cancelAndWaive();assert.equal(posts,2);assert.equal(one(s,'SELECT waived FROM meter').waived,49);assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,0);
 s.sql.exec('UPDATE meter SET outstanding=50');await service.cancelAndWaive();assert.equal(posts,2);s.db.close();
});

test('Stripe paid status/minimum-charge balance is not confused with actual funds collected',async()=>{
 const s=storage(),start=ready(s)-100,end=1793491200;for(let i=0;i<49;i++)add(s,'c'+i,start+100+i);
 const canonical=invoice(start,end,49,{amount_paid:49,amount_due:49});
 const service=new BillingService(s,client(async(method,path)=>path==='/v1/invoice_payments'?{data:[],has_more:false}:path.startsWith('/v1/invoices/')?canonical:subscription('2026-11')),'cus_test',()=>end+100);
 await service.webhook({id:'evt_balanceonly',type:'invoice.paid',data:{object:{id:'in_test'}}});assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,49);assert.equal(one(s,'SELECT paid FROM meter').paid,0);s.db.close();
});
test('meter summaries use minute-aligned ranges; cancellation waits for aggregation then cancels once',async()=>{
 const s=storage(),start=ready(s)-100;add(s,'call',start+101);s.sql.exec("UPDATE calls SET sendState='sent'");let now=start+121,deleted=0,canceled=false,requests=[];
 const service=new BillingService(s,client(async(method,path,p)=>{requests.push({method,path,p});if(path.includes('event_summaries'))return {data:[{aggregated_value:1,livemode:false,meter:'mtr_test'}],has_more:false};if(method==='DELETE'){deleted++;canceled=true;return {status:'canceled'};}return subscription('2026-10',{status:canceled?'canceled':'active'});}), 'cus_test',()=>now);
 service.requestCancel();await service.cancelAndWaive();assert.equal(deleted,1);assert.equal(state(s).cancelConfirmed,true);await service.cancelAndWaive();assert.equal(deleted,1);
 const summary=requests.find(r=>r.path.includes('event_summaries'));assert.equal(summary.p.start_time%60,0);assert.equal(summary.p.end_time%60,0);s.db.close();
});
test('draft invoice is finalized only after all receipts sent and Stripe aggregation agrees',async()=>{
 const s=storage(),start=ready(s)-100,end=1793491200;add(s,'call',start+100);let now=end+120,writes=0;const inv=invoice(start,end,1,{status:'draft',amount_paid:0});saveState(s,{...state(s),pendingInvoice:'in_test',pendingSince:now,collectionHold:true});
 const service=new BillingService(s,client(async(method,path,p)=>{if(method==='POST'){writes++;assert.equal(p.auto_advance,true);return {...inv,status:'open'};}if(path.includes('event_summaries'))return {data:[{aggregated_value:1,livemode:false,meter:'mtr_test'}],has_more:false};return inv;}),'cus_test',()=>now);
 await service.finalizePending();assert.equal(writes,0);s.sql.exec("UPDATE calls SET sendState='sent'");await service.finalizePending();assert.equal(writes,1);s.db.close();
});
test('paid receipt cannot be finalized again under another invoice ID or above local exposure',async()=>{
 const s=storage(),start=ready(s)-100,end=1793491200;add(s,'call',start+100);s.sql.exec("UPDATE calls SET sendState='sent',invoiceId='in_old'");let writes=0;const inv=invoice(start,end,1,{id:'in_duplicate',status:'draft',amount_paid:0});saveState(s,{...state(s),pendingInvoice:inv.id,pendingSince:end+120,collectionHold:true});
 const service=new BillingService(s,client(async(method)=>{if(method==='POST')writes++;return inv;}),'cus_test',()=>end+120);await assert.rejects(()=>service.finalizePending(),e=>e.message==='invoice_overlap');assert.equal(writes,0);s.db.close();
});

test('sandbox can be tested with verified=false; missing flag and unverified live remain closed',()=>{
 assert.equal(billingConfig({...env,BILLING_VERIFIED:'false'}).mode,'test');
 const live={...env,STRIPE_MODE:'live',STRIPE_RESTRICTED_KEY:'rk_live_synthetic_only_not_a_real_key',BILLING_VERIFIED:'false'};assert.throws(()=>billingConfig(live));
 const missing={...env};delete missing.BILLING_VERIFIED;assert.throws(()=>billingConfig(missing));
});

test('thin hold persists atomically and prevents outbox/finalize/cancel activity without v2 fetch',async()=>{
 const s=storage();ready(s);let requests=0;const service=new BillingService(s,client(async()=>{requests++;throw Error('must not fetch');}),'cus_test');
 await service.webhook({id:'evt_test_thin_01',object:'v2.core.event',type:'v1.billing.meter.error_report_triggered',related_object:{id:config.meterId,type:'billing.meter'}});
 assert.equal(state(s).requiresManual,true);assert.equal(state(s).active,false);assert.equal(service.needsAlarm(),false);
 await service.tick();await service.flush();await service.finalizePending();await service.cancelAndWaive();await assert.rejects(()=>service.checkout('new','digest'));assert.equal(requests,0);
 await service.webhook({id:'evt_test_thin_01',object:'v2.core.event',type:'v1.billing.meter.error_report_triggered',related_object:{id:config.meterId,type:'billing.meter'}});
 assert.equal(one(s,'SELECT COUNT(*) AS count FROM webhooks').count,1);s.db.close();
});

test('thin manual hold followed by cancelled open invoice.updated retries cannot resume collection',async()=>{
 const s=storage(),now=ready(s,'2026-10'),end=now+60,writes=[];
 for(let i=0;i<50;i++)add(s,'cancel-open-'+i,now);saveState(s,{...state(s),cancelRequested:true,cancelConfirmed:true});
 const inv=invoice(now-1,end,50,{status:'open',amount_paid:0,amount_remaining:50,auto_advance:false,hosted_invoice_url:'https://invoice.stripe.com/i/synthetic'});
 const service=new BillingService(s,client(async(method,path,p)=>{if(method==='POST'){writes.push({path,p});return inv;}if(path==='/v1/invoices/in_test')return inv;throw Error('unexpected request');}),'cus_test',()=>end+120);
 await service.webhook({id:'evt_test_meter_cancel_hold',object:'v2.core.event',type:'v1.billing.meter.error_report_triggered',related_object:{id:config.meterId,type:'billing.meter'}});
 const event={id:'evt_cancel_open_updated',type:'invoice.updated',data:{object:{id:'in_test'}}};
 await service.webhook(event);await service.webhook(event);await service.webhook({...event,id:'evt_cancel_open_updated_again'});
 await service.observeInvoice(inv,false);await service.tick();await service.finalizePending();await service.cancelAndWaive();
 assert.deepEqual(writes,[]);assert.equal(state(s).requiresManual,true);assert.equal(state(s).collectionHold,true);assert.equal(state(s).active,false);
 assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,50);assert.equal((await service.billingStatus()).paymentUrl,null);s.db.close();
});
test('cancelled open invoice resumes expected collection only without manual hold',async()=>{
 const s=storage(),now=ready(s,'2026-10'),end=now+60,writes=[];
 for(let i=0;i<50;i++)add(s,'normal-cancel-'+i,now);saveState(s,{...state(s),cancelRequested:true,cancelConfirmed:true});
 const inv=invoice(now-1,end,50,{status:'open',amount_paid:0,amount_remaining:50,auto_advance:false});
 const service=new BillingService(s,client(async(method,path,p)=>{if(method==='POST')writes.push({path,p});return inv;}),'cus_test',()=>end+120);
 await service.webhook({id:'evt_normal_cancel_open',type:'invoice.updated',data:{object:{id:'in_test'}}});
 assert.deepEqual(writes,[{path:'/v1/invoices/in_test',p:{auto_advance:true}}]);assert.equal(!!state(s).requiresManual,false);s.db.close();
});
test('cash settlement after meter hold records verified payment while preserving manual hold',async()=>{
 const s=storage(),now=ready(s),end=now+60;for(let i=0;i<50;i++)add(s,'held-paid-'+i,now);
 const inv=invoice(now-1,end,50),service=new BillingService(s,client(async(method,path)=>{assert.equal(method,'GET');if(path==='/v1/invoices/in_test')return inv;if(path==='/v1/invoice_payments')return paidList(inv);if(path==='/v1/subscriptions/sub_test')return subscription();throw Error('unexpected request');}),'cus_test',()=>end+120);
 await service.webhook({id:'evt_meter_before_paid',object:'v2.core.event',type:'v1.billing.meter.error_report_triggered',related_object:{id:config.meterId,type:'billing.meter'}});
 await service.webhook({id:'evt_held_invoice_paid',type:'invoice.paid',data:{object:{id:'in_test'}}});
 assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,0);assert.equal(one(s,'SELECT paid FROM meter').paid,50);assert.equal(state(s).requiresManual,true);assert.equal(state(s).collectionHold,true);assert.equal(state(s).active,false);s.db.close();
});

test('outbox uses real StripeClient fixed failure classes with stable retries only before 23 hours',async()=>{
 const failures=[
  async()=>new Response('synthetic-hidden-body',{status:429}),
  async()=>new Response('synthetic-hidden-body',{status:500}),
  async()=>{throw new Error('synthetic-accepted-response-lost');},
  async()=>new Response('synthetic-invalid-json',{status:200})
 ];
 for(const fail of failures){
  const s=storage();let now=ready(s),failing=true;const requests=[],accepted=new Set();
  const api=new StripeClient(env,async(url,options)=>{
   const params=Object.fromEntries(new URLSearchParams(options.body));
   requests.push({url,method:options.method,body:options.body,key:options.headers['idempotency-key']});
   accepted.add(params.identifier);
   if(failing)return fail();
   return Response.json(ack(params));
  });
  const service=new BillingService(s,api,'cus_test',()=>now);
  try{
   add(s,'retry-client',now);await service.flush();
   const first=one(s,"SELECT * FROM calls WHERE id='retry-client'");
   assert.equal(first.sendState,'sending');assert.equal(first.firstAttempt,now);assert.equal(first.attempts,1);
   assert.ok(first.nextAttempt>now);assert.equal(!!state(s).requiresManual,false);
   failing=false;now+=20;await service.flush();
   const sent=one(s,"SELECT * FROM calls WHERE id='retry-client'");
   assert.equal(sent.sendState,'sent');assert.equal(sent.firstAttempt,first.firstAttempt);assert.equal(sent.attempts,2);
   assert.deepEqual(requests[0],requests[1]);assert.equal(requests[0].key,'meter:'+eventId('retry-client'));
   assert.equal(new URLSearchParams(requests[0].body).get('payload[value]'),'1');
   assert.equal(accepted.size,1);await service.flush();assert.equal(requests.length,2);
   failing=true;add(s,'expiry-client',now);await service.flush();
   const started=one(s,"SELECT * FROM calls WHERE id='expiry-client'");
   now=started.firstAttempt+23*3600-1;await service.flush();
   assert.equal(requests.length,4);assert.deepEqual(requests[2],requests[3]);
   assert.equal(one(s,"SELECT firstAttempt FROM calls WHERE id='expiry-client'").firstAttempt,started.firstAttempt);
   assert.equal(!!state(s).requiresManual,false);
   now=started.firstAttempt+23*3600;
   s.sql.exec("UPDATE calls SET nextAttempt=? WHERE id='expiry-client'",now);
   await service.flush();assert.equal(requests.length,4);
   assert.equal(one(s,"SELECT sendState FROM calls WHERE id='expiry-client'").sendState,'hold');
   assert.equal(state(s).requiresManual,true);assert.equal(state(s).collectionHold,true);
  }finally{s.db.close();}
 }
});
test('outbox real StripeClient rejection and acknowledgement mismatch still require manual hold',async()=>{
 for(const respond of [async()=>new Response('synthetic-private-body',{status:403}),async()=>Response.json({identifier:'wrong'})]){
  const s=storage();const now=ready(s);let calls=0;
  try{
   add(s,'rejected-client',now);
   const service=new BillingService(s,new StripeClient(env,async()=>{calls++;return respond();}),'cus_test',()=>now);
   await service.flush();assert.equal(calls,1);
   assert.equal(one(s,'SELECT sendState FROM calls').sendState,'hold');
   assert.equal(state(s).requiresManual,true);assert.equal(state(s).collectionHold,true);
   await service.flush();assert.equal(calls,1);
  }finally{s.db.close();}
 }
});
