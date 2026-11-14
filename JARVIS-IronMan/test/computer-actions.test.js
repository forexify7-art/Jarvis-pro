import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createComputerActionRunner, validateComputerAction, APP_ALLOWLIST } from '../desktop/computer-actions.js';
import { planTask } from '../public/agent-planner.js';
import { classifyAction, RISK } from '../public/security-permissions.js';

function makeRunner(overrides = {}) {
  const calls = [];
  const runner = createComputerActionRunner({
    platform: 'win32',
    confirm: async () => true,
    spawnApp: async (cmd) => { calls.push(['spawn', cmd]); },
    openPath: async (p) => { calls.push(['open', p]); return ''; },
    getPath: (n) => `/home/u/${n}`,
    readClipboard: () => 'clip text',
    writeClipboard: (t) => { calls.push(['write', t]); },
    showNotification: (n) => { calls.push(['notify', n.body]); },
    ...overrides,
  });
  return { runner, calls };
}

test('rejects anything outside the typed allowlist', () => {
  for (const bad of ['run-command', 'click', 'shell', '__proto__']) assert.throws(() => validateComputerAction(bad, {}), /Unsupported/);
  assert.throws(() => validateComputerAction('launch-app', { app: 'cmd.exe' }), /not an allowlisted app/);
  assert.throws(() => validateComputerAction('launch-app', { app: 'constructor' }), /not an allowlisted app/);
  assert.throws(() => validateComputerAction('open-folder', { folder: '../../etc' }), /not an allowlisted folder/);
  assert.throws(() => validateComputerAction('clipboard-write', { text: 'a\u0000b' }), /plain text/);
  assert.throws(() => validateComputerAction('notify', { body: 'x'.repeat(301) }), /Notification/);
});

test('launches only fixed executables and never passes caller text to a shell', async () => {
  const { runner, calls } = makeRunner();
  const out = await runner.run('launch-app', { app: 'Calculator', args: ['; rm -rf /'] });
  assert.deepEqual(out, { ok: true, launched: 'calculator' });
  assert.deepEqual(calls, [['spawn', APP_ALLOWLIST.calculator.win32]]);
});

test('denied confirmation runs nothing and is audited', async () => {
  const { runner, calls } = makeRunner({ confirm: async () => false });
  assert.deepEqual(await runner.run('clipboard-write', { text: 'hi' }), { ok: false, denied: true });
  assert.equal(calls.length, 0);
  assert.equal(runner.getAudit().at(-1).decision, 'denied');
});

test('open-folder resolves only allowlisted folder ids; clipboard and notify work', async () => {
  const { runner, calls } = makeRunner();
  await runner.run('open-folder', { folder: 'downloads' });
  assert.deepEqual(calls[0], ['open', '/home/u/downloads']);
  assert.equal((await runner.run('clipboard-read')).text, 'clip text');
  await runner.run('notify', { body: 'Tea is ready' });
  assert.deepEqual(calls.at(-1), ['notify', 'Tea is ready']);
});

test('supports cancellation and rate limiting', async () => {
  const { runner } = makeRunner({ maxPerMinute: 2 });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runner.run('notify', { body: 'x' }, { signal: controller.signal }), /Cancelled/);
  await runner.run('notify', { body: 'a' });
  await runner.run('notify', { body: 'b' });
  await assert.rejects(runner.run('notify', { body: 'c' }), /Too many/);
});

test('reports failures instead of success when the OS call fails', async () => {
  const { runner } = makeRunner({ spawnApp: async () => { throw new Error('ENOENT'); } });
  await assert.rejects(runner.run('launch-app', { app: 'notepad' }), /ENOENT/);
  assert.equal(runner.getAudit().at(-1).decision, 'failed');
});

test('planner maps natural requests to typed desktop actions and still refuses raw control', () => {
  assert.equal(planTask('open calculator').steps[0].action, 'desktop-launch-app');
  assert.equal(planTask('open my downloads folder').steps[0].params.folder, 'downloads');
  assert.equal(planTask('copy "hello world" to clipboard').steps[0].params.text, 'hello world');
  assert.equal(planTask('notify me: stand up').steps[0].params.body, 'stand up');
  assert.equal(planTask('click the start button').steps[0].action, 'computer-control');
  assert.equal(planTask('shutdown now').steps[0].action, 'computer-control');
});

test('risk levels: launching/reading are dangerous (asked every time); raw control stays dangerous', () => {
  assert.equal(classifyAction('desktop-launch-app'), RISK.DANGEROUS);
  assert.equal(classifyAction('desktop-clipboard-read'), RISK.DANGEROUS);
  assert.equal(classifyAction('desktop-notify'), RISK.CONFIRM);
  assert.equal(classifyAction('computer-control'), RISK.DANGEROUS);
  assert.equal(classifyAction('anything-unknown'), RISK.DANGEROUS);
});
