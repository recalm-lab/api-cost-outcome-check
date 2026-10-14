// Code-only upload; mode must already be closed. No configuration transitions.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {buildReviewedBundle,assertCheckout} from './build-reviewed-worker.mjs';
const worker='recalm-api-cost-check',account='9a2e48df6882d20c2d1c4398184215a9',namespace='0b8d1c5cea78485d9d9ae6a62ed98b6f';
const known=['secret_text','secret_key','plain_text','json','durable_object_namespace'];
const preserve=['compatibility_date','compatibility_flags','observability','logpush','tags','tail_consumers','placement','limits','usage_model','cache_options','exports'];
const readOnly=['bindings','annotations','exports_reconciliation','migration_tag'];
export function canonical(value){return JSON.stringify(sort(value));}
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
export function retainedSettings(settings){
 if(!settings||Array.isArray(settings)||typeof settings!=='object'||Object.keys(settings).some(k=>!preserve.includes(k)&&!readOnly.includes(k)))throw Error('unknown_remote_settings');
 for(const key of ['compatibility_date','compatibility_flags','observability','logpush','tags','tail_consumers'])if(!Object.hasOwn(settings,key))throw Error('remote_settings_incomplete');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(settings.compatibility_date)||!Array.isArray(settings.compatibility_flags)||settings.compatibility_flags.some(x=>typeof x!=='string')||typeof settings.observability?.enabled!=='boolean'||typeof settings.logpush!=='boolean'||!Array.isArray(settings.tags)||!Array.isArray(settings.tail_consumers))throw Error('remote_settings_incomplete');
 const allowed=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
 const obs=settings.observability;
 if(!allowed(obs,['enabled','head_sampling_rate','issues','logs','traces','redact_query_string'])||obs.issues&&!allowed(obs.issues,['enabled'])||obs.logs&&!allowed(obs.logs,['enabled','invocation_logs','destinations','head_sampling_rate','persist'])||obs.traces&&!allowed(obs.traces,['enabled','destinations','head_sampling_rate','persist','propagation_policy']))throw Error('unknown_remote_settings');
 for(const [key,keys]of Object.entries({placement:['mode'],limits:['cpu_ms','subrequests'],cache_options:['enabled','cross_version_cache']}))if(Object.hasOwn(settings,key)&&!allowed(settings[key],keys))throw Error('unknown_remote_settings');
 if(settings.tail_consumers.some(v=>!allowed(v,['service','environment','namespace']))||settings.tags.some(v=>typeof v!=='string'))throw Error('unknown_remote_settings');
 if(obs.traces?.propagation_policy===null)throw Error('unpreservable_remote_settings');
 const result=Object.fromEntries(preserve.filter(k=>Object.hasOwn(settings,k)).map(k=>[k,settings[k]]));
 if(result.exports){
  if(Object.keys(result.exports).length!==1||result.exports.AccountMeter?.type!=='durable-object'||result.exports.AccountMeter.storage!=='sqlite'||Object.keys(result.exports.AccountMeter).some(k=>!['type','storage','state'].includes(k)))throw Error('unreviewed_remote_exports');
  if(result.exports.AccountMeter.state!==undefined&&result.exports.AccountMeter.state!=='created')throw Error('unreviewed_remote_exports');
 }
 return result;
}
function inspect(bindings,mode){
 if(!Array.isArray(bindings)||bindings.some(b=>!b||!known.includes(b.type)||typeof b.name!=='string')||new Set(bindings.map(b=>b.name)).size!==bindings.length)throw Error('unreviewed_binding_stop');
 const get=name=>bindings.find(b=>b.name===name);
 for(const [name,value]of Object.entries({STRIPE_MODE:mode,API_ENABLED:'false',BILLING_ENABLED:'false',BILLING_VERIFIED:'false'}))if(get(name)?.type!=='plain_text'||get(name).text!==value)throw Error('existing_worker_not_'+mode+'_closed');
 const durable=bindings.filter(b=>b.type==='durable_object_namespace');
 if(durable.length!==1||durable[0].name!=='ACCOUNTS'||durable[0].class_name!=='AccountMeter'||durable[0].namespace_id!==namespace||durable[0].script_name&&durable[0].script_name!==worker||durable[0].environment&&durable[0].environment!=='production')throw Error('existing_namespace_mismatch');
 return bindings.map(b=>b.type.startsWith('secret_')?{name:b.name,type:b.type}:b).sort((a,b)=>a.name.localeCompare(b.name));
}
export async function verifyClosedHttp(mode,fetcher=fetch,sha){
 const origin='https://recalm-api-cost-check.rough-sound-e8d7.workers.dev';
 const options={redirect:'error',signal:AbortSignal.timeout(10000)};
 const response=await fetcher(origin+'/health',options),health=await response.json();
 if(response.headers.get('x-recalm-source-commit')!==sha||response.status!==200||health.stripeMode!==mode||['apiEnabled','billingEnabled','billingVerified','saleActive'].some(k=>health[k]!==false))throw Error('closed_http_health_failed');
 for(const path of ['/v1/stripe/webhook','/v1/stripe/meter-webhook']){
  const r=await fetcher(origin+path,{...options,method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  if(r.headers.get('x-recalm-source-commit')!==sha||![400,503].includes(r.status))throw Error('closed_http_webhook_failed');
  const body=await r.json();if(body.received===true||body.verification)throw Error('closed_http_webhook_failed');
 }
}
export async function uploadClosed({sha,expected,mode='live',fetcher=fetch}){
 if(!['live','test'].includes(mode))throw Error('closed_mode_required');
 // Always fresh, committed inputs only. No stale /tmp bundle can enter this path.
 const built=buildReviewedBundle(sha);
 if(!process.env.CLOUDFLARE_API_TOKEN)throw Error('approved_credential_missing');
 const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers';
 async function cf(path,method='GET',body){
  const r=await fetcher(base+path,{method,body,headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},redirect:'error',signal:AbortSignal.timeout(60000)});
  let json;try{json=await r.json();}catch{throw Error('scoped_worker_api_rejected');}
  if(!r.ok||json.success!==true)throw Error('scoped_worker_api_rejected');return json.result;
 }
 const service=await cf('/services/'+worker);
 if(service.id!==worker||service.default_environment?.environment!=='production')throw Error('existing_worker_identity_mismatch');
 const bindingPath='/services/'+worker+'/environments/production/bindings',settingsPath='/scripts/'+worker+'/settings';
 async function snapshot(){return {bindings:inspect(await cf(bindingPath),mode),settings:retainedSettings(await cf(settingsPath))};}
 const before=await snapshot();
 if(canonical(before.settings)!==canonical(expected))throw Error('expected_remote_settings_mismatch');
 // Official content replacement explicitly leaves configuration and metadata untouched.
 const metadata={main_module:'worker.js'};
 const body=new FormData();body.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
 body.set('worker.js',new Blob([built.bundle],{type:'application/javascript+module'}),'worker.js');
 if(canonical(await snapshot())!==canonical(before))throw Error('preflight_remote_changed');
 assertCheckout(sha);
 await cf('/scripts/'+worker+'/content','PUT',body);
 if(canonical(await snapshot())!==canonical(before))throw Error('remote_retention_failed');
 await verifyClosedHttp(mode,fetcher,sha);
 console.log(JSON.stringify({worker,uploaded:true,stripeMode:mode,closed:true,settingsRetained:true,bindingsRetained:true,namespaceRetained:true,closedHttpVerified:true,...built.manifest}));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const [sha,path]=process.argv.slice(2);if(!path)throw Error('reviewed_settings_file_required');
 await uploadClosed({sha,expected:JSON.parse(await readFile(path,'utf8'))});
}
