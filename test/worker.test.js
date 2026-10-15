import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash,createHmac } from 'node:crypto';
import {billingEnv,stripeMock,webhookSecret} from './stripe-mock.js';
import { Miniflare } from 'miniflare';
import {testTermsDocuments,testTerms} from './helpers.js';
import { normal, retry } from '../scripts/fixtures.mjs';
const token='synthetic_test_credential_'.padEnd(50,'x');
const token2='second_synthetic_test_credential_'.padEnd(50,'x');
const credentials = Object.fromEntries([token,token2].map((t,i)=>[createHash('sha256').update(t).digest('hex'),{account:i?'other-account':'test-account',enabled:true,expiresAt:Date.now()+3600000,maxMonthlySuccessfulCalls:5}]));
const modules=await Promise.all(['worker','reconcile','meter','stripe','terms-registry','terms','billing'].map(async name=>({type:'ESModule',path:resolve('src/'+name+'.js'),contents:await readFile('src/'+name+'.js','utf8')})));
// The real release registry is empty. Synthetic approved entries exist only in this test module override.
function runtime(persist,bindings={},provider=stripeMock()) { const runtimeModules=bindings.STRIPE_MODE==='live'?modules.map(m=>m.path.endsWith('terms-registry.js')?{...m,contents:'export const releasedTerms='+JSON.stringify(Object.fromEntries(Object.entries(testTermsDocuments).map(([v,d])=>[v,{...d,status:'approved'}])))+';'}:m):modules;return new Miniflare({name:'test-api',modules:runtimeModules,compatibilityDate:'2026-07-30',durableObjects:{ACCOUNTS:{className:'AccountMeter',useSQLite:true}},durableObjectsPersist:persist,serviceBindings:{STRIPE_HTTP:provider.fetch},bindings:Object.fromEntries(Object.entries({...billingEnv,API_ENABLED:'true',CREDENTIALS:JSON.stringify(credentials),FINGERPRINT_SECRET:'synthetic-test-only-fingerprint-secret'.padEnd(50,'x'),...bindings}).filter(([,value])=>value!==undefined))}); }

const req=(body=normal,key='synthetic-call-0001',bearer=token)=>({method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json','idempotency-key':key},body:typeof body==='string'?body:JSON.stringify(body)});
async function activate(mf,bearer=token){
 const customer=bearer===token2?'cus_other':'cus_test',session=bearer===token2?'cs_other':'cs_test';
 const checkout=await mf.dispatchFetch('https://test/v1/checkout',req({termsVersion:'2026-10-13'},'synthetic-checkout-0001',bearer));assert.equal(checkout.status,200);
 const timestamp=Math.floor(Date.now()/1000),body=JSON.stringify({id:customer==='cus_other'?'evt_other':'evt_test',type:'checkout.session.completed',livemode:false,data:{object:{id:session,customer}}});
 const signature=createHmac('sha256',webhookSecret).update(timestamp+'.'+body).digest('hex');const response=await mf.dispatchFetch('https://test/v1/stripe/webhook',{method:'POST',headers:{'stripe-signature':`t=${timestamp},v1=${signature}`},body});assert.equal(response.status,200);
}
test('workerd SQLite atomic success, parallel retries, conflicts, caps, invalid inputs, accounts and restart', async () => {
  const persist=await mkdtemp(join(tmpdir(),'recalm-workerd-')); let mf=runtime(persist);
  try {
    await activate(mf);
    const first=await Promise.all(Array.from({length:20},()=>mf.dispatchFetch('https://test/v1/check',req())));
    assert.ok(first.every(r=>r.status===200));
    const outputs=await Promise.all(first.map(r=>r.json()));
    assert.equal(outputs.reduce((n,r)=>n+r.usage.billableCalls,0),1);
    assert.ok(outputs.every(r=>r.usage.successfulCalls===1));
    assert.equal((await mf.dispatchFetch('https://test/v1/check',req(retry))).status,409);
    assert.equal((await mf.dispatchFetch('https://test/v1/check',req('{'))).status,400);
    const invalidBytes=req();invalidBytes.body=new Uint8Array([255]);assert.equal((await mf.dispatchFetch('https://test/v1/check',invalidBytes)).status,400);
    assert.equal((await mf.dispatchFetch('https://test/v1/check',req({...normal,secret:'reject'}))).status,400);
    assert.equal((await mf.dispatchFetch('https://test/v1/check',req(' '.repeat(16385)))).status,413);
    assert.equal((await mf.dispatchFetch('https://test/v1/check',req(normal,'short'))).status,400);
    assert.equal((await mf.dispatchFetch('https://test/v1/check',req(normal,'synthetic-call-0001','unknown'.padEnd(50,'x')))).status,401);
    await activate(mf,token2);
    const second=await (await mf.dispatchFetch('https://test/v1/check',req(normal,'synthetic-call-0001',token2))).json(); assert.equal(second.usage.billableCalls,1);
    const burst=await Promise.all(Array.from({length:12},(_,i)=>mf.dispatchFetch('https://test/v1/check',req(normal,'synthetic-distinct-'+String(i).padStart(3,'0')))));
    assert.equal(burst.filter(r=>r.status===200).length,4); assert.equal(burst.filter(r=>r.status===429).length,8);
    await mf.dispose(); mf=runtime(persist);
    const replay=await (await mf.dispatchFetch('https://test/v1/check',req())).json(); assert.equal(replay.usage.billableCalls,0); assert.equal(replay.usage.successfulCalls,5);

  } finally { await mf.dispose(); await rm(persist,{recursive:true,force:true}); }
});
test('API closed by default, disabled/expired credential and malformed config fail closed', async () => {
  const expired=structuredClone(credentials);expired[createHash('sha256').update(token).digest('hex')].expiresAt=0;
  for(const bindings of [{CREDENTIALS:JSON.stringify(expired)},{API_ENABLED:'false'},{CREDENTIALS:'{}'},{CREDENTIALS:'broken'},{CREDENTIALS:JSON.stringify({[createHash('sha256').update(token).digest('hex')]:{...credentials[createHash('sha256').update(token).digest('hex')],enabled:false}})}]) {
    const mf=runtime(false,bindings);
    try { assert.ok([401,503].includes((await mf.dispatchFetch('https://test/v1/check',req())).status)); }
    finally { await mf.dispose(); }
  }
});
test('workerd accepts exact maximum body and 40-step chain; rejects compressed and unsupported content',async()=>{
  const mf=runtime(false);
  try {
    await activate(mf);
    const data={...normal,tasks:[],attempts:[],bills:[]};
    for(let i=0;i<40;i++){data.tasks.push({id:'t'+i,outcome:'success'});data.attempts.push({requestId:'r'+i,taskId:'t0',outcome:i===39?'success':'failure',...(i?{retryOf:'r'+(i-1)}:{})});data.bills.push({...normal.bills[0],id:'b'+i,requestId:'r'+i});}
    const body=JSON.stringify(data).padEnd(16384,' ');
    const response=await mf.dispatchFetch('https://test/v1/check',req(body,'maximum-body-call-1'));assert.equal(response.status,200);assert.equal((await response.json()).usage.billableCalls,1);
    const compressed=req();compressed.headers['content-encoding']='gzip';assert.equal((await mf.dispatchFetch('https://test/v1/check',compressed)).status,415);
    const wrongType=req();wrongType.headers['content-type']='text/plain';assert.equal((await mf.dispatchFetch('https://test/v1/check',wrongType)).status,415);
    assert.equal((await mf.dispatchFetch('https://test/v1/check')).status,405);
  }finally{await mf.dispose();}
});

test('workerd committed receipt survives lost caller response; cancellation stops new usage but replay adds zero',async()=>{
 const mf=runtime(false);
 try{
  await activate(mf);
  const lost=async()=>{const response=await mf.dispatchFetch('https://test/v1/check',req());assert.equal(response.status,200);await response.text();throw new Error('synthetic_response_lost');};
  await assert.rejects(lost);
  const replay=await (await mf.dispatchFetch('https://test/v1/check',req())).json();assert.equal(replay.usage.billableCalls,0);assert.equal(replay.usage.successfulCalls,1);assert.equal(replay.usage.outstandingJpy,1);
  assert.equal((await mf.dispatchFetch('https://test/v1/cancel',req({},'synthetic-cancel-0001'))).status,202);
  assert.equal((await mf.dispatchFetch('https://test/v1/check',req(normal,'synthetic-after-stop'))).status,503);
  assert.equal((await (await mf.dispatchFetch('https://test/v1/check',req())).json()).usage.billableCalls,0);
 }finally{await mf.dispose();}
});
test('workerd requires canonical consent evidence; failed notification can retry but delayed success never undoes cancellation',async()=>{
 const mock=stripeMock();let confirmed=false;
 const provider={async fetch(request){const response=await mock.fetch(request);if(request.method==='GET'&&new URL(request.url).pathname==='/v1/checkout/sessions/cs_test'&&!confirmed){const session=await response.json();delete session.consent;return Response.json(session);}return response;}};
 const mf=runtime(false,{},provider);
 try{
  assert.equal((await mf.dispatchFetch('https://test/v1/checkout',req({termsVersion:'2026-10-13'},'synthetic-checkout-0001'))).status,200);
  const send=async(id)=>{const t=Math.floor(Date.now()/1000),body=JSON.stringify({id,type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_test',customer:'cus_test'}}}),sig=createHmac('sha256',webhookSecret).update(t+'.'+body).digest('hex');return mf.dispatchFetch('https://test/v1/stripe/webhook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${sig}`},body});};
  assert.equal((await send('evt_canonical_consent')).status,503);assert.equal((await mf.dispatchFetch('https://test/v1/check',req())).status,503);
  confirmed=true;assert.equal((await send('evt_canonical_consent')).status,200);assert.equal((await mf.dispatchFetch('https://test/v1/check',req())).status,200);
  assert.equal((await mf.dispatchFetch('https://test/v1/cancel',req({}))).status,202);
  assert.equal((await send('evt_delayed_consent')).status,200);assert.equal((await send('evt_delayed_consent')).status,200);
  assert.equal((await mf.dispatchFetch('https://test/v1/check',req(normal,'synthetic-after-consent-cancel'))).status,503);
  const replay=await (await mf.dispatchFetch('https://test/v1/check',req())).json();assert.equal(replay.usage.billableCalls,0);assert.equal(replay.usage.successfulCalls,1);
 }finally{await mf.dispose();}
});

test('workerd billing and all paid routes fail closed before configuration or verified Checkout',async()=>{
 const mf=runtime(false,{BILLING_ENABLED:'false'});try{for(const path of ['check','checkout','cancel'])assert.equal((await mf.dispatchFetch('https://test/v1/'+path,req())).status,503);}finally{await mf.dispose();}
 const pending=runtime(false);try{assert.equal((await pending.dispatchFetch('https://test/v1/check',req())).status,503);assert.equal((await pending.dispatchFetch('https://test/v1/stripe/webhook',{method:'POST',headers:{'stripe-signature':'bad'},body:'{}'})).status,400);}finally{await pending.dispose();}
});

test('workerd sandbox E2E starts without claiming billing verified or enabling live mode',async()=>{
 const mf=runtime(false,{BILLING_VERIFIED:'false'});
 try{const health=await (await mf.dispatchFetch('https://test/health')).json();assert.equal(health.stripeMode,'test');assert.equal(health.billingVerified,false);assert.equal(health.saleActive,false);await activate(mf);const response=await mf.dispatchFetch('https://test/v1/check',req());assert.equal(response.status,200);assert.equal((await response.json()).usage.billableCalls,1);}finally{await mf.dispose();}
});

test('thin meter error dedicated signature, fanout durable hold, replay and snapshot rejection',async()=>{
 const mf=runtime(false);try{
  await activate(mf);await activate(mf,token2);
  assert.equal((await mf.dispatchFetch('https://test/v1/check',req())).status,200);
  const event={id:'evt_test_thin_error_01',object:'v2.core.event',type:'v1.billing.meter.error_report_triggered',livemode:false,related_object:{id:'mtr_test',type:'billing.meter',url:'/v1/billing/meters/mtr_test'}};
  async function send(value=event,secret=billingEnv.STRIPE_METER_WEBHOOK_SECRET,path='/v1/stripe/meter-webhook'){
   const t=Math.floor(Date.now()/1000),body=JSON.stringify(value),sig=createHmac('sha256',secret).update(t+'.'+body).digest('hex');
   return mf.dispatchFetch('https://test'+path,{method:'POST',headers:{'stripe-signature':`t=${t},v1=${sig}`},body});
  }
  assert.equal((await send(event,webhookSecret)).status,400);
  assert.equal((await send(event,webhookSecret,'/v1/stripe/webhook')).status,400);
  for(const bad of [{...event,type:'billing.meter.error_report_triggered'},{...event,livemode:true},{...event,related_object:{id:'mtr_other',type:'billing.meter'}},{...event,context:'acct_other'}])assert.equal((await send(bad)).status,400);
  assert.equal((await send()).status,200);assert.equal((await send()).status,200);
  for(const bearer of [token,token2]){
   const r=await mf.dispatchFetch('https://test/v1/billing',{headers:{authorization:'Bearer '+bearer}});const b=await r.json();assert.equal(b.manualReconciliationRequired,true);assert.equal(b.active,false);
   assert.equal((await mf.dispatchFetch('https://test/v1/check',req(normal,'synthetic-newcall-002',bearer))).status,503);
  }
  const replay=await mf.dispatchFetch('https://test/v1/check',req());assert.equal(replay.status,200);assert.equal((await replay.json()).usage.billableCalls,0);
 }finally{await mf.dispose();}
});
test('thin no_meter_found without related object conservatively holds accounts; missing or reused secret fails closed',async()=>{
 for(const bindings of [{STRIPE_METER_WEBHOOK_SECRET:''},{STRIPE_METER_WEBHOOK_SECRET:webhookSecret}]){const mf=runtime(false,bindings);try{assert.equal((await mf.dispatchFetch('https://test/v1/checkout',req({termsVersion:'2026-10-13'}))).status,503);}finally{await mf.dispose();}}
 const mf=runtime(false);try{
  await activate(mf);const t=Math.floor(Date.now()/1000),body=JSON.stringify({id:'evt_test_no_meter_01',object:'v2.core.event',type:'v1.billing.meter.no_meter_found',livemode:false}),sig=createHmac('sha256',billingEnv.STRIPE_METER_WEBHOOK_SECRET).update(t+'.'+body).digest('hex');
  assert.equal((await mf.dispatchFetch('https://test/v1/stripe/meter-webhook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${sig}`},body})).status,200);
  assert.equal((await mf.dispatchFetch('https://test/v1/check',req())).status,503);
 }finally{await mf.dispose();}
});

test('workerd renewed synthetic credential shares account receipts and cap and can cancel after old credential expires',async()=>{
 const renewed='renewed_synthetic_test_credential_'.padEnd(50,'x'),oldHash=createHash('sha256').update(token).digest('hex'),newHash=createHash('sha256').update(renewed).digest('hex');
 const updated=structuredClone(credentials);updated[oldHash].expiresAt=0;updated[newHash]={...credentials[oldHash],expiresAt:Date.now()+3600000};
 const persist=await mkdtemp(join(tmpdir(),'recalm-renewal-workerd-'));let mf=runtime(persist);
 try{
  await activate(mf);
  const first=await mf.dispatchFetch('https://test/v1/check',req(normal,'renewal-shared-receipt'));assert.equal(first.status,200);assert.equal((await first.json()).usage.billableCalls,1);
  await mf.dispose();mf=runtime(persist,{CREDENTIALS:JSON.stringify(updated)});
  assert.equal((await mf.dispatchFetch('https://test/v1/check',req(normal,'renewal-shared-receipt',token))).status,401);
  const replay=await mf.dispatchFetch('https://test/v1/check',req(normal,'renewal-shared-receipt',renewed));assert.equal(replay.status,200);
  const replayBody=await replay.json();assert.equal(replayBody.usage.billableCalls,0);assert.equal(replayBody.usage.successfulCallsThisMonth,1);
  for(let i=0;i<4;i++)assert.equal((await mf.dispatchFetch('https://test/v1/check',req(normal,'renewal-new-call-'+i,renewed))).status,200);
  assert.equal((await mf.dispatchFetch('https://test/v1/check',req(normal,'renewal-over-cap',renewed))).status,429);
  assert.equal((await mf.dispatchFetch('https://test/v1/cancel',req({},'renewal-cancel-key',renewed))).status,202);
  const billing=await (await mf.dispatchFetch('https://test/v1/billing',{headers:{authorization:'Bearer '+renewed}})).json();
  assert.equal(billing.cancelRequested,true);assert.equal(billing.active,false);assert.equal(billing.outstandingJpy,5);
  const after=await (await mf.dispatchFetch('https://test/v1/check',req(normal,'renewal-shared-receipt',renewed))).json();assert.equal(after.usage.billableCalls,0);assert.equal(after.usage.successfulCallsThisMonth,5);
  assert.equal((await mf.dispatchFetch('https://test/v1/check',req(normal,'renewal-after-cancel',renewed))).status,503);
 }finally{await mf.dispose();await rm(persist,{recursive:true,force:true});}
});

test('health saleActive requires live, three flags and local settings without Stripe calls or secret disclosure',async()=>{
 const live={...billingEnv,TERMS_DOCUMENTS:JSON.stringify(Object.fromEntries(Object.entries(testTermsDocuments).map(([v,d])=>[v,{...d,status:'approved'}]))),STRIPE_MODE:'live',STRIPE_RESTRICTED_KEY:'rk_live_synthetic_only_not_a_real_key',API_ENABLED:'true',BILLING_ENABLED:'true',BILLING_VERIFIED:'true'};
 const cases=[
  [live,true],
  ...['API_ENABLED','BILLING_ENABLED','BILLING_VERIFIED'].flatMap(key=>[[{...live,[key]:'false'},false],[{...live,[key]:undefined},false]]),
  [{...live,STRIPE_MODE:'test',STRIPE_RESTRICTED_KEY:billingEnv.STRIPE_RESTRICTED_KEY},false],
  ...['STRIPE_RESTRICTED_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_METER_WEBHOOK_SECRET','STRIPE_ACCOUNT_ID','STRIPE_PRICE_ID','STRIPE_METER_ID','STRIPE_EVENT_NAME','TERMS_VERSION','PUBLIC_BASE_URL','BILLING_ACCOUNTS'].map(key=>[{...live,[key]:''},false]),
  [{...live,STRIPE_RESTRICTED_KEY:billingEnv.STRIPE_RESTRICTED_KEY},false],
  [{...live,STRIPE_METER_WEBHOOK_SECRET:webhookSecret},false],
  [{...live,FINGERPRINT_SECRET:''},false],
  [{...live,CREDENTIALS:'broken'},false],
  [{...live,CREDENTIALS:'{}'},false],
  [{...live,CREDENTIALS:JSON.stringify({bad:credentials[Object.keys(credentials)[0]]})},false],
  ...[{account:'toString'},{account:'missing-account'},{account:''},{maxMonthlySuccessfulCalls:1001},{expiresAt:'unknown'},{enabled:'true'}].map(extra=>[{...live,CREDENTIALS:JSON.stringify({[Object.keys(credentials)[0]]:{...credentials[Object.keys(credentials)[0]],...extra}})},false])
 ];
 for(const [bindings,expected]of cases){
  const provider=stripeMock(),mf=runtime(false,bindings,provider);
  try{
   const response=await mf.dispatchFetch('https://test/health');assert.equal(response.status,200);
   const text=await response.text(),health=JSON.parse(text);assert.equal(health.saleActive,expected);
   if(expected)assert.equal(health.status,'live_enabled');
   assert.deepEqual(provider.calls,[]);
   for(const secret of [bindings.STRIPE_RESTRICTED_KEY,bindings.STRIPE_WEBHOOK_SECRET,bindings.STRIPE_METER_WEBHOOK_SECRET,token])if(secret)assert.ok(!text.includes(secret));
  }finally{await mf.dispose();}
 }
});
