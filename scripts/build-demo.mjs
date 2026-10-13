import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { normal, retry, missing } from './fixtures.mjs';
await mkdir('public', { recursive:true });
await copyFile('src/reconcile.js','public/reconcile.js');
await writeFile('public/examples.json',JSON.stringify({normal,retry,missing},null,2)+'\n');
await copyFile('docs/openapi.json','public/openapi.json');
await import('./build-terms.mjs');
