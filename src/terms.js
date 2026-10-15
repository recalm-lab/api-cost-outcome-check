import {BillingError} from './stripe.js';
import {releasedTerms} from './terms-registry.js';
// Documents are explicit configuration, never inferred from a version label or the mutable draft page.
// No real document is approved or published by this module.
export async function verifyTerms(document,mode){
  if(!document||!/^([A-Za-z0-9][A-Za-z0-9._-]{0,63})$/.test(document.version||'')||typeof document.body!=='string'||!document.body.length||new TextEncoder().encode(document.body).length>65536||!/^[0-9a-f]{64}$/.test(document.sha256||'')||!(document.status==='approved'||mode==='test'&&document.status==='test-only'))throw new BillingError('terms_not_configured');
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(document.body)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==document.sha256)throw new BillingError('terms_digest_mismatch');
  return document;
}
export async function configuredTerms(config,version=config.termsVersion){
  let documents;try{documents=config.mode==='live'?releasedTerms:config.mode==='test'?JSON.parse(config.termsDocuments):null;}catch{throw new BillingError('terms_not_configured');}
  if(!documents||Array.isArray(documents)||typeof documents!=='object'||!Object.hasOwn(documents,version))throw new BillingError('terms_not_configured');
  const entry=documents[version];
  if(!entry||Object.keys(entry).some(k=>!['body','sha256','status','url'].includes(k)))throw new BillingError('terms_not_configured');
  const document=await verifyTerms({...entry,version},config.mode);
  let base;try{base=new URL(config.base);}catch{throw new BillingError('terms_not_configured');}
  if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw new BillingError('terms_not_configured');
  const url=base.origin+'/terms/'+encodeURIComponent(version)+'/'+document.sha256+'.html';
  if(document.url!==url)throw new BillingError('terms_url_mismatch');
  return document;
}
