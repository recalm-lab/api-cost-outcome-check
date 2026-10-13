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
for(const [operation,path]of paths){try{const r=await fetch('https://api.cloudflare.com/client/v4'+path,{headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(10000),redirect:'error'});let codes=[];if(!r.ok){try{const b=await r.json();codes=(b.errors||[]).map(e=>e.code).filter(Number.isSafeInteger);}catch{}}results.push({operation,status:r.status,errorCodes:codes});}catch{results.push({operation,status:'unreachable'});}}
console.log(JSON.stringify({worker,readOnly:true,results}));
