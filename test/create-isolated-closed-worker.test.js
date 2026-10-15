import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createIsolatedClosed,initialMetadata,REVIEWED_SOURCE,APPROVED_TAG} from '../scripts/create-isolated-closed-worker.mjs';
const worker='recalm-api-cost-check-isolated-test',origin='https://'+worker+'.rough-sound-e8d7.workers.dev';
const options={sha:REVIEWED_SOURCE,approved:true,freePlanConfirmed:true,token:'synthetic-cf-token',build:sha=>({bundle:'synthetic-reviewed-bundle',manifest:{sourceCommit:sha,bundleSha256:'a'.repeat(64)}})};
function mock({existing=false,appear=false,denied=false,rejectPut=false,lostPut=false,shared=false,secret=false,enabled=false,wrongSource=false,routeDenied=false}={}){
 let created=false,serviceReads=0,routeSet=false;const calls=[];let metadata,bundle;
 const fetcher=async(url,request)=>{
  calls.push({url,method:request.method});assert.equal(request.redirect,'error');
  const u=new URL(url),path=u.pathname;
  if(u.origin===origin){assert.equal(path,'/health');assert.equal(request.method,'GET');assert.equal(request.headers,undefined);return Response.json({status:'sandbox',stripeMode:'test',apiEnabled:enabled,billingEnabled:false,billingVerified:false,saleActive:false},{headers:{'x-recalm-source-commit':wrongSource?'b'.repeat(40):REVIEWED_SOURCE}});}
  assert.equal(u.origin,'https://api.cloudflare.com');assert.ok(path.includes('/workers/services/'+worker)||path.includes('/workers/scripts/'+worker));
  assert.equal(request.headers.authorization,'Bearer '+options.token);
  if(denied)return Response.json({success:false,errors:[{code:10000,message:options.token}]},{status:403});
  const ok=result=>Response.json({success:true,result});
  if(path.endsWith('/services/'+worker)){serviceReads++;return created||existing||appear&&serviceReads>1?ok({id:worker,default_environment:{environment:'production'}}):Response.json({success:false,errors:[{code:10090}]},{status:404});}
  if(request.method==='PUT'){
   assert.ok(path.endsWith('/scripts/'+worker));metadata=JSON.parse(await request.body.get('metadata').text());bundle=await request.body.get('worker.js').text();
   if(rejectPut)return Response.json({success:false,errors:[{code:10000,message:options.token}]},{status:403});
   if(lostPut)throw Error(options.token);
   created=true;return ok({});
  }
  if(path.endsWith('/bindings'))return ok([...initialMetadata().bindings.map(b=>b.type==='durable_object_namespace'?{...b,namespace_id:shared?'0b8d1c5cea78485d9d9ae6a62ed98b6f':'2'.repeat(32),script_name:worker}:b),...(secret?[{name:'CREDENTIALS',type:'secret_text'}]:[])]);
  if(path.endsWith('/settings'))return ok({compatibility_date:'2026-10-01',compatibility_flags:[],logpush:false,observability:{enabled:false},tags:[],tail_consumers:[]});
  if(path.endsWith('/versions'))return ok({items:[{id:'22222222-2222-4222-8222-222222222222'}]});
  if(path.includes('/versions/'))return ok({resources:{script_runtime:{exports:{AccountMeter:{type:'durable-object',storage:'sqlite'}}}}});
  if(path.endsWith('/subdomain')){
   if(request.method==='POST'){if(routeDenied)return Response.json({success:false},{status:403});assert.deepEqual(JSON.parse(request.body),{enabled:true,previews_enabled:false});routeSet=true;}
   return ok({enabled:true,previews_enabled:!routeSet});
  }
  throw Error('unexpected_mock_endpoint');
 };
 return {fetcher,calls,get metadata(){return metadata;},get bundle(){return bundle;}};
}
const mutations=p=>p.calls.filter(c=>c.method!=='GET');
test('isolated creation uploads exact reviewed build, empty customer map and no secrets, creates separate SQLite and verifies only closed public health',async()=>{
 const p=mock(),r=await createIsolatedClosed({...options,fetcher:p.fetcher});assert.equal(r.passed,true);assert.equal(r.namespaceVerified,true);assert.equal(r.publicHealthVerified,true);
 assert.equal(p.bundle,'synthetic-reviewed-bundle');assert.deepEqual(p.metadata,initialMetadata());
 assert.deepEqual(p.metadata.exports,{AccountMeter:{type:'durable-object',storage:'sqlite'}});
 const d=p.metadata.bindings.find(b=>b.name==='ACCOUNTS');assert.deepEqual(d,{name:'ACCOUNTS',type:'durable_object_namespace',class_name:'AccountMeter'});
 assert.equal(p.metadata.bindings.filter(b=>b.name.endsWith('_ENABLED')||b.name==='BILLING_VERIFIED').every(b=>b.text==='false'),true);
 assert.ok(p.metadata.bindings.every(b=>!b.type.startsWith('secret')));assert.equal(p.metadata.bindings.find(b=>b.name==='BILLING_ACCOUNTS').text,'{}');
 assert.deepEqual(mutations(p).map(c=>c.method),['PUT','POST']);assert.equal(p.calls.filter(c=>c.url.startsWith(origin)).length,1);assert.ok(!JSON.stringify(r).includes(options.token));
});
test('unapproved source, missing approval/free confirmation or credential stop before build and network',async()=>{
 for(const extra of [{sha:'b'.repeat(40)},{approved:false},{freePlanConfirmed:false},{token:''}]){
  const p=mock();let builds=0;const r=await createIsolatedClosed({...options,...extra,build:()=>{builds++;throw Error('unexpected');},fetcher:p.fetcher});assert.equal(r.passed,false);assert.equal(builds,0);assert.equal(p.calls.length,0);
 }
});
test('existing target and target appearing between reads are never overwritten',async()=>{
 for(const fixture of [{existing:true},{appear:true}]){const p=mock(fixture),r=await createIsolatedClosed({...options,fetcher:p.fetcher});assert.equal(r.passed,false);assert.equal(mutations(p).length,0);assert.equal(r.created,false);}
});
test('403 stops immediately with no permission expansion, fallback or unsafe provider error output',async()=>{
 for(const fixture of [{denied:true},{rejectPut:true}]){const p=mock(fixture),r=await createIsolatedClosed({...options,fetcher:p.fetcher});assert.equal(r.error,'existing_permission_rejected_no_expansion');assert.equal(r.noPermissionExpansion,true);assert.ok(!JSON.stringify(r).includes(options.token));assert.ok(mutations(p).length<=1);}
});
test('ambiguous upload is attempted once without retry, cleanup, credential renewal or enabling route',async()=>{
 const p=mock({lostPut:true}),r=await createIsolatedClosed({...options,fetcher:p.fetcher});assert.equal(r.error,'mutation_outcome_unknown_no_retry');assert.equal(mutations(p).length,1);assert.equal(r.noAutomaticRetry,true);assert.ok(!JSON.stringify(r).includes(options.token));
});
test('shared namespace or unexpected secret metadata stops after creation without route changes or cleanup',async()=>{
 for(const fixture of [{shared:true},{secret:true}]){const p=mock(fixture),r=await createIsolatedClosed({...options,fetcher:p.fetcher});assert.equal(r.created,true);assert.equal(r.passed,false);assert.equal(mutations(p).length,1);assert.equal(p.calls.filter(c=>c.url.startsWith(origin)).length,0);}
});
test('partial route denial or wrong public flags/source preserves partial evidence and never repeats a mutation',async()=>{
 for(const fixture of [{routeDenied:true},{enabled:true},{wrongSource:true}]){const p=mock(fixture),r=await createIsolatedClosed({...options,fetcher:p.fetcher});assert.equal(r.created,true);assert.equal(r.namespaceVerified,true);assert.equal(r.passed,false);assert.equal(mutations(p).length,2);assert.equal(r.publicHealthVerified,false);}
});
test('isolated initial deployment reuses scoped workflow only on one approved tag, with no main change, client/Stripe secrets or legacy job',async()=>{
 const text=await readFile('.github/workflows/deploy-scoped-sandbox.yml','utf8');
 assert.ok(text.includes("- '"+APPROVED_TAG+"'"));assert.ok(text.includes("github.ref == 'refs/tags/"+APPROVED_TAG+"'"));
 assert.match(text,/startsWith\(github.ref, 'refs\/tags\/recalm-sandbox-scoped-deploy-'\)/);
 const isolated=text.split('  isolated-initial-create:')[1];assert.match(isolated,/ref: 4405833bef84bf6a891ef165b5fdbd106574dbd4/);assert.match(isolated,/secrets.CLOUDFLARE_API_TOKEN/);
 assert.doesNotMatch(isolated,/RECALM_TEST_API_KEY|secrets\.STRIPE|wrangler|sandbox-smoke|verify-read-only|upload-artifact|cache:|workflow_dispatch/);
 assert.ok(isolated.indexOf('npm test')<isolated.indexOf('secrets.CLOUDFLARE_API_TOKEN'));
});
