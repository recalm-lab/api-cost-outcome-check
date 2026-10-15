import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, validate } from '../src/reconcile.js';
import { normal, retry, missing } from '../scripts/fixtures.mjs';
const copy = x => structuredClone(x);
test('skill synthetic normal and retry include failed attempt costs', () => {
  assert.deepEqual(reconcile(normal).totals[0].costPerSuccessfulTask, { numerator: 20, denominator: 1 });
  const r = reconcile(retry); assert.equal(r.totals[0].total,20); assert.ok(r.findings[0].flags.includes('failed_retry'));
  assert.ok(!r.findings.some(f=>f.flags.includes('duplicate_suspected')));
});
test('missing join, zero successes, HTTP outcome, false zero-cost attribution', () => {
  assert.equal(reconcile(missing).totals[0].costPerSuccessfulTask,null);
  const p = copy(normal); p.tasks[0].outcome='failure'; assert.equal(reconcile(p).totals[0].costPerSuccessfulTask,null);
  p.attempts[0].httpStatus=200; assert.throws(()=>validate(p));
  const z=copy(normal); delete z.bills[0].requestId; z.bills[0].amount=0; assert.equal(reconcile(z).totals[0].costPerSuccessfulTask,null);
});
test('duplicates are suspicions, no invented allocations', () => {
  const p=copy(normal); p.bills.push({...p.bills[0],id:'b2'});
  const r=reconcile(p); assert.equal(r.totals[0].total,40); assert.equal(r.totals[0].costPerSuccessfulTask,null);
  assert.ok(r.findings.every(f=>f.flags.includes('duplicate_suspected')));
});
test('currency, credits, estimates separate; deposits/balances excluded', () => {
  const p=copy(normal);
  for(const [i,unit,evidence,kind] of [[2,'money:JPY:0','confirmed','usage'],[3,'credits:vendor:0','estimated','usage'],[4,'money:USD:2','estimated','usage'],[5,'money:USD:2','confirmed','topup'],[6,'money:USD:2','confirmed','balance']]) p.bills.push({...p.bills[0],id:'b'+i,unit,evidence,kind});
  const r=reconcile(p); assert.equal(r.totals.length,4); assert.equal(r.totals[0].total,20);
});
test('strict inputs, amounts, maximums, unknown properties and retry cycles', () => {
  for(const amount of [-1,0.1,NaN,Number.MAX_SAFE_INTEGER]){const p=copy(normal);p.bills[0].amount=amount;assert.throws(()=>validate(p));}
  const p=copy(normal);p.attempts[0].retryOf='A1';assert.throws(()=>validate(p));
  const q=copy(normal);q.tasks=Array.from({length:41},(_,i)=>({id:'t'+i,outcome:'success'}));assert.throws(()=>validate(q));
  const r=copy(normal);r.secret='never-accept';assert.throws(()=>validate(r));
  const s=copy(normal);s.bills.push({...s.bills[0]});assert.throws(()=>validate(s));
});
