import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { normal, retry } from '../scripts/fixtures.mjs';
const token='synthetic_test_credential_'.padEnd(50,'x');
const token2='second_synthetic_test_credential_'.padEnd(50,'x');
const credentials = Object.fromEntries([token,token2].map((t,i)=>[createHash('sha256').update(t).digest('hex'),{account:i?'other-account':'test-account',enabled:true,expiresAt:Date.now()+3600000,maxMonthlySuccessfulCalls:5}]));
const modules=await Promise.all(['worker','reconcile','meter'].map(async name=>({type:'ESModule',path:resolve('src/'+name+'.js'),contents:await readFile('src/'+name+'.js','utf8')})));
function runtime(persist,bindings={}) { return new Miniflare({name:'test-api',modules,compatibilityDate:'2026-07-30',durableObjects:{ACCOUNTS:{className:'AccountMeter',useSQLite:true}},durableObjectsPersist:persist,bindings:{API_ENABLED:'true',CREDENTIALS:JSON.stringify(credentials),FINGERPRINT_SECRET:'synthetic-test-only-fingerprint-secret',...bindings}}); }
const req=(body=normal,key='synthetic-call-0001',bearer=token)=>({method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json','idempotency-key':key},body:typeof body==='string'?body:JSON.stringify(body)});
test('workerd SQLite atomic success, parallel retries, conflicts, caps, invalid inputs, accounts and restart', async () => {
  const persist=await mkdtemp(join(tmpdir(),'recalm-workerd-')); let mf=runtime(persist);
  try {
    const first=await Promise.all(Array.from({length:20},()=>mf.dispatchFetch('https://test/v1/check',req())));
    assert.ok(first.every(r=>r.status===200));
    const outputs=await Promise.all(first.map(r=>r.json()));
    assert.equal(outputs.reduce((n,r)=>n+r.usage.billableCalls,0),1);
    assert.ok(outputs.every(r=>r.usage.successfulCalls===1));
    assert.equal((await mf.dispatchFetch('https://test/v1/check',req(retry))).status,409);
    assert.equal((await mf.dispatchFetch('https://test/v1/check',req('{'))).status,400);
    const invalidBytes=req();invalidBytes.body=new Uint8Array([255]);assert.equal((await mf.dispatchFetch('https://test/v1/check',invalidBytes)).status,400);
    assert.equal((await mf.dispatchFetch('https://test/v1/check',req({...normal,secret:'reject'}))).status,400);
    assert.equal((await mf.dispatchFetch('https://test/v1/check',req(' '.repeat(16385)))).status,413);
    assert.equal((await mf.dispatchFetch('https://test/v1/check',req(normal,'short'))).status,400);
    assert.equal((await mf.dispatchFetch('https://test/v1/check',req(normal,'synthetic-call-0001','unknown'.padEnd(50,'x')))).status,401);
    const second=await (await mf.dispatchFetch('https://test/v1/check',req(normal,'synthetic-call-0001',token2))).json(); assert.equal(second.usage.billableCalls,1);
    const burst=await Promise.all(Array.from({length:12},(_,i)=>mf.dispatchFetch('https://test/v1/check',req(normal,'synthetic-distinct-'+String(i).padStart(3,'0')))));
    assert.equal(burst.filter(r=>r.status===200).length,4); assert.equal(burst.filter(r=>r.status===429).length,8);
    await mf.dispose(); mf=runtime(persist);
    const replay=await (await mf.dispatchFetch('https://test/v1/check',req())).json(); assert.equal(replay.usage.billableCalls,0); assert.equal(replay.usage.successfulCalls,5);

  } finally { await mf.dispose(); await rm(persist,{recursive:true,force:true}); }
});
test('API closed by default, disabled/expired credential and malformed config fail closed', async () => {
  const expired=structuredClone(credentials);expired[createHash('sha256').update(token).digest('hex')].expiresAt=0;
  for(const bindings of [{CREDENTIALS:JSON.stringify(expired)},{API_ENABLED:'false'},{CREDENTIALS:'{}'},{CREDENTIALS:'broken'},{CREDENTIALS:JSON.stringify({[createHash('sha256').update(token).digest('hex')]:{...credentials[createHash('sha256').update(token).digest('hex')],enabled:false}})}]) {
    const mf=runtime(false,bindings);
    try { assert.ok([401,503].includes((await mf.dispatchFetch('https://test/v1/check',req())).status)); }
    finally { await mf.dispose(); }
  }
});
test('workerd accepts exact maximum body and 40-step chain; rejects compressed and unsupported content',async()=>{
  const mf=runtime(false);
  try {
    const data={...normal,tasks:[],attempts:[],bills:[]};
    for(let i=0;i<40;i++){data.tasks.push({id:'t'+i,outcome:'success'});data.attempts.push({requestId:'r'+i,taskId:'t0',outcome:i===39?'success':'failure',...(i?{retryOf:'r'+(i-1)}:{})});data.bills.push({...normal.bills[0],id:'b'+i,requestId:'r'+i});}
    const body=JSON.stringify(data).padEnd(16384,' ');
    const response=await mf.dispatchFetch('https://test/v1/check',req(body,'maximum-body-call-1'));assert.equal(response.status,200);assert.equal((await response.json()).usage.billableCalls,1);
    const compressed=req();compressed.headers['content-encoding']='gzip';assert.equal((await mf.dispatchFetch('https://test/v1/check',compressed)).status,415);
    const wrongType=req();wrongType.headers['content-type']='text/plain';assert.equal((await mf.dispatchFetch('https://test/v1/check',wrongType)).status,415);
    assert.equal((await mf.dispatchFetch('https://test/v1/check')).status,405);
  }finally{await mf.dispose();}
});
