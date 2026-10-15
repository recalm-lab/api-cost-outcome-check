import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {prepareLocalSetup,customerMapping,SETUP_ACCOUNT,SETUP_CUSTOMER,MAX_LIFETIME_MS} from '../scripts/offline-setup-core.mjs';
// Fixed public synthetic bytes: never use actual randomness or issue/store a key in these tests.
const syntheticCrypto=()=>{let n=0;return {getRandomValues(bytes){bytes.fill(n++);return bytes;},subtle:webcrypto.subtle};};
test('offline helper derives registry from synthetic bytes and numeric expiry exactly 24h',async()=>{
 const now=1791878400000,data=await prepareLocalSetup(syntheticCrypto(),now);
 assert.match(data.testKey,/^[A-Za-z0-9_-]{43}$/);assert.match(data.fingerprint,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(data.testKey,data.fingerprint);
 const entries=Object.entries(JSON.parse(data.credentials));assert.equal(entries.length,1);const [hash,c]=entries[0];assert.equal(hash,createHash('sha256').update(data.testKey).digest('hex'));assert.equal(c.account,SETUP_ACCOUNT);assert.equal(c.expiresAt,now+24*60*60*1000);assert.equal(typeof c.expiresAt,'number');assert.equal(c.maxMonthlySuccessfulCalls,1000);assert.equal(c.enabled,true);assert.equal(MAX_LIFETIME_MS,24*60*60*1000);
 assert.ok(!data.credentials.includes(data.testKey));assert.ok(!data.credentials.includes(data.fingerprint));assert.equal(data.expiresAt,c.expiresAt);
});
test('no weak randomness fallback and invalid clock/customer inputs are refused',async()=>{
 await assert.rejects(()=>prepareLocalSetup({},0));await assert.rejects(()=>prepareLocalSetup(syntheticCrypto(),NaN));await assert.rejects(()=>prepareLocalSetup(syntheticCrypto(),Number.MAX_SAFE_INTEGER));
 const same={getRandomValues(bytes){bytes.fill(0);return bytes;},subtle:webcrypto.subtle};await assert.rejects(()=>prepareLocalSetup(same,1));
 assert.deepEqual(JSON.parse(customerMapping(SETUP_CUSTOMER)),{[SETUP_ACCOUNT]:{customerId:'cus_VQrJWHFdsVqzJG'}});for(const id of ['',null,'https://example.test','cus_bad/value','cus_bad;'])assert.throws(()=>customerMapping(id));
});
test('single local HTML has correct CSP hashes, no external code/network/storage/logging, and no auto-generation',async()=>{
 const html=await readFile('tools/offline-sandbox-setup.html','utf8');const js=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1],css=html.match(/<style>([\s\S]*?)<\/style>/)[1];
 assert.ok(html.includes("script-src 'sha256-"+createHash('sha256').update(js).digest('base64')+"'"));assert.ok(html.includes("style-src 'sha256-"+createHash('sha256').update(css).digest('base64')+"'"));assert.ok(html.includes("connect-src 'none'"));assert.ok(html.includes("form-action 'none'"));
 assert.ok(!/<script[^>]*src=/.test(html));assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|console)\b/.test(js));assert.ok(!/\.cookie\b|Math\.random/.test(js));
 assert.ok(js.includes("location.protocol==='file:'"));assert.ok(js.includes("generate.addEventListener('click'"));assert.equal(js.match(/await prepareLocalSetup\(/g).length,1);assert.ok(js.includes('ticket!==generationEpoch'));assert.ok(html.includes('type="password"'));assert.ok(html.includes('RECALM_TEST_API_KEY'));assert.ok(html.includes('FINGERPRINT_SECRET'));assert.ok(html.includes('CREDENTIALS'));assert.ok(html.includes('BILLING_ACCOUNTS'));
});
test('browser UI stays idle until user click, copies locally, and clears without regeneration',async()=>{
 const {runInNewContext}=await import('node:vm');const html=await readFile('tools/offline-sandbox-setup.html','utf8'),js=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/\bexport\s+/g,'');
 const makeElement=()=>({value:'',textContent:'',disabled:false,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}});
 async function browser(protocol){
  const elements=Object.fromEntries(['status','generate','clear','test-key','fingerprint','registry','mapping','expires','customer'].map(id=>[id,makeElement()]));
  const buttons=['test-key','fingerprint','registry','mapping'].map(id=>({...makeElement(),dataset:{copy:id,destination:'safe local target'}}));const copied=[];let rngCalls=0;
  const cryptoApi={getRandomValues(bytes){bytes.fill(rngCalls++);return bytes;},subtle:webcrypto.subtle};
  const doc={getElementById:id=>elements[id],querySelectorAll:()=>buttons,querySelector:selector=>buttons.find(b=>selector.includes('"'+b.dataset.copy+'"')),createElement:()=>({...makeElement(),setAttribute(){},select(){},remove(){}}),body:{append(){}},execCommand:()=>false};
  runInNewContext(js,{document:doc,location:{protocol},navigator:{clipboard:{async writeText(value){copied.push(value);}}},crypto:cryptoApi,Date,Uint8Array,TextEncoder,btoa,addEventListener(){}},{timeout:1000});
  return {elements,buttons,copied,rng:()=>rngCalls};
 }
 const local=await browser('file:');assert.equal(local.rng(),0);assert.equal(local.elements['test-key'].value,'');await local.elements.generate.listeners.click();assert.equal(local.rng(),2);assert.match(local.elements['test-key'].value,/^[A-Za-z0-9_-]{43}$/);assert.ok(local.elements.mapping.value.includes(SETUP_CUSTOMER));
 await local.buttons[0].listeners.click();assert.equal(local.copied.length,1);assert.equal(local.copied[0],local.elements['test-key'].value);assert.ok(!local.elements.status.textContent.includes(local.copied[0]));
 local.elements.clear.listeners.click();for(const id of ['test-key','fingerprint','registry','mapping'])assert.equal(local.elements[id].value,'');assert.ok(local.buttons.every(b=>b.disabled));await local.elements.generate.listeners.click();assert.equal(local.rng(),2);
 const remote=await browser('https:');assert.equal(remote.elements.generate.disabled,true);await remote.elements.generate.listeners.click();assert.equal(remote.rng(),0);
});
