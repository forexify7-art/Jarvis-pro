import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');

test('AI Model Manager controls are wired to authenticated discovery, probe, and selection APIs', () => {
  for (const id of ['ai-model-mode', 'ai-model-refresh', 'ai-model-test', 'ai-model-use', 'ai-model-status', 'ai-model-list']) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.ok(app.includes(`#${id}`), `${id} must be selected by the app`);
  }
  assert.match(app, /fetch\('\/api\/models'/);
  assert.match(app, /fetch\('\/api\/models\/test'/);
  assert.match(app, /fetch\('\/api\/settings\/ai\/model'/);
  assert.match(app, /result\.verified !== true/);
  assert.match(app, /testedAIModels\.get\(model\)\?\.verified !== true/);
  assert.match(css, /\.ai-model-option/);
});
