// One approved initial deployment only. No secrets, Stripe, credentials, customer data or existing Worker writes.
import {fileURLToPath} from 'node:url';
import {buildReviewedBundle} from './build-reviewed-worker.mjs';
import {validateTarget} from './isolated-test-readiness.mjs';
import {retainedSettings} from './upload-live-closed-worker.mjs';
export const REVIEWED_SOURCE='4405833bef84bf6a891ef165b5fdbd106574dbd4';
export const APPROVED_TAG='recalm-isolated-closed-create-20261015-v1';
const target=validateTarget();
const vars={STRIPE_MODE:'test',API_ENABLED:'false',BILLING_ENABLED:'false',BILLING_VERIFIED:'false',BILLING_ACCOUNTS:'{}',PUBLIC_BASE_URL:target.base};
const stop=code=>{throw Error(code);};
export function initialMetadata(){
 return {main_module:'worker.js',compatibility_date:'2026-10-01',compatibility_flags:[],observability:{enabled:false},logpush:false,tags:[],tail_consumers:[],bindings:[...Object.entries(vars).map(([name,text])=>({name,type:'plain_text',text})),{name:'ACCOUNTS',type:'durable_object_namespace',class_name:'AccountMeter'}],exports:{AccountMeter:{type:'durable-object',storage:'sqlite'}}};
}
export async function createIsolatedClosed({sha,approved=false,freePlanConfirmed=false,token,fetcher=fetch,build=buildReviewedBundle}){
 const evidence={target:target.workerName,sourceCommit:sha,created:false,namespaceVerified:false,subdomainConfigured:false,publicHealthVerified:false,mutationAttempts:0};
 try{
  if(sha!==REVIEWED_SOURCE)stop('reviewed_source_required');
  if(approved!==true||freePlanConfirmed!==true)stop('explicit_isolated_free_approval_required');
  if(typeof token!=='string'||!token.length)stop('existing_credential_missing');
  const built=build(sha);if(built.manifest.sourceCommit!==sha)stop('reviewed_build_mismatch');
  const root='https://api.cloudflare.com/client/v4/accounts/'+target.cloudflareAccountId+'/workers';
  const service='/services/'+target.workerName,script='/scripts/'+target.workerName;
  const allowed=new Set(['GET '+service,'PUT '+script,'GET '+service+'/environments/production/bindings','GET '+script+'/settings','GET '+script+'/versions','GET '+script+'/subdomain','POST '+script+'/subdomain']);
  const cf=async(path,method='GET',body,notFoundAllowed=false)=>{
   if(!allowed.has(method+' '+path)&&!(method==='GET'&&new RegExp('^'+script+'/versions/[0-9a-f-]{36}$').test(path)))stop('unapproved_operation');
   if(method!=='GET')evidence.mutationAttempts++;
   let response;try{response=await fetcher(root+path,{method,body,headers:{authorization:'Bearer '+token,...(method==='POST'?{'content-type':'application/json'}:{})},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{stop(method==='GET'?'metadata_transport_failed':'mutation_outcome_unknown_no_retry');}
   if([401,403].includes(response.status))stop('existing_permission_rejected_no_expansion');
   let data;try{data=await response.json();}catch{stop(method==='GET'?'metadata_invalid':'mutation_outcome_unknown_no_retry');}
   if(notFoundAllowed&&response.status===404&&data.success===false&&Array.isArray(data.errors)&&data.errors.length&&data.errors.every(e=>Number.isSafeInteger(e.code)))return null;
   if(!response.ok||data.success!==true)stop(method==='GET'?'metadata_read_rejected':response.status>=500?'mutation_outcome_unknown_no_retry':'creation_rejected_no_retry');
   return data.result;
  };
  if(await cf(service,'GET',undefined,true)!==null)stop('target_already_exists_no_overwrite');
  const payload=new FormData();payload.set('metadata',new Blob([JSON.stringify(initialMetadata())],{type:'application/json'}));payload.set('worker.js',new Blob([built.bundle],{type:'application/javascript+module'}),'worker.js');
  // Refuse a target created by another actor since the first read. No upsert retry or existing-resource adoption.
  if(await cf(service,'GET',undefined,true)!==null)stop('target_appeared_no_overwrite');
  await cf(script,'PUT',payload);evidence.created=true;evidence.bundleSha256=built.manifest.bundleSha256;
  const identity=await cf(service);if(identity?.id!==target.workerName||identity.default_environment?.environment!=='production')stop('created_identity_unconfirmed');
  const bindings=await cf(service+'/environments/production/bindings');
  if(!Array.isArray(bindings)||bindings.length!==Object.keys(vars).length+1||new Set(bindings.map(b=>b.name)).size!==bindings.length)stop('created_bindings_unconfirmed');
  for(const [name,text]of Object.entries(vars))if(!bindings.some(b=>b.name===name&&b.type==='plain_text'&&b.text===text))stop('closed_flags_unconfirmed');
  const b=bindings.find(b=>b.name==='ACCOUNTS');
  if(b?.type!=='durable_object_namespace'||b.class_name!=='AccountMeter'||!/^[0-9a-f]{32}$/.test(b.namespace_id||'')||b.namespace_id===target.excludedNamespaceId||b.script_name&&b.script_name!==target.workerName||b.environment&&b.environment!=='production')stop('new_namespace_unconfirmed');
  evidence.namespaceVerified=true;evidence.namespaceId=b.namespace_id;
  const settings=retainedSettings(await cf(script+'/settings'));
  if(settings.compatibility_date!=='2026-10-01'||settings.compatibility_flags.length||settings.logpush||settings.observability?.enabled!==false||settings.tail_consumers.length)stop('closed_settings_unconfirmed');
  const versions=await cf(script+'/versions'),id=versions?.items?.[0]?.id;if(!/^[0-9a-f-]{36}$/.test(id||''))stop('created_version_unconfirmed');
  const version=await cf(script+'/versions/'+id),exports=version?.resources?.script_runtime?.exports;
  if(!exports||Object.keys(exports).length!==1||exports.AccountMeter?.type!=='durable-object'||exports.AccountMeter.storage!=='sqlite')stop('sqlite_export_unconfirmed');
  evidence.versionId=id;
  const route=await cf(script+'/subdomain');
  if(route?.enabled!==true||route.previews_enabled!==false)await cf(script+'/subdomain','POST',JSON.stringify({enabled:true,previews_enabled:false}));
  const verifiedRoute=await cf(script+'/subdomain');if(verifiedRoute?.enabled!==true||verifiedRoute.previews_enabled!==false)stop('test_subdomain_unconfirmed');evidence.subdomainConfigured=true;
  let response;try{response=await fetcher(target.base+'/health',{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});}catch{stop('public_health_unconfirmed_no_retry');}
  let health;try{health=await response.json();}catch{stop('public_health_unconfirmed_no_retry');}
  if(response.status!==200||response.headers.get('x-recalm-source-commit')!==sha||health.status!=='sandbox'||health.stripeMode!=='test'||['apiEnabled','billingEnabled','billingVerified','saleActive'].some(k=>health[k]!==false))stop('public_closed_state_unconfirmed');
  evidence.publicHealthVerified=true;
  return {...evidence,passed:true,apiEnabled:false,billingEnabled:false,billingVerified:false,saleActive:false,secretWrites:0,stripeRequests:0,authenticatedApiRequests:0,planChanges:0,freePlanConfirmedByOwner:true};
 }catch(error){
  const safe=new Set(['reviewed_source_required','explicit_isolated_free_approval_required','existing_credential_missing','reviewed_build_mismatch','expected_sha_required','reviewed_checkout_required','unapproved_operation','metadata_transport_failed','mutation_outcome_unknown_no_retry','existing_permission_rejected_no_expansion','metadata_invalid','metadata_read_rejected','creation_rejected_no_retry','target_already_exists_no_overwrite','target_appeared_no_overwrite','created_identity_unconfirmed','created_bindings_unconfirmed','closed_flags_unconfirmed','new_namespace_unconfirmed','closed_settings_unconfirmed','created_version_unconfirmed','sqlite_export_unconfirmed','test_subdomain_unconfirmed','public_health_unconfirmed_no_retry','public_closed_state_unconfirmed']);
  return {...evidence,passed:false,error:safe.has(error?.message)?error.message:'isolated_creation_failed',noAutomaticRetry:true,noPermissionExpansion:true};
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const allowed=process.env.GITHUB_REPOSITORY==='recalm-lab/api-cost-outcome-check'&&process.env.GITHUB_EVENT_NAME==='push'&&process.env.GITHUB_REF==='refs/tags/'+APPROVED_TAG;
 const result=await createIsolatedClosed({sha:process.argv[2],approved:allowed&&process.env.RECALM_ISOLATED_CREATE_APPROVED==='true',freePlanConfirmed:process.env.RECALM_NO_EXTRA_COST_CONFIRMED==='true',token:process.env.CLOUDFLARE_API_TOKEN});
 console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}
