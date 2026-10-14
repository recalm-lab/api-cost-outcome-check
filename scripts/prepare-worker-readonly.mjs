import {writeFile} from 'node:fs/promises';
import {retainedSettings} from './upload-live-closed-worker.mjs';
export async function prepare(fetcher=fetch){
 const account='9a2e48df6882d20c2d1c4398184215a9',worker='recalm-api-cost-check';
 if(!process.env.CLOUDFLARE_API_TOKEN)throw Error('existing_credential_missing');
 const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers';
 async function get(path){
  const response=await fetcher(base+path,{method:'GET',headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});
  let body;try{body=await response.json();}catch{throw Error('worker_read_failed');}
  if(!response.ok||body.success!==true)throw Error('worker_read_failed_'+response.status);
  return body.result;
 }
 const service=await get('/services/'+worker);
 if(service.id!==worker||service.default_environment?.environment!=='production')throw Error('worker_identity_mismatch');
 const bindings=await get('/services/'+worker+'/environments/production/bindings');
 if(!Array.isArray(bindings)||new Set(bindings.map(b=>b.name)).size!==bindings.length)throw Error('ambiguous_binding');
 const raw=await get('/scripts/'+worker+'/settings');
 const flags=Object.fromEntries(['STRIPE_MODE','API_ENABLED','BILLING_ENABLED','BILLING_VERIFIED'].map(name=>{
  const b=bindings.find(b=>b.name===name);if(b?.type!=='plain_text'||typeof b.text!=='string')throw Error('flags_unknown');return [name,b.text];
 }));
 const b=bindings.find(b=>b.name==='ACCOUNTS');
 if(b?.type!=='durable_object_namespace'||b.class_name!=='AccountMeter'||b.namespace_id!=='0b8d1c5cea78485d9d9ae6a62ed98b6f')throw Error('namespace_mismatch');
 let settings;
 try{settings=retainedSettings(raw);}catch(error){
  const keys=['compatibility_date','compatibility_flags','observability','logpush','tags','tail_consumers','placement','limits','usage_model','cache_options','exports'];
  console.log(JSON.stringify({worker,readOnly:true,flags,namespaceVerified:true,settingsDiagnostics:Object.fromEntries(keys.map(k=>[k,{present:Object.hasOwn(raw,k),type:Array.isArray(raw[k])?'array':raw[k]===null?'null':typeof raw[k]}])),compatibilityDate:typeof raw.compatibility_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw.compatibility_date)?raw.compatibility_date:'unknown',observabilityEnabled:typeof raw.observability?.enabled==='boolean'?raw.observability.enabled:'unknown'}));
  throw error;
 }
 for(const operation of ['deployments','versions']){
  const response=await fetcher(base+'/scripts/'+worker+'/'+operation,{method:'GET',headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});
  let body;try{body=await response.json();}catch{body={};}
  if(operation==='versions'&&response.ok&&body.result?.items?.[0]?.id){
   const version=await get('/scripts/'+worker+'/versions/'+body.result.items[0].id);
   const runtime=version.resources?.script_runtime;
   console.log(JSON.stringify({readOnly:true,operation:'current_version_exports',exportsPresent:Object.hasOwn(runtime||{},'exports'),exports:runtime?.exports}));
  }
  console.log(JSON.stringify({readOnly:true,operation,httpStatus:response.status,errorCodes:(body.errors||[]).map(e=>e.code).filter(Number.isSafeInteger),...(response.ok?operation==='deployments'?{activeVersions:body.result?.deployments?.[0]?.versions,deploymentCreatedOn:body.result?.deployments?.[0]?.created_on}:{latestVersion:body.result?.items?.[0]?.id,latestVersionCreatedOn:body.result?.items?.[0]?.metadata?.created_on,latestVersionModifiedOn:body.result?.items?.[0]?.metadata?.modified_on}:{})}));
 }
 const healthResponse=await fetcher('https://recalm-api-cost-check.rough-sound-e8d7.workers.dev/health',{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});
 const health=await healthResponse.json(),source=healthResponse.headers.get('x-recalm-source-commit');
 if(healthResponse.status!==200||source!=='4c42a85efa3e4e31f00039e692a323f63128f2f7'||health.stripeMode!=='test'||['apiEnabled','billingEnabled','billingVerified','saleActive'].some(k=>health[k]!==false)||flags.STRIPE_MODE!=='test'||['API_ENABLED','BILLING_ENABLED','BILLING_VERIFIED'].some(k=>flags[k]!=='false'))throw Error('closed_http_state_mismatch');
 return {worker,account,readOnly:true,flags,namespaceVerified:true,settings,publicHealth:{sourceCommit:source,stripeMode:health.stripeMode,apiEnabled:health.apiEnabled,billingEnabled:health.billingEnabled,billingVerified:health.billingVerified,saleActive:health.saleActive},workerModifiedOn:service.default_environment?.script?.modified_on,secretBindings:Object.fromEntries(['STRIPE_RESTRICTED_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_METER_WEBHOOK_SECRET','FINGERPRINT_SECRET','CREDENTIALS'].map(name=>[name,{present:bindings.some(b=>b.name===name&&['secret_text','secret_key'].includes(b.type)),type:bindings.find(b=>b.name===name)?.type||'missing'}])),targetBindings:Object.fromEntries(['STRIPE_ACCOUNT_ID','STRIPE_PRICE_ID','STRIPE_METER_ID','STRIPE_EVENT_NAME','TERMS_VERSION'].map(name=>{const b=bindings.find(b=>b.name===name);return [name,b?.type==='plain_text'?b.text:'unconfigured'];}))};
}
if(process.argv[1]?.endsWith('/prepare-worker-readonly.mjs')){
 try{
  const result=await prepare();
  if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result.settings,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result));
 }catch(e){console.log(JSON.stringify({readOnly:true,error:['existing_credential_missing','worker_identity_mismatch','ambiguous_binding','flags_unknown','namespace_mismatch','closed_http_state_mismatch','unknown_remote_settings','remote_settings_incomplete','unreviewed_remote_exports','unpreservable_remote_settings'].includes(e.message)||/^worker_read_failed(?:_\d{3})?$/.test(e.message)?e.message:'preparation_failed'}));process.exitCode=1;}
}
