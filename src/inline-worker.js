// Packaging fallback for a Worker-scoped token: same API/DO, static assets inline.
// Route/domain resources are neither queried nor changed by its uploader.
import api,{AccountMeter} from './worker.js';
import demo from '../public/dashboard-demo-worker.js';
export {AccountMeter};
export default {fetch(request,env,ctx){const path=new URL(request.url).pathname;return path==='/health'||path.startsWith('/v1/')||path.startsWith('/terms/')?api.fetch(request,env,ctx):demo.fetch(request);}};
