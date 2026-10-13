import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const TARGET = Object.freeze({
  base: 'https://recalm-api-cost-check.rough-sound-e8d7.workers.dev',
  account: 'sandbox-e2e-20261013', customer: 'cus_VQrJWHFdsVqzJG',
  stripeAccount: 'acct_1TqptzD1AvIZkMfK',
  price: 'price_1UPwToD1AvIZkMfK9yFCs9xN',
  meter: 'mtr_test_61VZKPnRudfS37Kdz41D1AvIZkMfK1J2',
  terms: '2026-10-13', checkoutKey: 'sandbox-checkout-v1-20261013'
});
const fail = () => {throw new Error('sandbox_lifecycle_failed');};
export function safeFailure(body) {
  const allowed=new Set(['billing_unavailable','account_mismatch','catalog_mismatch','customer_not_dedicated','stripe_retryable','stripe_rate_limited','stripe_upstream_unavailable','stripe_transport_error','stripe_invalid_json','stripe_rejected','checkout_mismatch','checkout_window_closed','checkout_delivery_unknown','checkout_pending','checkout_capacity','existing_contract','manual_reconciliation_required','billing_configuration_changed','billing_account_missing','unauthorized','not_available','invalid_input','invalid_idempotency_key','unsupported_media_type','timeout','unavailable']);
  return body && typeof body==='object' && !Array.isArray(body) && Object.hasOwn(body,'error') && allowed.has(body.error) ? body.error : 'unclassified';
}
export function validateContext(vars, account) {
  if(account!==TARGET.account || vars.STRIPE_MODE!=='test' || vars.STRIPE_ACCOUNT_ID!==TARGET.stripeAccount || vars.PUBLIC_BASE_URL!==TARGET.base || vars.STRIPE_PRICE_ID!==TARGET.price || vars.STRIPE_METER_ID!==TARGET.meter || vars.TERMS_VERSION!==TARGET.terms || vars.BILLING_VERIFIED!=='false')fail();
}
export function validateHealth(h, action) {
  if(h.status!=='sandbox'||h.stripeMode!=='test'||h.saleActive!==false||h.billingVerified!==false||typeof h.apiEnabled!=='boolean'||typeof h.billingEnabled!=='boolean')fail();
  if(action==='checkout' && (!h.apiEnabled||!h.billingEnabled))fail();
}
export function safeStatus(b) {
  const out={};
  for(const k of ['outstandingJpy','collectedJpy','waivedJpy']) {if(!Number.isSafeInteger(b[k])||b[k]<0)fail();out[k]=b[k];}
  for(const k of ['active','cancelRequested','hold','manualReconciliationRequired']) {if(typeof b[k]!=='boolean')fail();out[k]=b[k];}
  if(b.billingTimezone!=='UTC')fail();out.billingTimezone='UTC';return out;
}
export function validateCheckout(b, now=Math.floor(Date.now()/1000)) {
  let u;try{u=new URL(b.checkoutUrl);}catch{fail();}
  if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com'||u.port||u.username||u.password||u.search||!/^\/c\/pay\/cs_test_[A-Za-z0-9_]+$/.test(u.pathname)||u.href.length>4096||!Number.isSafeInteger(b.expiresAt)||b.expiresAt<=now||b.expiresAt>now+3600)fail();
  return {checkoutUrl:u.href,expiresAt:b.expiresAt};
}
// No retries: an ambiguous POST must be inspected, never assigned a new nonce.
// All checkout runs use the same logical idempotency key and identical body.
export async function execute(action, {key, account=TARGET.account, vars, fetchImpl=fetch, now}={}) {
  if(!['checkout','status','cancel'].includes(action)||!/^[A-Za-z0-9_-]{43,128}$/.test(key||''))fail();
  validateContext(vars,account);
  const request=async(path,method='GET',body,authenticated=true,idem=false)=>{
    const headers={accept:'application/json'};
    if(authenticated)headers.authorization='Bearer '+key;
    if(body!==undefined)headers['content-type']='application/json';
    if(idem)headers['idempotency-key']=TARGET.checkoutKey;
    let r;try{r=await fetchImpl(TARGET.base+path,{method,headers,redirect:'error',signal:AbortSignal.timeout(15000),...(body===undefined?{}:{body:JSON.stringify(body)})});}catch{fail();}
    console.log(JSON.stringify({action,path,httpStatus:r.status}));
    if(!r.ok){
      let code='unclassified';try{const text=await r.text();if(text.length<=4096)code=safeFailure(JSON.parse(text));}catch{}
      console.log(JSON.stringify({action,path,httpStatus:r.status,errorCode:code}));fail();
    }
    let t;try{t=await r.text();}catch{fail();}
    if(t.length>16384)fail();let b;try{b=JSON.parse(t);}catch{fail();}
    if(!b||Array.isArray(b)||typeof b!=='object')fail();return b;
  };
  validateHealth(await request('/health','GET',undefined,false),action);
  const before=safeStatus(await request('/v1/billing'));
  if(action==='status')return {status:before};
  if(action==='checkout'){
    // Initial collectionHold=true is normal before Checkout. Manual hold still stops.
    // Server checkout remains authoritative for existing subscriptions and dedicated customer.
    if(before.active||before.cancelRequested||before.manualReconciliationRequired||before.outstandingJpy!==0)fail();
    const checkout=validateCheckout(await request('/v1/checkout','POST',{termsVersion:TARGET.terms},true,true),now);
    return {status:before,checkout};
  }
  if(before.manualReconciliationRequired)fail();
  const b=await request('/v1/cancel','POST',{});
  // Cancellation is asynchronous. Report only acknowledgement; poll status separately.
  if(b.cancelRequested!==true)fail();return {cancelRequested:true};
}
async function main(){
  try{
    if(process.env.RECALM_SANDBOX_E2E!=='true')fail();
    const vars=JSON.parse(readFileSync(new URL('../deploy/sandbox-vars.json',import.meta.url),'utf8'));
    const result=await execute(process.argv[2],{key:process.env.RECALM_TEST_API_KEY,account:process.env.RECALM_SANDBOX_ACCOUNT,vars});
    if(result.checkout){
      // Public repository: never write the capability URL to logs, summary or artifact.
      // The authorized operator retrieves the session link directly in Stripe Dashboard.
      console.log(JSON.stringify({action:'checkout',checkoutReady:true,expiresAt:result.checkout.expiresAt}));
    }else console.log(JSON.stringify(result));
  }catch{console.error('Sandbox lifecycle failed; state preserved. Inspect HTTP status; do not change the checkout nonce or key scopes.');process.exitCode=1;}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await main();
