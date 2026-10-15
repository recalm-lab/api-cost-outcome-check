import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {BACKEND,DEMO,BASE_HASH,CANDIDATE_HASH,prepareCandidate,updateDemo,expectedVars,hash,readContent} from '../scripts/update-demo-content-only.mjs';
const show=(sha,path)=>execFileSync('git',['show',sha+':'+path],{encoding:'utf8'});
// Reconstruct the immutable baseline with its original builder, bypassing only its
// checkout assertion in this credential-free test fixture (never in the uploader).
const builderSource=show(BACKEND,'scripts/build-reviewed-worker.mjs').split('if(process.argv[1]')[0].replaceAll('assertCheckout(sha);','');
const {buildReviewedBundle}=await import('data:text/javascript;base64,'+Buffer.from(builderSource).toString('base64'));
const baseline=buildReviewedBundle(BACKEND).bundle;
const assets=Object.fromEntries(['index.html','style.css','demo.js','examples.json'].map(n=>['/'+n,show(DEMO,'public/'+n)]));
const oldStatic=show(BACKEND,'public/dashboard-demo-worker.js'),candidate=prepareCandidate(baseline,oldStatic,assets);
function fake(extra={}){
 const calls=[];let content=extra.content??baseline,updated=false,backedUp=false;
 const bindings=[...Object.entries(expectedVars).map(([name,text])=>({name,text,type:'plain_text'})),...['STRIPE_RESTRICTED_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_METER_WEBHOOK_SECRET','FINGERPRINT_SECRET','CREDENTIALS'].map(name=>({name,type:'secret_text'})),{name:'ACCOUNTS',type:'durable_object_namespace',class_name:'AccountMeter',namespace_id:'0b8d1c5cea78485d9d9ae6a62ed98b6f'}];
 if(extra.enabled)bindings.find(b=>b.name==='API_ENABLED').text='true';
 const settings={compatibility_date:'2026-10-01',compatibility_flags:[],logpush:false,tags:[],tail_consumers:[],placement:{},usage_model:'standard'};
 return {calls,saveBackup:async s=>{assert.equal(s,baseline);backedUp=true;},fetcher:async(url,o)=>{
  const u=new URL(url),p=u.pathname;calls.push({method:o.method,path:p});
  if(extra.reject)return new Response('{}',{status:403});
  if(u.hostname!=='api.cloudflare.com'){
   if(p==='/health')return Response.json({stripeMode:'live',apiEnabled:false,billingEnabled:false,billingVerified:false,saleActive:false},{headers:{'x-recalm-source-commit':BACKEND}});
   assert.equal(o.method,'GET');assert.ok(Object.hasOwn(assets,p==='/'?'/index.html':p));return new Response(assets[p==='/'?'/index.html':p]);
  }
  if(o.method==='PUT'){
   assert.ok(backedUp);assert.ok(p.endsWith('/content'));assert.deepEqual(JSON.parse(await o.body.get('metadata').text()),{main_module:'worker.js'});
   assert.equal(await o.body.get('worker.js').text(),candidate);content=candidate;updated=true;
   if(extra.lost)throw Error('synthetic transport detail must not escape');
   return Response.json({success:true,result:{}});
  }
  assert.equal(o.method,'GET');let result;
  if(p.endsWith('/content/v2'))return new Response(content,{headers:{'content-type':'application/javascript+module'}});
  if(p.endsWith('/bindings'))result=bindings;
  else if(p.endsWith('/settings'))result=updated&&extra.drift?{...settings,logpush:true}:settings;
  else if(p.endsWith('/deployments'))result={deployments:[{versions:[{percentage:100,version_id:updated?'new-version':'old-version'}]}]};
  else if(p.includes('/versions/'))result={resources:{script_runtime:{exports:{AccountMeter:{type:'durable-object',storage:'sqlite'}}}}};
  else {assert.ok(p.endsWith('/services/recalm-api-cost-check'));result={id:'recalm-api-cost-check',default_environment:{environment:'production'}};}
  return Response.json({success:true,result});
 }};
}
test('pinned demo substitution preserves all other baseline bytes and refuses unrelated input',()=>{
 assert.equal(hash(baseline),BASE_HASH);assert.equal(hash(candidate),CANDIDATE_HASH);
 assert.throws(()=>prepareCandidate(baseline+'x',oldStatic,assets));
 assert.throws(()=>prepareCandidate(baseline,oldStatic,{...assets,'/terms.html':'changed'}));
 assert.throws(()=>prepareCandidate(baseline,oldStatic,{...assets,'/demo.js':'changed'}));
});
test('current content and metadata match before one content-only PUT; backup and four public hashes verified',async()=>{
 const f=fake(),r=await updateDemo({baseline,candidate,assets,credential:'synthetic-only',...f});
 assert.equal(r.passed,true);assert.equal(r.backupSha256,BASE_HASH);assert.equal(r.contentSha256,CANDIDATE_HASH);
 assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);assert.ok(f.calls.every(c=>['GET','PUT'].includes(c.method)));
});
test('403, content drift and enabled flag stop without a write or fallback',async()=>{
 for(const extra of [{reject:true},{content:baseline+'different'},{enabled:true}]){
  const f=fake(extra),r=await updateDemo({baseline,candidate,assets,credential:'synthetic-only',...f});
  assert.equal(r.passed,false);assert.equal(r.mutationAttempts,0);assert.ok(f.calls.every(c=>c.method==='GET'));
 }
});
test('lost PUT response and post-update drift never trigger a second update or disclose raw errors',async()=>{
 for(const extra of [{lost:true},{drift:true}]){
  const f=fake(extra),r=await updateDemo({baseline,candidate,assets,credential:'synthetic-only',...f});
  assert.equal(r.passed,false);assert.equal(r.noAutomaticRetry,true);assert.equal(f.calls.filter(c=>c.method==='PUT').length,1);assert.ok(!JSON.stringify(r).includes('synthetic transport'));
 }
});
test('content parser accepts only one known module and rejects ambiguous multipart payloads',async()=>{
 const form=new FormData();form.set('worker.js',new Blob([baseline],{type:'application/javascript+module'}),'worker.js');
 assert.equal(await readContent(new Response(form)),baseline);
 form.set('other.js',new Blob(['other']),'other.js');await assert.rejects(readContent(new Response(form)));
});
