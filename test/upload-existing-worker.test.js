import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const uploader=new URL('../scripts/upload-existing-worker.mjs',import.meta.url).href;
test('sandbox uploader never PUTs or reveals secrets for existing live, missing, unknown or ambiguous mode',()=>{
 const cases=[
  [{type:'plain_text',name:'STRIPE_MODE',text:'live'}],
  [],
  [{type:'plain_text',name:'STRIPE_MODE',text:'unknown'}],
  [{type:'plain_text',name:'STRIPE_MODE'}],
  [{type:'plain_text',name:'STRIPE_MODE',text:null}],
  [{type:'json',name:'STRIPE_MODE',json:'test'}],
  [{type:'secret_text',name:'STRIPE_MODE'}],
  [{type:'plain_text',name:'STRIPE_MODE',text:'test'},{type:'plain_text',name:'STRIPE_MODE',text:'live'}],
  [{type:'plain_text',name:'STRIPE_MODE',text:'test'},{type:'plain_text',name:'STRIPE_MODE',text:'test'}]
 ];
 for(const fixture of cases){
  const bindings=[...fixture,{type:'secret_text',name:'STRIPE_RESTRICTED_KEY'},{type:'secret_text',name:'FINGERPRINT_SECRET'}];
  const source=`
   const calls=[];globalThis.fetch=async(url,options={})=>{
    const method=options.method||'GET';calls.push({method,path:new URL(url).pathname});
    if(method!=='GET')throw Error('unexpected_mutation');
    if(url.endsWith('/services/recalm-api-cost-check'))return Response.json({success:true,result:{id:'recalm-api-cost-check',default_environment:{environment:'production'}}});
    if(url.endsWith('/services/recalm-api-cost-check/environments/production/bindings'))return Response.json({success:true,result:${JSON.stringify(bindings)}});
    throw Error('unexpected_read');
   };
   try{await import(${JSON.stringify(uploader)});console.log(JSON.stringify({error:null,calls}));}
   catch(error){console.log(JSON.stringify({error:error.message,calls}));}
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:10000,env:{...process.env,CLOUDFLARE_API_TOKEN:'synthetic_preflight_only_not_a_real_token'}});
  assert.equal(result.status,0,result.stderr);assert.equal(result.error,undefined);
  const output=JSON.parse(result.stdout.trim());
  assert.equal(output.error,'existing_worker_not_sandbox');
  assert.deepEqual(output.calls.map(c=>c.method),['GET','GET']);
  assert.ok(output.calls.every(c=>c.path.startsWith('/client/v4/accounts/9a2e48df6882d20c2d1c4398184215a9/workers/services/recalm-api-cost-check')));
  assert.ok(!result.stdout.includes('synthetic_preflight_only_not_a_real_token'));
 }
});

test('sandbox uploader preserves secret bindings and keeps closed flags; retention failure is detected',()=>{
 for(const retained of [true,false]){
  const source=`
   import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
   const read=fs.readFile;fs.readFile=(path,...args)=>path==='/tmp/recalm-inline-build/inline-worker.js'?Promise.resolve('export default {fetch(){return new Response("synthetic");}};'):read(path,...args);syncBuiltinESMExports();
   const before=[{type:'plain_text',name:'STRIPE_MODE',text:'test'},{type:'secret_text',name:'STRIPE_RESTRICTED_KEY'},{type:'secret_text',name:'FINGERPRINT_SECRET'},{type:'durable_object_namespace',name:'ACCOUNTS',class_name:'AccountMeter'}];
   const calls=[];let metadata,reads=0;
   globalThis.fetch=async(url,options={})=>{
    const method=options.method||'GET';calls.push(method);
    if(url.endsWith('/services/recalm-api-cost-check'))return Response.json({success:true,result:{id:'recalm-api-cost-check',default_environment:{environment:'production'}}});
    if(url.endsWith('/bindings')){reads++;return Response.json({success:true,result:reads===1||${retained}?before:before.filter(b=>b.name!=='STRIPE_RESTRICTED_KEY')});}
    if(method==='PUT'&&url.endsWith('/scripts/recalm-api-cost-check')){metadata=JSON.parse(await options.body.get('metadata').text());return Response.json({success:true,result:{exports_reconciliation:{created:[]},startup_time_ms:1}});}
    throw Error('unexpected_endpoint');
   };
   let error=null;try{await import(${JSON.stringify(uploader)});}catch(e){error=e.message;}
   console.log(JSON.stringify({error,calls,metadata}));
  `;
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:10000,env:{...process.env,CLOUDFLARE_API_TOKEN:'synthetic_preflight_only_not_a_real_token'}});
  assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(output.error,retained?null:'secret_binding_retention_failed');
  assert.deepEqual(output.calls,['GET','GET','PUT','GET']);
  assert.deepEqual(output.metadata.keep_bindings,['secret_text','secret_key','plain_text','json']);
  const vars=Object.fromEntries(output.metadata.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
  assert.deepEqual(vars,{API_ENABLED:'false',BILLING_ENABLED:'false',BILLING_VERIFIED:'false',STRIPE_MODE:'test'});
  assert.ok(output.metadata.bindings.some(b=>b.type==='durable_object_namespace'&&b.name==='ACCOUNTS'&&b.class_name==='AccountMeter'));
  assert.ok(!result.stdout.includes('synthetic_preflight_only_not_a_real_token'));
 }
});
test('legacy deploy script and old tag workflow are disabled before credential use or deployment',async()=>{
 const legacy=new URL('../scripts/deploy-existing-worker.mjs',import.meta.url).href;
 const source=`let calls=0;globalThis.fetch=()=>{calls++;throw Error('unexpected_network');};try{await import(${JSON.stringify(legacy)});}catch(error){console.log(JSON.stringify({error:error.message,calls}));}`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout.trim()),{error:'legacy_deployment_disabled_use_scoped_uploader',calls:0});
 const {readFile}=await import('node:fs/promises');
 const workflow=await readFile(new URL('../.github/workflows/deploy-sandbox.yml',import.meta.url),'utf8');
 assert.match(workflow,/deploy:\s*\n\s*#.*\n\s*if: \$\{\{ false \}\}/);
});
