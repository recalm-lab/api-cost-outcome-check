import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordSuccess,one,saveState,state} from '../src/meter.js';
import {storage,ready,eventId} from './helpers.js';
const record=(s,key,period='2026-10',now=ready(s,period),cap=1000)=>recordSuccess(s,key,'hmac-body',cap,period,now,eventId(key));
test('fail closed without paid entitlement, receipt + liability + outbox atomically committed',()=>{
 const s=storage();assert.equal(recordSuccess(s,'key','body',1000,'2026-10',1790812801,eventId('key')).status,503);const now=ready(s);
 assert.equal(record(s,'key','2026-10',now).status,200);assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,1);assert.equal(one(s,'SELECT sendState,unitAmount FROM calls').sendState,'queued');
 const original=s.sql.exec;s.sql.exec=(sql,...args)=>{if(sql.startsWith('UPDATE meter'))throw new Error('synthetic-storage-failure');return original(sql,...args);};assert.throws(()=>record(s,'rollback','2026-10',now));s.sql.exec=original;assert.equal(one(s,'SELECT COUNT(*) AS count FROM calls').count,1);assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,1);s.db.close();
});
test('month boundary does not erase outstanding debt; unknown previous invoice blocks new calls',()=>{
 const s=storage(),now=ready(s);record(s,'old','2026-10',now);const next=ready(s,'2026-11');assert.equal(record(s,'new','2026-11',next).status,503);assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,1);
 assert.equal(recordSuccess(s,'old','hmac-body',1000,'2026-11',next,eventId('old')).replay,true);assert.equal(recordSuccess(s,'old','changed',1000,'2026-11',next,eventId('old')).status,409);s.db.close();
});
test('49 carried plus new usage stops at total 1000, without counting carry twice',()=>{
 const s=storage(),now=ready(s);for(let i=0;i<49;i++)record(s,'old'+i,'2026-10',now+i);s.sql.exec("UPDATE calls SET invoiceId='in_old'");s.sql.exec("INSERT INTO invoices VALUES ('in_old',?,?,'paid',0)",now,now+100);
 const next=ready(s,'2026-11');for(let i=0;i<951;i++)assert.equal(record(s,'new'+i,'2026-11',next+i).status,200);
 assert.equal(record(s,'over','2026-11',next+1000).status,429);assert.equal(one(s,'SELECT outstanding FROM meter').outstanding,1000);assert.equal(one(s,"SELECT count FROM periods WHERE period='2026-11'").count,951);
 saveState(s,{...state(s),collectionHold:true});assert.equal(record(s,'hold','2026-11',next+1001).status,503);s.db.close();
});
