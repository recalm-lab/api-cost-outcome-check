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
