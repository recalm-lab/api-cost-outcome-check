// Preparation and GET-only preflight. No creation, deployment, issuance, secret export or lifecycle POST.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assertCheckout} from './build-reviewed-worker.mjs';
import {retainedSettings,canonical} from './upload-live-closed-worker.mjs';
import {safeStatus} from './sandbox-lifecycle.mjs';
const fixed=JSON.parse(await readFile(new URL('../deploy/isolated-test-target.json',import.meta.url),'utf8'));
const digest=body=>createHash('sha256').update(body,'utf8').digest('hex');
const stop=code=>{throw Error(code);};
export function validateTarget(target=fixed){
  if(canonical(target)!==canonical(fixed)||target.workerName==='recalm-api-cost-check'||target.base!=='https://'+target.workerName+'.rough-sound-e8d7.workers.dev'||target.stripeAccountId==='acct_1TqptlRUIufKFmuE'||target.logicalAccount==='sandbox-e2e-20261013')stop('unapproved_test_target');
  return structuredClone(target);
}
export function syntheticDocuments(target=fixed){
  validateTarget(target);
  return Object.fromEntries(target.termsVersions.map(version=>{
    const body='<!doctype html><meta charset="utf-8"><title>TEST ONLY</title><p>Synthetic isolated verification '+version+'. Not an offer or contract.</p>',sha256=digest(body);
    return [version,{body,sha256,status:'test-only',url:target.base+'/terms/'+version+'/'+sha256+'.html'}];
  }));
}
export function preparation(sha,target=fixed){
  validateTarget(target);if(!/^[0-9a-f]{40}$/.test(sha||''))stop('reviewed_sha_required');
  return {preparedOnly:true,remoteExecuted:false,integrationVerified:false,target:target.workerName,base:target.base,reviewedSha:sha,requiredVars:{STRIPE_MODE:'test',API_ENABLED:'false',BILLING_ENABLED:'true',BILLING_VERIFIED:'false',STRIPE_ACCOUNT_ID:target.stripeAccountId,STRIPE_PRICE_ID:target.priceId,STRIPE_METER_ID:target.meterId,STRIPE_EVENT_NAME:target.eventName,PUBLIC_BASE_URL:target.base,TERMS_VERSION:target.termsVersions[0],TERMS_DOCUMENTS:JSON.stringify(syntheticDocuments(target))},logicalAccount:target.logicalAccount,customerSelectionRequired:true,existingSecrets:['CLOUDFLARE_API_TOKEN','RECALM_TEST_API_KEY'],resourceCreation:false};
}
function inspect(bindings,settings,target,customer){
  if(!Array.isArray(bindings)||bindings.some(b=>!b||typeof b.name!=='string')||new Set(bindings.map(b=>b.name)).size!==bindings.length)stop('test_bindings_unknown');
  const get=name=>bindings.find(b=>b.name===name);
  for(const b of bindings)if(!['plain_text','json','secret_text','secret_key','durable_object_namespace'].includes(b.type))stop('test_bindings_unknown');
  for(const b of bindings.filter(b=>b.type.startsWith('secret_')))if(Object.keys(b).some(k=>!['name','type'].includes(k)))stop('opaque_secret_metadata_required');
  const vars=preparation('0'.repeat(40),target).requiredVars;
  // Both synthetic versions may be current; the reviewed bytes and URL of both must remain present.
  for(const [name,value]of Object.entries(vars)){
    if(name==='TERMS_VERSION'){if(get(name)?.type!=='plain_text'||!target.termsVersions.includes(get(name).text))stop('test_terms_mismatch');continue;}
    if(name==='TERMS_DOCUMENTS'){
      let documents;try{documents=JSON.parse(get(name)?.text);}catch{stop('test_terms_mismatch');}
      if(get(name).type!=='plain_text'||canonical(documents)!==canonical(syntheticDocuments(target)))stop('test_terms_mismatch');continue;
    }
    if(get(name)?.type!=='plain_text'||get(name).text!==value)stop('test_configuration_mismatch');
  }
  let accounts;try{accounts=JSON.parse(get('BILLING_ACCOUNTS')?.text);}catch{stop('test_accounts_mismatch');}
  if(get('BILLING_ACCOUNTS').type!=='plain_text'||canonical(accounts)!==canonical({[target.logicalAccount]:{customerId:customer}}))stop('test_accounts_mismatch');
  for(const name of ['STRIPE_RESTRICTED_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_METER_WEBHOOK_SECRET','FINGERPRINT_SECRET','CREDENTIALS'])if(!['secret_text','secret_key'].includes(get(name)?.type))stop('existing_test_secret_missing');
  const objects=bindings.filter(b=>b.type==='durable_object_namespace'),binding=objects[0];
  if(objects.length!==1||binding.name!=='ACCOUNTS'||binding.class_name!=='AccountMeter'||!/^[0-9a-f]{32}$/.test(binding.namespace_id||'')||binding.namespace_id===target.excludedNamespaceId||binding.script_name&&binding.script_name!==target.workerName||binding.environment&&binding.environment!=='production')stop('test_namespace_not_isolated');
  const retained=retainedSettings(settings);
  if(retained.compatibility_date!=='2026-10-01'||retained.compatibility_flags.length||retained.logpush||retained.observability?.enabled||retained.tail_consumers.length)stop('test_settings_mismatch');
  return {namespace:binding.namespace_id,settings:retained,bindings:bindings.map(b=>b.type.startsWith('secret_')?{name:b.name,type:b.type}:b).sort((a,b)=>a.name.localeCompare(b.name))};
}
async function jsonResponse(response,error){
  if(!response.ok)stop(error);
  let text;try{text=await response.text();}catch{stop(error);}
  if(Buffer.byteLength(text)>262144)stop(error);
  try{return JSON.parse(text);}catch{stop(error);}
}
export async function verifyReadOnly({sha,target=fixed,customer,cfToken,clientKey,noExtraCostConfirmed=false,fetcher=fetch}){
  validateTarget(target);preparation(sha,target);
  if(noExtraCostConfirmed!==true)stop('no_extra_cost_confirmation_required');
  if(!/^cus_[A-Za-z0-9]{1,100}$/.test(customer||'')||['cus_VQrJWHFdsVqzJG','cus_VQoavxGaZUgnF9'].includes(customer))stop('approved_unused_test_customer_required');
  if(typeof cfToken!=='string'||!cfToken.length||!/^[A-Za-z0-9_-]{43,128}$/.test(clientKey||''))stop('existing_credentials_unavailable');
  const root='https://api.cloudflare.com/client/v4/accounts/'+target.cloudflareAccountId+'/workers';
  const cf=async path=>{
    let response;try{response=await fetcher(root+path,{method:'GET',headers:{authorization:'Bearer '+cfToken},redirect:'error',signal:AbortSignal.timeout(15000)});}catch{stop('test_metadata_unavailable');}
    const body=await jsonResponse(response,[401,403].includes(response.status)?'existing_token_scope_or_auth_unavailable':'test_metadata_unavailable');
    if(body.success!==true)stop('test_metadata_unavailable');return body.result;
  };
  const service=await cf('/services/'+target.workerName);
  if(service.id!==target.workerName||service.default_environment?.environment!=='production')stop('test_worker_identity_mismatch');
  const bindingPath='/services/'+target.workerName+'/environments/production/bindings',scriptPath='/scripts/'+target.workerName;
  const snapshot=async()=>inspect(await cf(bindingPath),await cf(scriptPath+'/settings'),target,customer);
  const before=await snapshot();
  const deployments=await cf(scriptPath+'/deployments'),versions=await cf(scriptPath+'/versions');
  const deployed=deployments?.deployments?.[0]?.versions;
  if(!Array.isArray(deployed)||deployed.length!==1||deployed[0].percentage!==100||!/^[0-9a-f-]{36}$/.test(deployed[0].version_id||'')||versions?.items?.[0]?.id!==deployed[0].version_id)stop('single_test_deployment_required');
  const version=await cf(scriptPath+'/versions/'+deployed[0].version_id),exports=version?.resources?.script_runtime?.exports;
  if(!exports||Object.keys(exports).length!==1||exports.AccountMeter?.type!=='durable-object'||exports.AccountMeter.storage!=='sqlite')stop('test_sqlite_export_unconfirmed');
  const http=async(path,authenticated=false)=>{
    let response;try{response=await fetcher(target.base+path,{method:'GET',headers:authenticated?{authorization:'Bearer '+clientKey}:{},redirect:'error',signal:AbortSignal.timeout(15000)});}catch{stop('test_http_unavailable');}
    if(response.headers.get('x-recalm-source-commit')!==sha)stop('test_source_mismatch');
    if([401,403].includes(response.status)&&authenticated)stop('test_credential_rejected_no_issuance');
    return response;
  };
  const health=await jsonResponse(await http('/health'),'test_health_unavailable');
  if(health.stripeMode!=='test'||health.status!=='sandbox'||health.apiEnabled!==false||health.billingEnabled!==true||health.billingVerified!==false||health.saleActive!==false)stop('test_health_mismatch');
  const documents=syntheticDocuments(target);
  for(const document of Object.values(documents)){
    const response=await http(new URL(document.url).pathname);if(!response.ok)stop('test_document_unavailable');
    const body=await response.text();if(Buffer.byteLength(body)>65536||body!==document.body||digest(body)!==document.sha256)stop('test_document_mismatch');
  }
  if(canonical(await snapshot())!==canonical(before))stop('test_metadata_changed');
  const status=safeStatus(await jsonResponse(await http('/v1/billing',true),'test_billing_unavailable'));
  if(status.cancelRequested||status.manualReconciliationRequired||status.outstandingJpy!==0)stop('test_account_not_usable_no_reset');
  let archivedConsentVerified=false;
  if(status.active){
    const document=await jsonResponse(await http('/v1/terms',true),'test_archived_terms_unavailable'),expected=documents[document.version];
    if(!expected||document.body!==expected.body||document.sha256!==expected.sha256||document.url!==expected.url||document.status!=='test-only')stop('test_archived_terms_mismatch');
    archivedConsentVerified=true;
  }
  return {httpGetOnly:true,target:target.workerName,stripeMode:'test',namespaceIsolated:true,sourceVerified:true,syntheticDocumentsVerified:true,credentialUsable:true,contractActive:status.active,archivedConsentVerified,customerHistoryVerified:false,costConfirmationProvided:true,providerPlanIndependentlyVerified:false,integrationVerified:false,provisioningRequestsSent:false};
}
async function main(){
  try{
    const [action,sha]=process.argv.slice(2);if(!['plan','verify-read-only'].includes(action))stop('manual_action_required');
    assertCheckout(sha);
    const result=action==='plan'?preparation(sha):await verifyReadOnly({sha,customer:process.env.RECALM_APPROVED_TEST_CUSTOMER,cfToken:process.env.CLOUDFLARE_API_TOKEN,clientKey:process.env.RECALM_TEST_API_KEY,noExtraCostConfirmed:process.env.RECALM_NO_EXTRA_COST_CONFIRMED==='true'});
    console.log(JSON.stringify(result));
  }catch(error){
    const safe=new Set(['manual_action_required','reviewed_checkout_required','reviewed_sha_required','unapproved_test_target','no_extra_cost_confirmation_required','approved_unused_test_customer_required','existing_credentials_unavailable','existing_token_scope_or_auth_unavailable','test_metadata_unavailable','test_bindings_unknown','opaque_secret_metadata_required','test_terms_mismatch','test_accounts_mismatch','existing_test_secret_missing','test_namespace_not_isolated','test_configuration_mismatch','test_settings_mismatch','test_worker_identity_mismatch','single_test_deployment_required','test_sqlite_export_unconfirmed','test_http_unavailable','test_source_mismatch','test_health_unavailable','test_health_mismatch','test_document_unavailable','test_document_mismatch','test_metadata_changed','test_credential_rejected_no_issuance','test_billing_unavailable','test_account_not_usable_no_reset','test_archived_terms_unavailable','test_archived_terms_mismatch']);
    console.error(JSON.stringify({passed:false,mutatingRequestSent:false,error:safe.has(error?.message)?error.message:'test_readiness_failed',retryWithNewCredentials:false}));process.exitCode=1;
  }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await main();
