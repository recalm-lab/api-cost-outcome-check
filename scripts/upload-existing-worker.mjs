// Official Worker upload API, exact existing Worker only. Never fetches route/domain resources.
import {readFile} from 'node:fs/promises';
const config=JSON.parse(await readFile('wrangler.inline.jsonc','utf8'));
if(config.name!=='recalm-api-cost-check'||config.account_id!=='9a2e48df6882d20c2d1c4398184215a9'||config.vars.STRIPE_MODE!=='test'||['API_ENABLED','BILLING_ENABLED','BILLING_VERIFIED'].some(k=>config.vars[k]!=='false')||config.routes||config.route||config.exports?.AccountMeter?.storage!=='sqlite')throw new Error('target_or_closed_flags_mismatch');
if(!process.env.CLOUDFLARE_API_TOKEN)throw new Error('approved_credential_missing');
const base=`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/workers`;
async function cf(path,method='GET',body){
 const response=await fetch(base+path,{method,body,headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},redirect:'error',signal:AbortSignal.timeout(60000)});
 const json=await response.json();if(!response.ok||json.success===false){console.log(JSON.stringify({operation:method+' '+path,status:response.status,errorCodes:(json.errors||[]).map(e=>e.code).filter(Number.isSafeInteger)}));throw new Error('scoped_worker_api_rejected');}return json.result;
}
const service=await cf('/services/'+config.name);if(service.id!==config.name)throw new Error('existing_worker_identity_mismatch');
const env=service.default_environment?.environment;if(env!=='production')throw new Error('unexpected_worker_environment');
const bindingPath=`/services/${config.name}/environments/${env}/bindings`;
const before=await cf(bindingPath);if(!Array.isArray(before))throw new Error('bindings_shape_unknown');
const known=['secret_text','secret_key','plain_text','json'];
if(before.some(b=>!known.includes(b.type)&&!(b.type==='durable_object_namespace'&&b.name==='ACCOUNTS'&&b.class_name==='AccountMeter')))throw new Error('unreviewed_binding_stop');
const secretNames=before.filter(b=>['secret_text','secret_key'].includes(b.type)).map(b=>b.name);
const metadata={main_module:'worker.js',compatibility_date:config.compatibility_date,bindings:[...Object.entries(config.vars).map(([name,text])=>({type:'plain_text',name,text})),{type:'durable_object_namespace',name:'ACCOUNTS',class_name:'AccountMeter'}],exports:config.exports,keep_bindings:['secret_text','secret_key','plain_text','json'],observability:{enabled:false}};
const body=new FormData();body.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));body.set('worker.js',new Blob([await readFile('/tmp/recalm-inline-build/inline-worker.js')],{type:'application/javascript+module'}),'worker.js');
const result=await cf('/scripts/'+config.name,'PUT',body);
const after=await cf(bindingPath);if(secretNames.some(name=>!after.some(b=>b.name===name&&['secret_text','secret_key'].includes(b.type))))throw new Error('secret_binding_retention_failed');
if(!after.some(b=>b.name==='ACCOUNTS'&&b.type==='durable_object_namespace'))throw new Error('durable_binding_missing');
console.log(JSON.stringify({worker:config.name,uploaded:true,secretBindingsRetained:true,storage:'sqlite',exportsCreated:result.exports_reconciliation?.created||[],startupMs:result.startup_time_ms??null,routesChanged:false,domainsChanged:false}));
