import { reconcile } from './reconcile.js';
const examples = await (await fetch('./examples.json')).json();
const selection=document.getElementById('example');
export function describe(input,result){
  const money=(amount,unit)=>{const [,currency,places]=unit.split(':');return currency+' '+(amount/10**Number(places)).toFixed(Number(places));};
  const counts=Object.fromEntries(['success','failure','unknown'].map(outcome=>[outcome,input.tasks.filter(t=>t.outcome===outcome).length]));
  const lines=['以下は分析対象の利用料金です。無料デモの料金や将来のAPI利用料ではありません。',`入力されたタスク：成功 ${counts.success} 件、失敗 ${counts.failure} 件、結果不明 ${counts.unknown} 件。`];
  for(const total of result.totals){
    lines.push(`入力された利用料金合計 ${money(total.total,total.unit)} ／ 対応が判明 ${money(total.attributable,total.unit)} ／ 対応不明 ${money(total.unknown,total.unit)}。`);
    const cost=total.costPerSuccessfulTask;
    lines.push('成功タスク当たり費用：'+(cost?money(cost.numerator/cost.denominator,total.unit):'算出不可')+'。');
  }
  const flags=result.findings.flatMap(f=>f.flags);
  if(flags.includes('duplicate_suspected'))lines.push('同じrequest IDに2明細があり、重複の疑いがあります。総額から差し引いていません。過大請求の確定ではなく、正当な別内訳の可能性があります。次に請求元の明細内訳を確認してください。');
  else if(flags.includes('unknown_attribution'))lines.push('USD 1.00の請求に対応する実行記録がありません。成功記録なし・結果不明3件で、失敗3件ではありません。次にrequest IDとタスク結果の記録を確認してください。');
  else if(flags.includes('failed_retry'))lines.push('失敗した試行 USD 0.10 と再試行 USD 0.10 の合計です。失敗費用も正当な利用料の場合があります。次に請求元の課金条件と再試行の必要性を確認してください。');
  else lines.push('入力された成功1件にUSD 0.20が対応しています。次に請求元の記録と成功の根拠を確認してください。');
  if(!flags.includes('duplicate_suspected'))lines.push('この入力では重複疑いを検出していませんが、重複がない保証ではありません。');
  return lines.join('\n\n');
}
const run=()=>{const input=examples[selection.value],result=reconcile(input);document.getElementById('overview').textContent=describe(input,result);document.getElementById('input').textContent=JSON.stringify(input,null,2);document.getElementById('result').textContent=JSON.stringify(result,null,2);};
selection.addEventListener('change',run); document.getElementById('run').addEventListener('click',run); run();
