import {subscription,testTermsDocuments} from './helpers.js';
export const webhookSecret='whsec_synthetic_only_not_a_real_secret';
export const billingEnv={BILLING_ENABLED:'true',BILLING_VERIFIED:'true',STRIPE_MODE:'test',STRIPE_RESTRICTED_KEY:'rk_test_synthetic_only_not_a_real_key',STRIPE_WEBHOOK_SECRET:webhookSecret,STRIPE_METER_WEBHOOK_SECRET:'whsec_synthetic_meter_only_not_a_real_secret',STRIPE_ACCOUNT_ID:'acct_test',STRIPE_PRICE_ID:'price_test',STRIPE_METER_ID:'mtr_test',STRIPE_EVENT_NAME:'recalm_api_cost_check_success_v1',TERMS_VERSION:'2026-10-13',PUBLIC_BASE_URL:'https://example.test',BILLING_ACCOUNTS:JSON.stringify({'test-account':{customerId:'cus_test'},'other-account':{customerId:'cus_other'}})};
billingEnv.TERMS_DOCUMENTS=JSON.stringify(testTermsDocuments);
export function stripeMock(){const calls=[],accepted=new Set(),sessions=new Map();return {calls,accepted,fetch:async request=>{
 const url=new URL(request.url),path=url.pathname,params=new URLSearchParams(await request.text());calls.push({method:request.method,path,params:Object.fromEntries(params)});
 const now=new Date(),period=now.toISOString().slice(0,7);
 const sub=customer=>({...subscription(period),id:customer==='cus_other'?'sub_other':'sub_test',customer});
 const session=customer=>({id:customer==='cus_other'?'cs_other':'cs_test',mode:'subscription',customer,livemode:false,url:'https://checkout.stripe.com/c/pay/'+customer,status:'complete',payment_status:'no_payment_required',subscription:sub(customer).id});
 let body;
 if(path==='/v1/account')body={id:'acct_test',charges_enabled:true,payouts_enabled:true};
 else if(path==='/v1/prices/price_test')body={...sub('cus_test').items.data[0].price,livemode:false,active:true,product:{active:true}};
 else if(path==='/v1/billing/meters/mtr_test')body={id:'mtr_test',livemode:false,status:'active',event_name:billingEnv.STRIPE_EVENT_NAME,default_aggregation:{formula:'sum'},customer_mapping:{type:'by_id',event_payload_key:'stripe_customer_id'},value_settings:{event_payload_key:'value'},event_time_window:null};
 else if(path==='/v1/subscriptions'||path==='/v1/invoices')body={data:[],has_more:false};
 else if(path==='/v1/subscriptions/sub_test'||path==='/v1/subscriptions/sub_other')body=sub(path.endsWith('sub_other')?'cus_other':'cus_test');
 else if(path==='/v1/customers/cus_test'||path==='/v1/customers/cus_other')body={id:path.split('/').at(-1),livemode:false,balance:0,currency:'jpy',cash_balance:null};
 else if(path==='/v1/checkout/sessions'&&request.method==='POST'){
  body={...session(params.get('customer')),created:Math.floor(Date.now()/1000),expires_at:Number(params.get('expires_at')),metadata:{terms_version:params.get('metadata[terms_version]'),terms_sha256:params.get('metadata[terms_sha256]')},consent_collection:{terms_of_service:params.get('consent_collection[terms_of_service]')},consent:{terms_of_service:'accepted'}};sessions.set(body.id,body);
 }
 else if(path==='/v1/checkout/sessions/cs_test'||path==='/v1/checkout/sessions/cs_other')body=sessions.get(path.split('/').at(-1));
 else if(path==='/v1/billing/meter_events'){accepted.add(params.get('identifier'));body={identifier:params.get('identifier'),event_name:params.get('event_name'),livemode:false,payload:{stripe_customer_id:params.get('payload[stripe_customer_id]'),value:params.get('payload[value]')},timestamp:Number(params.get('timestamp'))};}
 else return Response.json({error:'unexpected_mock_endpoint'},{status:400});
 return Response.json(body);
}};}
