// Exact existing Worker only. No configuration/Secret writes, fallback or automatic retry.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {canonical,retainedSettings} from './upload-live-closed-worker.mjs';
export const BACKEND='01e29255e421ede7f0e9999051d224fac92f4ac5',DEMO='c550efa1523544309a26e4e1bc3bcfe1fc954ad1';
export const BASE_HASH='16ec6034d098326ebe9723deb6944cb717cbbf0ed323096888fa50d21287bb8a',CANDIDATE_HASH='8ff27c0c9751161c7f4a3b42624da2481ca748313988acf04d76a0a8b5a9af11';
export const TAG='recalm-demo-content-only-20261016-v1';
const worker='recalm-api-cost-check',origin='https://recalm-api-cost-check.rough-sound-e8d7.workers.dev';
const root='https://api.cloudflare.com/client/v4/accounts/9a2e48df6882d20c2d1c4398184215a9/workers';
export const hash=s=>createHash('sha256').update(s).digest('hex');
export function prepareCandidate(baseline,oldStatic,assets){
 if(hash(baseline)!==BASE_HASH)throw Error('baseline_hash_mismatch');
 const match=oldStatic.match(/const assets=(.*);\nexport default/);if(!match)throw Error('static_shape_unknown');
 const table=JSON.parse(match[1]),names=['/index.html','/style.css','/demo.js','/examples.json'];
 if(canonical(Object.keys(assets).sort())!==canonical([...names].sort()))throw Error('asset_allowlist_mismatch');
 for(const name of names){if(!table[name]||typeof assets[name]!=='string')throw Error('asset_shape_unknown');table[name].body=assets[name];}
 const next=oldStatic.replace(match[1],JSON.stringify(table)),transform=s=>s.replace(/^export\s+default\s+/m,'const __default=');
 const from=transform(oldStatic),to=transform(next);if(baseline.split(from).length!==2)throw Error('static_module_not_unique');
 const candidate=baseline.replace(from,to);
 if(candidate.replace(to,from)!==baseline||hash(candidate)!==CANDIDATE_HASH)throw Error('candidate_identity_mismatch');
 return candidate;
}
export async function readContent(response){
 const type=response.headers.get('content-type')||'';
 if(type.startsWith('multipart/form-data')){
  const form=await response.formData(),parts=[...form.entries()];
  if(parts.length!==1||parts[0][0]!=='worker.js'||typeof parts[0][1]==='string')throw Error('content_parts_unknown');
  return await parts[0][1].text();
 }
 if(!/^(application|text)\/(javascript|javascript\+module)/.test(type))throw Error('content_format_unknown');
 return response.text();
}
export const expectedVars={STRIPE_MODE:'live',API_ENABLED:'false',BILLING_ENABLED:'false',BILLING_VERIFIED:'false',STRIPE_ACCOUNT_ID:'acct_1TqptlRUIufKFmuE',STRIPE_PRICE_ID:'price_1UQKQ0RUIufKFmuEMN1jt6OU',STRIPE_METER_ID:'mtr_61VZYWJ5ULlQs4CCm41RUIufKFmuE4IC',STRIPE_EVENT_NAME:'recalm_api_cost_check_success_v1',TERMS_VERSION:'2026-10-13',PUBLIC_BASE_URL:origin,BILLING_ACCOUNTS:'{}'};
export function inspectBindings(list){
 const secrets=['STRIPE_RESTRICTED_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_METER_WEBHOOK_SECRET','FINGERPRINT_SECRET','CREDENTIALS'];
 const names=[...Object.keys(expectedVars),...secrets,'ACCOUNTS'];
 if(!Array.isArray(list)||list.length!==names.length||new Set(list.map(b=>b.name)).size!==names.length||list.some(b=>!names.includes(b.name)))throw Error('bindings_mismatch');
 for(const [name,text]of Object.entries(expectedVars))if(!list.some(b=>b.name===name&&b.type==='plain_text'&&b.text===text))throw Error('closed_config_mismatch');
 for(const name of secrets){const b=list.find(b=>b.name===name);if(b?.type!=='secret_text'||Object.keys(b).some(k=>!['name','type'].includes(k)))throw Error('secret_metadata_shape_unknown');}
 const ledger=list.find(b=>b.name==='ACCOUNTS');
 if(ledger?.type!=='durable_object_namespace'||ledger.class_name!=='AccountMeter'||ledger.namespace_id!=='0b8d1c5cea78485d9d9ae6a62ed98b6f'||ledger.script_name&&ledger.script_name!==worker||ledger.environment&&ledger.environment!=='production')throw Error('namespace_mismatch');
 return canonical(list);
}
export async function updateDemo({baseline,candidate,assets,credential,fetcher=fetch,saveBackup=async()=>{}}){
 const evidence={worker,backendSource:BACKEND,demoSource:DEMO,mutationAttempts:0,updated:false,passed:false};
 try{
  if(!credential||hash(baseline)!==BASE_HASH||hash(candidate)!==CANDIDATE_HASH)throw Error('reviewed_inputs_required');
  async function cf(path,method='GET',body){
   evidence.lastOperation=method+' '+path;
   let response;try{response=await fetcher(root+path,{method,body,headers:{authorization:'Bearer '+credential},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error(method==='PUT'?'mutation_outcome_unknown_no_retry':'read_transport_failed');}
   evidence.lastHttpStatus=response.status;
   if(!response.ok)throw Error([401,403].includes(response.status)?'existing_permission_rejected_no_expansion':'worker_api_rejected');
   return response;
  }
  async function get(path){const b=await (await cf(path)).json();if(b.success!==true)throw Error('worker_api_rejected');return b.result;}
  async function snapshot(){
   const service=await get('/services/'+worker);if(service.id!==worker||service.default_environment?.environment!=='production')throw Error('target_mismatch');
   const bindings=inspectBindings(await get('/services/'+worker+'/environments/production/bindings'));
   const settings=retainedSettings(await get('/scripts/'+worker+'/settings'));delete settings.exports;
   if(canonical(settings)!==canonical({compatibility_date:'2026-10-01',compatibility_flags:[],logpush:false,tags:[],tail_consumers:[],placement:{},usage_model:'standard'}))throw Error('settings_mismatch');
   const active=(await get('/scripts/'+worker+'/deployments')).deployments?.[0]?.versions;
   if(!Array.isArray(active)||active.length!==1||active[0].percentage!==100||typeof active[0].version_id!=='string')throw Error('active_version_unknown');
   const versionId=active[0].version_id;
   const declaration=(await get('/scripts/'+worker+'/versions/'+versionId)).resources?.script_runtime?.exports;
   if(canonical(declaration)!==canonical({AccountMeter:{type:'durable-object',storage:'sqlite'}}))throw Error('exports_mismatch');
   return {bindings,settings,versionId};
  }
  async function content(){return readContent(await cf('/scripts/'+worker+'/content/v2'));}
  async function health(){
   const r=await fetcher(origin+'/health',{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)}),h=await r.json();
   if(r.status!==200||r.headers.get('x-recalm-source-commit')!==BACKEND||h.stripeMode!=='live'||['apiEnabled','billingEnabled','billingVerified','saleActive'].some(k=>h[k]!==false))throw Error('closed_health_mismatch');
  }
  const before=await snapshot();evidence.beforeVersion=before.versionId;
  const current=await content();if(current!==baseline)throw Error('current_content_mismatch');
  await health();await saveBackup(current);evidence.backupSha256=hash(current);
  if(canonical(await snapshot())!==canonical(before)||await content()!==current)throw Error('preflight_changed');
  const form=new FormData();form.set('metadata',new Blob([JSON.stringify({main_module:'worker.js'})],{type:'application/json'}));form.set('worker.js',new Blob([candidate],{type:'application/javascript+module'}),'worker.js');
  evidence.mutationAttempts=1;
  const put=await (await cf('/scripts/'+worker+'/content','PUT',form)).json();if(put.success!==true)throw Error('mutation_outcome_unknown_no_retry');evidence.updated=true;
  const after=await snapshot();evidence.afterVersion=after.versionId;
  if(before.bindings!==after.bindings||canonical(before.settings)!==canonical(after.settings))throw Error('metadata_retention_failed');
  if(await content()!==candidate)throw Error('post_content_mismatch');
  await health();
  for(const [path,text]of Object.entries(assets)){
   const r=await fetcher(origin+(path==='/index.html'?'/':path),{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});
   if(r.status!==200||await r.text()!==text)throw Error('public_asset_mismatch');
  }
  return {...evidence,passed:true,contentSha256:hash(candidate),metadataRetained:true,closed:true,assetCount:4,secretWrites:0,stripeRequests:0,authenticatedApiRequests:0};
 }catch(e){
  const safe=new Set(['reviewed_inputs_required','mutation_outcome_unknown_no_retry','read_transport_failed','existing_permission_rejected_no_expansion','worker_api_rejected','target_mismatch','bindings_mismatch','closed_config_mismatch','secret_metadata_shape_unknown','namespace_mismatch','settings_mismatch','active_version_unknown','exports_mismatch','closed_health_mismatch','current_content_mismatch','preflight_changed','metadata_retention_failed','post_content_mismatch','public_asset_mismatch','content_parts_unknown','content_format_unknown']);
  return {...evidence,error:safe.has(e.message)?e.message:'verification_failed_no_retry',noAutomaticRetry:true};
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const [mode,baselinePath,candidatePath]=process.argv.slice(2);
 const show=(sha,path)=>execFileSync('git',['show',sha+':'+path],{encoding:'utf8'});
 const assets=Object.fromEntries(['index.html','style.css','demo.js','examples.json'].map(name=>['/'+name,show(DEMO,'public/'+name)]));
 const baseline=await readFile(baselinePath,'utf8');
 if(mode==='prepare'){
  const candidate=prepareCandidate(baseline,show(BACKEND,'public/dashboard-demo-worker.js'),assets);await writeFile(candidatePath,candidate,{flag:'wx'});console.log(JSON.stringify({baselineSha256:hash(baseline),candidateSha256:hash(candidate),nonStaticBytesIdentical:true}));
 }else{
  if(mode!=='update'||process.env.GITHUB_REPOSITORY!=='recalm-lab/api-cost-outcome-check'||process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_REF!=='refs/tags/'+TAG||process.env.RECALM_DEMO_UPDATE_APPROVED!=='true')throw Error('approved_execution_required');
  const candidate=await readFile(candidatePath,'utf8');
  const result=await updateDemo({baseline,candidate,assets,credential:process.env.CLOUDFLARE_API_TOKEN,saveBackup:current=>writeFile(baselinePath+'.verified-backup.js',current,{flag:'wx'})});
  console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
 }
}
