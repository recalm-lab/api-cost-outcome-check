import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Miniflare} from 'miniflare';
import {billingEnv} from './stripe-mock.js';

test('workerd native fetch rejects an unrelated receiver; StripeClient default and injected paths preserve receivers',async()=>{
 const entry=resolve('src/fetch-regression-worker.js');
 const mf=new Miniflare({modules:[{type:'ESModule',path:entry,contents:`
  import {StripeClient} from './stripe.js';
  export default {async fetch(request,env){
   const native=globalThis.fetch;
   let legacyRejected=false;
   try{await ({fetcher:native}).fetcher('data:text/plain,receiver-ok');}
   catch(error){legacyRejected=error instanceof TypeError&&error.message.includes('Illegal invocation');}
   const boundOk=await (await native.bind(globalThis)('data:text/plain,receiver-ok')).text()==='receiver-ok';
   let defaultReceiver=false;
   try{
    globalThis.fetch=function(){defaultReceiver=this===globalThis;return Promise.resolve(Response.json({ok:true}));};
    await new StripeClient(env).request('GET','/v1/account');
   }finally{globalThis.fetch=native;}
   let injectedCalls=0;
   const injected=await new StripeClient(env,async()=>{injectedCalls++;return Response.json({ok:true});}).request('GET','/v1/account');
   const service={calls:0,fetch(){this.calls++;return Promise.resolve(Response.json({ok:true}));}};
   const serviceResult=await new StripeClient({...env,STRIPE_HTTP:service}).request('GET','/v1/account');
   return Response.json({legacyRejected,boundOk,defaultReceiver,injectedOk:injected.ok&&injectedCalls===1,serviceOk:serviceResult.ok&&service.calls===1});
  }};
 `},{type:'ESModule',path:resolve('src/stripe.js'),contents:await readFile('src/stripe.js','utf8')}],compatibilityDate:'2026-07-30',bindings:billingEnv});
 try{
  const result=await (await mf.dispatchFetch('https://test/receiver')).json();
  assert.equal(result.legacyRejected,true,'native unrelated receiver reproduces Illegal invocation');
  assert.equal(result.boundOk,true,'bound native fetch succeeds without network I/O');
  assert.equal(result.defaultReceiver,true,'default fetch must receive Worker global scope');
  assert.equal(result.injectedOk,true);
  assert.equal(result.serviceOk,true);
 }finally{await mf.dispose();}
});

test('Stripe failures distinguish fixed classes without reflecting response bodies or exception strings',async()=>{
 const {StripeClient,BillingError}=await import('../src/stripe.js');
 const {safeFailure}=await import('../scripts/sandbox-lifecycle.mjs');
 const marker='synthetic-private-marker-never-reflect';
 const cases=[
  [async()=>new Response(marker,{status:429}),'stripe_rate_limited',503],
  [async()=>new Response(marker,{status:500}),'stripe_upstream_unavailable',503],
  [async()=>new Response(marker,{status:503}),'stripe_upstream_unavailable',503],
  [async()=>new Response(marker,{status:403}),'stripe_rejected',502],
  [async()=>{throw new Error(marker);},'stripe_transport_error',503],
  [async()=>new Response(marker,{status:200}),'stripe_invalid_json',502]
 ];
 for(const [fetcher,code,status]of cases){
  let calls=0;const client=new StripeClient(billingEnv,(...args)=>{calls++;return fetcher(...args);});
  await assert.rejects(()=>client.request('POST','/v1/checkout/sessions',{},'synthetic-idempotency'),error=>{
   assert.ok(error instanceof BillingError);assert.equal(error.message,code);assert.equal(error.status,status);
   assert.equal(safeFailure({error:error.message,detail:marker}),code);
   assert.ok(!JSON.stringify(error).includes(marker));return true;
  });
  assert.equal(calls,1,'classification must not retry an ambiguous POST');
 }
 assert.equal(safeFailure({error:marker}),'unclassified');
});
