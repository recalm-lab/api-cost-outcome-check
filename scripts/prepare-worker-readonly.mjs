import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {retainedSettings,canonical} from './upload-live-closed-worker.mjs';
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
 const settings=retainedSettings(await get('/scripts/'+worker+'/settings'));
 const flags=Object.fromEntries(['STRIPE_MODE','API_ENABLED','BILLING_ENABLED','BILLING_VERIFIED'].map(name=>{
  const b=bindings.find(b=>b.name===name);if(b?.type!=='plain_text'||typeof b.text!=='string')throw Error('flags_unknown');return [name,b.text];
 }));
 const b=bindings.find(b=>b.name==='ACCOUNTS');
 if(b?.type!=='durable_object_namespace'||b.class_name!=='AccountMeter'||b.namespace_id!=='0b8d1c5cea78485d9d9ae6a62ed98b6f')throw Error('namespace_mismatch');
 return {worker,account,readOnly:true,flags,namespaceVerified:true,settings,expectedSettingsSha256:createHash('sha256').update(canonical(settings)).digest('hex'),secretBindingsPresent:Object.fromEntries(['STRIPE_RESTRICTED_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_METER_WEBHOOK_SECRET','FINGERPRINT_SECRET','CREDENTIALS'].map(name=>[name,bindings.some(b=>b.name===name&&['secret_text','secret_key'].includes(b.type))])),targetBindings:Object.fromEntries(['STRIPE_ACCOUNT_ID','STRIPE_PRICE_ID','STRIPE_METER_ID','STRIPE_EVENT_NAME','TERMS_VERSION'].map(name=>{const b=bindings.find(b=>b.name===name);return [name,b?.type==='plain_text'?b.text:'unconfigured'];}))};
}
if(process.argv[1]?.endsWith('/prepare-worker-readonly.mjs')){
 try{
  const result=await prepare();
  if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(result.settings,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result));
 }catch(e){console.log(JSON.stringify({readOnly:true,error:['existing_credential_missing','worker_identity_mismatch','ambiguous_binding','flags_unknown','namespace_mismatch','unknown_remote_settings','remote_settings_incomplete','unreviewed_remote_exports','unpreservable_remote_settings'].includes(e.message)||/^worker_read_failed(?:_\d{3})?$/.test(e.message)?e.message:'preparation_failed'}));process.exitCode=1;}
}
