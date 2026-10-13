import { reconcile } from './reconcile.js';
const examples = await (await fetch('./examples.json')).json();
const selection=document.getElementById('example');
const run=()=>{const input=examples[selection.value];document.getElementById('input').textContent=JSON.stringify(input,null,2);document.getElementById('result').textContent=JSON.stringify(reconcile(input),null,2);};
selection.addEventListener('change',run); document.getElementById('run').addEventListener('click',run); run();
