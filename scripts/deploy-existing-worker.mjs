// Use only after approved deployment credential injection. Never prints credential values.
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
if(config.name!=='recalm-api-cost-check'||config.account_id!=='9a2e48df6882d20c2d1c4398184215a9'||config.vars.STRIPE_MODE!=='test'||['API_ENABLED','BILLING_ENABLED','BILLING_VERIFIED'].some(k=>config.vars[k]!=='false')||config.exports?.AccountMeter?.storage!=='sqlite'||config.routes||config.route)throw new Error('deployment_target_or_closed_flags_mismatch');
const mode=process.argv[2]||'dry-run';if(!['dry-run','deploy'].includes(mode))throw new Error('Supported actions: dry-run, deploy');
if(mode==='deploy'&&!process.env.CLOUDFLARE_API_TOKEN){console.log('Deployment blocked: approved environment credential not injected. Worker Secret is not the deploy credential input.');process.exit(1);}
const args=['--yes','--cache','/tmp/recalm-npm-cache','wrangler@4.149.0','deploy','--config','wrangler.jsonc'];if(mode==='dry-run')args.push('--dry-run','--outdir','/tmp/recalm-sandbox-ready-build');
const child=spawn('npx',args,{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false',XDG_CONFIG_HOME:'/tmp/recalm-wrangler-config'}});child.on('exit',code=>{process.exitCode=code??1;});
