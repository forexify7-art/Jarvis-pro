import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeConfiguration,
  findMissingDependencies,
  getForwardedUrl,
  isNodeVersionSupported,
} from '../scripts/codespaces.js';

test('node version gate accepts 22.12+ and rejects older runtimes', () => {
  assert.equal(isNodeVersionSupported('22.12.0'), true);
  assert.equal(isNodeVersionSupported('22.23.4'), true);
  assert.equal(isNodeVersionSupported('24.1.0'), true);
  assert.equal(isNodeVersionSupported('22.11.9'), false);
  assert.equal(isNodeVersionSupported('20.19.0'), false);
});

test('missing dependency detection reports only absent required paths', () => {
  const present = new Set(['three/package.json']);
  const missing = findMissingDependencies('/root', (path) => [...present].some((tail) => path.endsWith(tail)));
  assert.ok(missing.includes('node_modules/.bin/esbuild'));
  assert.ok(!missing.includes('node_modules/three/package.json'));
  assert.deepEqual(findMissingDependencies('/root', () => true), []);
});

test('configuration check flags a missing or placeholder Gemini key without exposing values', () => {
  assert.equal(describeConfiguration({ AI_PROVIDER: 'gemini' }).problems.length, 1);
  assert.equal(describeConfiguration({ GEMINI_API_KEY: 'replace_with_your_google_ai_studio_key' }).problems.length, 1);
  const ok = describeConfiguration({ GEMINI_API_KEY: 'AIza-test' });
  assert.equal(ok.problems.length, 0);
  assert.ok(!JSON.stringify(ok).includes('AIza-test'));
  assert.equal(describeConfiguration({ AI_PROVIDER: 'ollama' }).problems.length, 0);
});

test('forwarded URL is built from Codespaces environment', () => {
  assert.equal(
    getForwardedUrl({ codespaceName: 'abc', forwardingDomain: 'app.github.dev', port: 4173 }),
    'https://abc-4173.app.github.dev',
  );
  assert.equal(getForwardedUrl({}), null);
});
