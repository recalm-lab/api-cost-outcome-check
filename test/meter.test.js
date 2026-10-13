import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initMeter,recordSuccess} from '../src/meter.js';
function storage() {
  const db=new DatabaseSync(':memory:');
  return {db,sql:{exec(sql,...params){const stmt=db.prepare(sql);return sql.startsWith('SELECT')?stmt.all(...params):(stmt.run(...params),[]);}},transactionSync(fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
}
test('monthly reset preserves old receipt; hard cap, metadata only and atomic rollback',()=>{
  const s=storage();initMeter(s);
  assert.equal(recordSuccess(s,'hmac-key','hmac-body',1,'2026-10').status,200);
  assert.equal(recordSuccess(s,'new-key','hmac-body',1,'2026-10').status,429);
  const replay=recordSuccess(s,'hmac-key','hmac-body',1,'2026-11'); assert.equal(replay.replay,true); assert.equal(replay.monthlyCount,0);
  assert.equal(recordSuccess(s,'new-key','hmac-body',1,'2026-11').monthlyCount,1);
  assert.equal(recordSuccess(s,'hmac-key','different-body',1,'2026-11').status,409);
  assert.deepEqual(s.db.prepare('SELECT * FROM periods ORDER BY period').all().map(r=>({...r})),[{period:'2026-10',count:1},{period:'2026-11',count:1}]);
  assert.deepEqual(s.db.prepare('PRAGMA table_info(calls)').all().map(r=>r.name),['id','digest','version','period']);
  const original=s.sql.exec;s.sql.exec=(sql,...args)=>{if(sql.startsWith('UPDATE meter'))throw new Error('synthetic-storage-failure');return original(sql,...args);};
  assert.throws(()=>recordSuccess(s,'rollback-key','digest',1000,'2026-12'));
  s.sql.exec=original;assert.equal(s.db.prepare('SELECT COUNT(*) AS count FROM calls WHERE id=?').get('rollback-key').count,0);
  assert.equal(s.db.prepare('SELECT count FROM meter').get().count,2);
  s.db.prepare('UPDATE meter SET count=100000').run();assert.equal(recordSuccess(s,'hard-cap-key','digest',1000,'2026-12').status,429);
  s.db.close();
});
