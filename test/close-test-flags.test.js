import {test} from 'node:test';
import assert from 'node:assert/strict';
import {closeTestFlags} from '../scripts/close-test-flags.mjs';
const settings={compatibility_date:'2026-10-01',compatibility_flags:[],logpush:false,tags:[],tail_consumers:[],placement:{},usage_model:'standard'};
test('test flag close changes only three values, inherits opaque bindings and rejects unproven source version before PATCH',async()=>{
 for(const proven of [true,false]){
  let patched=false;const calls=[];
  const before=[...Object.entries({STRIPE_MODE:'test',API_ENABLED:'true',BILLING_ENABLED:'true',BILLING_VERIFIED:'false'}).map(([name,text])=>({name,text,type:'plain_text'})),{name:'CREDENTIALS',type:'secret_text'},{name:'ACCOUNTS',type:'durable_object_namespace',class_name:'AccountMeter',namespace_id:'0b8d1c5cea78485d9d9ae6a62ed98b6f'}];
  const fetcher=async(url,options)=>{
   const path=new URL(url).pathname;calls.push(options.method);let result;
   if(options.method==='PATCH'){
    assert.ok(path.endsWith('/scripts/recalm-api-cost-check/settings'));
    const payload=JSON.parse(await options.body.get('settings').text());assert.deepEqual(Object.keys(payload),['bindings','exports']);assert.deepEqual(payload.exports,{AccountMeter:{type:'durable-object',storage:'sqlite'}});
    for(const b of payload.bindings)assert.deepEqual(b,['API_ENABLED','BILLING_ENABLED','BILLING_VERIFIED'].includes(b.name)?{name:b.name,type:'plain_text',text:'false'}:{name:b.name,type:'inherit'});
    patched=true;result={};
   }else if(path.endsWith('/bindings'))result=before.map(b=>patched&&['API_ENABLED','BILLING_ENABLED','BILLING_VERIFIED'].includes(b.name)?{...b,text:'false'}:b);
   else if(path.endsWith('/settings'))result=settings;
   else if(path.endsWith('/deployments'))result={deployments:[{versions:[{percentage:100,version_id:'version_current'}]}]};
   else if(path.includes('/versions/'))result={resources:{script_runtime:{exports:{AccountMeter:{type:'durable-object',storage:'sqlite'}}}}};
   else if(path.endsWith('/versions'))result={items:[{id:proven?'version_current':'version_other'}]};
   else result={id:'recalm-api-cost-check',default_environment:{environment:'production'}};
   return Response.json({success:true,result});
  };
  const old=process.env.CLOUDFLARE_API_TOKEN,log=console.log;process.env.CLOUDFLARE_API_TOKEN='synthetic';console.log=()=>{};
  try{if(proven)await closeTestFlags(fetcher);else await assert.rejects(closeTestFlags(fetcher),/inherit_version_not_proven/);}
  finally{console.log=log;if(old===undefined)delete process.env.CLOUDFLARE_API_TOKEN;else process.env.CLOUDFLARE_API_TOKEN=old;}
  assert.equal(calls.filter(c=>c==='PATCH').length,proven?1:0);
 }
});
