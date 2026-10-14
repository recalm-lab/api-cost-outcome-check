import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {uploadClosed,retainedSettings,canonical} from '../scripts/upload-live-closed-worker.mjs';
import {buildReviewedBundle} from '../scripts/build-reviewed-worker.mjs';
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const baseSettings={compatibility_date:'2026-07-30',compatibility_flags:[],observability:{enabled:false},logpush:false,tags:[],tail_consumers:[],usage_model:'standard',exports:{AccountMeter:{type:'durable-object',storage:'sqlite'}}};
const baseBindings=[
 ...Object.entries({STRIPE_MODE:'live',API_ENABLED:'false',BILLING_ENABLED:'false',BILLING_VERIFIED:'false',CUSTOM_VAR:'retained'}).map(([name,text])=>({name,text,type:'plain_text'})),
 {name:'CUSTOM_JSON',type:'json',json:{retain:true}},
 ...['STRIPE_RESTRICTED_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_METER_WEBHOOK_SECRET','FINGERPRINT_SECRET','CREDENTIALS'].map(name=>({name,type:'secret_text'})),
 {name:'ACCOUNTS',type:'durable_object_namespace',class_name:'AccountMeter',namespace_id:'0b8d1c5cea78485d9d9ae6a62ed98b6f'}
];
async function run({bindings=baseBindings,settings=baseSettings,expected=baseSettings,changed,after,mode='live',expectedSha=sha,httpEnabled=false,httpSha=sha}={}){
 const calls=[];let metadata,bundle,reads=0;
 const fetcher=async(url,options={})=>{
  const method=options.method||'GET',path=new URL(url).pathname;calls.push({method,path});
  if(new URL(url).hostname.endsWith('workers.dev')){
   const headers={'x-recalm-source-commit':httpSha};
   if(path==='/health')return Response.json({stripeMode:mode,apiEnabled:httpEnabled,billingEnabled:false,billingVerified:false,saleActive:false},{headers});
   return Response.json({error:'billing_unavailable'},{status:503,headers});
  }
  if(method==='GET'&&path.endsWith('/services/recalm-api-cost-check'))return Response.json({success:true,result:{id:'recalm-api-cost-check',default_environment:{environment:'production'}}});
  if(method==='GET'&&path.endsWith('/bindings')){reads++;return Response.json({success:true,result:reads===1?bindings:reads===2?(changed?.bindings||bindings):(after?.bindings||bindings)});}
  if(method==='GET'&&path.endsWith('/settings'))return Response.json({success:true,result:reads===1?settings:reads===2?(changed?.settings||settings):(after?.settings||settings)});
  if(method==='PUT'&&path.endsWith('/scripts/recalm-api-cost-check/content')){metadata=JSON.parse(await options.body.get('metadata').text());bundle=await options.body.get('worker.js').text();return Response.json({success:true,result:{}});}
  throw Error('unexpected_endpoint');
 };
 const old=process.env.CLOUDFLARE_API_TOKEN,log=console.log;process.env.CLOUDFLARE_API_TOKEN='synthetic_not_a_real_token';console.log=()=>{};
 let error=null;try{await uploadClosed({sha:expectedSha,expected,mode,fetcher});}catch(e){error=e.message;}finally{console.log=log;if(old===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=old;}
 return {error,calls,metadata,bundle};
}
test('fresh reviewed bundle SHA matches PUT, exact remote settings survive and deployed closed HTTP carries SHA',async()=>{
 const output=await run();assert.equal(output.error,null);
 assert.equal(output.bundle,buildReviewedBundle(sha).bundle);
 assert.deepEqual(output.metadata,{main_module:'worker.js'});

 assert.equal(output.calls.filter(c=>c.method==='PUT').length,1);assert.ok(output.calls.filter(c=>c.method==='PUT').every(c=>c.path.endsWith('/scripts/recalm-api-cost-check/content')));
 assert.deepEqual(output.calls.slice(-3).map(c=>c.path),['/health','/v1/stripe/webhook','/v1/stripe/meter-webhook']);
 const built=buildReviewedBundle(sha);assert.equal(built.manifest.sourceCommit,sha);assert.equal(built.manifest.bundleSha256,createHash('sha256').update(output.bundle).digest('hex'));
 for(const key of ['migrations','routes','route','vars'])assert.ok(!Object.hasOwn(output.metadata,key));
});
test('SHA mismatch and missing expected SHA stop before network or any stale bundle use',async()=>{
 for(const expectedSha of [undefined,'',sha.replace(/^./,sha[0]==='a'?'b':'a')]){
  const output=await run({expectedSha:expectedSha===undefined?'bad':expectedSha});assert.ok(output.error);assert.deepEqual(output.calls,[]);
 }
});
test('remote settings unknown, missing, changed, or different from reviewed expectation stop before PUT',async()=>{
 const fixtures=[
  {...baseSettings,compatibility_date:'2026-08-01'},
  {...baseSettings,compatibility_flags:['nodejs_compat']},
  {...baseSettings,observability:{enabled:true}},
  {...baseSettings,unknown:true},
  {...baseSettings,observability:{enabled:false,unknown:true}},
  Object.fromEntries(Object.entries(baseSettings).filter(([k])=>k!=='compatibility_flags'))
 ];
 for(const settings of fixtures){const output=await run({settings});assert.ok(output.error);assert.ok(output.calls.every(c=>c.method==='GET'));}
 const output=await run({changed:{settings:{...baseSettings,logpush:true}}});assert.equal(output.error,'preflight_remote_changed');assert.ok(output.calls.every(c=>c.method==='GET'));
});
test('remote settings and bindings drift after PUT or enabled/wrong-SHA HTTP are failures',async()=>{
 for(const after of [{settings:{...baseSettings,observability:{enabled:true}}},{bindings:baseBindings.filter(b=>b.name!=='CREDENTIALS')}]){
  const output=await run({after});assert.equal(output.error,'remote_retention_failed');assert.equal(output.calls.filter(c=>c.method==='PUT').length,1);
 }
 assert.equal((await run({httpEnabled:true})).error,'closed_http_health_failed');
 assert.equal((await run({httpSha:'stale'})).error,'closed_http_health_failed');
});
test('mode/flags/namespace fail before PUT; test bootstrap requires test with three exact false flags',async()=>{
 for(const bindings of [
  baseBindings.map(b=>b.name==='STRIPE_MODE'?{...b,text:'test'}:b),
  ...['API_ENABLED','BILLING_ENABLED','BILLING_VERIFIED'].map(name=>baseBindings.map(b=>b.name===name?{...b,text:'true'}:b)),
  [...baseBindings,baseBindings[0]],baseBindings.filter(b=>b.name!=='STRIPE_MODE'),
  baseBindings.map(b=>b.name==='ACCOUNTS'?{...b,namespace_id:'wrong'}:b)
 ]){const output=await run({bindings});assert.ok(output.error);assert.ok(output.calls.every(c=>c.method==='GET'));}
 const bindings=baseBindings.map(b=>b.name==='STRIPE_MODE'?{...b,text:'test'}:b);
 assert.equal((await run({bindings,mode:'test'})).error,null);
});
