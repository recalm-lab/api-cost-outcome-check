import { DurableObject } from 'cloudflare:workers';
import { reconcile, LIMITS, InputError } from './reconcile.js';
import { initMeter, recordSuccess, state, saveState, one } from './meter.js';
import { StripeClient, billingConfig, verifyWebhook, validateMeterEvent, BillingError, objectId } from './stripe.js';
import { BillingService } from './billing.js';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
const encoder = new TextEncoder();
async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
async function fingerprint(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))].map(v => v.toString(16).padStart(2, '0')).join('');
}
async function boundedBody(request,limit=LIMITS.bytes) {
  if (!request.body) throw new InputError();
  const reader = request.body.getReader(); const bytes = new Uint8Array(limit); let size = 0; let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { reader.cancel().catch(() => {}); reject(new InputError('timeout')); }, 2000); });
  try {
    return await Promise.race([deadline, (async () => {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        if (size + value.byteLength > limit) { await reader.cancel(); throw new InputError('too_large'); }
        bytes.set(value, size); size += value.byteLength;
      }
      try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, size)); }
      catch { throw new InputError('invalid_utf8'); }
    })()]);
  } finally { clearTimeout(timer); }
}
async function authenticate(request,env){
  if(!env.CREDENTIALS||!env.ACCOUNTS||!/^[A-Za-z0-9_-]{43,128}$/.test(env.FINGERPRINT_SECRET||''))throw new BillingError();
  const auth=request.headers.get('authorization')||'';if(!/^Bearer [A-Za-z0-9_-]{43,128}$/.test(auth))throw new BillingError('unauthorized',401);
  let credential;try{credential=JSON.parse(env.CREDENTIALS)[await hash(auth.slice(7))];}catch{throw new BillingError();}
  if(!credential||credential.enabled!==true||!/^[a-zA-Z0-9_-]{1,64}$/.test(credential.account)||!Number.isFinite(credential.expiresAt)||credential.expiresAt<=Date.now())throw new BillingError('unauthorized',401);
  if(!Number.isSafeInteger(credential.maxMonthlySuccessfulCalls)||credential.maxMonthlySuccessfulCalls<1||credential.maxMonthlySuccessfulCalls>1000)throw new BillingError();
  return credential;
}
function failure(error,ambiguous=false){
  if(error instanceof InputError)return json({error:['too_large','timeout'].includes(error.message)?error.message:'invalid_input'},error.message==='too_large'?413:error.message==='timeout'?408:400);
  if(error instanceof BillingError)return json({error:error.message},error.status);
  return json(ambiguous?{error:'usage_state_unknown',usageStatus:'unknown',retry:'same_idempotency_key_and_identical_body'}:{error:'unavailable'},503);
}
function saleConfigured(env){
  if(env.STRIPE_MODE!=='live'||['API_ENABLED','BILLING_ENABLED','BILLING_VERIFIED'].some(k=>env[k]!=='true'))return false;
  try{
    const config=billingConfig(env);
    if(!env.ACCOUNTS||!/^[A-Za-z0-9_-]{43,128}$/.test(env.FINGERPRINT_SECRET||''))return false;
    const registry=JSON.parse(env.CREDENTIALS);
    if(!registry||Array.isArray(registry)||typeof registry!=='object')return false;
    const entries=Object.entries(registry);
    return entries.length>0&&entries.every(([key,value])=>/^[0-9a-f]{64}$/.test(key)&&value&&typeof value.enabled==='boolean'&&Number.isFinite(value.expiresAt)&&Number.isSafeInteger(value.maxMonthlySuccessfulCalls)&&value.maxMonthlySuccessfulCalls>=1&&value.maxMonthlySuccessfulCalls<=1000&&/^[A-Za-z0-9_-]{1,64}$/.test(value.account)&&Object.hasOwn(config.accounts,value.account));
  }catch{return false;}
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path==='/health'&&['GET','HEAD'].includes(request.method)){
      const saleActive=saleConfigured(env);
      const body={status:env.STRIPE_MODE==='test'?'sandbox':saleActive?'live_enabled':'preparing',stripeMode:['test','live'].includes(env.STRIPE_MODE)?env.STRIPE_MODE:'unconfigured',apiEnabled:env.API_ENABLED==='true',billingEnabled:env.BILLING_ENABLED==='true',billingVerified:env.BILLING_VERIFIED==='true',saleActive};
      return request.method==='HEAD'?new Response(null,{status:200,headers:{'cache-control':'no-store'}}):json(body);
    }
    if(!path.startsWith('/v1/')){if(['GET','HEAD'].includes(request.method)&&env.ASSETS)return env.ASSETS.fetch(request);return json({error:'not_found'},404);}
    const allowed=['/v1/check','/v1/checkout','/v1/cancel','/v1/billing','/v1/stripe/webhook','/v1/stripe/meter-webhook'];if(!allowed.includes(path))return json({error:'not_found'},404);
    if(request.method!==(path==='/v1/billing'?'GET':'POST'))return json({error:'method_not_allowed'},405);
    let dispatched=false;
    try{
      const config=billingConfig(env);
      if(['/v1/stripe/webhook','/v1/stripe/meter-webhook'].includes(path)){
        if(!env.ACCOUNTS)throw new BillingError();
        const thin=path==='/v1/stripe/meter-webhook';
        const text=await boundedBody(request,65536),event=await verifyWebhook(text,request.headers.get('stripe-signature'),thin?env.STRIPE_METER_WEBHOOK_SECRET:env.STRIPE_WEBHOOK_SECRET,undefined,thin?'thin':'snapshot');
        if(thin)validateMeterEvent(event,config.meterId);
        if(event.livemode!==config.livemode)throw new BillingError('mode_mismatch',400);
        const customer=thin?null:objectId(event.data.object.customer);
        const matched=thin?Object.keys(config.accounts):Object.keys(config.accounts).filter(a=>config.accounts[a].customerId===customer);
        for(const account of matched){const stub=env.ACCOUNTS.get(env.ACCOUNTS.idFromName(account));const response=await stub.fetch('https://internal/webhook',{method:'POST',body:JSON.stringify(event),headers:{'x-account':account}});if(!response.ok)return json({error:'billing_sync_pending'},503);}
        return json({received:true});
      }
      if(['/v1/check','/v1/checkout'].includes(path)&&env.API_ENABLED!=='true')throw new BillingError('not_available');
      const credential=await authenticate(request,env);if(!config.accounts[credential.account])throw new BillingError('billing_account_missing');
      let body='',idem='';
      if(request.method==='POST'){
        if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||request.headers.has('content-encoding'))throw new BillingError('unsupported_media_type',415);
        body=await boundedBody(request,path==='/v1/check'?LIMITS.bytes:1024);
        if(['/v1/check','/v1/checkout'].includes(path)){const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,128}$/.test(key))throw new BillingError('invalid_idempotency_key',400);idem=await fingerprint(env.FINGERPRINT_SECRET,'id:'+key);}
        if(path==='/v1/checkout'){let consent;try{consent=JSON.parse(body);}catch{throw new InputError();}if(!consent||Object.keys(consent).length!==1||consent.termsVersion!==env.TERMS_VERSION)throw new InputError();}
        if(path==='/v1/cancel'){let input;try{input=JSON.parse(body);}catch{throw new InputError();}if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).length)throw new InputError();}
      }
      const stub=env.ACCOUNTS.get(env.ACCOUNTS.idFromName(credential.account));dispatched=true;
      return await stub.fetch('https://internal'+path.replace('/v1',''),{method:request.method, ...(request.method==='POST'?{body}:{}),headers:{'x-account':credential.account,'x-idempotency':idem,'x-cap':String(credential.maxMonthlySuccessfulCalls)}});
    }catch(error){return failure(error,dispatched&&path==='/v1/check');}
  }
};
export class AccountMeter extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.storage=ctx.storage;this.env=env;this.ctx=ctx;this.queue=Promise.resolve();initMeter(this.storage);}
  exclusive(fn){const work=this.queue.then(fn);this.queue=work.catch(()=>{});return work;}
  service(account){
    const client=new StripeClient(this.env),c=client.config;
    if(!account||!c.accounts[account]||this.env.ACCOUNTS.idFromName(account).toString()!==this.ctx.id.toString())throw new BillingError('billing_account_mismatch');
    const b=state(this.storage);if(b.account&&b.account!==account||b.customerId&&b.customerId!==c.accounts[account].customerId||b.priceId&&b.priceId!==c.priceId||b.meterId&&b.meterId!==c.meterId||b.mode&&b.mode!==c.mode||b.stripeAccountId&&b.stripeAccountId!==c.accountId)throw new BillingError('billing_configuration_changed');
    if(!b.account)saveState(this.storage,{...b,account});
    return new BillingService(this.storage,client,c.accounts[account].customerId);
  }
  async schedule(service){if(service.needsAlarm()&&!await this.storage.getAlarm())await this.storage.setAlarm(Date.now()+15000);}
  async fetch(request){return this.exclusive(async()=>{
    try{
      const service=this.service(request.headers.get('x-account')),path=new URL(request.url).pathname;
      if(path==='/webhook'){await service.webhook(JSON.parse(await request.text()));await this.schedule(service);return json({received:true});}
      if(path==='/checkout'){const body=await request.text();const result=await service.checkout(request.headers.get('x-idempotency'),await fingerprint(this.env.FINGERPRINT_SECRET,'checkout:'+body));return json(result);}
      if(path==='/cancel'){const result=service.requestCancel();await this.schedule(service);return json(result,202);}
      if(path==='/billing')return json(await service.billingStatus());
      if(path!=='/check')return json({error:'not_found'},404);
      const text=await request.text();if(encoder.encode(text).length>LIMITS.bytes)return json({error:'too_large'},413);
      const result=reconcile(JSON.parse(text)),digest=await fingerprint(this.env.FINGERPRINT_SECRET,'v1:'+text);
      const now=Math.floor(Date.now()/1000);
      const b=state(this.storage);if(!one(this.storage,'SELECT id FROM calls WHERE id=?',request.headers.get('x-idempotency'))&&b.subscriptionId&&b.checkedUntil<=now&&!b.cancelRequested&&!b.collectionHold)await service.refreshSubscription(b.subscriptionId);
      const receipt=recordSuccess(this.storage,request.headers.get('x-idempotency'),digest,Number(request.headers.get('x-cap')),new Date(now*1000).toISOString().slice(0,7),now,'rc_'+await fingerprint(this.env.FINGERPRINT_SECRET,'meter:'+request.headers.get('x-account')+':'+request.headers.get('x-idempotency')));
      if(receipt.status!==200)return json({error:receipt.status===409?'idempotency_conflict':receipt.status===429?'usage_limit':'billing_hold'},receipt.status);
      // Commit precedes response; RPC/connection failure can leave receipt status unknown to client.
      await this.schedule(service);
      return json({result,usage:{billableCalls:receipt.replay?0:1,replay:receipt.replay,successfulCalls:receipt.count,successfulCallsThisMonth:receipt.monthlyCount,outstandingJpy:receipt.outstanding,unitPrice:{amount:1,unit:'money:JPY:0',taxInclusive:true},paymentCollected:false}});
    }catch(error){if(error instanceof InputError||error instanceof SyntaxError)return json({error:'invalid_input'},400);return failure(error,true);}
  });}
  async alarm(){return this.exclusive(async()=>{let service;try{service=this.service(state(this.storage).account);await service.tick();}catch(error){if(service)service.hold(error instanceof BillingError?error.message:'billing_hold');}finally{if(service)await this.schedule(service);}});}
}
