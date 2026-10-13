export const STRIPE_VERSION = '2026-08-26.dahlia';
export class BillingError extends Error { constructor(code='billing_unavailable',status=503){super(code);this.status=status;} }
export function billingConfig(env) {
  if(env.BILLING_ENABLED!=='true'||!['true','false'].includes(env.BILLING_VERIFIED)||(env.STRIPE_MODE==='live'&&env.BILLING_VERIFIED!=='true'))throw new BillingError();
  const mode=env.STRIPE_MODE;
  if(!['test','live'].includes(mode)||!new RegExp('^rk_'+mode+'_[A-Za-z0-9_]{16,}$').test(env.STRIPE_RESTRICTED_KEY||'')||!/^whsec_[A-Za-z0-9_]{16,}$/.test(env.STRIPE_WEBHOOK_SECRET||'')||!/^whsec_[A-Za-z0-9_]{16,}$/.test(env.STRIPE_METER_WEBHOOK_SECRET||'')||env.STRIPE_METER_WEBHOOK_SECRET===env.STRIPE_WEBHOOK_SECRET)throw new BillingError();
  if(!/^acct_[A-Za-z0-9]+$/.test(env.STRIPE_ACCOUNT_ID||'')||!/^price_[A-Za-z0-9]+$/.test(env.STRIPE_PRICE_ID||'')||!/^mtr_[A-Za-z0-9_]+$/.test(env.STRIPE_METER_ID||''))throw new BillingError();
  if(env.STRIPE_EVENT_NAME!=='recalm_api_cost_check_success_v1'||env.TERMS_VERSION!=='2026-10-13')throw new BillingError();
  let base;try{base=new URL(env.PUBLIC_BASE_URL);}catch{throw new BillingError();}
  if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new BillingError();
  let accounts;try{accounts=JSON.parse(env.BILLING_ACCOUNTS);}catch{throw new BillingError();}
  if(!accounts||Array.isArray(accounts)||typeof accounts!=='object'||(Object.keys(accounts).length<1||Object.keys(accounts).length>32))throw new BillingError();
  const customers=new Set();for(const [account,c]of Object.entries(accounts)){if(!/^[A-Za-z0-9_-]{1,64}$/.test(account)||!c||Object.keys(c).some(k=>k!=='customerId')||!/^cus_[A-Za-z0-9]+$/.test(c.customerId)||customers.has(c.customerId))throw new BillingError();customers.add(c.customerId);}
  return {mode,livemode:mode==='live',accountId:env.STRIPE_ACCOUNT_ID,priceId:env.STRIPE_PRICE_ID,meterId:env.STRIPE_METER_ID,eventName:env.STRIPE_EVENT_NAME,base:base.origin,accounts};
}
// Small instance-based REST client; no SDK global keys or configurable external host.
export class StripeClient {
  constructor(env,fetcher){this.env=env;this.config=billingConfig(env);this.fetcher=fetcher||(env.STRIPE_MODE==='test'&&env.STRIPE_HTTP?env.STRIPE_HTTP.fetch.bind(env.STRIPE_HTTP):fetch);}
  async request(method,path,params={},key){
    if(!/^\/v1\/[A-Za-z0-9_/?=&%.[\]-]+$/.test(path))throw new BillingError();
    const encoded=new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)]));
    const headers={'authorization':'Bearer '+this.env.STRIPE_RESTRICTED_KEY,'stripe-version':STRIPE_VERSION};if(key)headers['idempotency-key']=key;
    const url='https://api.stripe.com'+path+(method==='GET'&&encoded.size?(path.includes('?')?'&':'?')+encoded:'');
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
    try{
      const response=await this.fetcher(url,{method,headers:{...headers,...(method==='GET'?{}:{'content-type':'application/x-www-form-urlencoded'})},...(method==='GET'?{}:{body:encoded.toString()}),signal:controller.signal});
      if(!response.ok)throw new BillingError(response.status===429||response.status>=500?'stripe_retryable':'stripe_rejected',response.status===429||response.status>=500?503:502);
      const body=await response.json();if(!body||typeof body!=='object')throw new BillingError();return body;
    }catch(error){if(error instanceof BillingError)throw error;throw new BillingError('stripe_retryable');}finally{clearTimeout(timer);}
  }
}
export const METER_EVENTS=['v1.billing.meter.error_report_triggered','v1.billing.meter.no_meter_found'];
export function validateMeterEvent(event,meterId){
  if(event?.object!=='v2.core.event'||!METER_EVENTS.includes(event.type)||event.context!=null||event.account!=null)throw new BillingError('invalid_event',400);
  if(event.type==='v1.billing.meter.error_report_triggered'&&(!event.related_object||event.related_object.id!==meterId||event.related_object.type!=='billing.meter'))throw new BillingError('meter_mismatch',400);
  // Missing/invalid meter cannot safely be attributed: conservatively hold every configured account.
  return event;
}
export async function verifyWebhook(text,header,secret,nowSeconds=Math.floor(Date.now()/1000),format='snapshot') {
  if(typeof header!=='string'||header.length>2048)throw new BillingError('invalid_signature',400);
  const fields=header.split(',').map(p=>p.split('='));const timestamps=fields.filter(([k])=>k==='t');
  if(timestamps.length!==1||!/^\d{1,12}$/.test(timestamps[0][1]))throw new BillingError('invalid_signature',400);
  const t=Number(timestamps[0][1]);if(Math.abs(nowSeconds-t)>300)throw new BillingError('invalid_signature',400);
  const sigs=fields.filter(([k,v])=>k==='v1'&&/^[0-9a-f]{64}$/.test(v)).map(([,v])=>Uint8Array.from(v.match(/../g),x=>parseInt(x,16)));
  const bytes=new TextEncoder();const key=await crypto.subtle.importKey('raw',bytes.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  let valid=false;for(const sig of sigs)valid=(await crypto.subtle.verify('HMAC',key,sig,bytes.encode(t+'.'+text)))||valid;
  if(!valid)throw new BillingError('invalid_signature',400);
  let event;try{event=JSON.parse(text);}catch{throw new BillingError('invalid_event',400);}
  if(!event||!/^evt_[A-Za-z0-9_]{1,150}$/.test(event.id)||typeof event.type!=='string'||typeof event.livemode!=='boolean')throw new BillingError('invalid_event',400);
  if(format==='snapshot'){if(!event.data?.object||event.type.startsWith('v1.billing.meter.')||event.type.startsWith('billing.meter.'))throw new BillingError('invalid_event',400);}
  else if(format!=='thin'||event.object!=='v2.core.event'||!METER_EVENTS.includes(event.type))throw new BillingError('invalid_event',400);
  return event;
}
export const objectId=value=>typeof value==='string'?value:value?.id;
export function utcBoundary(seconds){const d=new Date(seconds*1000);return Number.isSafeInteger(seconds)&&d.getUTCDate()===1&&d.getUTCHours()===0&&d.getUTCMinutes()===0&&d.getUTCSeconds()===0;}
export function nextMonth(nowSeconds){const d=new Date(nowSeconds*1000);return Math.floor(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)/1000);}
export function subscriptionState(sub,customer,config,now) {
  const items=sub.items?.data;
  if(objectId(sub.customer)!==customer||sub.livemode!==config.livemode||!Array.isArray(items)||items.length!==1||sub.items.has_more)throw new BillingError('subscription_mismatch');
  const item=items[0],price=item.price;
  if(price?.id!==config.priceId||price.currency!=='jpy'||price.unit_amount!==1||price.tax_behavior!=='inclusive'||price.recurring?.usage_type!=='metered'||price.recurring.interval!=='month'||price.recurring.interval_count!==1||price.recurring.meter!==config.meterId||sub.collection_method!=='charge_automatically'||sub.automatic_tax?.enabled||sub.discounts?.length||sub.pause_collection||!utcBoundary(sub.billing_cycle_anchor))throw new BillingError('subscription_mismatch');
  const start=item.current_period_start,end=item.current_period_end;
  if(sub.status!=='canceled'&&(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start||!utcBoundary(end)||end!==nextMonth(start)))throw new BillingError('billing_period_mismatch');
  return {subscriptionId:sub.id,periodStart:start,periodEnd:end,active:sub.status==='active'&&!sub.cancel_at_period_end&&!sub.cancel_at&&!sub.pending_update&&!!objectId(sub.default_payment_method)&&start<=now&&now<end,cancelConfirmed:sub.status==='canceled'};
}
