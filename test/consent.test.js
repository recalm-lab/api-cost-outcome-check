import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BillingService} from '../src/billing.js';
import {StripeClient,BillingError,nextMonth} from '../src/stripe.js';
import {one,state,saveState,recordSuccess} from '../src/meter.js';
import {storage,ready,config,subscription,eventId,testTerms} from './helpers.js';
import {stripeMock,billingEnv} from './stripe-mock.js';

const started=Date.parse('2026-10-13T12:00:00Z')/1000;
const event=(id='evt_consent')=>({id,type:'checkout.session.completed',data:{object:{id:'cs_test'}}});
function pending(s,changes={}){
 const document=testTerms('test-only-v1');s.sql.exec('INSERT OR IGNORE INTO terms_documents VALUES (?,?,?,?,?)','test-only-v1',document.sha256,document.body,document.status,document.url);
 const action={status:'complete',firstAttempt:started,expiresAt:started+3600,sessionId:'cs_test',termsVersion:'test-only-v1',termsUrl:document.url,termsSha256:document.sha256,params:{'metadata[terms_version]':'test-only-v1','metadata[terms_sha256]':document.sha256,'custom_text[terms_of_service_acceptance][message]':'[TEST]('+document.url+')'},...changes};
 s.sql.exec('INSERT INTO actions VALUES (?,?,?)','checkout:synthetic','digest',JSON.stringify(action));
 return action;
}
function completed(changes={}){return {id:'cs_test',customer:'cus_test',subscription:'sub_test',livemode:false,mode:'subscription',status:'complete',payment_status:'no_payment_required',created:started,expires_at:started+3600,consent_collection:{terms_of_service:'required'},consent:{terms_of_service:'accepted'},metadata:{terms_version:'test-only-v1',terms_sha256:testTerms('test-only-v1').sha256},...changes};}
function serviceFor(s,session=completed(),clock=()=>started+10){return new BillingService(s,{config:{...config,termsVersion:'test-only-v2'},async request(method,path){assert.equal(method,'GET');if(path==='/v1/checkout/sessions/cs_test')return session;if(path==='/v1/subscriptions/sub_test')return subscription();throw Error('unexpected endpoint');}},'cus_test',clock);}

test('consent pins original version, verifies latest session and survives duplicate notifications and SQLite reopen',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'recalm-consent-')),filename=join(directory,'ledger.sqlite');let s=storage(filename),now=started+10;
 try{
  pending(s);const service=()=>serviceFor(s,completed(),()=>now);
  await service().webhook(event());assert.equal(state(s).active,true);
  const evidence={...one(s,'SELECT * FROM consents')};
  assert.equal(evidence.termsVersion,'test-only-v1');assert.equal(evidence.verifiedAt,now);assert.equal(evidence.sessionCreatedAt,started);
  now+=30;await service().webhook(event());await service().webhook(event('evt_consent_again'));
  assert.deepEqual({...one(s,'SELECT * FROM consents')},evidence);assert.equal(one(s,'SELECT COUNT(*) AS n FROM consents').n,1);
  s.db.close();s=storage(filename);await service().webhook(event('evt_after_reopen'));
  assert.deepEqual({...one(s,'SELECT * FROM consents')},evidence);assert.equal((await service().billingStatus()).active,true);
 }finally{s.db.close();await rm(directory,{recursive:true,force:true});}
});

test('subscription notification arriving first uses the same consent checks before activating',async()=>{
 const s=storage();try{
  pending(s);await serviceFor(s).webhook({id:'evt_sub_first',type:'customer.subscription.created',data:{object:{id:'sub_test'}}});
  assert.equal((await serviceFor(s).billingStatus()).active,false);assert.equal(one(s,'SELECT termsVersion FROM consents').termsVersion,'test-only-v1');
  await serviceFor(s).webhook(event());assert.equal((await serviceFor(s).billingStatus()).active,true);
 }finally{s.db.close();}
});

test('missing, mismatched and legacy consent fail closed on both Checkout and subscription notifications',async()=>{
 const cases=[{consent:null},{consent:{terms_of_service:'none'}},{consent_collection:null},{consent_collection:{terms_of_service:'none'}},{metadata:{}},{metadata:{terms_version:'test-only-v2'}},{created:started-1},{created:started+3600},{created:started+11},{expires_at:started+3601},{id:'cs_wrong'},{customer:'cus_other'},{livemode:true},{subscription:null}];
 for(const change of cases){for(const type of ['checkout','subscription']){
  const s=storage();try{
   pending(s);const service=serviceFor(s,completed(change));
   const notification=type==='checkout'?event():{id:'evt_sub_bad',type:'customer.subscription.created',data:{object:{id:'sub_test'}}};
   await assert.rejects(()=>service.webhook(notification));assert.equal(one(s,'SELECT COUNT(*) AS n FROM consents').n,0);assert.equal(!!state(s).active,false);assert.equal(!!state(s).checkoutComplete,false);assert.equal(state(s).collectionHold,true);
  }finally{s.db.close();}
 }}
 const s=storage();try{pending(s,{termsVersion:undefined});await assert.rejects(()=>serviceFor(s).webhook(event()),/checkout_consent_unconfirmed/);assert.equal(one(s,'SELECT COUNT(*) AS n FROM consents').n,0);}finally{s.db.close();}
});

test('failed consent or entitlement write rolls back evidence; redelivery records it once',async()=>{
 for(const failedWrite of ['INSERT INTO consents ', 'UPDATE billing SET data=']){
  const s=storage();try{
   pending(s);const original=s.sql.exec;let fail=true;
   s.sql.exec=(sql,...args)=>{if(fail&&sql.startsWith(failedWrite)){fail=false;throw Error('synthetic_storage_failure');}return original(sql,...args);};
   await assert.rejects(()=>serviceFor(s).webhook(event()),/synthetic_storage_failure/);
   assert.equal(one(s,'SELECT COUNT(*) AS n FROM consents').n,0);assert.equal(!!state(s).checkoutComplete,false);assert.equal(one(s,'SELECT COUNT(*) AS n FROM webhooks').n,0);
   await serviceFor(s).webhook(event());assert.equal(one(s,'SELECT COUNT(*) AS n FROM consents').n,1);assert.equal(state(s).active,true);
  }finally{s.db.close();}
 }
});

test('a conflicting contract record is held without overwriting original consent',async()=>{
 const s=storage();try{
  pending(s);const service=serviceFor(s);await service.webhook(event());const evidence={...one(s,'SELECT * FROM consents')};
  const row=one(s,'SELECT * FROM actions');const action={...JSON.parse(row.data),termsVersion:'test-only-conflicting'};s.sql.exec('UPDATE actions SET data=? WHERE id=?',JSON.stringify(action),row.id);
  const changed=serviceFor(s,completed({metadata:{terms_version:action.termsVersion}}));
  await assert.rejects(()=>changed.webhook(event('evt_conflict')),/consent_conflict|terms_snapshot_mismatch/);assert.deepEqual({...one(s,'SELECT * FROM consents')},evidence);assert.equal(state(s).active,false);
 }finally{s.db.close();}
});

test('legacy active flags do not permit new usage without consent; existing receipt still replays at zero',async()=>{
 const s=storage(),now=ready(s);try{
  assert.equal(recordSuccess(s,'old','body',1000,'2026-10',now,eventId('old')).status,200);s.sql.exec('DELETE FROM consents');
  const service=serviceFor(s,completed(),()=>now);assert.equal((await service.billingStatus()).active,false);
  assert.equal(recordSuccess(s,'new','body',1000,'2026-10',now,eventId('new')).status,503);
  await service.refreshSubscription('sub_test');assert.equal(state(s).active,false);
  assert.equal(recordSuccess(s,'old','body',1000,'2026-10',now,eventId('old')).replay,true);assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,1);
 }finally{s.db.close();}
});

test('cancellation stays stopped across duplicate requests, delayed active notifications, failed settlement and reopen',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'recalm-cancel-consent-')),filename=join(directory,'ledger.sqlite');let s=storage(filename);
 try{
  pending(s);const service=()=>serviceFor(s);await service().webhook(event());
  assert.equal(recordSuccess(s,'old','body',1000,'2026-10',started+10,eventId('old')).status,200);
  const result=service().requestCancel();assert.deepEqual(service().requestCancel(),result);
  s.sql.exec("UPDATE calls SET sendState='sent'");
  const failing=new BillingService(s,{config,async request(){throw new BillingError('stripe_transport_error');}},'cus_test',()=>started+120);
  await assert.rejects(()=>failing.cancelAndWaive());
  await service().webhook(event('evt_delayed_checkout'));await service().webhook({id:'evt_delayed_sub',type:'customer.subscription.updated',data:{object:{id:'sub_test'}}});
  s.db.close();s=storage(filename);await service().refreshSubscription('sub_test');
  assert.equal((await service().billingStatus()).active,false);assert.equal(state(s).cancelRequested,true);
  assert.equal(recordSuccess(s,'new','body',1000,'2026-10',started+10,eventId('new')).status,503);
  assert.equal(recordSuccess(s,'old','body',1000,'2026-10',started+10,eventId('old')).replay,true);assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,1);
  await assert.rejects(()=>service().checkout('different','digest'),/existing_contract/);
 }finally{s.db.close();await rm(directory,{recursive:true,force:true});}
});

test('lost Checkout response retries original version and params, and never recreates at expiry',async()=>{
 const s=storage(),mock=stripeMock(),requests=[];let now=started,lost=true;
 const api=new StripeClient(billingEnv,async(url,options)=>{
  const response=await mock.fetch(new Request(url,options));
  if(options.method==='POST'){requests.push({body:options.body,key:options.headers['idempotency-key']});if(lost){lost=false;throw Error('synthetic_response_lost');}}
  return response;
 });
 try{
  const service=new BillingService(s,api,'cus_test',()=>now);await assert.rejects(()=>service.checkout('synthetic','digest'),/stripe_transport_error/);
  const action=JSON.parse(one(s,'SELECT data FROM actions').data);assert.equal(action.termsVersion,billingEnv.TERMS_VERSION);assert.equal(action.params['metadata[terms_version]'],billingEnv.TERMS_VERSION);assert.equal(one(s,'SELECT COUNT(*) AS n FROM consents').n,0);
  api.config={...api.config,termsVersion:'test-only-v2'};now+=1;await new BillingService(s,api,'cus_test',()=>now).checkout('synthetic','digest');assert.deepEqual(requests[0],requests[1]);
  now=action.expiresAt;await assert.rejects(()=>service.checkout('synthetic','digest'),/checkout_expired/);assert.equal(requests.length,2);
  const row=one(s,'SELECT * FROM actions');s.sql.exec('UPDATE actions SET data=? WHERE id=?',JSON.stringify({...action,status:'pending'}),row.id);
  await assert.rejects(()=>service.checkout('synthetic','digest'),/checkout_expired/);assert.equal(requests.length,2);
 }finally{s.db.close();}
});

test('missing terms and last UTC half-hour refuse creation; exact eligible boundary and next month work',async()=>{
 const anchor=nextMonth(started);
 for(const [now,allowed]of [[anchor-1802,true],[anchor-1801,true],[anchor-1800,false],[anchor-1,false],[anchor,true]]){
  const s=storage(),mock=stripeMock(),api=new StripeClient(billingEnv,(url,options)=>mock.fetch(new Request(url,options)));
  try{
   const service=new BillingService(s,api,'cus_test',()=>now);
   if(allowed){const result=await service.checkout('synthetic','digest');assert.equal(result.expiresAt>=now+1800,true);}
   else{await assert.rejects(()=>service.checkout('synthetic','digest'),/checkout_window_closed/);assert.equal(mock.calls.some(c=>c.method==='POST'),false);assert.equal(one(s,'SELECT COUNT(*) AS n FROM actions').n,0);}
  }finally{s.db.close();}
 }
 const s=storage();try{const service=serviceFor(s);service.c={...service.c,termsVersion:undefined};await assert.rejects(()=>service.checkout('synthetic','digest'),/terms_not_configured/);assert.equal(one(s,'SELECT COUNT(*) AS n FROM actions').n,0);}finally{s.db.close();}
});
