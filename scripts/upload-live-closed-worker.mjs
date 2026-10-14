// Code-only upload to one existing live-closed Worker. Never transitions test to live.
import {readFile} from 'node:fs/promises';
const worker='recalm-api-cost-check',account='9a2e48df6882d20c2d1c4398184215a9',namespace='0b8d1c5cea78485d9d9ae6a62ed98b6f';
const config=JSON.parse(await readFile('wrangler.inline.jsonc','utf8'));
if(config.name!==worker||config.account_id!==account||config.exports?.AccountMeter?.storage!=='sqlite'||config.routes||config.route)throw new Error('target_mismatch');
if(!process.env.CLOUDFLARE_API_TOKEN)throw new Error('approved_credential_missing');
const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers';
async function cf(path,method='GET',body){
 const response=await fetch(base+path,{method,body,headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},redirect:'error',signal:AbortSignal.timeout(60000)});
 let json;try{json=await response.json();}catch{throw new Error('scoped_worker_api_rejected');}
 if(!response.ok||json.success!==true)throw new Error('scoped_worker_api_rejected');return json.result;
}
const service=await cf('/services/'+worker);
if(service.id!==worker||service.default_environment?.environment!=='production')throw new Error('existing_worker_identity_mismatch');
const path='/services/'+worker+'/environments/production/bindings';
const known=['secret_text','secret_key','plain_text','json','durable_object_namespace'];
function inspect(bindings){
 if(!Array.isArray(bindings)||bindings.some(b=>!b||!known.includes(b.type)||typeof b.name!=='string')||new Set(bindings.map(b=>b.name)).size!==bindings.length)throw new Error('unreviewed_binding_stop');
 const get=name=>bindings.find(b=>b.name===name);
 for(const [name,value]of Object.entries({STRIPE_MODE:'live',API_ENABLED:'false',BILLING_ENABLED:'false',BILLING_VERIFIED:'false'})){
  if(get(name)?.type!=='plain_text'||get(name).text!==value)throw new Error('existing_worker_not_live_closed');
 }
 const durable=bindings.filter(b=>b.type==='durable_object_namespace');
 if(durable.length!==1||durable[0].name!=='ACCOUNTS'||durable[0].class_name!=='AccountMeter'||durable[0].namespace_id!==namespace||durable[0].script_name&&durable[0].script_name!==worker||durable[0].environment&&durable[0].environment!=='production')throw new Error('existing_namespace_mismatch');
 // Secret metadata only; never fetch, reconstruct, or log secret values.
 return bindings.map(b=>b.type.startsWith('secret_')?{name:b.name,type:b.type}:b).sort((a,b)=>a.name.localeCompare(b.name));
}
const before=inspect(await cf(path));
const metadata={main_module:'worker.js',compatibility_date:config.compatibility_date,keep_assets:true,keep_bindings:known,bindings:[]};
// No vars, exports, migrations, routes or namespaces are created/overwritten by this upload.
const body=new FormData();body.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
body.set('worker.js',new Blob([await readFile('/tmp/recalm-inline-build/inline-worker.js')],{type:'application/javascript+module'}),'worker.js');
// Recheck immediately before PUT; if another operator changed bindings, stop.
if(JSON.stringify(inspect(await cf(path)))!==JSON.stringify(before))throw new Error('preflight_binding_changed');
await cf('/scripts/'+worker,'PUT',body);
if(JSON.stringify(inspect(await cf(path)))!==JSON.stringify(before))throw new Error('binding_retention_failed');
console.log(JSON.stringify({worker,uploaded:true,stripeMode:'live',closed:true,bindingsRetained:true,namespaceRetained:true,routesChanged:false,domainsChanged:false}));
