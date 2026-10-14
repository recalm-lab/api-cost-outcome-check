// Only the existing Worker, five non-secret settings, and all sales flags false.
import {fileURLToPath} from 'node:url';
import {canonical,retainedSettings} from './upload-live-closed-worker.mjs';
const worker='recalm-api-cost-check';
const root='https://api.cloudflare.com/client/v4/accounts/9a2e48df6882d20c2d1c4398184215a9/workers';
const base='https://recalm-api-cost-check.rough-sound-e8d7.workers.dev';
const closedFlags=['API_ENABLED','BILLING_ENABLED','BILLING_VERIFIED'];
const changes={STRIPE_MODE:'live',STRIPE_ACCOUNT_ID:'acct_1TqptlRUIufKFmuE',STRIPE_PRICE_ID:'price_1UQKQ0RUIufKFmuEMN1jt6OU',STRIPE_METER_ID:'mtr_61VZYWJ5ULlQs4CCm41RUIufKFmuE4IC',BILLING_ACCOUNTS:'{}'};
const oldValues={STRIPE_MODE:'test',STRIPE_ACCOUNT_ID:'acct_1TqptzD1AvIZkMfK',STRIPE_PRICE_ID:'price_1UPwToD1AvIZkMfK9yFCs9xN',STRIPE_METER_ID:'mtr_test_61VZKPnRudfS37Kdz41D1AvIZkMfK1J2'};
const settingsExpected={compatibility_date:'2026-10-01',compatibility_flags:[],logpush:false,tags:[],tail_consumers:[],placement:{},usage_model:'standard'};
const exportsExpected={AccountMeter:{type:'durable-object',storage:'sqlite'}};
export async function configureLiveClosed(sha,fetcher=fetch){
 if(!/^[0-9a-f]{40}$/.test(sha||''))throw Error('reviewed_source_required');
 if(!process.env.CLOUDFLARE_API_TOKEN)throw Error('existing_credential_missing');
 async function cf(path,method='GET',body){
  const r=await fetcher(root+path,{method,body,headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});
  let b;try{b=await r.json();}catch{throw Error('worker_api_failed');}
  if(!r.ok||b.success!==true)throw Error('worker_api_failed');return b.result;
 }
 function inspect(list,mode){
  if(!Array.isArray(list)||new Set(list.map(b=>b.name)).size!==list.length||list.some(b=>!['plain_text','json','secret_text','secret_key','durable_object_namespace'].includes(b.type)))throw Error('unreviewed_bindings');
  const value=name=>{const b=list.find(b=>b.name===name);if(b?.type!=='plain_text'||typeof b.text!=='string')throw Error('nonsecret_setting_required');return b.text;};
  if(closedFlags.some(n=>value(n)!=='false'))throw Error('closed_flags_required');
  for(const [name,v]of Object.entries(mode==='test'?oldValues:changes))if(value(name)!==v)throw Error('target_configuration_mismatch');
  if(value('STRIPE_EVENT_NAME')!=='recalm_api_cost_check_success_v1'||value('TERMS_VERSION')!=='2026-10-13'||value('PUBLIC_BASE_URL')!==base)throw Error('target_configuration_mismatch');
  if(mode==='test'){
   let accounts;try{accounts=JSON.parse(value('BILLING_ACCOUNTS'));}catch{throw Error('sandbox_mapping_mismatch');}
   if(canonical(accounts)!==canonical({'sandbox-e2e-20261013':{customerId:'cus_VQrJWHFdsVqzJG'}}))throw Error('sandbox_mapping_mismatch');
  }
  for(const name of ['STRIPE_RESTRICTED_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_METER_WEBHOOK_SECRET','FINGERPRINT_SECRET','CREDENTIALS']){
   if(!list.some(b=>b.name===name&&['secret_text','secret_key'].includes(b.type)))throw Error('secret_binding_missing');
  }
  const ledger=list.find(b=>b.name==='ACCOUNTS');
  if(ledger?.type!=='durable_object_namespace'||ledger.class_name!=='AccountMeter'||ledger.namespace_id!=='0b8d1c5cea78485d9d9ae6a62ed98b6f')throw Error('namespace_mismatch');
  return list.map(b=>b.type.startsWith('secret_')?{name:b.name,type:b.type}:b).sort((a,b)=>a.name.localeCompare(b.name));
 }
 const bindingsPath='/services/'+worker+'/environments/production/bindings',settingsPath='/scripts/'+worker+'/settings';
 const service=await cf('/services/'+worker);if(service.id!==worker||service.default_environment?.environment!=='production')throw Error('target_mismatch');
 async function snapshot(mode){const settings=retainedSettings(await cf(settingsPath));delete settings.exports;return {bindings:inspect(await cf(bindingsPath),mode),settings};}
 async function health(mode){
  const r=await fetcher(base+'/health',{method:'GET',redirect:'error',signal:AbortSignal.timeout(10000)});const h=await r.json();
  if(r.status!==200||r.headers.get('x-recalm-source-commit')!==sha||h.stripeMode!==mode||['apiEnabled','billingEnabled','billingVerified','saleActive'].some(n=>h[n]!==false))throw Error('closed_http_mismatch');
 }
 const before=await snapshot('test');if(canonical(before.settings)!==canonical(settingsExpected))throw Error('expected_settings_mismatch');
 await health('test');
 const deployments=await cf('/scripts/'+worker+'/deployments'),versions=await cf('/scripts/'+worker+'/versions');
 const active=deployments.deployments?.[0]?.versions,latest=versions.items?.[0]?.id;
 if(!Array.isArray(active)||active.length!==1||active[0].percentage!==100||!latest||active[0].version_id!==latest)throw Error('inherit_version_not_proven');
 const declaration=(await cf('/scripts/'+worker+'/versions/'+latest)).resources?.script_runtime?.exports;
 if(canonical(declaration)!==canonical(exportsExpected))throw Error('existing_exports_not_proven');
 if(canonical(await snapshot('test'))!==canonical(before))throw Error('preflight_changed');
 const form=new FormData();form.set('settings',new Blob([JSON.stringify({bindings:before.bindings.map(b=>Object.hasOwn(changes,b.name)?{name:b.name,type:'plain_text',text:changes[b.name]}:{name:b.name,type:'inherit'}),exports:declaration})],{type:'application/json'}));
 await cf(settingsPath,'PATCH',form);
 const expected={...before,bindings:before.bindings.map(b=>Object.hasOwn(changes,b.name)?{...b,text:changes[b.name]}:b)};
 if(canonical(await snapshot('live'))!==canonical(expected))throw Error('settings_retention_failed');
 const afterVersions=await cf('/scripts/'+worker+'/versions');
 if(canonical((await cf('/scripts/'+worker+'/versions/'+afterVersions.items?.[0]?.id)).resources?.script_runtime?.exports)!==canonical(declaration))throw Error('exports_retention_failed');
 await health('live');
 return {worker,sourceCommit:sha,mode:'live',closed:true,saleActive:false,customerMappingEmpty:true,secretBindingsRetained:true,namespaceRetained:true,settingsRetained:true};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 try{console.log(JSON.stringify(await configureLiveClosed(process.argv[2])));}catch{console.log(JSON.stringify({error:'live_closed_configuration_failed',closedActivationAttempted:false}));process.exitCode=1;}
}
