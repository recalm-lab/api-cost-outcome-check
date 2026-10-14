import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const uploader=new URL('../scripts/upload-live-closed-worker.mjs',import.meta.url).href;
const before=[
 ...Object.entries({STRIPE_MODE:'live',API_ENABLED:'false',BILLING_ENABLED:'false',BILLING_VERIFIED:'false',STRIPE_PRICE_ID:'price_existing'}).map(([name,text])=>({name,text,type:'plain_text'})),
 {name:'CUSTOM_JSON',type:'json',json:{retain:['all','values']}},
 ...['STRIPE_RESTRICTED_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_METER_WEBHOOK_SECRET','FINGERPRINT_SECRET','CREDENTIALS'].map(name=>({name,type:'secret_text'})),
 {name:'ACCOUNTS',type:'durable_object_namespace',class_name:'AccountMeter',namespace_id:'0b8d1c5cea78485d9d9ae6a62ed98b6f'}
];
function run(bindings=before,changed=null,after=null){
 const source=`
 import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
 const read=fs.readFile;fs.readFile=(path,...args)=>path==='/tmp/recalm-inline-build/inline-worker.js'?Promise.resolve('export default {fetch(){return new Response("synthetic");}};'):read(path,...args);syncBuiltinESMExports();
 const calls=[];let metadata,reads=0;
 globalThis.fetch=async(url,options={})=>{
  const method=options.method||'GET',path=new URL(url).pathname;calls.push({method,path});
  if(method==='GET'&&url.endsWith('/services/recalm-api-cost-check'))return Response.json({success:true,result:{id:'recalm-api-cost-check',default_environment:{environment:'production'}}});
  if(method==='GET'&&url.endsWith('/bindings')){reads++;return Response.json({success:true,result:reads===1?\${JSON.stringify(bindings)}:reads===2?\${JSON.stringify(changed||bindings)}:\${JSON.stringify(after||bindings)}});}
  if(method==='PUT'&&url.endsWith('/scripts/recalm-api-cost-check')){metadata=JSON.parse(await options.body.get('metadata').text());return Response.json({success:true,result:{}});}
  throw Error('unexpected_endpoint');
 };
 let error=null;try{await import(\${JSON.stringify(uploader)});}catch(e){error=e.message;}
 console.log(JSON.stringify({error,calls,metadata}));
 `;
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:10000,env:{...process.env,CLOUDFLARE_API_TOKEN:'synthetic_live_closed_not_a_real_token'}});
 assert.equal(result.status,0,result.stderr);assert.equal(result.error,undefined);assert.ok(!result.stdout.includes('synthetic_live_closed_not_a_real_token'));
 return JSON.parse(result.stdout.trim().split('\n').at(-1));
}
test('live-closed code uploader keeps every binding and namespace with no vars, migrations, exports or routes',()=>{
 const output=run();assert.equal(output.error,null);assert.deepEqual(output.calls.map(c=>c.method),['GET','GET','GET','PUT','GET']);
 assert.deepEqual(output.metadata.bindings,[]);assert.deepEqual(output.metadata.keep_bindings,['secret_text','secret_key','plain_text','json','durable_object_namespace']);assert.equal(output.metadata.keep_assets,true);
 for(const key of ['vars','exports','migrations','routes','route','observability'])assert.ok(!Object.hasOwn(output.metadata,key));
 assert.ok(output.calls.every(c=>c.path.startsWith('/client/v4/accounts/9a2e48df6882d20c2d1c4398184215a9/workers/')));
});
test('live-closed uploader never transitions sandbox, ambiguous settings, enabled flags or changed namespace',()=>{
 const fixtures=[
  ...['STRIPE_MODE','API_ENABLED','BILLING_ENABLED','BILLING_VERIFIED'].flatMap(name=>[
   before.filter(b=>b.name!==name),
   before.map(b=>b.name===name?{...b,text:name==='STRIPE_MODE'?'test':'true'}:b),
   [...before,before.find(b=>b.name===name)],
   before.map(b=>b.name===name?{name,type:'secret_text'}:b)
  ]),
  before.map(b=>b.name==='ACCOUNTS'?{...b,namespace_id:'another_namespace'}:b),
  before.filter(b=>b.name!=='ACCOUNTS'),
  [...before,{name:'unexpected',type:'kv_namespace',namespace_id:'another_namespace'}]
 ];
 for(const fixture of fixtures){const output=run(fixture);assert.ok(output.error);assert.deepEqual(output.calls.map(c=>c.method),['GET','GET']);}
});
test('binding drift before upload stops PUT and drift after upload is reported without leaking vars or secrets',()=>{
 const changed=before.map(b=>b.name==='CUSTOM_JSON'?{...b,json:{changed:true}}:b);
 let output=run(before,changed);assert.equal(output.error,'preflight_binding_changed');assert.deepEqual(output.calls.map(c=>c.method),['GET','GET','GET']);
 output=run(before,null,changed);assert.equal(output.error,'binding_retention_failed');assert.deepEqual(output.calls.map(c=>c.method),['GET','GET','GET','PUT','GET']);
 output=run(before,null,before.filter(b=>b.name!=='CREDENTIALS'));assert.equal(output.error,'binding_retention_failed');
});
