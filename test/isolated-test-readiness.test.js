import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {preparation,syntheticDocuments,validateTarget,verifyReadOnly} from '../scripts/isolated-test-readiness.mjs';
const sha='a'.repeat(40),target=validateTarget(),customer='cus_IsolatedSynthetic1';
const cfToken='synthetic-cf-token-only',clientKey='synthetic-existing-test-credential-'.padEnd(50,'x');
const options={sha,customer,cfToken,clientKey,noExtraCostConfirmed:true};
function mock({bindingChange,healthChange,namespace,denied=false,expired=false,canceled=false,active=false,badSource=false,badDocument=false,drift=false,archivedChange}={}){
 const calls=[];let settingsReads=0;
 const vars={...preparation(sha).requiredVars,BILLING_ACCOUNTS:JSON.stringify({[target.logicalAccount]:{customerId:customer}})};
 const bindings=[...Object.entries(vars).map(([name,text])=>({name,type:'plain_text',text})),...['STRIPE_RESTRICTED_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_METER_WEBHOOK_SECRET','FINGERPRINT_SECRET','CREDENTIALS'].map(name=>({name,type:'secret_text'})),{name:'ACCOUNTS',type:'durable_object_namespace',class_name:'AccountMeter',namespace_id:namespace||'1'.repeat(32),script_name:target.workerName}];
 if(bindingChange)bindingChange(bindings);
 const versionId='11111111-1111-4111-8111-111111111111';
 const exports={AccountMeter:{type:'durable-object',storage:'sqlite'}};
 const fetcher=async(url,request)=>{
  calls.push({url,request});assert.equal(request.method,'GET');assert.equal(request.redirect,'error');
  const u=new URL(url),path=u.pathname;
  if(u.hostname==='api.cloudflare.com'){
   assert.equal(request.headers.authorization,'Bearer '+cfToken);
   if(denied)return Response.json({success:false,error:cfToken},{status:403});
   let result;
   if(path.endsWith('/bindings'))result=bindings;
   else if(path.endsWith('/settings'))result={compatibility_date:'2026-10-01',compatibility_flags:[],observability:{enabled:false},logpush:false,tags:drift&&++settingsReads>1?['changed']:[],tail_consumers:[],exports};
   else if(path.endsWith('/deployments'))result={deployments:[{versions:[{percentage:100,version_id:versionId}]}]};
   else if(path.endsWith('/versions'))result={items:[{id:versionId}]};
   else if(path.endsWith('/versions/'+versionId))result={resources:{script_runtime:{exports}}};
   else if(path.endsWith('/services/'+target.workerName))result={id:target.workerName,default_environment:{environment:'production'}};
   else throw Error('unexpected_mock_cf_request');
   return Response.json({success:true,result});
  }
  assert.equal(u.origin,target.base);assert.ok(!url.includes('recalm-api-cost-check.rough-sound'));
  const headers={'x-recalm-source-commit':badSource?'b'.repeat(40):sha};
  if(path==='/health'){assert.equal(request.headers.authorization,undefined);return Response.json({status:'sandbox',stripeMode:'test',apiEnabled:false,billingEnabled:true,billingVerified:false,saleActive:false,...healthChange},{headers});}
  const documents=syntheticDocuments();
  const shown=Object.values(documents).find(d=>new URL(d.url).pathname===path);
  if(shown){assert.equal(request.headers.authorization,undefined);return new Response(shown.body+(badDocument?'changed':''),{headers});}
  assert.equal(request.headers.authorization,'Bearer '+clientKey);
  if(path==='/v1/billing')return expired?Response.json({error:clientKey},{status:401,headers}):Response.json({outstandingJpy:0,collectedJpy:0,waivedJpy:0,active,cancelRequested:canceled,hold:!active,manualReconciliationRequired:false,billingTimezone:'UTC',paymentUrl:'not-logged-'+clientKey},{headers});
  if(path==='/v1/terms')return Response.json({version:target.termsVersions[0],...documents[target.termsVersions[0]],...archivedChange},{headers});
  throw Error('unexpected_mock_test_request');
 };
 return {calls,fetcher};
}
const authenticated=calls=>calls.filter(c=>c.request.headers.authorization==='Bearer '+clientKey);

test('isolated plan needs no credential or network and contains only synthetic test terms and separate target',()=>{
 const plan=preparation(sha);assert.equal(plan.preparedOnly,true);assert.equal(plan.remoteExecuted,false);assert.equal(plan.resourceCreation,false);
 assert.equal(plan.requiredVars.STRIPE_MODE,'test');assert.equal(plan.requiredVars.API_ENABLED,'false');assert.equal(plan.requiredVars.BILLING_VERIFIED,'false');
 assert.notEqual(plan.target,'recalm-api-cost-check');assert.notEqual(plan.requiredVars.STRIPE_ACCOUNT_ID,'acct_1TqptlRUIufKFmuE');
 for(const d of Object.values(syntheticDocuments())){assert.equal(d.status,'test-only');assert.ok(d.body.includes('TEST ONLY'));assert.ok(d.url.startsWith(target.base+'/terms/'));}
 assert.throws(()=>preparation('main'),/reviewed_sha_required/);assert.throws(()=>validateTarget({...target,base:'https://elsewhere.test'}),/unapproved_test_target/);
});

test('isolated preflight checks metadata, source and documents before credential use; all traffic is GET only',async()=>{
 const provider=mock(),result=await verifyReadOnly({...options,fetcher:provider.fetcher});
 assert.equal(result.httpGetOnly,true);assert.equal(result.integrationVerified,false);assert.equal(result.contractActive,false);assert.equal(result.archivedConsentVerified,false);assert.equal(result.providerPlanIndependentlyVerified,false);
 assert.equal(authenticated(provider.calls).length,1);assert.ok(provider.calls.at(-1).url.endsWith('/v1/billing'));assert.equal(provider.calls.filter(c=>c.url.endsWith('/bindings')).length,2);
 assert.ok(!JSON.stringify(result).includes(clientKey));assert.ok(!JSON.stringify(result).includes(cfToken));
});

test('cost unconfirmed, missing credentials and known consumed test customers stop before any remote request',async()=>{
 for(const extra of [{noExtraCostConfirmed:false},{cfToken:''},{clientKey:''},{customer:'cus_VQrJWHFdsVqzJG'},{customer:'cus_VQoavxGaZUgnF9'}]){
  const provider=mock();await assert.rejects(()=>verifyReadOnly({...options,...extra,fetcher:provider.fetcher}));assert.equal(provider.calls.length,0);
 }
});

test('live account/mode, shared namespace, wrong mapping and non-opaque secrets reject before client authentication',async()=>{
 for(const change of [
  {bindingChange:b=>b.find(x=>x.name==='STRIPE_MODE').text='live'},
  {bindingChange:b=>b.find(x=>x.name==='STRIPE_ACCOUNT_ID').text='acct_1TqptlRUIufKFmuE'},
  {namespace:target.excludedNamespaceId},
  {bindingChange:b=>b.find(x=>x.name==='ACCOUNTS').script_name='recalm-api-cost-check'},
  {bindingChange:b=>b.find(x=>x.name==='BILLING_ACCOUNTS').text='{}'},
  {bindingChange:b=>b.find(x=>x.name==='CREDENTIALS').text=clientKey}
 ]){
  const provider=mock(change);await assert.rejects(()=>verifyReadOnly({...options,fetcher:provider.fetcher}));assert.equal(authenticated(provider.calls).length,0);
 }
});

test('CF scope denial, health drift, stale source and modified document reject without fallback or key forwarding',async()=>{
 for(const change of [{denied:true},{healthChange:{stripeMode:'live'}},{badSource:true},{badDocument:true},{drift:true}]){
  const provider=mock(change);await assert.rejects(()=>verifyReadOnly({...options,fetcher:provider.fetcher}),e=>!e.message.includes(cfToken)&&!e.message.includes(clientKey));assert.equal(authenticated(provider.calls).length,0);
 }
});

test('expired/disabled existing credential and canceled account stop with no issuance or lifecycle request',async()=>{
 for(const [change,code]of [[{expired:true},'test_credential_rejected_no_issuance'],[{canceled:true},'test_account_not_usable_no_reset']]){
  const provider=mock(change);await assert.rejects(()=>verifyReadOnly({...options,fetcher:provider.fetcher}),new RegExp(code));assert.equal(authenticated(provider.calls).length,1);assert.ok(provider.calls.every(c=>c.request.method==='GET'));
 }
});

test('existing active test contract may verify archived synthetic bytes but does not claim new scenario verification',async()=>{
 const provider=mock({active:true}),result=await verifyReadOnly({...options,fetcher:provider.fetcher});assert.equal(result.archivedConsentVerified,true);assert.equal(result.integrationVerified,false);assert.equal(authenticated(provider.calls).length,2);
 const mismatch=mock({active:true,archivedChange:{sha256:'0'.repeat(64)}});await assert.rejects(()=>verifyReadOnly({...options,fetcher:mismatch.fetcher}),/test_archived_terms_mismatch/);
});

test('isolated workflow is dispatch-only; normal push/PR cannot select credentials or start remote/deployment work',async()=>{
 const workflow=await readFile('.github/workflows/isolated-test-readiness.yml','utf8');
 assert.match(workflow,/^on:\r?\n  workflow_dispatch:/m);assert.doesNotMatch(workflow,/^  (push|pull_request|workflow_run|schedule|repository_dispatch):/m);
 assert.match(workflow,/github.event_name == 'workflow_dispatch'/);assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/default: plan/);
 assert.match(workflow,/inputs.action == 'verify-read-only' && inputs.no_extra_cost_confirmed == true/);
 assert.ok(workflow.indexOf('Verify all synthetic tests without runtime credentials')<workflow.indexOf('secrets.CLOUDFLARE_API_TOKEN'));
 assert.doesNotMatch(workflow,/wrangler|gh workflow run|upload-artifact|secrets\.STRIPE|NODE_TLS_REJECT_UNAUTHORIZED/);
});
