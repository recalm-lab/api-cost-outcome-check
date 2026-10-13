import { reconcile } from '../src/reconcile.js';
import { normal } from './fixtures.mjs';
import { createHmac, createHash } from 'node:crypto';
const input={...normal,tasks:[],attempts:[],bills:[]};
const ident=(prefix,i)=>(prefix+i).padEnd(16,'x');
for(let i=0;i<40;i++) {input.tasks.push({id:ident('t',i),outcome:'success'});input.attempts.push({requestId:ident('r',i),taskId:ident('t',0),outcome:i===39?'success':'failure',...(i?{retryOf:ident('r',i-1)}:{})});input.bills.push({id:ident('b',i),requestId:ident('r',i),amount:1000000000,unit:i%2?'money:USD:2':'credits:test:0',evidence:'confirmed',kind:'usage'});}
const body=JSON.stringify(input).padEnd(16384,' ');
if(Buffer.byteLength(body)!==16384)throw new Error('Benchmark must fit maximum body');
const run=()=>{createHash('sha256').update('test-only').digest();createHmac('sha256','test-only').update(body).digest();JSON.stringify(reconcile(JSON.parse(body)));};
for(let i=0;i<500;i++)run();
const timings=[];for(let i=0;i<1000;i++){const start=process.cpuUsage();run();const t=process.cpuUsage(start);timings.push((t.user+t.system)/1000);}
timings.sort((a,b)=>a-b);
console.log(JSON.stringify({runtime:process.version,recordsPerArray:40,bytes:Buffer.byteLength(body),iterations:1000,scenario:"maximum 16KiB body, 40 rows per array, retry chain of 40 attempts",cpuMs:{p50:timings[500],p95:timings[950],p99:timings[990],max:timings.at(-1)},includes:'JSON parse/validate/reconcile/serialize and Node hash/HMAC',excludes:'Workers ingress, WebCrypto, DO RPC and storage; NOT evidence of deployed Workers CPU'},null,2));
