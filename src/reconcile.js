export const LIMITS = Object.freeze({ bytes: 16384, bills: 40, attempts: 40, tasks: 40 });
export class InputError extends Error {}
const fail = () => { throw new InputError('invalid_input'); };
const obj = (v, keys) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) fail();
};
const id = v => { if (typeof v !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(v)) fail(); return v; };
const choice = (v, allowed) => { if (!allowed.includes(v)) fail(); return v; };
const rows = (v, max) => { if (!Array.isArray(v) || v.length > max) fail(); return v; };
const unique = (xs, field) => { if (new Set(xs.map(x => x[field])).size !== xs.length) fail(); };
export function validate(input) {
  obj(input, ['scope', 'successCriterion', 'tasks', 'attempts', 'bills']);
  const scope = id(input.scope);
  const successCriterion = id(input.successCriterion);
  const tasks = rows(input.tasks, LIMITS.tasks).map(t => {
    obj(t, ['id', 'outcome']);
    return { id: id(t.id), outcome: choice(t.outcome, ['success', 'failure', 'unknown']) };
  });
  const attempts = rows(input.attempts, LIMITS.attempts).map(a => {
    obj(a, ['requestId', 'taskId', 'outcome', 'retryOf']);
    return { requestId: id(a.requestId), taskId: id(a.taskId), outcome: choice(a.outcome, ['success', 'failure', 'unknown']), ...(a.retryOf === undefined ? {} : { retryOf: id(a.retryOf) }) };
  });
  const bills = rows(input.bills, LIMITS.bills).map(b => {
    obj(b, ['id', 'requestId', 'amount', 'unit', 'evidence', 'kind']);
    if (!Number.isSafeInteger(b.amount) || b.amount < 0 || b.amount > 1000000000) fail();
    if (typeof b.unit !== 'string' || !/^(money:[A-Z]{3}:[0-6]|credits:[A-Za-z0-9_.-]{1,32}:[0-6])$/.test(b.unit)) fail();
    return { id: id(b.id), ...(b.requestId === undefined ? {} : { requestId: id(b.requestId) }), amount: b.amount, unit: b.unit, evidence: choice(b.evidence, ['confirmed', 'estimated', 'unknown']), kind: choice(b.kind, ['usage', 'topup', 'balance']) };
  });
  unique(tasks, 'id'); unique(attempts, 'requestId'); unique(bills, 'id');
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const attemptMap = new Map(attempts.map(a => [a.requestId, a]));
  for (const a of attempts) {
    if (!taskMap.has(a.taskId)) fail();
    if (a.retryOf !== undefined) {
      const earlier = attemptMap.get(a.retryOf);
      if (!earlier || earlier === a || earlier.taskId !== a.taskId) fail();
      const seen = new Set([a.requestId]); let cur = earlier;
      while (cur) { if (seen.has(cur.requestId)) fail(); seen.add(cur.requestId); cur = attemptMap.get(cur.retryOf); }
    }
  }
  return { scope, successCriterion, tasks, attempts, bills };
}
export function reconcile(input) {
  const data = validate(input);
  const attempts = new Map(data.attempts.map(a => [a.requestId, a]));
  const tasks = new Map(data.tasks.map(t => [t.id, t]));
  const repeats = new Map();
  for (const b of data.bills) if (b.kind === 'usage' && b.requestId) repeats.set(b.requestId, (repeats.get(b.requestId) || 0) + 1);
  const groups = new Map();
  const findings = data.bills.map(b => {
    const a = attempts.get(b.requestId);
    const excluded = b.kind !== 'usage';
    const duplicate = !excluded && (repeats.get(b.requestId) || 0) > 1;
    const linked = !excluded && !!a;
    const flags = [];
    if (excluded) flags.push('excluded_non_usage');
    else if (!linked) flags.push('unknown_attribution');
    if (duplicate) flags.push('duplicate_suspected');
    if (linked && a.outcome === 'failure' && data.attempts.some(r => r.retryOf === a.requestId)) flags.push('failed_retry');
    if (linked && tasks.get(a.taskId).outcome === 'unknown') flags.push('unknown_task_outcome');
    if (!excluded) {
      const key = `${b.unit}|${b.evidence}`;
      if (!groups.has(key)) groups.set(key, { unit: b.unit, evidence: b.evidence, total: 0, attributable: 0, unknown: 0, duplicateSuspected: false, attributionComplete: true });
      const g = groups.get(key); g.total += b.amount;
      g[linked ? 'attributable' : 'unknown'] += b.amount; g.duplicateSuspected ||= duplicate; g.attributionComplete &&= linked;
    }
    return { billId: b.id, attribution: linked ? 'explicit_request_id' : 'unknown', ...(linked ? { taskId: a.taskId, requestId: a.requestId } : {}), flags };
  });
  const successes = data.tasks.filter(t => t.outcome === 'success').length;
  const completeOutcomes = data.tasks.every(t => t.outcome !== 'unknown');
  const totals = [...groups.values()].map(g => ({ ...g,
    costPerSuccessfulTask: completeOutcomes && g.attributionComplete && !g.duplicateSuspected && successes > 0 && g.evidence !== 'unknown' ? { numerator: g.total, denominator: successes } : null
  }));
  return { algorithmVersion: '1', scope: data.scope, successCriterion: data.successCriterion, successfulTasks: successes, totals, findings, notice: 'Input assertions are not independently verified. Suspicions do not establish fraud, billing error, avoidable loss or refund entitlement.' };
}
