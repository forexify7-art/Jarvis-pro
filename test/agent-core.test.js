import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyAction, createPermissionBroker, RISK } from '../public/security-permissions.js';
import { classifyError, withRecovery } from '../public/error-recovery.js';
import { verifyStepResult } from '../public/task-verifier.js';
import { planTask } from '../public/agent-planner.js';
import { runPlan } from '../public/agent-engine.js';

test('unknown actions are classified dangerous; reads are safe', () => {
  assert.equal(classifyAction('read-file'), RISK.SAFE);
  assert.equal(classifyAction('delete-file'), RISK.DANGEROUS);
  assert.equal(classifyAction('format-disk'), RISK.DANGEROUS);
});

test('broker asks for confirmation, remembers session grants only for confirm-level actions', async () => {
  let asked = 0;
  const broker = createPermissionBroker({ ask: async () => { asked += 1; return 'allow-session'; } });
  assert.equal((await broker.request('create-file', 'a.txt')).allowed, true);
  assert.equal((await broker.request('create-file', 'b.txt')).allowed, true);
  assert.equal(asked, 1, 'session grant reused');
  await broker.request('delete-file', 'a.txt');
  await broker.request('delete-file', 'a.txt');
  assert.equal(asked, 3, 'dangerous actions always ask again');
  broker.revokeAll();
  await broker.request('create-file', 'c.txt');
  assert.equal(asked, 4);
});

test('broker denies when the user denies or the prompt throws, and redacts secrets in audit', async () => {
  const denying = createPermissionBroker({ ask: async () => 'deny' });
  assert.equal((await denying.request('edit-file', 'x')).allowed, false);
  const throwing = createPermissionBroker({ ask: async () => { throw new Error('ui closed'); } });
  assert.equal((await throwing.request('delete-file', 'api_key=abc123secret')).allowed, false);
  const log = JSON.stringify(throwing.getAudit());
  assert.doesNotMatch(log, /abc123secret/);
  assert.throws(() => createPermissionBroker({}), TypeError);
});

test('classifyError distinguishes retryable and fatal failures', () => {
  assert.deepEqual(classifyError({ status: 429 }), { kind: 'rate-limit', retryable: true });
  assert.equal(classifyError({ status: 503 }).retryable, true);
  assert.equal(classifyError({ status: 401 }).retryable, false);
  assert.equal(classifyError({ name: 'AbortError' }).kind, 'cancelled');
});

test('withRecovery retries transient errors with backoff then succeeds', async () => {
  const delays = [];
  let calls = 0;
  const result = await withRecovery(async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error('busy'), { status: 503 });
    return 'ok';
  }, { wait: async (ms) => delays.push(ms), baseDelayMs: 100 });
  assert.deepEqual([result.ok, result.value, result.attempts], [true, 'ok', 3]);
  assert.deepEqual(delays, [100, 200]);
});

test('withRecovery does not retry fatal errors and uses fallback only when allowed', async () => {
  let calls = 0;
  const fatal = await withRecovery(async () => { calls += 1; throw Object.assign(new Error('no'), { status: 401 }); },
    { fallback: () => 'x' });
  assert.equal(fatal.ok, false);
  assert.equal(calls, 1);
  const recovered = await withRecovery(async () => { throw Object.assign(new Error('bad'), { status: 400 }); },
    { fallback: () => 'local answer' });
  assert.deepEqual([recovered.ok, recovered.value, recovered.usedFallback], [true, 'local answer', true]);
});

test('verifier never passes empty or wrong results', () => {
  assert.equal(verifyStepResult({ expect: { type: 'non-empty-text' } }, '  ').passed, false);
  assert.equal(verifyStepResult({ expect: { type: 'non-empty-text' } }, 'hi').passed, true);
  assert.equal(verifyStepResult({ expect: { type: 'file-created' } }, { name: 'a.txt', size: 0 }).passed, false);
  assert.equal(verifyStepResult({}, undefined).passed, false);
  assert.equal(verifyStepResult({ expect: { type: 'bogus' } }, 'x').passed, false);
  assert.equal(verifyStepResult({ expect: { type: 'predicate', check: () => { throw new Error('boom'); } } }, 1).passed, false);
});

test('planner splits compound requests and maps known actions', () => {
  const plan = planTask('create a file named notes.txt with hello world, then save the file notes.txt');
  assert.deepEqual(plan.steps.map((s) => s.action), ['create-file', 'export-file']);
  assert.deepEqual(plan.steps[0].params, { name: 'notes.txt', content: 'hello world' });
  assert.equal(planTask('delete file old.txt').steps[0].action, 'delete-file');
  assert.equal(planTask('click the start button').steps[0].action, 'computer-control');
  assert.equal(planTask('open https://example.com').steps[0].action, 'open-url');
  assert.equal(planTask('summarize https://example.com/a key points').steps[0].action, 'browser-read-page');
  assert.equal(planTask('what is the capital of France').steps[0].action, 'ask-ai');
  assert.throws(() => planTask('  '), TypeError);
  assert.throws(() => planTask('x'.repeat(4_001)), RangeError);
});

test('engine runs approved steps, verifies them, and stops at the first denial', async () => {
  const calls = [];
  const handlers = {
    'create-file': async ({ name, content }) => { calls.push('create'); return { name, size: content.length }; },
    'delete-file': async () => { calls.push('delete'); return true; },
  };
  const plan = planTask('create a file named a.txt with hi, then delete file a.txt');
  const broker = createPermissionBroker({ ask: async ({ action }) => (action === 'delete-file' ? 'deny' : 'allow') });
  const report = await runPlan(plan, { handlers, broker });
  assert.deepEqual(calls, ['create']);
  assert.equal(report.status, 'stopped');
  assert.deepEqual(report.steps.map((s) => s.status), ['done', 'denied']);
});

test('engine reports unsupported actions, unverified results and failures honestly', async () => {
  const broker = createPermissionBroker({ ask: async () => 'allow' });
  const none = await runPlan(planTask('click ok'), { handlers: {}, broker });
  assert.equal(none.steps[0].status, 'unsupported');
  const empty = await runPlan(planTask('hello there'), { handlers: { 'ask-ai': async () => '   ' }, broker });
  assert.equal(empty.steps[0].status, 'unverified');
  assert.equal(empty.status, 'failed');
  const failing = await runPlan(planTask('hello there'), {
    handlers: { 'ask-ai': async () => { throw Object.assign(new Error('down'), { status: 400 }); } }, broker,
  });
  assert.equal(failing.steps[0].status, 'failed');
  const ctrl = new AbortController();
  ctrl.abort();
  const cancelled = await runPlan(planTask('hello'), { handlers: { 'ask-ai': async () => 'x' }, broker, signal: ctrl.signal });
  assert.equal(cancelled.status, 'cancelled');
});

test('engine reports cancellation during an in-flight action as cancelled', async () => {
  const broker = createPermissionBroker({ ask: async () => 'allow' });
  const controller = new AbortController();
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const running = runPlan(planTask('hello'), {
    broker,
    signal: controller.signal,
    handlers: {
      'ask-ai': (_params, { signal }) => new Promise((_resolve, reject) => {
        markStarted();
        signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('Cancelled by user.'), { name: 'AbortError' }));
        }, { once: true });
      }),
    },
  });

  await started;
  controller.abort();
  const report = await running;

  assert.equal(report.status, 'cancelled');
  assert.equal(report.steps[0].status, 'cancelled');
});

test('engine reports cancellation while approval is pending as cancelled', async () => {
  const controller = new AbortController();
  let resolvePermission;
  let markPrompted;
  let actionCalls = 0;
  const prompted = new Promise((resolve) => { markPrompted = resolve; });
  const permissionDecision = new Promise((resolve) => { resolvePermission = resolve; });
  const broker = createPermissionBroker({ ask: () => {
    markPrompted();
    return permissionDecision;
  } });
  const running = runPlan(planTask('create a file named x.txt with hello'), {
    broker,
    signal: controller.signal,
    handlers: { 'create-file': async () => { actionCalls += 1; return { name: 'x.txt', size: 5 }; } },
  });

  await prompted;
  controller.abort();
  resolvePermission('deny');
  const report = await running;

  assert.equal(actionCalls, 0);
  assert.equal(report.status, 'cancelled');
  assert.equal(report.steps[0].status, 'cancelled');
});
