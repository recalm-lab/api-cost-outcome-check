// Non-public initial deployment only. No multipart upsert, route updates or public HTTP requests.
import {fileURLToPath} from 'node:url';
import {buildReviewedBundle} from './build-reviewed-worker.mjs';
import {validateTarget} from './isolated-test-readiness.mjs';
import {retainedSettings} from './upload-live-closed-worker.mjs';
export const REVIEWED_SOURCE='4405833bef84bf6a891ef165b5fdbd106574dbd4';
export const APPROVED_TAG='recalm-isolated-closed-create-20261015-v1';
const target=validateTarget();
const vars={STRIPE_MODE:'test',API_ENABLED:'false',BILLING_ENABLED:'false',BILLING_VERIFIED:'false',BILLING_ACCOUNTS:'{}',PUBLIC_BASE_URL:target.base};
const stop=code=>{throw Error(code);};
export function privateWorkerSettings(){
 return {name:target.workerName,subdomain:{enabled:false,previews_enabled:false},observability:{enabled:false},logpush:false,tags:[],tail_consumers:[]};
}
export function initialMetadata(){
 return {main_module:'worker.js',compatibility_date:'2026-10-01',compatibility_flags:[],bindings:[...Object.entries(vars).map(([name,text])=>({name,type:'plain_text',text})),{name:'ACCOUNTS',type:'durable_object_namespace',class_name:'AccountMeter'}],exports:{AccountMeter:{type:'durable-object',storage:'sqlite'}}};
}
function inspectPrivateWorker(worker,id){
 if(worker?.name!==target.workerName||!/^[0-9a-f]{32}$/.test(worker.id||'')||id&&worker.id!==id)stop('created_identity_unconfirmed');
 if(worker.subdomain?.enabled!==false||worker.subdomain.previews_enabled!==false||!Array.isArray(worker.references?.domains)||worker.references.domains.length)stop('nonpublic_worker_unconfirmed');
 if(worker.logpush!==false||worker.observability?.enabled!==false||!Array.isArray(worker.tail_consumers)||worker.tail_consumers.length)stop('closed_settings_unconfirmed');
 return worker.id;
}
export async function createIsolatedClosed({sha,approved=false,freePlanConfirmed=false,token,fetcher=fetch,build=buildReviewedBundle}){
 const evidence={target:target.workerName,sourceCommit:sha,created:false,bootstrapDeployed:false,deployed:false,namespaceVerified:false,nonpublicVerified:false,publicRequests:0,mutationAttempts:0};
 try{
  if(sha!==REVIEWED_SOURCE)stop('reviewed_source_required');
  if(approved!==true||freePlanConfirmed!==true)stop('explicit_isolated_free_approval_required');
  if(typeof token!=='string'||!token.length)stop('existing_credential_missing');
  const built=build(sha);if(built.manifest.sourceCommit!==sha)stop('reviewed_build_mismatch');
  const root='https://api.cloudflare.com/client/v4/accounts/'+target.cloudflareAccountId+'/workers';
  const named='/workers/'+target.workerName,service='/services/'+target.workerName,script='/scripts/'+target.workerName;
  const allowed=new Set(['GET '+named,'POST /workers','GET '+service+'/environments/production/bindings','GET '+script+'/settings','GET '+script+'/deployments']);
  const cf=async(path,method='GET',body,notFoundAllowed=false)=>{
   if(!allowed.has(method+' '+path))stop('unapproved_operation');
   evidence.lastOperation=method+' '+path;delete evidence.lastHttpStatus;
   if(method!=='GET')evidence.mutationAttempts++;
   let response;try{response=await fetcher(root+path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:{authorization:'Bearer '+token,...(method==='POST'?{'content-type':'application/json'}:{})},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{stop(method==='GET'?'metadata_transport_failed':'mutation_outcome_unknown_no_retry');}
   evidence.lastHttpStatus=response.status;
   if([401,403].includes(response.status))stop('existing_permission_rejected_no_expansion');
   let data;try{data=await response.json();}catch{stop(method==='GET'?'metadata_invalid':'mutation_outcome_unknown_no_retry');}
   if(notFoundAllowed&&response.status===404&&data.success===false&&Array.isArray(data.errors)&&data.errors.length&&data.errors.every(e=>Number.isSafeInteger(e.code)))return null;
   if(!response.ok||data.success!==true)stop(method==='GET'?'metadata_read_rejected':response.status>=500?'mutation_outcome_unknown_no_retry':'creation_rejected_no_retry');
   return data.result;
  };
  if(await cf(named,'GET',undefined,true)!==null)stop('target_already_exists_no_overwrite');
  // Name-unique creation with no code and both URL switches false. Never fall back to PUT/upsert.
  const worker=await cf('/workers','POST',privateWorkerSettings());evidence.created=true;
  const id=inspectPrivateWorker(worker);evidence.workerId=id;
  const workerPath='/workers/'+id,versionPath=workerPath+'/versions?deploy=true';
  allowed.add('GET '+workerPath);allowed.add('POST '+versionPath);
  const verifyPrivate=async()=>{
   inspectPrivateWorker(await cf(workerPath),id);
  };
  await verifyPrivate();
  // First deploy the SQLite class without binding to a namespace that does not exist yet (official IaC DO ordering).
  // Both intentional versions use the same pinned code; neither can change Worker URL settings.
  const payload={...initialMetadata(),modules:[{name:'worker.js',content_type:'application/javascript+module',content_base64:Buffer.from(built.bundle,'utf8').toString('base64')}]};
  const bootstrap=await cf(versionPath,'POST',{...payload,bindings:payload.bindings.filter(b=>b.name!=='ACCOUNTS')});
  evidence.bootstrapDeployed=true;evidence.bundleSha256=built.manifest.bundleSha256;
  if(!/^[0-9a-f-]{36}$/.test(bootstrap?.id||'')||!Array.isArray(bootstrap.urls)||bootstrap.urls.length)stop('nonpublic_version_unconfirmed');
  evidence.bootstrapVersionId=bootstrap.id;
  if(!Array.isArray(bootstrap.exports_reconciliation?.created)||bootstrap.exports_reconciliation.created.length!==1||bootstrap.exports_reconciliation.created[0]!=='AccountMeter')stop('sqlite_bootstrap_unconfirmed');
  await verifyPrivate();
  const version=await cf(versionPath,'POST',payload);
  evidence.deployed=true;evidence.bundleSha256=built.manifest.bundleSha256;
  if(!/^[0-9a-f-]{36}$/.test(version?.id||'')||!Array.isArray(version.urls)||version.urls.length)stop('nonpublic_version_unconfirmed');
  evidence.versionId=version.id;
  await verifyPrivate();
  const bindings=await cf(service+'/environments/production/bindings');
  if(!Array.isArray(bindings)||bindings.length!==Object.keys(vars).length+1||new Set(bindings.map(b=>b.name)).size!==bindings.length)stop('created_bindings_unconfirmed');
  for(const [name,text]of Object.entries(vars))if(!bindings.some(b=>b.name===name&&b.type==='plain_text'&&b.text===text))stop('closed_flags_unconfirmed');
  const b=bindings.find(b=>b.name==='ACCOUNTS');
  if(b?.type!=='durable_object_namespace'||b.class_name!=='AccountMeter'||!/^[0-9a-f]{32}$/.test(b.namespace_id||'')||b.namespace_id===target.excludedNamespaceId||b.script_name&&b.script_name!==target.workerName||b.environment&&b.environment!=='production')stop('new_namespace_unconfirmed');
  evidence.namespaceVerified=true;evidence.namespaceId=b.namespace_id;
  const settings=retainedSettings(await cf(script+'/settings'));
  if(settings.compatibility_date!=='2026-10-01'||settings.compatibility_flags.length||settings.logpush||settings.observability?.enabled!==false||settings.tail_consumers.length)stop('closed_settings_unconfirmed');
  const detailPath=script+'/versions/'+version.id;allowed.add('GET '+detailPath);
  const detail=await cf(detailPath),exports=detail?.resources?.script_runtime?.exports;
  if(!exports||Object.keys(exports).length!==1||exports.AccountMeter?.type!=='durable-object'||exports.AccountMeter.storage!=='sqlite')stop('sqlite_export_unconfirmed');
  const deployments=await cf(script+'/deployments'),active=deployments?.deployments?.[0]?.versions;
  if(!Array.isArray(active)||active.length!==1||active[0].version_id!==version.id||active[0].percentage!==100)stop('created_deployment_unconfirmed');
  await verifyPrivate();evidence.nonpublicVerified=true;
  return {...evidence,passed:true,metadataOnly:true,workersDevEnabled:false,previewUrlsEnabled:false,apiEnabled:false,billingEnabled:false,billingVerified:false,secretWrites:0,stripeRequests:0,authenticatedApiRequests:0,planChanges:0,freePlanConfirmedByOwner:true,freePlanEvidence:'owner_dashboard_2026-10-15',providerPlanIndependentlyVerified:false};
 }catch(error){
  const safe=new Set(['reviewed_source_required','explicit_isolated_free_approval_required','existing_credential_missing','reviewed_build_mismatch','expected_sha_required','reviewed_checkout_required','unapproved_operation','metadata_transport_failed','mutation_outcome_unknown_no_retry','existing_permission_rejected_no_expansion','metadata_invalid','metadata_read_rejected','creation_rejected_no_retry','target_already_exists_no_overwrite','created_identity_unconfirmed','nonpublic_worker_unconfirmed','nonpublic_version_unconfirmed','sqlite_bootstrap_unconfirmed','created_bindings_unconfirmed','closed_flags_unconfirmed','new_namespace_unconfirmed','closed_settings_unconfirmed','created_deployment_unconfirmed','sqlite_export_unconfirmed']);
  return {...evidence,passed:false,error:safe.has(error?.message)?error.message:'isolated_creation_failed',noAutomaticRetry:true,noPermissionExpansion:true};
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const allowed=process.env.GITHUB_REPOSITORY==='recalm-lab/api-cost-outcome-check'&&process.env.GITHUB_EVENT_NAME==='push'&&process.env.GITHUB_REF==='refs/tags/'+APPROVED_TAG;
 const result=await createIsolatedClosed({sha:process.argv[2],approved:allowed&&process.env.RECALM_ISOLATED_CREATE_APPROVED==='true',freePlanConfirmed:process.env.RECALM_NO_EXTRA_COST_CONFIRMED==='true',token:process.env.CLOUDFLARE_API_TOKEN});
 console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}
