import {BillingError,objectId, validateMeterEvent, METER_EVENTS,subscriptionState,nextMonth} from './stripe.js';
import {one,state,saveState,contractConsent} from './meter.js';
import {configuredTerms,verifyTerms} from './terms.js';
const rows=(s,sql,...args)=>[...s.sql.exec(sql,...args)];
const retryWindow=23*3600;
const checkoutRecoverable=['checkout_consent_unconfirmed','checkout_mismatch','checkout_confirmation_pending','checkout_payment_pending','stripe_transport_error','stripe_upstream_unavailable','stripe_rate_limited','stripe_invalid_json'];
const initialSessionRetryable=['stripe_transport_error','stripe_upstream_unavailable','stripe_rate_limited','stripe_invalid_json'];
// Only the documented no-currency cash state is eligible for small-invoice carry/waiver.
// Currency maps, including zero balances, remain blocked until lifecycle behavior is verified.
function emptyCashBalance(customer,customerId,livemode){
  if(!customer||Array.isArray(customer)||typeof customer!=='object'||customer.id!==customerId||customer.livemode!==livemode||(customer.deleted!==undefined&&customer.deleted!==false)||!Object.hasOwn(customer,'cash_balance'))return false;
  const cash=customer.cash_balance;
  if(cash===null)return true;
  return !!cash&&typeof cash==='object'&&!Array.isArray(cash)&&cash.object==='cash_balance'&&cash.customer===customerId&&cash.livemode===livemode&&(cash.customer_account===undefined||cash.customer_account===null)&&(cash.deleted===undefined||cash.deleted===false)&&Object.hasOwn(cash,'available')&&cash.available===null;
}
const emptyHistory=list=>!!list&&typeof list==='object'&&!Array.isArray(list)&&Array.isArray(list.data)&&list.data.length===0&&list.has_more===false;
export async function verifyCatalog(client){
    const config=client.config;
    const account=await client.request('GET','/v1/account');if(account.id!==config.accountId||!account.charges_enabled||!account.payouts_enabled)throw new BillingError('account_mismatch');
    const price=await client.request('GET','/v1/prices/'+config.priceId,{'expand[0]':'product'});
    const meter=await client.request('GET','/v1/billing/meters/'+config.meterId);
    if(client.readOnly&&(account.charges_enabled!==true||account.payouts_enabled!==true||price.product?.id!=='recalm_api_cost_check_v1'||price.billing_scheme!=='per_unit'||price.transform_quantity))throw new BillingError('catalog_mismatch');
    if(price.id!==config.priceId||meter.id!==config.meterId||meter.livemode!==config.livemode||price.livemode!==config.livemode||!price.active||!price.product?.active||price.currency!=='jpy'||price.unit_amount!==1||price.tax_behavior!=='inclusive'||price.recurring?.interval!=='month'||price.recurring.interval_count!==1||price.recurring.usage_type!=='metered'||price.recurring.meter!==config.meterId||meter.status!=='active'||meter.event_name!==config.eventName||meter.default_aggregation?.formula!=='sum'||meter.customer_mapping?.event_payload_key!=='stripe_customer_id'||meter.customer_mapping?.type!=='by_id'||meter.value_settings?.event_payload_key!=='value'||meter.event_time_window)throw new BillingError('catalog_mismatch');
  }

export class BillingService {
  constructor(storage,client,customerId,clock=()=>Math.floor(Date.now()/1000)){this.s=storage;this.client=client;this.c=client.config;this.customerId=customerId;this.now=clock;}
  hold(reason='billing_hold',source='billing'){
    const b=state(this.s),preserve=b.collectionHold&&b.holdReason&&!(b.holdSource==='checkout'&&checkoutRecoverable.includes(b.holdReason));
    saveState(this.s,{...b,active:false,collectionHold:true,holdReason:preserve?b.holdReason:reason,holdSource:preserve?(b.holdSource||'billing'):source,requiresManual:b.requiresManual||['meter_delivery_unknown','meter_timestamp_expired','waiver_delivery_unknown','invoice_reconciliation_unknown','meter_error'].includes(reason)});
  }
  async verifyCatalog(){await verifyCatalog(this.client);}
  async storedTerms(version,sha256,url){
    const document=one(this.s,'SELECT * FROM terms_documents WHERE version=?',version||'');
    if(!document||document.sha256!==sha256||document.url!==url)throw new BillingError('terms_snapshot_mismatch');
    await verifyTerms(document,this.c.mode);
    if(document.url!==this.c.base+'/terms/'+encodeURIComponent(version)+'/'+sha256+'.html')throw new BillingError('terms_url_mismatch');
    return document;
  }
  async actionTerms(action){
    if(!action?.termsVersion||!action.termsSha256)throw new BillingError('checkout_consent_unconfirmed');
    const document=await this.storedTerms(action.termsVersion,action.termsSha256,action.termsUrl);
    if(action.params?.['metadata[terms_version]']!==action.termsVersion||action.params?.['metadata[terms_sha256]']!==action.termsSha256||!action.params?.['custom_text[terms_of_service_acceptance][message]']?.includes(']('+action.termsUrl+')'))throw new BillingError('terms_snapshot_mismatch');
    return document;
  }
  async contractTerms(b=state(this.s)){
    const consent=one(this.s,'SELECT * FROM consents WHERE subscriptionId=? AND customerId=?',b.subscriptionId||'',this.customerId);
    if(!consent)throw new BillingError('consent_unconfirmed');
    return this.storedTerms(consent.termsVersion,consent.termsSha256,consent.termsUrl);
  }
  async verifyContract(b=state(this.s)){if(!contractConsent(this.s,b))return false;await this.contractTerms(b);return true;}
  async checkout(key,digest,requestedVersion){
    if(state(this.s).requiresManual)throw new BillingError('manual_reconciliation_required');
    if(state(this.s).cancelRequested)throw new BillingError('existing_contract',409);
    const id='checkout:'+key,old=one(this.s,'SELECT * FROM actions WHERE id=?',id);
    let action=old?JSON.parse(old.data):null;
    if(old&&old.digest!==digest)throw new BillingError('idempotency_conflict',409);
    if(action)await this.actionTerms(action);
    if(action?.status==='complete'){
      if(action.expiresAt<=this.now())throw new BillingError('checkout_expired',409);
      return {checkoutUrl:action.url,expiresAt:action.expiresAt};
    }
    if(action&&this.now()-action.firstAttempt>=retryWindow)throw new BillingError('checkout_delivery_unknown');
    if(action&&action.expiresAt<=this.now())throw new BillingError('checkout_expired',409);
    if(!action){
      if(requestedVersion!==undefined&&requestedVersion!==this.c.termsVersion)throw new BillingError('terms_version_mismatch',400);
      const document=await configuredTerms(this.c);
      if(state(this.s).cancelRequested||state(this.s).subscriptionId||one(this.s,'SELECT outstanding FROM meter WHERE id=1').outstanding!==0)throw new BillingError('existing_contract',409);
      const checkoutActions=rows(this.s,"SELECT data FROM actions WHERE id LIKE 'checkout:%' LIMIT 21");if(checkoutActions.length>=20)throw new BillingError('checkout_capacity');
      if(checkoutActions.some(r=>JSON.parse(r.data).expiresAt>this.now()))throw new BillingError('checkout_pending',409);
      await this.verifyCatalog();
      const customer=await this.client.request('GET','/v1/customers/'+this.customerId,{'expand[0]':'cash_balance'});
      const subs=await this.client.request('GET','/v1/subscriptions',{customer:this.customerId,status:'all',limit:2});
      const invoices=await this.client.request('GET','/v1/invoices',{customer:this.customerId,limit:1});
      if(!emptyCashBalance(customer,this.customerId,this.c.livemode)||customer.balance!==0||(customer.currency&&customer.currency!=='jpy')||!emptyHistory(subs)||!emptyHistory(invoices))throw new BillingError('customer_not_dedicated');
      const anchor=nextMonth(this.now()),expiresAt=Math.min(this.now()+3600,anchor-1);if(expiresAt<this.now()+1800)throw new BillingError('checkout_window_closed');
      const suffix=key.slice(0,8).split('').map(x=>String.fromCharCode(97+(x.charCodeAt(0)%26))).join('');
      action={status:'pending',firstAttempt:this.now(),expiresAt,params:{mode:'subscription',customer:this.customerId,'line_items[0][price]':this.c.priceId,'payment_method_collection':'always','subscription_data[billing_cycle_anchor]':anchor,'subscription_data[billing_mode][type]':'classic','subscription_data[proration_behavior]':'none','consent_collection[terms_of_service]':'required','custom_text[terms_of_service_acceptance][message]':'[利用条件]('+this.c.base+'/terms.html)に同意します。税込1円/成功call、UTC暦月後払い、50円未満繰越、解約時50円未満免除、未精算額を含め1,000円停止。',success_url:this.c.base+'/checkout-result.html',cancel_url:this.c.base+'/','integration_identifier':'recalm-cost-check-'+suffix,expires_at:expiresAt}};
      action.termsVersion=document.version;action.termsUrl=document.url;action.termsSha256=document.sha256;action.params['metadata[terms_version]']=action.termsVersion;action.params['metadata[terms_sha256]']=action.termsSha256;
      action.params['custom_text[terms_of_service_acceptance][message]']=action.params['custom_text[terms_of_service_acceptance][message]'].replace(this.c.base+'/terms.html',document.url);
      this.s.transactionSync(()=>{
        const oldDocument=one(this.s,'SELECT * FROM terms_documents WHERE version=?',document.version);
        if(oldDocument&&(oldDocument.sha256!==document.sha256||oldDocument.body!==document.body||oldDocument.url!==document.url||oldDocument.status!==document.status))throw new BillingError('terms_document_conflict');
        if(!oldDocument)this.s.sql.exec('INSERT INTO terms_documents VALUES (?,?,?,?,?)',document.version,document.sha256,document.body,document.status,document.url);
        saveState(this.s,{...state(this.s),customerId:this.customerId,priceId:this.c.priceId,meterId:this.c.meterId,mode:this.c.mode,stripeAccountId:this.c.accountId});
        this.s.sql.exec('INSERT INTO actions VALUES (?,?,?)',id,digest,JSON.stringify(action));
      });
    }
    const session=await this.client.request('POST','/v1/checkout/sessions',action.params,id);
    if(session.livemode!==this.c.livemode||objectId(session.customer)!==this.customerId||session.mode!=='subscription'||!/^cs_[A-Za-z0-9_]+$/.test(session.id))throw new BillingError('checkout_mismatch');
    let url;try{url=new URL(session.url);}catch{throw new BillingError('checkout_mismatch');}if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw new BillingError('checkout_mismatch');
    action={...action,status:'complete',sessionId:session.id,url:session.url};this.s.sql.exec('UPDATE actions SET data=? WHERE id=?',JSON.stringify(action),id);
    return {checkoutUrl:action.url,expiresAt:action.expiresAt};
  }
  async confirmConsent(session,action){
    await this.actionTerms(action);
    const subscriptionId=objectId(session.subscription);
    if(action.sessionId!==session.id||!/^sub_[A-Za-z0-9_]{1,100}$/.test(subscriptionId||'')||session.mode!=='subscription'||objectId(session.customer)!==this.customerId||session.livemode!==this.c.livemode||session.status!=='complete'||!['paid','no_payment_required'].includes(session.payment_status)||session.consent_collection?.terms_of_service!=='required'||session.consent?.terms_of_service!=='accepted'||session.metadata?.terms_version!==action.termsVersion||session.metadata?.terms_sha256!==action.termsSha256||!Number.isSafeInteger(session.created)||session.created<action.firstAttempt||session.created>=action.expiresAt||session.created>this.now()||session.expires_at!==action.expiresAt)throw new BillingError('checkout_consent_unconfirmed');
    // verifiedAt is our first observation, never a claimed customer click timestamp.
    this.s.transactionSync(()=>{
      const old=one(this.s,'SELECT * FROM consents WHERE subscriptionId=? OR sessionId=?',subscriptionId,session.id);
      if(old&&(old.subscriptionId!==subscriptionId||old.sessionId!==session.id||old.customerId!==this.customerId||old.termsVersion!==action.termsVersion||old.termsSha256!==action.termsSha256||old.termsUrl!==action.termsUrl||old.sessionCreatedAt!==session.created))throw new BillingError('consent_conflict');
      if(!old)this.s.sql.exec('INSERT INTO consents VALUES (?,?,?,?,?,?,?,?)',subscriptionId,session.id,this.customerId,action.termsVersion,action.termsUrl,session.created,this.now(),action.termsSha256);
      saveState(this.s,{...state(this.s),checkoutComplete:true});
    });
  }
  async bindSubscription(id){
    const existing=state(this.s).subscriptionId;if(existing){if(existing!==id)throw new BillingError('subscription_mismatch');return;}
    const actions=rows(this.s,"SELECT data FROM actions WHERE id LIKE 'checkout:%' LIMIT 21");if(actions.length>20)throw new BillingError('checkout_capacity');
    for(const row of actions){
      const a=JSON.parse(row.data);if(!a.sessionId)continue;
      await this.actionTerms(a);
      let session;try{session=await this.client.request('GET','/v1/checkout/sessions/'+a.sessionId);}catch(error){if(error instanceof BillingError&&initialSessionRetryable.includes(error.message))error.initialCheckoutConfirmation=true;throw error;}
      const matches=session.id===a.sessionId&&objectId(session.subscription)===id&&objectId(session.customer)===this.customerId&&session.livemode===this.c.livemode&&session.mode==='subscription';
      if(matches&&['open','complete'].includes(session.status)&&session.payment_status==='unpaid')throw Object.assign(new BillingError('checkout_payment_pending'),{initialCheckoutConfirmation:true});
      if(matches&&session.status==='complete'&&['paid','no_payment_required'].includes(session.payment_status)){
        await this.confirmConsent(session,a);await this.refreshSubscription(id);return;
      }
    }throw new BillingError('checkout_not_confirmed');
  }
  async refreshSubscription(id){
    const sub=await this.client.request('GET','/v1/subscriptions/'+id);
    const latest=subscriptionState(sub,this.customerId,this.c,this.now()),old=state(this.s);
    if(old.subscriptionId&&old.subscriptionId!==sub.id)throw new BillingError('subscription_mismatch');
    const b={...old,...latest,customerId:this.customerId,priceId:this.c.priceId,meterId:this.c.meterId,mode:this.c.mode,stripeAccountId:this.c.accountId,checkedUntil:this.now()+300};
    b.active=b.active&&b.checkoutComplete&&await this.verifyContract(b)&&!this.hasInvoiceHolds()&&!b.collectionHold&&!b.cancelRequested&&!b.cancelConfirmed&&!b.requiresManual;
    saveState(this.s,b);return sub;
  }
  async webhook(event){
    if(one(this.s,'SELECT id FROM webhooks WHERE id=?',event.id))return;
    if(one(this.s,'SELECT COUNT(*) AS count FROM webhooks').count>=100000){this.hold('webhook_capacity');throw new BillingError();}
    if(METER_EVENTS.includes(event.type)){
      validateMeterEvent(event,this.c.meterId);
      this.s.transactionSync(()=>{this.hold('meter_error');this.s.sql.exec('INSERT INTO webhooks VALUES (?,?)',event.id,this.now());});
      return;
    }
    const object=event.data?.object;
    if(!object||event.type.startsWith('billing.meter.'))throw new BillingError('invalid_event',400);
    try{
      const prefix=event.type.startsWith('checkout.session.')?'cs':event.type.startsWith('customer.subscription.')?'sub':event.type.startsWith('invoice.')?'in':null;
      if(prefix&&!new RegExp('^'+prefix+'_[A-Za-z0-9_]{1,100}$').test(object.id||''))throw new BillingError('invalid_event',400);
      if(event.type.startsWith('checkout.session.')){
        const session=await this.client.request('GET','/v1/checkout/sessions/'+object.id);
        const action=rows(this.s,"SELECT data FROM actions WHERE id LIKE 'checkout:%'").map(r=>JSON.parse(r.data)).find(a=>a.sessionId===session.id);
        if(session.id!==object.id||!action||objectId(session.customer)!==this.customerId||session.livemode!==this.c.livemode||session.mode!=='subscription')throw new BillingError('checkout_mismatch');
        if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&session.status==='complete'&&['paid','no_payment_required'].includes(session.payment_status)){
          await this.confirmConsent(session,action);
          const b={...state(this.s),checkoutVerified:true},initialOrCheckout=b.holdReason===undefined||b.holdSource==='checkout'&&checkoutRecoverable.includes(b.holdReason);
          const release=!b.requiresManual&&!b.cancelRequested&&!b.pendingInvoice&&!this.hasInvoiceHolds()&&!one(this.s,"SELECT id FROM invoices WHERE status!='paid' LIMIT 1")&&initialOrCheckout;
          saveState(this.s,release?{...b,collectionHold:false,holdReason:undefined,holdSource:undefined}:b);
          await this.refreshSubscription(objectId(session.subscription));
        }else if(event.type==='checkout.session.async_payment_failed')this.hold('payment_failed');
      }else if(event.type.startsWith('customer.subscription.')){
        await this.bindSubscription(object.id);await this.refreshSubscription(object.id);
      }else if(event.type.startsWith('invoice.')){
        const invoice=await this.client.request('GET','/v1/invoices/'+object.id);
        await this.observeInvoice(invoice,true);
      }
      this.s.sql.exec('INSERT INTO webhooks VALUES (?,?)',event.id,this.now());
    }catch(error){
      const reason=error instanceof BillingError?error.message:event.type.startsWith('checkout.session.')&&!state(this.s).subscriptionId?'checkout_confirmation_pending':'billing_hold';
      const initialSession=event.type.startsWith('customer.subscription.')&&!state(this.s).subscriptionId&&error?.initialCheckoutConfirmation===true;
      const invoiceEvent=event.type.startsWith('invoice.')&&/^in_[A-Za-z0-9_]{1,100}$/.test(object.id||'');
      if(invoiceEvent)this.invoiceHold(object.id,reason);
      this.hold(reason,event.type.startsWith('checkout.session.')||initialSession?'checkout':invoiceEvent?'invoice':'billing');throw error;
    }
  }
  hasInvoiceHolds(){return !!one(this.s,'SELECT id FROM invoice_holds LIMIT 1');}
  invoiceHold(id,reason){this.s.sql.exec("INSERT INTO invoice_holds VALUES (?,?) ON CONFLICT(id) DO UPDATE SET reason=CASE WHEN invoice_holds.reason='collection_pending' THEN excluded.reason ELSE invoice_holds.reason END",id,reason);}
  pendingInvoiceHold(id){
    this.invoiceHold(id,'collection_pending');const b=state(this.s);
    saveState(this.s,{...b,active:false,collectionHold:true,...(!b.holdReason||b.holdSource==='invoice'?{holdReason:'invoice_collection_pending',holdSource:'invoice'}:{})});
  }
  settleInvoiceHold(id){
    // Only a known collection wait for this invoice is automatically resolved.
    this.s.sql.exec("DELETE FROM invoice_holds WHERE id=? AND reason='collection_pending'",id);
    const b=state(this.s),pending=b.pendingInvoice===id?null:b.pendingInvoice,unpaid=!!one(this.s,"SELECT id FROM invoices WHERE status!='paid' LIMIT 1"),remaining=this.hasInvoiceHolds();
    const resolved=b.holdSource==='invoice'&&!remaining&&!unpaid&&!pending;
    saveState(this.s,{...b,pendingInvoice:pending,collectionHold:!!(b.requiresManual||b.cancelRequested||b.cancelConfirmed||remaining||unpaid||pending||!b.checkoutVerified||b.collectionHold&&!resolved),...(resolved?{holdReason:undefined,holdSource:undefined}:{})});
  }
  invoiceScope(invoice){
    const b=state(this.s),sub=objectId(invoice.parent?.subscription_details?.subscription||invoice.subscription);
    if(objectId(invoice.customer)!==this.customerId||invoice.livemode!==this.c.livemode||invoice.currency!=='jpy'||sub!==b.subscriptionId||invoice.collection_method!=='charge_automatically'||invoice.discounts?.length||invoice.automatic_tax?.enabled||invoice.lines?.has_more)throw new BillingError('invoice_mismatch');
    const lines=invoice.lines?.data;if(!Array.isArray(lines)||lines.length>1)throw new BillingError('invoice_mismatch');
    if(invoice.billing_reason==='subscription_create'&&invoice.total===0)return {start:invoice.created,end:invoice.created,expected:0};
    if(lines.length===0&&invoice.total===0&&!one(this.s,'SELECT id FROM calls WHERE invoiceId IS NULL LIMIT 1'))return {start:invoice.created,end:invoice.created,expected:0};
    if(lines.length!==1)throw new BillingError('invoice_mismatch');
    const line=lines[0],price=objectId(line.pricing?.price_details?.price||line.price);
    if(price!==this.c.priceId||!Number.isSafeInteger(line.period?.start)||!Number.isSafeInteger(line.period?.end)||line.period.end<=line.period.start||line.period.end>this.now()||line.discounts?.length||line.discount_amounts?.length)throw new BillingError('invoice_mismatch');
    const expected=one(this.s,'SELECT COUNT(*) AS count FROM calls WHERE createdAt>=? AND createdAt<?',line.period.start,line.period.end).count;
    if(invoice.total!==expected||line.quantity!==expected||line.amount!==expected)throw new BillingError('invoice_usage_pending');
    if(one(this.s,'SELECT id FROM calls WHERE createdAt>=? AND createdAt<? AND invoiceId IS NOT NULL AND invoiceId!=? LIMIT 1',line.period.start,line.period.end,invoice.id))throw new BillingError('invoice_overlap');
    return {start:line.period.start,end:line.period.end,expected};
  }
  async observeInvoice(invoice,trustedWebhook){
    await this.bindSubscription(objectId(invoice.parent?.subscription_details?.subscription||invoice.subscription));
    const b=state(this.s);
    if(objectId(invoice.customer)!==this.customerId||invoice.livemode!==this.c.livemode||invoice.currency!=='jpy')throw new BillingError('invoice_mismatch');
    if(invoice.status==='draft'){
      if(trustedWebhook){await this.client.request('POST','/v1/invoices/'+invoice.id,{auto_advance:false},'pause:'+invoice.id);if(b.pendingInvoice&&b.pendingInvoice!==invoice.id)throw new BillingError('invoice_overlap');this.pendingInvoiceHold(invoice.id);saveState(this.s,{...state(this.s),pendingInvoice:invoice.id,pendingSince:b.pendingInvoice===invoice.id?b.pendingSince:this.now()});}
      return;
    }
    const scope=this.invoiceScope(invoice);
    if(['void','uncollectible'].includes(invoice.status)||invoice.status!=='paid'){this.s.sql.exec('INSERT INTO invoices (id,start,end,status) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status',invoice.id,scope.start,scope.end,invoice.status);this.pendingInvoiceHold(invoice.id);saveState(this.s,{...state(this.s),pendingInvoice:b.pendingInvoice===invoice.id?null:b.pendingInvoice,billingInvoice:invoice.id});if(!b.requiresManual&&b.cancelConfirmed&&invoice.status==='open'&&invoice.auto_advance===false&&invoice.amount_due>=50&&invoice.amount_due<=one(this.s,'SELECT outstanding FROM meter WHERE id=1').outstanding)await this.client.request('POST','/v1/invoices/'+invoice.id,{auto_advance:true},'resume-cancel:'+invoice.id);return;}
    if(!trustedWebhook)return;
    if(!Number.isSafeInteger(invoice.amount_paid)||invoice.amount_paid<0||invoice.amount_remaining!==0||invoice.paid_out_of_band)throw new BillingError('invoice_payment_unknown');
    let collected=0;
    if(invoice.amount_paid>0){
      const payments=await this.client.request('GET','/v1/invoice_payments',{invoice:invoice.id,status:'paid',limit:2});
      if(payments.has_more||!Array.isArray(payments.data)||payments.data.length>2)throw new BillingError('invoice_payment_unknown');
      const ids=new Set();for(const payment of payments.data){
        if(ids.has(payment.id)||objectId(payment.invoice)!==invoice.id||payment.status!=='paid'||payment.currency!=='jpy'||payment.livemode!==this.c.livemode||payment.payment?.type!=='payment_intent'||!/^pi_[A-Za-z0-9]+$/.test(objectId(payment.payment.payment_intent)||'')||!Number.isSafeInteger(payment.amount_paid)||payment.amount_paid<0)throw new BillingError('invoice_payment_unknown');
        ids.add(payment.id);collected+=payment.amount_paid;
      }
      if(collected>invoice.amount_paid)throw new BillingError('invoice_payment_unknown');
    }
    if(collected===0&&(invoice.total>=50||invoice.amount_due>=50||invoice.starting_balance>=50))throw new BillingError('invoice_payment_unknown');
    this.s.transactionSync(()=>{
      const old=one(this.s,'SELECT * FROM invoices WHERE id=?',invoice.id),delta=collected-(old?.paid||0),meter=one(this.s,'SELECT * FROM meter WHERE id=1');
      if(delta<0||delta>meter.outstanding)throw new BillingError('settlement_mismatch');
      const conflict=one(this.s,'SELECT id FROM calls WHERE createdAt>=? AND createdAt<? AND invoiceId IS NOT NULL AND invoiceId!=? LIMIT 1',scope.start,scope.end,invoice.id);if(conflict)throw new BillingError('invoice_overlap');
      this.s.sql.exec("INSERT INTO invoices VALUES (?,?,?,'paid',?) ON CONFLICT(id) DO UPDATE SET status='paid',paid=excluded.paid",invoice.id,scope.start,scope.end,collected);
      this.s.sql.exec('UPDATE calls SET invoiceId=? WHERE createdAt>=? AND createdAt<?',invoice.id,scope.start,scope.end);
      this.s.sql.exec('UPDATE meter SET outstanding=outstanding-?,paid=paid+? WHERE id=1',delta,delta);
      this.settleInvoiceHold(invoice.id);
    });
    if(b.subscriptionId)await this.refreshSubscription(b.subscriptionId);
  }
  async flush(){
    if(state(this.s).requiresManual)return;
    const pending=rows(this.s,"SELECT * FROM calls WHERE sendState IN ('queued','sending') AND nextAttempt<=? ORDER BY createdAt LIMIT 10",this.now());
    for(const row of pending){
      if(row.firstAttempt!==null&&this.now()-row.firstAttempt>=retryWindow){this.s.sql.exec("UPDATE calls SET sendState='hold' WHERE id=?",row.id);this.hold('meter_delivery_unknown');continue;}
      if(this.now()-row.createdAt>34*86400){this.s.sql.exec("UPDATE calls SET sendState='hold' WHERE id=?",row.id);this.hold('meter_timestamp_expired');continue;}
      this.s.sql.exec("UPDATE calls SET sendState='sending',firstAttempt=COALESCE(firstAttempt,?),attempts=attempts+1 WHERE id=?",this.now(),row.id);
      try{
        const event=await this.client.request('POST','/v1/billing/meter_events',{event_name:this.c.eventName,'payload[stripe_customer_id]':this.customerId,'payload[value]':row.unitAmount,identifier:row.eventId,timestamp:row.createdAt},'meter:'+row.eventId);
        if(event.identifier!==row.eventId||event.event_name!==this.c.eventName||event.livemode!==this.c.livemode||event.payload?.stripe_customer_id!==this.customerId||String(event.payload?.value)!=='1')throw new BillingError('meter_ack_mismatch');
        this.s.sql.exec("UPDATE calls SET sendState='sent' WHERE id=?",row.id);
      }catch(error){
        if(error instanceof BillingError&&['stripe_retryable','stripe_rate_limited','stripe_upstream_unavailable','stripe_transport_error','stripe_invalid_json'].includes(error.message))this.s.sql.exec('UPDATE calls SET nextAttempt=? WHERE id=?',this.now()+Math.min(3600,15*2**Math.min(row.attempts,8)),row.id);
        else{this.s.sql.exec("UPDATE calls SET sendState='hold' WHERE id=?",row.id);this.hold('meter_delivery_unknown');}
      }
    }
  }
  async aggregateMatches(start,end,expected){
    const from=Math.floor(start/60)*60,to=Math.ceil(end/60)*60;if(this.now()<to)return false;
    const summary=await this.client.request('GET','/v1/billing/meters/'+this.c.meterId+'/event_summaries',{customer:this.customerId,start_time:from,end_time:to});
    if(summary.has_more||!Array.isArray(summary.data))return false;
    let value=0;for(const row of summary.data){if(row.livemode!==this.c.livemode||objectId(row.meter)!==this.c.meterId||!Number.isSafeInteger(row.aggregated_value)||row.aggregated_value<0)return false;value+=row.aggregated_value;}
    return value===expected;
  }
  async finalizePending(){
    if(state(this.s).requiresManual)return;
    const b=state(this.s);if(!b.pendingInvoice)return;
    if(this.now()-(b.pendingSince||0)>=retryWindow){this.hold('invoice_reconciliation_unknown');saveState(this.s,{...state(this.s),pendingInvoice:null});return;}
    const invoice=await this.client.request('GET','/v1/invoices/'+b.pendingInvoice);
    if(invoice.status!=='draft'){if(invoice.status!=='paid')await this.observeInvoice(invoice,false);return;}
    const scope=this.invoiceScope(invoice);
    if(one(this.s,"SELECT id FROM calls WHERE createdAt>=? AND createdAt<? AND sendState!='sent' LIMIT 1",scope.start,scope.end))return;
    if(!Number.isSafeInteger(invoice.amount_due)||invoice.amount_due<0||invoice.amount_due>1000||invoice.amount_due>one(this.s,'SELECT outstanding FROM meter WHERE id=1').outstanding)throw new BillingError('invoice_amount_mismatch');
    if(scope.expected>0&&!await this.aggregateMatches(scope.start,scope.end,scope.expected))return;
    await this.client.request('POST','/v1/invoices/'+invoice.id+'/finalize',{auto_advance:true},'finalize:'+invoice.id);
  }
  requestCancel(){this.s.transactionSync(()=>{const b=state(this.s);if(!b.subscriptionId&&!one(this.s,"SELECT id FROM actions WHERE id LIKE 'checkout:%' LIMIT 1"))throw new BillingError('no_contract',409);saveState(this.s,{...b,cancelRequested:true,cancelRequestedAt:b.cancelRequestedAt??this.now(),active:false,collectionHold:true});});return {cancelRequested:true,usageStopped:true,settlementPending:true};}
  async cancelAndWaive(){
    if(state(this.s).requiresManual)return;
    let b=state(this.s);if(!b.cancelRequested||!b.subscriptionId)return;
    if(one(this.s,"SELECT id FROM calls WHERE sendState!='sent' LIMIT 1"))return;
    if(one(this.s,'SELECT id FROM calls WHERE createdAt>=? LIMIT 1',this.now()-1))return;
    if(!b.cancelConfirmed){
      if(b.pendingInvoice)return;
      const current=await this.client.request('GET','/v1/subscriptions/'+b.subscriptionId);
      if(current.status==='canceled'){await this.refreshSubscription(b.subscriptionId);return;}
      const cutoff=Math.floor(this.now()/60)*60;
      if(one(this.s,'SELECT id FROM calls WHERE createdAt>=? LIMIT 1',cutoff))return;
      const expected=one(this.s,'SELECT COUNT(*) AS count FROM calls WHERE createdAt>=? AND createdAt<?',b.periodStart,cutoff).count;
      if(expected>0&&!await this.aggregateMatches(b.periodStart,cutoff,expected))return;
      const sub=await this.client.request('DELETE','/v1/subscriptions/'+b.subscriptionId,{invoice_now:true,prorate:false},'cancel:'+b.subscriptionId);if(sub.status!=='canceled')throw new BillingError('cancel_pending');await this.refreshSubscription(b.subscriptionId);return;
    }
    const meter=one(this.s,'SELECT * FROM meter WHERE id=1');if(meter.outstanding===0){saveState(this.s,{...b,waiverDone:true});return;}if(meter.outstanding>=50)return;
    if(one(this.s,'SELECT id FROM calls WHERE invoiceId IS NULL LIMIT 1')||one(this.s,"SELECT id FROM invoices WHERE status!='paid' LIMIT 1")||b.pendingInvoice)return;
    const id='waive:'+b.subscriptionId;
    let action=one(this.s,'SELECT * FROM actions WHERE id=?',id);if(action&&JSON.parse(action.data).status==='done')return;
    // Recheck cash funds even on ambiguous-response retries; the original action/key stays stable.
    const customer=await this.client.request('GET','/v1/customers/'+this.customerId,{'expand[0]':'cash_balance'});
    if(!emptyCashBalance(customer,this.customerId,this.c.livemode)||customer.currency!=='jpy'||(customer.balance!==meter.outstanding&&(!action||customer.balance!==0)))throw new BillingError('waiver_reconciliation_pending');
    if(!action){
      this.s.sql.exec('INSERT INTO actions VALUES (?,?,?)',id,String(meter.outstanding),JSON.stringify({firstAttempt:this.now(),amount:meter.outstanding,status:'pending'}));action=one(this.s,'SELECT * FROM actions WHERE id=?',id);
    }
    const data=JSON.parse(action.data);if(this.now()-data.firstAttempt>=retryWindow)throw new BillingError('waiver_delivery_unknown');
    const tx=await this.client.request('POST','/v1/customers/'+this.customerId+'/balance_transactions',{amount:-data.amount,currency:'jpy',description:'Recalm cancellation: balance below JPY 50 waived'},id);
    if(tx.amount!==-data.amount||tx.currency!=='jpy'||tx.ending_balance!==0)throw new BillingError('waiver_mismatch');
    this.s.transactionSync(()=>{this.s.sql.exec('UPDATE meter SET outstanding=outstanding-?,waived=waived+? WHERE id=1',data.amount,data.amount);this.s.sql.exec('UPDATE actions SET data=? WHERE id=?',JSON.stringify({...data,status:'done',transactionId:tx.id}),id);saveState(this.s,{...state(this.s),waiverDone:true});});
  }
  async billingStatus(){
    const meter=one(this.s,'SELECT * FROM meter WHERE id=1'),b=state(this.s);let paymentUrl=null;
    if(b.billingInvoice&&!b.requiresManual){const invoice=await this.client.request('GET','/v1/invoices/'+b.billingInvoice);this.invoiceScope(invoice);if(invoice.status==='open'&&invoice.hosted_invoice_url){const url=new URL(invoice.hosted_invoice_url);if(url.protocol==='https:'&&url.hostname==='invoice.stripe.com')paymentUrl=url.href;}}
    return {outstandingJpy:meter.outstanding,collectedJpy:meter.paid,waivedJpy:meter.waived,active:!!(b.active&&await this.verifyContract()&&!this.hasInvoiceHolds()&&!b.collectionHold&&!b.requiresManual&&!b.cancelRequested&&b.checkedUntil>this.now()&&b.periodEnd>this.now()),billingTimezone:'UTC',cancelRequested:b.cancelRequested,hold:!!b.collectionHold,manualReconciliationRequired:!!b.requiresManual,paymentUrl};
  }
  async tick(){if(state(this.s).requiresManual)return;await this.flush();await this.finalizePending();await this.cancelAndWaive();}
  needsAlarm(){const b=state(this.s);if(b.requiresManual)return false;return !!one(this.s,"SELECT id FROM calls WHERE sendState IN ('queued','sending') LIMIT 1")||!!b.pendingInvoice||!!(b.cancelRequested&&b.subscriptionId&&!b.cancelConfirmed)||!!(b.cancelConfirmed&&!b.waiverDone&&one(this.s,'SELECT outstanding FROM meter WHERE id=1').outstanding<50);}
}
