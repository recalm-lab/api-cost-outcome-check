// Test-closed code bootstrap; settings must already be test with all flags false.
import {readFile} from 'node:fs/promises';
import {uploadClosed} from './upload-live-closed-worker.mjs';
const [sha,path]=process.argv.slice(2);if(!path)throw Error('reviewed_settings_file_required');
await uploadClosed({sha,expected:JSON.parse(await readFile(path,'utf8')),mode:'test'});
