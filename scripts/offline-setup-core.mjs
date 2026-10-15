// Pure local Web Crypto only. No storage, network, logging or automatic invocation.
export const SETUP_ACCOUNT='sandbox-e2e-20261013';
export const SETUP_CUSTOMER='cus_VQrJWHFdsVqzJG';
export const MAX_LIFETIME_MS=24*60*60*1000;
export async function prepareLocalSetup(cryptoApi,now){
 if(!cryptoApi?.getRandomValues||!cryptoApi?.subtle?.digest||!Number.isSafeInteger(now)||now<0)throw new Error('local_crypto_or_clock_unavailable');
 const encode=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
 const first=new Uint8Array(32),second=new Uint8Array(32);cryptoApi.getRandomValues(first);cryptoApi.getRandomValues(second);
 const testKey=encode(first),fingerprint=encode(second);first.fill(0);second.fill(0);
 if(testKey===fingerprint)throw new Error('random_values_not_distinct');
 const digest=await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(testKey));
 const hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
 const expiresAt=now+MAX_LIFETIME_MS;if(!Number.isSafeInteger(expiresAt))throw new Error('invalid_expiry');
 const credentials=JSON.stringify({[hash]:{account:SETUP_ACCOUNT,enabled:true,expiresAt,maxMonthlySuccessfulCalls:1000}},null,2);
 return {testKey,fingerprint,credentials,expiresAt};
}
export function customerMapping(id){
 if(typeof id!=='string'||!/^cus_[A-Za-z0-9]+$/.test(id))throw new Error('customer_id_required');
 return JSON.stringify({[SETUP_ACCOUNT]:{customerId:id}},null,2);
}
