import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {BillingService} from '../src/billing.js';
import {BillingError} from '../src/stripe.js';
import {recordSuccess,one,saveState,state,initMeter} from '../src/meter.js';
import {storage,ready,eventId,config,subscription} from './helpers.js';
const record=(s,key,period='2026-10',now=ready(s,period),cap=1000)=>recordSuccess(s,key,'hmac-body',cap,period,now,eventId(key));

function ledgerFile(t){
 const root=resolve(tmpdir()),directory=mkdtempSync(join(root,'recalm-retained-ledger-'));
 t.after(()=>{assert.equal(dirname(resolve(directory)),root);assert.ok(directory.startsWith(join(root,'recalm-retained-ledger-')));rmSync(directory,{recursive:true,force:true});});
 return join(directory,'ledger.sqlite');
}
function ledgerTotals(s){return {...one(s,`SELECT count,outstanding,paid,waived,
 (SELECT COUNT(*) FROM calls) AS receipts,
 (SELECT COALESCE(SUM(unitAmount),0) FROM calls) AS units,
 (SELECT COALESCE(SUM(count),0) FROM periods) AS periodCount,
 (SELECT COALESCE(SUM(paid),0) FROM invoices) AS invoicePaid,
 (SELECT COUNT(*) FROM calls WHERE invoiceId IS NULL) AS unassigned,
 (SELECT COUNT(*) FROM calls WHERE sendState!='sent') AS unsent,
 (SELECT COUNT(*) FROM webhooks) AS webhooks FROM meter WHERE id=1`)};}
function seedSettledReceipts(s,count){
 // Completed synthetic months, each at or below 1,000 calls. No live-month or
 // outstanding cap is raised, and historical outbox rows are already sent.
 const call=s.db.prepare("INSERT INTO calls (id,digest,version,period,createdAt,unitAmount,eventId,sendState,firstAttempt,attempts,invoiceId) VALUES (?,'hmac-body','1',?,?,1,?,'sent',?,1,?)");
 s.transactionSync(()=>{
  let inserted=0;
  for(let month=0;inserted<count;month++){
   const start=Date.UTC(2018,5+month,1)/1000,end=Date.UTC(2018,6+month,1)/1000,period=new Date(start*1000).toISOString().slice(0,7),batch=Math.min(1000,count-inserted),invoiceId='in_retained_'+period.replace('-','');
   assert.ok(end<=Date.parse('2026-10-01T00:00:00Z')/1000);
   s.sql.exec("INSERT INTO invoices VALUES (?,?,?,'paid',?)",invoiceId,start,end,batch);
   s.sql.exec('INSERT INTO periods VALUES (?,?)',period,batch);
   for(let i=0;i<batch;i++){
    const key='retained-'+inserted++,createdAt=start+100+i;
    call.run(key,period,createdAt,eventId(key),createdAt,invoiceId);
   }
  }
  s.sql.exec('UPDATE meter SET count=count+?,paid=paid+? WHERE id=1',count,count);
 });
}
test('fail closed without paid entitlement, receipt + liability + outbox atomically committed',()=>{
 const s=storage();assert.equal(recordSuccess(s,'key','body',1000,'2026-10',1790812801,eventId('key')).status,503);const now=ready(s);
 assert.equal(record(s,'key','2026-10',now).status,200);assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,1);assert.equal(one(s,'SELECT sendState,unitAmount FROM calls').sendState,'queued');
 const original=s.sql.exec;s.sql.exec=(sql,...args)=>{if(sql.startsWith('UPDATE meter'))throw new Error('synthetic-storage-failure');return original(sql,...args);};assert.throws(()=>record(s,'rollback','2026-10',now));s.sql.exec=original;assert.equal(one(s,'SELECT COUNT(*) AS count FROM calls').count,1);assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,1);s.db.close();
});
test('month boundary does not erase outstanding debt; unknown previous invoice blocks new calls',()=>{
 const s=storage(),now=ready(s);record(s,'old','2026-10',now);const next=ready(s,'2026-11');assert.equal(record(s,'new','2026-11',next).status,503);assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,1);
 assert.equal(recordSuccess(s,'old','hmac-body',1000,'2026-11',next,eventId('old')).replay,true);assert.equal(recordSuccess(s,'old','changed',1000,'2026-11',next,eventId('old')).status,409);s.db.close();
});

test('a failure after any metering write rolls back the whole call and its retry is charged exactly once',()=>{
 for(const failedWrite of ['INSERT INTO calls ', 'UPDATE meter SET count=', 'INSERT INTO periods ']){
  const s=storage(),now=ready(s),original=s.sql.exec;
  try{
   assert.equal(record(s,'existing','2026-10',now).status,200);
   const before={calls:[...s.sql.exec('SELECT * FROM calls ORDER BY id')],meter:[...s.sql.exec('SELECT * FROM meter')],periods:[...s.sql.exec('SELECT * FROM periods')]};
   s.sql.exec=(sql,...args)=>{
    const result=original(sql,...args);
    if(sql.startsWith(failedWrite))throw new Error('synthetic-failure-after-write');
    return result;
   };
   try{assert.throws(()=>record(s,'retry-after-rollback','2026-10',now+1),/synthetic-failure-after-write/);}
   finally{s.sql.exec=original;}
   assert.deepEqual({calls:[...s.sql.exec('SELECT * FROM calls ORDER BY id')],meter:[...s.sql.exec('SELECT * FROM meter')],periods:[...s.sql.exec('SELECT * FROM periods')]},before);
   const retry=record(s,'retry-after-rollback','2026-10',now+2);
   assert.deepEqual(retry,{status:200,replay:false,count:2,monthlyCount:2,outstanding:2});
   const replay=record(s,'retry-after-rollback','2026-10',now+3);
   assert.deepEqual(replay,{status:200,replay:true,count:2,monthlyCount:2,outstanding:2});
   assert.equal(one(s,"SELECT COUNT(*) AS count FROM calls WHERE sendState='queued'").count,2);
   assert.equal(one(s,'SELECT eventId FROM calls WHERE id=?','retry-after-rollback').eventId,eventId('retry-after-rollback'));
  }finally{s.sql.exec=original;s.db.close();}
 }
});
test('49 carried plus new usage stops at total 1000, without counting carry twice',()=>{
 const s=storage(),now=ready(s);for(let i=0;i<49;i++)record(s,'old'+i,'2026-10',now+i);s.sql.exec("UPDATE calls SET invoiceId='in_old'");s.sql.exec("INSERT INTO invoices VALUES ('in_old',?,?,'paid',0)",now,now+100);
 const next=ready(s,'2026-11');for(let i=0;i<951;i++)assert.equal(record(s,'new'+i,'2026-11',next+i).status,200);
 assert.equal(record(s,'over','2026-11',next+1000).status,429);assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,1000);assert.equal(one(s,"SELECT count FROM periods WHERE period='2026-11'").count,951);
 saveState(s,{...state(s),collectionHold:true});assert.equal(record(s,'hold','2026-11',next+1001).status,503);s.db.close();
});
test('legacy receipts are preserved and held during additive migration',()=>{
 // Simulate the original development schema without discarding its idempotency record.
 const base=storage();const db=new base.db.constructor(':memory:');base.db.close();db.exec("CREATE TABLE calls(id TEXT PRIMARY KEY,digest TEXT NOT NULL,version TEXT NOT NULL,period TEXT NOT NULL); INSERT INTO calls VALUES('old','body','1','2026-10'); CREATE TABLE meter(id INTEGER PRIMARY KEY,count INTEGER NOT NULL); INSERT INTO meter VALUES(1,1)");
 const old={sql:{exec(sql,...args){const stmt=db.prepare(sql);return /^(SELECT|PRAGMA)/.test(sql)?stmt.all(...args):(stmt.run(...args),[]);}}};
 // init's migration runs only additive ALTER operations and conservative liabilities.
 initMeter(old);assert.equal(one(old,'SELECT outstanding FROM meter').outstanding,1);assert.equal(one(old,'SELECT sendState FROM calls').sendState,'hold');assert.equal(one(old,'SELECT COUNT(*) AS count FROM calls').count,1);db.close();
});

test('retained receipts reach 100,000 once; capacity retries add zero metering and survive SQLite restart',async t=>{
 const filename=ledgerFile(t);let s=storage(filename);
 try{
  const now=ready(s),requests=[];
  seedSettledReceipts(s,99999);
  assert.deepEqual(ledgerTotals(s),{count:99999,outstanding:0,paid:99999,waived:0,receipts:99999,units:99999,periodCount:99999,invoicePaid:99999,unassigned:0,unsent:0,webhooks:0});
  assert.equal(one(s,'SELECT MAX(count) AS count FROM periods').count,1000);
  assert.equal(one(s,"SELECT count FROM periods WHERE period='2026-10'"),undefined);
  const plan=s.db.prepare('EXPLAIN QUERY PLAN SELECT id FROM calls WHERE createdAt<? AND invoiceId IS NULL LIMIT 1').all(state(s).periodStart);
  assert.ok(plan.some(r=>r.detail.includes('calls_unassigned')));
  const historical=['retained-0','retained-99998'].map(key=>({...one(s,'SELECT * FROM calls WHERE id=?',key)}));
  assert.deepEqual(record(s,'retained-boundary','2026-10',now),{status:200,replay:false,count:100000,monthlyCount:1,outstanding:1});
  assert.deepEqual(ledgerTotals(s),{count:100000,outstanding:1,paid:99999,waived:0,receipts:100000,units:100000,periodCount:100000,invoicePaid:99999,unassigned:1,unsent:1,webhooks:0});
  const client={config,async request(method,path,params,key){
   assert.equal(method,'POST');assert.equal(path,'/v1/billing/meter_events');
   requests.push({params,key});
   return {identifier:params.identifier,event_name:config.eventName,livemode:false,payload:{stripe_customer_id:'cus_test',value:'1'}};
  }};
  const flush=()=>new BillingService(s,client,'cus_test',()=>now).flush();
  await flush();assert.equal(requests.length,1);
  assert.equal(requests[0].params.identifier,eventId('retained-boundary'));
  assert.equal(requests[0].params['payload[value]'],1);
  assert.equal(requests[0].key,'meter:'+eventId('retained-boundary'));
  const expected=ledgerTotals(s),billing=state(s),boundary={...one(s,"SELECT * FROM calls WHERE id='retained-boundary'")};
  const checkCapacity=async()=>{
   assert.equal(record(s,'retained-overflow','2026-10',now+1).status,429);
   assert.equal(one(s,"SELECT id FROM calls WHERE id='retained-overflow'"),undefined);
   for(const key of ['retained-0','retained-99998','retained-boundary']){
    assert.deepEqual(record(s,key,'2026-10',now+1),{status:200,replay:true,count:100000,monthlyCount:1,outstanding:1});
    assert.equal(recordSuccess(s,key,'different-body',1000,'2026-10',now+1,eventId(key)).status,409);
   }
   await flush();assert.equal(requests.length,1);
   assert.equal(one(s,"SELECT count FROM periods WHERE period='2026-10'").count,1);
   assert.deepEqual(ledgerTotals(s),expected);assert.deepEqual(state(s),billing);
   assert.deepEqual({...one(s,"SELECT * FROM calls WHERE id='retained-boundary'")},boundary);
   assert.deepEqual(historical.map(row=>({...one(s,'SELECT * FROM calls WHERE id=?',row.id)})),historical);
  };
  await checkCapacity();
  s.db.close();s=null;s=storage(filename);
  assert.deepEqual(ledgerTotals(s),expected);assert.deepEqual(state(s),billing);
  await checkCapacity();
 }finally{s?.db.close();}
});

test('100,000 retained webhooks reject new IDs but deduplicate redelivery before and after SQLite restart',async t=>{
 const filename=ledgerFile(t);let s=storage(filename);
 try{
  const now=ready(s),requests=[];
  assert.equal(record(s,'webhook-receipt','2026-10',now).status,200);
  const insert=s.db.prepare('INSERT INTO webhooks VALUES (?,?)');
  s.transactionSync(()=>{for(let i=0;i<99999;i++)insert.run('evt_retained_'+i,now-1);});
  assert.equal(one(s,'SELECT COUNT(*) AS count FROM webhooks').count,99999);
  const event={id:'evt_retained_boundary',type:'customer.subscription.updated',livemode:false,data:{object:{id:'sub_test'}}};
  const client={config,async request(method,path){
   assert.equal(method,'GET');assert.equal(path,'/v1/subscriptions/sub_test');
   requests.push({method,path});return subscription();
  }};
  const service=()=>new BillingService(s,client,'cus_test',()=>now);
  await service().webhook(event);assert.equal(requests.length,1);
  const expected=ledgerTotals(s);
  assert.deepEqual(expected,{count:1,outstanding:1,paid:0,waived:0,receipts:1,units:1,periodCount:1,invoicePaid:0,unassigned:1,unsent:1,webhooks:100000});
  const receipt={...one(s,"SELECT * FROM calls WHERE id='webhook-receipt'")};
  const duplicates=async()=>{
   const before=state(s);
   for(const id of ['evt_retained_0','evt_retained_99998',event.id])await service().webhook({...event,id});
   assert.equal(requests.length,1);assert.deepEqual(ledgerTotals(s),expected);assert.deepEqual(state(s),before);
   assert.deepEqual({...one(s,"SELECT * FROM calls WHERE id='webhook-receipt'")},receipt);
  };
  const overflow=async()=>{
   await assert.rejects(()=>service().webhook({...event,id:'evt_retained_overflow'}),error=>error instanceof BillingError&&error.status===503&&error.message==='billing_unavailable');
   assert.equal(one(s,"SELECT id FROM webhooks WHERE id='evt_retained_overflow'"),undefined);
   assert.equal(requests.length,1);assert.deepEqual(ledgerTotals(s),expected);
   assert.equal(state(s).active,false);assert.equal(state(s).collectionHold,true);assert.equal(state(s).holdReason,'webhook_capacity');
   assert.equal(record(s,'after-webhook-capacity','2026-10',now).status,503);
   assert.deepEqual(record(s,'webhook-receipt','2026-10',now),{status:200,replay:true,count:1,monthlyCount:1,outstanding:1});
   assert.deepEqual(ledgerTotals(s),expected);
  };
  await duplicates();await overflow();await duplicates();
  const held=state(s);
  s.db.close();s=null;s=storage(filename);
  assert.deepEqual(ledgerTotals(s),expected);assert.deepEqual(state(s),held);
  await duplicates();await overflow();await duplicates();
 }finally{s?.db.close();}
});

test('settlement clearing outstanding does not reopen the same-month 1000 successful-call cap',()=>{
 const s=storage(),now=ready(s);
 try{
  for(let i=0;i<1000;i++)assert.equal(record(s,'settled-cap-'+i,'2026-10',now+i).status,200);
  // Apply the ledger result of verified collection; monthly receipts must remain intact.
  s.sql.exec("UPDATE calls SET invoiceId='in_settled_cap'");
  s.sql.exec("INSERT INTO invoices VALUES ('in_settled_cap',?,?,'paid',1000)",now,now+1000);
  s.sql.exec('UPDATE meter SET outstanding=0,paid=1000 WHERE id=1');
  assert.equal(record(s,'after-collection','2026-10',now+1001).status,429);
  const replay=record(s,'settled-cap-0','2026-10',now+1001);assert.equal(replay.status,200);assert.equal(replay.replay,true);
  assert.equal(one(s,"SELECT count FROM periods WHERE period='2026-10'").count,1000);
  assert.deepEqual({...one(s,'SELECT count,outstanding,paid FROM meter')},{count:1000,outstanding:0,paid:1000});
 }finally{s.db.close();}
});
