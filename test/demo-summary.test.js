import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reconcile} from '../src/reconcile.js';
import {normal,retry,missing,duplicate} from '../scripts/fixtures.mjs';

test('four demo selections and buttons render summaries consistent with unchanged JSON',async()=>{
  const examples={normal,retry,missing,duplicate},requests=[];
  const elements=Object.fromEntries(['example','run','overview','input','result'].map(id=>[id,{value:'normal',textContent:'',listeners:{},addEventListener(event,fn){this.listeners[event]=fn;}}]));
  const script=(await readFile('public/demo.js','utf8')).replace("import { reconcile } from './reconcile.js';",'').replace('export function describe','function describe');
  const fetch=async path=>{requests.push(path);assert.equal(path,'./examples.json');return {json:async()=>examples};};
  const execute=new (Object.getPrototypeOf(async function(){}).constructor)('reconcile','document','fetch',script);
  await execute(reconcile,{getElementById:id=>elements[id]},fetch);
  for(const [name,input] of Object.entries(examples)){
    elements.example.value=name;
    elements.example.listeners.change();
    const result=reconcile(input),summary=elements.overview.textContent;
    assert.deepEqual(JSON.parse(elements.result.textContent),result);
    assert.deepEqual(JSON.parse(elements.input.textContent),input);
    assert.match(summary,/分析対象の利用料金/);
    assert.match(summary,/将来のAPI利用料ではありません/);
    elements.run.listeners.click();assert.equal(elements.overview.textContent,summary);
    if(name==='missing'){
      assert.equal(result.totals[0].unknown,100);assert.equal(result.totals[0].costPerSuccessfulTask,null);
      assert.match(summary,/成功 0 件、失敗 0 件、結果不明 3 件/);assert.match(summary,/対応不明 USD 1\.00/);assert.match(summary,/算出不可/);
    }else{
      assert.match(summary,/合計 USD 0\.20/);assert.match(summary,/対応が判明 USD 0\.20/);assert.match(summary,/対応不明 USD 0\.00/);
      if(name==='duplicate'){
        assert.equal(result.totals[0].total,20);assert.equal(result.totals[0].duplicateSuspected,true);assert.equal(result.totals[0].costPerSuccessfulTask,null);
        assert.equal(result.findings.length,2);for(const finding of result.findings)assert.ok(finding.flags.includes('duplicate_suspected'));
        assert.match(summary,/算出不可/);assert.match(summary,/正当な別内訳/);assert.match(summary,/総額から差し引いていません/);
      }else{
        assert.deepEqual(result.totals[0].costPerSuccessfulTask,{numerator:20,denominator:1});assert.match(summary,/成功タスク当たり費用：USD 0\.20/);
        assert.match(summary,/重複がない保証ではありません/);
        if(name==='retry'){assert.match(summary,/失敗した試行 USD 0\.10 と再試行 USD 0\.10/);assert.match(summary,/正当な利用料/);}
      }
    }
  }
  assert.deepEqual(requests,['./examples.json']);
});

test('demo keeps disclosures visible and native keyboard controls with a concise live summary',async()=>{
  const html=await readFile('public/index.html','utf8');
  assert.match(html,/<label for="example">/);assert.equal((html.match(/<option value=/g)||[]).length,4);
  assert.match(html,/<button id="run" type="button">/);
  assert.match(html,/<p id="overview" role="status" aria-live="polite" aria-atomic="true">/);
  assert.ok(html.indexOf('id="overview"')<html.indexOf('<details>'));
  assert.ok(html.indexOf('独立した検証や入力の完全性を保証しません')<html.indexOf('<details>'));
  assert.match(html,/<details><summary>合成入力と照合結果のJSONを見る<\/summary>/);
  assert.doesNotMatch(html,/<(?:form|input|textarea)\b/);
  assert.match(await readFile('public/style.css','utf8'),/:focus-visible/);
});
