// One authorized operation: close three plain-text flags on the existing test Worker.
import {writeFile} from 'node:fs/promises';
import {canonical,retainedSettings} from './upload-live-closed-worker.mjs';
const flags=['API_ENABLED','BILLING_ENABLED','BILLING_VERIFIED'];
const settingsExpected={compatibility_date:'2026-10-01',compatibility_flags:[],logpush:false,tags:[],tail_consumers:[],placement:{},usage_model:'standard'};
const root='https://api.cloudflare.com/client/v4/accounts/9a2e48df6882d20c2d1c4398184215a9/workers',worker='recalm-api-cost-check';
export async function closeTestFlags(fetcher=fetch){
 if(!process.env.CLOUDFLARE_API_TOKEN)throw Error('existing_credential_missing');
 const bindingsPath='/services/'+worker+'/environments/production/bindings',settingsPath='/scripts/'+worker+'/settings';
 async function cf(path,method='GET',body){
  const r=await fetcher(root+path,{method,body,headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});
  let b;try{b=await r.json();}catch{throw Error('worker_api_failed');}
  if(!r.ok||b.success!==true){
   const safeMessage=value=>{
    let text=typeof value==='string'?value:'';
    const structured=text.indexOf('{');if(structured>=0)text=text.slice(0,structured)+'[structured detail omitted]';
    text=text.split(process.env.CLOUDFLARE_API_TOKEN).join('[redacted]').replace(/(?:rk|sk)_(?:test|live)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+|Bearer\s+\S+/g,'[redacted]');
    return text.slice(0,400);
   };
   console.log(JSON.stringify({operation:method+' '+path,httpStatus:r.status,errors:(b.errors||[]).slice(0,5).map(e=>({code:Number.isSafeInteger(e.code)?e.code:null,message:safeMessage(e.message)}))}));
   throw Error('worker_api_failed_'+r.status);
  }return b.result;
 }
 function inspect(list){
  if(!Array.isArray(list)||new Set(list.map(b=>b.name)).size!==list.length||list.some(b=>!['plain_text','json','secret_text','secret_key','durable_object_namespace'].includes(b.type)))throw Error('unreviewed_bindings');
  const mode=list.find(b=>b.name==='STRIPE_MODE');if(mode?.type!=='plain_text'||mode.text!=='test')throw Error('test_mode_required');
  for(const name of flags){const b=list.find(b=>b.name===name);if(b?.type!=='plain_text'||!['true','false'].includes(b.text))throw Error('flags_unknown');}
  const b=list.find(b=>b.name==='ACCOUNTS');if(b?.type!=='durable_object_namespace'||b.class_name!=='AccountMeter'||b.namespace_id!=='0b8d1c5cea78485d9d9ae6a62ed98b6f')throw Error('namespace_mismatch');
  return list.map(b=>b.type.startsWith('secret_')?{name:b.name,type:b.type}:b).sort((a,b)=>a.name.localeCompare(b.name));
 }
 const service=await cf('/services/'+worker);if(service.id!==worker||service.default_environment?.environment!=='production')throw Error('target_mismatch');
 async function snapshot(){const settings=retainedSettings(await cf(settingsPath));delete settings.exports;return {bindings:inspect(await cf(bindingsPath)),settings};}
 const before=await snapshot();if(canonical(before.settings)!==canonical(settingsExpected))throw Error('expected_settings_mismatch');
 // inherit defaults to latest. Require latest upload to be the sole 100% deployed version.
 const deployments=await cf('/scripts/'+worker+'/deployments'),versions=await cf('/scripts/'+worker+'/versions');
 const active=deployments.deployments?.[0]?.versions,latest=versions.items?.[0]?.id;
 if(!Array.isArray(active)||active.length!==1||active[0].percentage!==100||!latest||active[0].version_id!==latest)throw Error('inherit_version_not_proven');
 const declaration=(await cf('/scripts/'+worker+'/versions/'+latest)).resources?.script_runtime?.exports;
 const exportsExpected={AccountMeter:{type:'durable-object',storage:'sqlite'}};
 if(canonical(declaration)!==canonical(exportsExpected))throw Error('existing_exports_not_proven');
 if(canonical(await snapshot())!==canonical(before))throw Error('preflight_changed');
 const expected={...before,bindings:before.bindings.map(b=>flags.includes(b.name)?{...b,text:'false'}:b)};
 if(canonical(expected)!==canonical(before)){
  const bindings=before.bindings.map(b=>flags.includes(b.name)?{name:b.name,type:'plain_text',text:'false'}:{name:b.name,type:'inherit'});
  const form=new FormData();form.set('settings',new Blob([JSON.stringify({bindings,exports:declaration})],{type:'application/json'}));
  await cf(settingsPath,'PATCH',form);
 }
 if(canonical(await snapshot())!==canonical(expected))throw Error('flag_retention_failed');
 const afterVersions=await cf('/scripts/'+worker+'/versions');
 const afterDeclaration=(await cf('/scripts/'+worker+'/versions/'+afterVersions.items?.[0]?.id)).resources?.script_runtime?.exports;
 if(canonical(afterDeclaration)!==canonical(declaration))throw Error('exports_retention_failed');
 const expectedSettings=retainedSettings(await cf(settingsPath));
 console.log(JSON.stringify({worker,test:true,flagsClosed:true,otherBindingsRetained:true,settingsRetained:true,observability:'not_returned_unchanged',exportsRetained:true}));
 return expectedSettings;
}
if(process.argv[1]?.endsWith('/close-test-flags.mjs')){
 try{const settings=await closeTestFlags();if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(settings,null,2)+'\n',{flag:'wx'});}catch(e){console.log(JSON.stringify({error:/^(?:existing_credential_missing|unreviewed_bindings|test_mode_required|flags_unknown|namespace_mismatch|target_mismatch|expected_settings_mismatch|inherit_version_not_proven|existing_exports_not_proven|exports_retention_failed|preflight_changed|flag_retention_failed|worker_api_failed(?:_\d{3})?)$/.test(e.message)?e.message:'close_flags_failed'}));process.exitCode=1;}
}
