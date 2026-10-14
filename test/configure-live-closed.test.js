import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configureLiveClosed} from '../scripts/configure-live-closed.mjs';
const sha='a'.repeat(40),ns='0b8d1c5cea78485d9d9ae6a62ed98b6f';
const settings={compatibility_date:'2026-10-01',compatibility_flags:[],logpush:false,tags:[],tail_consumers:[],placement:{},usage_model:'standard'};
const exports={AccountMeter:{type:'durable-object',storage:'sqlite'}};
function fake(extra={}){
 const vars={STRIPE_MODE:'test',STRIPE_ACCOUNT_ID:'acct_1TqptzD1AvIZkMfK',STRIPE_PRICE_ID:'price_1UPwToD1AvIZkMfK9yFCs9xN',STRIPE_METER_ID:'mtr_test_61VZKPnRudfS37Kdz41D1AvIZkMfK1J2',BILLING_ACCOUNTS:JSON.stringify({'sandbox-e2e-20261013':{customerId:'cus_VQrJWHFdsVqzJG'}}),API_ENABLED:'false',BILLING_ENABLED:'false',BILLING_VERIFIED:'false',STRIPE_EVENT_NAME:'recalm_api_cost_check_success_v1',TERMS_VERSION:'2026-10-13',PUBLIC_BASE_URL:'https://recalm-api-cost-check.rough-sound-e8d7.workers.dev',...extra.vars};
 let bindings=[...Object.entries(vars).map(([name,text])=>({name,text,type:'plain_text'})),...['STRIPE_RESTRICTED_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_METER_WEBHOOK_SECRET','FINGERPRINT_SECRET','CREDENTIALS'].map(name=>({name,type:'secret_text'})),{name:'ACCOUNTS',type:'durable_object_namespace',class_name:'AccountMeter',namespace_id:extra.namespace||ns}];
 const calls=[];let payload;
 return {calls,get payload(){return payload;},fetch:async(url,options)=>{
  const path=new URL(url).pathname;calls.push({method:options.method,path});let result;
  if(path==='/health')return new Response(JSON.stringify({stripeMode:bindings.find(b=>b.name==='STRIPE_MODE').text,apiEnabled:false,billingEnabled:false,billingVerified:false,saleActive:false}),{headers:{'x-recalm-source-commit':extra.sha||sha}});
  if(options.method==='PATCH'){
   payload=JSON.parse(await options.body.get('settings').text());
   bindings=bindings.map(b=>{const next=payload.bindings.find(n=>n.name===b.name);return next.type==='inherit'?b:next;});result={};
  }else if(path.endsWith('/bindings'))result=bindings;
  else if(path.endsWith('/settings'))result=settings;
  else if(path.endsWith('/deployments'))result={deployments:[{versions:[{percentage:100,version_id:extra.version||'current'}]}]};
  else if(path.endsWith('/versions'))result={items:[{id:'current'}]};
  else if(path.includes('/versions/'))result={resources:{script_runtime:{exports:extra.exports||exports}}};
  else result={id:'recalm-api-cost-check',default_environment:{environment:'production'}};
  return Response.json({success:true,result});
 }};
}
test('closed live configuration PATCH changes only five non-secret settings, clears customer map, and inherits all secrets and ledger',async()=>{
 const old=process.env.CLOUDFLARE_API_TOKEN;process.env.CLOUDFLARE_API_TOKEN='synthetic_config_test';const f=fake();
 try{
  const result=await configureLiveClosed(sha,f.fetch);assert.equal(result.closed,true);assert.equal(result.customerMappingEmpty,true);
  const changed=f.payload.bindings.filter(b=>b.type!=='inherit');assert.deepEqual(changed.map(b=>b.name).sort(),['BILLING_ACCOUNTS','STRIPE_ACCOUNT_ID','STRIPE_METER_ID','STRIPE_MODE','STRIPE_PRICE_ID']);
  assert.ok(changed.every(b=>b.type==='plain_text'));assert.equal(changed.find(b=>b.name==='BILLING_ACCOUNTS').text,'{}');
  assert.deepEqual(f.payload.exports,exports);assert.ok(!JSON.stringify(f.payload).includes('synthetic_config_test'));
  assert.equal(f.calls.filter(c=>c.method==='PATCH').length,1);assert.ok(f.calls.every(c=>c.method==='GET'||c.method==='PATCH'));
 }finally{if(old===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=old;}
});
test('enabled flags, unexpected test configuration, source, namespace, version, or export stop before any mutation',async()=>{
 const old=process.env.CLOUDFLARE_API_TOKEN;process.env.CLOUDFLARE_API_TOKEN='synthetic_config_test';
 try{
  for(const extra of [{vars:{API_ENABLED:'true'}},{vars:{BILLING_ENABLED:'true'}},{vars:{BILLING_VERIFIED:'true'}},{vars:{STRIPE_MODE:'live'}},{vars:{STRIPE_PRICE_ID:'price_other'}},{vars:{BILLING_ACCOUNTS:'{}'}},{sha:'b'.repeat(40)},{namespace:'different'},{version:'pending'},{exports:{AccountMeter:{type:'durable-object',storage:'legacy'}}}]){
   const f=fake(extra);await assert.rejects(configureLiveClosed(sha,f.fetch));assert.ok(f.calls.every(c=>c.method==='GET'));
  }
 }finally{if(old===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=old;}
});
