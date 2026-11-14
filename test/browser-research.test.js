import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

const environmentKeys = [
  'AI_API_KEY',
  'AI_BASE_URL',
  'AI_MODEL',
  'AI_PROVIDER',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'APP_ACCESS_TOKEN',
  'GEMINI_API_KEY',
  'NODE_ENV',
];
const savedEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
for (const key of environmentKeys) delete process.env[key];

const server = createAppServer();
const originalFetch = globalThis.fetch;
const apiKey = 'test-only-browser-research-secret';
const accessToken = 'test-only-browser-research-access-token';
let baseUrl;

async function postJson(path, body, headers = {}) {
  return originalFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

before(async () => {
  // Gemini keys are server-environment only; the settings endpoint rejects them by design.
  process.env.GEMINI_API_KEY = apiKey;
  process.env.AI_MODEL = 'gemini-test-model';
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const configurationResponse = await postJson('/api/settings/ai', {
    provider: 'gemini',
    model: 'gemini-test-model',
  });
  assert.equal(configurationResponse.status, 200);
  process.env.APP_ACCESS_TOKEN = accessToken;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const [key, value] of savedEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('proxies authorized Browser Research requests only to the loopback service', async () => {
  let researchRequest;
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith(baseUrl)) return originalFetch(input, options);
    researchRequest = { url: String(input), options };
    return Response.json({ result: 'A read-only summary.' });
  };
  const authorization = `Bearer ${accessToken}`;

  const unauthorized = await postJson('/api/browser/research', {
    url: 'https://example.com/article',
    question: 'Summarize it',
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(researchRequest, undefined);

  const response = await postJson('/api/browser/research', {
    url: 'https://example.com/article',
    question: 'Summarize it',
  }, { authorization });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(researchRequest.url, 'http://127.0.0.1:4174/research');
  assert.deepEqual(JSON.parse(researchRequest.options.body), {
    url: 'https://example.com/article',
    question: 'Summarize it',
    provider: 'gemini',
    model: 'gemini-test-model',
    apiKey,
  });
  assert.deepEqual(result, {
    url: 'https://example.com/article',
    result: 'A read-only summary.',
  });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey));

  const invalidUrl = await postJson('/api/browser/research', {
    url: 'file:///etc/passwd',
    question: 'Read this file',
  }, { authorization });
  assert.equal(invalidUrl.status, 400);
  assert.equal(researchRequest.url, 'http://127.0.0.1:4174/research');
});
