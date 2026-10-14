import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export function assertCheckout(sha){
 if(!/^[0-9a-f]{40}$/.test(sha||''))throw Error('expected_sha_required');
 try{
  if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==sha)throw Error();
  if(execFileSync('git',['status','--porcelain','--untracked-files=all'],{encoding:'utf8'}).trim())throw Error();
 }catch{throw Error('reviewed_checkout_required');}
}
export function buildReviewedBundle(sha){
 assertCheckout(sha);
 const paths=['src/reconcile.js','src/meter.js','src/stripe.js','src/billing.js','src/worker.js','public/dashboard-demo-worker.js','src/inline-worker.js'];
 const names=Object.fromEntries(paths.map((p,i)=>[p,'__m'+i]));
 const inputs={},chunks=['// Reviewed source commit: '+sha+'\nimport {DurableObject as __DurableObject} from \'cloudflare:workers\';\n'];
 for(const path of paths){
  let source;try{source=execFileSync('git',['show',sha+':'+path],{encoding:'utf8',maxBuffer:2*1024*1024});}catch{throw Error('committed_build_input_missing');}
  inputs[path]=createHash('sha256').update(source).digest('hex');
  const named=[...source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/g)].map(m=>m[1]);
  source=source.replace(/import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"];?/g,(_,clause,target)=>{
   const dependency=target==='cloudflare:workers'?'__external':names[posix.normalize(posix.join(posix.dirname(path),target))];
   if(!dependency||target==='cloudflare:workers'&&clause.trim()!=='{ DurableObject }')throw Error('unreviewed_build_import');
   if(target==='cloudflare:workers')return 'const DurableObject=__DurableObject;';
   clause=clause.trim();if(clause.startsWith('{'))return 'const '+clause+'='+dependency+';';
   const split=clause.indexOf(',');return 'const '+(split<0?clause:clause.slice(0,split))+ '='+dependency+'.default;'+(split<0?'':'const '+clause.slice(split+1)+'='+dependency+';');
  });
  const hasDefault=/export\s+default\s+/.test(source);
  source=source.replace(/export\s+default\s+/,'const __default=').replace(/export\s+(?=(?:async\s+)?(?:function|class|const|let)\s)/g,'');
  source=source.replace(/export\s*\{([^}]+)\};?/g,(_,list)=>{for(const name of list.split(',').map(x=>x.trim())){if(!/^[A-Za-z_$][\w$]*$/.test(name))throw Error('unreviewed_build_export');named.push(name);}return '';});
  chunks.push('const '+names[path]+'=(()=>{\n'+source+'\nreturn {'+[...new Set(named)].join(',')+(hasDefault?(named.length?',':'')+'default:__default':'')+'};\n})();\n');
 }
 chunks.push('export const AccountMeter=__m6.AccountMeter;\nconst __api=__m6.default;\nexport default {async fetch(request,env,ctx){const response=await __api.fetch(request,env,ctx);const headers=new Headers(response.headers);headers.set(\'x-recalm-source-commit\',\''+sha+'\');return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}};\n');
 const bundle=chunks.join(''),bundleSha256=createHash('sha256').update(bundle).digest('hex');
 assertCheckout(sha);
 return {bundle,manifest:{sourceCommit:sha,bundleSha256,inputs}};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const result=buildReviewedBundle(process.argv[2]),output=process.argv[3];
 if(!output)throw Error('fresh_output_path_required');
 await writeFile(output,result.bundle,{flag:'wx'});
 await writeFile(output+'.manifest.json',JSON.stringify(result.manifest,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(result.manifest));
}
