import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const closed={stripeMode:'test',saleActive:false,apiEnabled:false,billingEnabled:false,billingVerified:false};
async function exercise(fn){
 const dir=await mkdtemp(join(tmpdir(),'recalm-readiness-'));
 const preload=join(dir,'mock-fetch.mjs');
 await writeFile(preload,`globalThis.fetch=async(url,options)=>{if(url==='https://recalm-api-cost-check.rough-sound-e8d7.workers.dev/v1/stripe/meter-webhook'&&options.method==='POST'&&options.body==='{}')return Response.json({error:'billing_unavailable'},{status:503});if(options.method&&options.method!=='GET')throw new Error('unexpected_write');if(url==='https://recalm-api-cost-check.rough-sound-e8d7.workers.dev/health')return Response.json(JSON.parse(process.env.READINESS_TEST_HEALTH));if(url==='https://recalm-api-cost-check.rough-sound-e8d7.workers.dev/openapi.json')return Response.json({openapi:'3.1.0',paths:{'/v1/stripe/meter-webhook':{}}});throw new Error('unexpected_network');};`);
 const run=health=>{const result=spawnSync(process.execPath,['--import',preload,resolve('scripts/sandbox-smoke.mjs'),'readiness'],{encoding:'utf8',env:{...process.env,READINESS_TEST_HEALTH:JSON.stringify(health)}});assert.equal(result.stderr,'');return {status:result.status,report:JSON.parse(result.stdout.trim())};};
 try{await fn(run);}finally{await rm(dir,{recursive:true,force:true});}
}
test('post-deploy readiness passes only closed boolean flags and reports all three false',()=>exercise(run=>{
 const {status,report}=run(closed);assert.equal(status,0);assert.equal(report.apiEnabled,false);assert.equal(report.billingEnabled,false);assert.equal(report.billingVerified,false);assert.equal(report.saleActive,false);assert.deepEqual(report.checks.map(c=>c.path),['/health','/openapi.json','/v1/stripe/meter-webhook']);
}));
test('post-deploy readiness stops for any enabled flag before further requests',()=>exercise(run=>{
 for(const name of ['apiEnabled','billingEnabled','billingVerified']){const {status,report}=run({...closed,[name]:true});assert.equal(status,1);assert.equal(report.passed,false);assert.deepEqual(report.checks.map(c=>c.path),['/health']);}
}));
test('post-deploy readiness rejects missing or string-valued activation flags',()=>exercise(run=>{
 for(const name of ['apiEnabled','billingEnabled','billingVerified']){
  const missing={...closed};delete missing[name];for(const health of [missing,{...closed,[name]:'false'}]){const {status,report}=run(health);assert.equal(status,1);assert.equal(report.passed,false);}
 }
}));
