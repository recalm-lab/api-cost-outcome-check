// No secret/header/body/Checkout URL output. No Stripe calls except through approved test Worker.
import assert from 'node:assert/strict';
import {normal} from './fixtures.mjs';
const origin='https://recalm-api-cost-check.rough-sound-e8d7.workers.dev';
const action=process.argv[2]||'readiness';
if(!['readiness','check'].includes(action))throw new Error('Supported actions: readiness, check');
const output=[];
async function request(path,options={}){
 const start=performance.now();let response;
 try{response=await fetch(origin+path,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new Error('approved_worker_unreachable');}
 output.push({path,status:response.status,wallMs:Math.round(performance.now()-start),note:'wall time is not CPU'});
 let json=null;try{json=await response.json();}catch{}return {status:response.status,json};
}
try{
 const health=await request('/health');assert.equal(health.status,200);
 if(action==='readiness'){
  assert.equal(health.json.saleActive,false);assert.equal(health.json.stripeMode,'test');
  const spec=await request('/openapi.json');assert.equal(spec.status,200);assert.equal(spec.json.openapi,'3.1.0');
  console.log(JSON.stringify({action,checks:output,apiEnabled:health.json.apiEnabled===true,stripeMode:health.json.stripeMode||'static_only',saleActive:false}));
 }else{
  assert.equal(process.env.RECALM_SANDBOX_E2E,'true');assert.equal(health.json.stripeMode,'test');assert.equal(health.json.apiEnabled,true);assert.equal(health.json.billingEnabled,true);assert.equal(health.json.saleActive,false);
  const key=process.env.RECALM_TEST_API_KEY;if(!/^[A-Za-z0-9_-]{43,128}$/.test(key||''))throw new Error('client_test_key_not_injected');
  const idem=process.env.RECALM_SMOKE_IDEMPOTENCY_KEY;if(!/^[A-Za-z0-9_-]{16,128}$/.test(idem||''))throw new Error('stable_test_idempotency_key_required');
  const headers={'authorization':'Bearer '+key,'content-type':'application/json','idempotency-key':idem};
  const before=await request('/v1/billing',{headers:{authorization:'Bearer '+key}});assert.equal(before.status,200);
  const first=await request('/v1/check',{method:'POST',headers,body:JSON.stringify(normal)});assert.equal(first.status,200);
  const retry=await request('/v1/check',{method:'POST',headers,body:JSON.stringify(normal)});assert.equal(retry.status,200);assert.equal(retry.json.usage.billableCalls,0);assert.equal(retry.json.usage.successfulCalls,first.json.usage.successfulCalls);
  const conflict=await request('/v1/check',{method:'POST',headers,body:JSON.stringify({...normal,scope:'synthetic-conflict'})});assert.equal(conflict.status,409);
  assert.equal(first.json.usage.billableCalls===0||first.json.usage.billableCalls===1,true);
  console.log(JSON.stringify({action,checks:output,firstIncrement:first.json.usage.billableCalls,retryIncrement:0,conflictStatus:409,sandboxOnly:true}));
 }
}catch(error){console.log(JSON.stringify({action,checks:output,passed:false,reason:error.message==='approved_worker_unreachable'?'approved_worker_unreachable':error.message==='client_test_key_not_injected'?'client_test_key_not_injected':error.message==='stable_test_idempotency_key_required'?'stable_test_idempotency_key_required':'unexpected_status_or_test_configuration'}));process.exitCode=1;}
