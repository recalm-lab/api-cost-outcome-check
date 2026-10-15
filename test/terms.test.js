import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configuredTerms} from '../src/terms.js';
import {releasedTerms} from '../src/terms-registry.js';
import {BillingService} from '../src/billing.js';
import {StripeClient} from '../src/stripe.js';
import {billingEnv,stripeMock} from './stripe-mock.js';
import {initMeter,one,recordSuccess} from '../src/meter.js';
import {storage,ready,config,testTerms,eventId} from './helpers.js';

test('no real terms are released; live ignores environment-supplied approvals and rejects arbitrary versions',async()=>{
 assert.deepEqual(releasedTerms,{});const document=testTerms('test-only-v1');
 await assert.rejects(()=>configuredTerms({...config,mode:'live',termsDocuments:JSON.stringify({'test-only-v1':{...document,status:'approved'}})}),/terms_not_configured/);
 await assert.rejects(()=>configuredTerms(config,'arbitrary-version'),/terms_not_configured/);
});

test('archived document verification rejects modified body or display URL without reading current configured terms',async()=>{
 const s=storage();try{
  ready(s);const service=new BillingService(s,{config:{...config,termsVersion:'missing',termsDocuments:'{}'}},'cus_test');
  assert.equal(await service.verifyContract(),true);const original=one(s,'SELECT * FROM terms_documents');
  s.sql.exec('UPDATE terms_documents SET body=?',original.body+'changed');await assert.rejects(()=>service.verifyContract(),/terms_digest_mismatch/);
  s.sql.exec('UPDATE terms_documents SET body=?,url=?',original.body,'https://example.test/terms.html');await assert.rejects(()=>service.verifyContract(),/terms_snapshot_mismatch/);
 }finally{s.db.close();}
});

test('additive initialization never invents a missing legacy consent digest even when matching document bytes exist',async()=>{
 const s=storage(),now=ready(s);try{
  assert.equal(recordSuccess(s,'existing','body',1000,'2026-10',now,eventId('existing')).status,200);
  s.sql.exec('UPDATE consents SET termsSha256=NULL');initMeter(s);
  assert.equal(one(s,'SELECT termsSha256 FROM consents').termsSha256,null);
  assert.equal(recordSuccess(s,'new','body',1000,'2026-10',now,eventId('new')).status,503);
  assert.equal(recordSuccess(s,'existing','body',1000,'2026-10',now,eventId('existing')).replay,true);
 }finally{s.db.close();}
});

test('document, application and account binding roll back together before any Checkout POST on storage failure',async()=>{
 for(const write of ['INSERT INTO terms_documents ', 'UPDATE billing SET data=', 'INSERT INTO actions ']){
  const s=storage(),mock=stripeMock(),client=new StripeClient(billingEnv,(url,options)=>mock.fetch(new Request(url,options))),original=s.sql.exec;let fail=true;
  s.sql.exec=(sql,...args)=>{const result=original(sql,...args);if(fail&&sql.startsWith(write)){fail=false;throw Error('synthetic_prepare_write_failure');}return result;};
  const service=new BillingService(s,client,'cus_test',()=>Date.parse('2026-10-13T12:00:00Z')/1000);
  try{
   await assert.rejects(()=>service.checkout('test-atomic-terms','digest'),/synthetic_prepare_write_failure/);
   assert.equal(one(s,'SELECT COUNT(*) AS n FROM terms_documents').n,0);assert.equal(one(s,'SELECT COUNT(*) AS n FROM actions').n,0);
   assert.equal(mock.calls.some(c=>c.method==='POST'),false);assert.equal(JSON.parse(one(s,'SELECT data FROM billing').data).customerId,undefined);
   await service.checkout('test-atomic-terms','digest');assert.equal(one(s,'SELECT COUNT(*) AS n FROM terms_documents').n,1);assert.equal(one(s,'SELECT COUNT(*) AS n FROM actions').n,1);assert.equal(mock.calls.filter(c=>c.method==='POST').length,1);
  }finally{s.db.close();}
 }
});
