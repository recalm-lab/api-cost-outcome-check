// Existing-Worker, read-only auth diagnostics. Never outputs headers, bodies or secret values.
const account='9a2e48df6882d20c2d1c4398184215a9',worker='recalm-api-cost-check';
if(!process.env.CLOUDFLARE_API_TOKEN){console.log(JSON.stringify({credentialAvailable:false}));process.exit(1);}
const paths=[
 ['service',`/accounts/${account}/workers/services/${worker}`],
 ['bindings',`/accounts/${account}/workers/services/${worker}/environments/production/bindings`],
 ['routes',`/accounts/${account}/workers/services/${worker}/environments/production/routes?show_zonename=true`],
 ['domains',`/accounts/${account}/workers/domains/records?page=0&per_page=5&service=${worker}&environment=production`],
 ['subdomain',`/accounts/${account}/workers/services/${worker}/environments/production/subdomain`],
 ['environment',`/accounts/${account}/workers/services/${worker}/environments/production`],
 ['schedules',`/accounts/${account}/workers/scripts/${worker}/schedules`]
];
const results=[];
for(const [operation,path]of paths){try{const r=await fetch('https://api.cloudflare.com/client/v4'+path,{headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(10000),redirect:'error'});let codes=[],metadata={};if(r.ok&&['service','subdomain','environment'].includes(operation)){const b=await r.json();if(operation==='subdomain')metadata={enabled:b.result?.enabled,previewsEnabled:b.result?.previews_enabled};if(operation==='service')metadata={workerId:b.result?.id,environment:b.result?.default_environment?.environment,lastDeployedFrom:b.result?.default_environment?.script?.last_deployed_from};if(operation==='environment')metadata={lastDeployedFrom:b.result?.script?.last_deployed_from,modifiedOn:b.result?.script?.modified_on};}if(!r.ok){try{const b=await r.json();codes=(b.errors||[]).map(e=>e.code).filter(Number.isSafeInteger);}catch{}}results.push({operation,status:r.status,errorCodes:codes,...metadata});}catch{results.push({operation,status:'unreachable'});}}
console.log(JSON.stringify({worker,readOnly:true,results}));

const publicChecks=[];for(const path of ['/health','/openapi.json']){try{const r=await fetch('https://recalm-api-cost-check.rough-sound-e8d7.workers.dev'+path,{redirect:'error',signal:AbortSignal.timeout(15000)});let metadata={};if(r.ok){try{const b=await r.json();metadata=path==='/health'?{stripeMode:b.stripeMode,apiEnabled:b.apiEnabled,billingEnabled:b.billingEnabled,billingVerified:b.billingVerified,saleActive:b.saleActive}:{openapi:b.openapi,version:b.info?.version};}catch{}}publicChecks.push({path,status:r.status,...metadata});}catch{publicChecks.push({path,status:'unreachable'});}}console.log(JSON.stringify({readOnly:true,publicChecks}));
