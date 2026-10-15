import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createIsolatedClosed,initialMetadata,privateWorkerSettings,REVIEWED_SOURCE,APPROVED_TAG} from '../scripts/create-isolated-closed-worker.mjs';
const worker='recalm-api-cost-check-isolated-test',id='3'.repeat(32),versionId='22222222-2222-4222-8222-222222222222';
const options={sha:REVIEWED_SOURCE,approved:true,freePlanConfirmed:true,token:'synthetic-cf-token',build:sha=>({bundle:'synthetic-reviewed-bundle containing /terms.html draft',manifest:{sourceCommit:sha,bundleSha256:'a'.repeat(64)}})};
function mock({existing=false,race=false,deniedAt,lostAt,workerChange,drift=false,shared=false,secret=false,enabled=false,urls=[],badDeployment=false}={}){
 let created=false,versionCreated=false;const calls=[];let creation,versionBody;
 const fetcher=async(url,request)=>{
  calls.push({url,method:request.method});assert.equal(request.redirect,'error');
  const u=new URL(url),path=u.pathname;
  assert.equal(u.origin,'https://api.cloudflare.com');assert.ok(path.startsWith('/client/v4/accounts/9a2e48df6882d20c2d1c4398184215a9/workers/'));
  assert.equal(request.headers.authorization,'Bearer '+options.token);
  assert.ok(!path.includes('/health')&&!path.includes('/terms.html')&&!path.includes('/v1/billing'));
  const isCreate=path.endsWith('/workers/workers'),isVersion=path.endsWith('/workers/'+id+'/versions');
  const stage=request.method==='POST'?(isCreate?'create':'version'):'read';
  if(deniedAt===stage)return Response.json({success:false,errors:[{code:10000,message:options.token}]},{status:403});
  if(lostAt===stage)throw Error(options.token);
  const ok=result=>Response.json({success:true,result});
  const metadata=()=>{const w={id,name:worker,subdomain:{enabled:false,previews_enabled:false,url:'https://'+worker+'.rough-sound-e8d7.workers.dev'},references:{domains:[]},observability:{enabled:false},logpush:false,tail_consumers:[]};if(workerChange)workerChange(w);if(drift&&versionCreated)w.subdomain.previews_enabled=true;return w;};
  if(request.method==='POST'){
   const body=JSON.parse(request.body);
   if(isCreate){creation=body;assert.deepEqual(body,privateWorkerSettings());assert.equal(Object.hasOwn(body,'modules'),false);if(race)return Response.json({success:false,errors:[{code:10000}]},{status:409});created=true;return ok(metadata());}
   assert.equal(isVersion,true);assert.equal(u.search,'?deploy=true');assert.equal(created,true);versionBody=body;versionCreated=true;return ok({id:versionId,urls});
  }
  assert.equal(request.method,'GET');
  if(path.endsWith('/workers/'+worker))return existing?ok(metadata()):Response.json({success:false,errors:[{code:10090}]},{status:404});
  if(path.endsWith('/workers/'+id))return ok(metadata());
  if(path.endsWith('/subdomain'))return ok({enabled:false,previews_enabled:drift&&versionCreated});
  if(path.endsWith('/bindings'))return ok([...initialMetadata().bindings.map(b=>b.type==='durable_object_namespace'?{...b,namespace_id:shared?'0b8d1c5cea78485d9d9ae6a62ed98b6f':'2'.repeat(32),script_name:worker}:enabled&&b.name==='API_ENABLED'?{...b,text:'true'}:b),...(secret?[{name:'CREDENTIALS',type:'secret_text'}]:[])]);
  if(path.endsWith('/settings'))return ok({compatibility_date:'2026-10-01',compatibility_flags:[],logpush:false,observability:{enabled:false},tags:[],tail_consumers:[]});
  if(path.endsWith('/versions/'+versionId))return ok({resources:{script_runtime:{exports:{AccountMeter:{type:'durable-object',storage:'sqlite'}}}}});
  if(path.endsWith('/deployments'))return ok({deployments:[{versions:[{version_id:badDeployment?'11111111-1111-4111-8111-111111111111':versionId,percentage:100}]}]});
  throw Error('unexpected_mock_endpoint');
 };
 return {fetcher,calls,get creation(){return creation;},get versionBody(){return versionBody;}};
}
const mutations=p=>p.calls.filter(c=>c.method!=='GET');
test('private initial deployment disables both URL types before any code exists, deploys pinned bytes and verifies SQLite using metadata only',async()=>{
 const p=mock(),r=await createIsolatedClosed({...options,fetcher:p.fetcher});assert.equal(r.passed,true);assert.equal(r.namespaceVerified,true);assert.equal(r.nonpublicVerified,true);assert.equal(r.metadataOnly,true);assert.equal(r.publicRequests,0);
 assert.deepEqual(p.creation.subdomain,{enabled:false,previews_enabled:false});assert.equal(p.versionBody.modules.length,1);assert.equal(Buffer.from(p.versionBody.modules[0].content_base64,'base64').toString(),options.build(REVIEWED_SOURCE).bundle);
 assert.deepEqual(p.versionBody.exports,{AccountMeter:{type:'durable-object',storage:'sqlite'}});assert.deepEqual(p.versionBody.bindings.find(b=>b.name==='ACCOUNTS'),{name:'ACCOUNTS',type:'durable_object_namespace',class_name:'AccountMeter'});
 assert.ok(p.versionBody.bindings.every(b=>!b.type.startsWith('secret')));assert.equal(p.versionBody.bindings.find(b=>b.name==='BILLING_ACCOUNTS').text,'{}');
 for(const name of ['API_ENABLED','BILLING_ENABLED','BILLING_VERIFIED'])assert.equal(p.versionBody.bindings.find(b=>b.name===name).text,'false');
 assert.deepEqual(mutations(p).map(c=>c.method),['POST','POST']);assert.ok(!JSON.stringify(r).includes(options.token));
 for(const forbidden of ['routes','route','domain','domains','subdomain'])assert.equal(Object.hasOwn(p.versionBody,forbidden),false);
});
test('unapproved source, approval, cost or credential stops before build and network',async()=>{
 for(const extra of [{sha:'b'.repeat(40)},{approved:false},{freePlanConfirmed:false},{token:''}]){const p=mock();let builds=0;const r=await createIsolatedClosed({...options,...extra,build:()=>{builds++;throw Error('unexpected');},fetcher:p.fetcher});assert.equal(r.passed,false);assert.equal(builds,0);assert.equal(p.calls.length,0);}
});
test('existing name is refused; concurrent name creation rejects without upsert or existing-resource adoption',async()=>{
 const existing=mock({existing:true});assert.equal((await createIsolatedClosed({...options,fetcher:existing.fetcher})).error,'target_already_exists_no_overwrite');assert.equal(mutations(existing).length,0);
 const race=mock({race:true}),r=await createIsolatedClosed({...options,fetcher:race.fetcher});assert.equal(r.error,'creation_rejected_no_retry');assert.equal(r.created,false);assert.equal(mutations(race).length,1);
});
test('enabled, unknown or contradictory URL/domain metadata stops with no code upload and no setting repair fallback',async()=>{
 for(const workerChange of [w=>w.subdomain.enabled=true,w=>w.subdomain.previews_enabled=true,w=>delete w.subdomain.enabled,w=>w.references.domains.push({hostname:'unexpected.invalid'}),w=>delete w.references.domains]){const p=mock({workerChange}),r=await createIsolatedClosed({...options,fetcher:p.fetcher});assert.equal(r.error,'nonpublic_worker_unconfirmed');assert.equal(r.created,true);assert.equal(r.deployed,false);assert.equal(mutations(p).length,1);assert.equal(p.versionBody,undefined);}
});
test('403 in read, code-free create or version upload stops with exact operation, no permission expansion and no raw token',async()=>{
 for(const deniedAt of ['read','create','version']){const p=mock({deniedAt}),r=await createIsolatedClosed({...options,fetcher:p.fetcher});assert.equal(r.error,'existing_permission_rejected_no_expansion');assert.equal(r.lastHttpStatus,403);assert.equal(r.noPermissionExpansion,true);assert.ok(r.lastOperation);assert.ok(!JSON.stringify(r).includes(options.token));assert.ok(mutations(p).length<=2);}
});
test('ambiguous create/version outcome is never retried, deleted or replaced through a legacy PUT',async()=>{
 for(const lostAt of ['create','version']){const p=mock({lostAt}),r=await createIsolatedClosed({...options,fetcher:p.fetcher});assert.equal(r.error,'mutation_outcome_unknown_no_retry');assert.equal(r.noAutomaticRetry,true);assert.equal(mutations(p).length,lostAt==='create'?1:2);assert.ok(p.calls.every(c=>c.method==='GET'||c.method==='POST'));}
});
test('shared namespace, unexpected secret or enabled flag rejects metadata verification without public requests',async()=>{
 for(const fixture of [{shared:true},{secret:true},{enabled:true}]){const p=mock(fixture),r=await createIsolatedClosed({...options,fetcher:p.fetcher});assert.equal(r.created,true);assert.equal(r.deployed,true);assert.equal(r.passed,false);assert.equal(r.publicRequests,0);assert.equal(mutations(p).length,2);}
});
test('routable version URLs, public-setting drift and incorrect deployment stop without any enabling operation',async()=>{
 for(const fixture of [{urls:['https://unapproved.invalid']},{drift:true},{badDeployment:true}]){const p=mock(fixture),r=await createIsolatedClosed({...options,fetcher:p.fetcher});assert.equal(r.created,true);assert.equal(r.passed,false);assert.equal(r.publicRequests,0);assert.equal(mutations(p).length,2);}
});
test('no public origin, route/domain/subdomain mutation or draft terms fetch is present in the metadata-only execution path',async()=>{
 const p=mock();await createIsolatedClosed({...options,fetcher:p.fetcher});
 assert.ok(p.calls.every(c=>new URL(c.url).hostname==='api.cloudflare.com'));
 assert.ok(mutations(p).every(c=>new URL(c.url).pathname.endsWith('/workers/workers')||new URL(c.url).pathname.endsWith('/workers/'+id+'/versions')));
 assert.ok(p.calls.every(c=>!c.url.includes('/health')&&!c.url.includes('/terms.html')));
});
test('scoped workflow remains one-tag-only, pinned source, no main change and runtime credentials supplied only after tests',async()=>{
 const text=await readFile('.github/workflows/deploy-scoped-sandbox.yml','utf8');assert.ok(text.includes("- '"+APPROVED_TAG+"'"));assert.ok(text.includes("github.ref == 'refs/tags/"+APPROVED_TAG+"'"));assert.match(text,/startsWith\(github.ref, 'refs\/tags\/recalm-sandbox-scoped-deploy-'\)/);
 const isolated=text.split('  isolated-initial-create:')[1];assert.match(isolated,/ref: 4405833bef84bf6a891ef165b5fdbd106574dbd4/);assert.match(isolated,/secrets.CLOUDFLARE_API_TOKEN/);assert.ok(isolated.indexOf('npm test')<isolated.indexOf('secrets.CLOUDFLARE_API_TOKEN'));
 assert.doesNotMatch(isolated,/RECALM_TEST_API_KEY|secrets\.STRIPE|wrangler|sandbox-smoke|verify-read-only|upload-artifact|cache:|workflow_dispatch/);
});
