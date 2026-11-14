import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createAppServer } from '../server.js';

const originalFetch = globalThis.fetch;
const environmentKeys = ['AI_PROVIDER', 'AI_MODEL', 'AI_API_KEY', 'GEMINI_API_KEY', 'APP_ACCESS_TOKEN', 'NODE_ENV'];
const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
for (const key of environmentKeys) delete process.env[key];

const apiKey = 'test-only-gemini-server-secret';
const server = createAppServer();
let baseUrl;

async function postJson(path, body) {
  return originalFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.GEMINI_API_KEY = apiKey;
  delete process.env.AI_PROVIDER;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('auto-selects server GEMINI_API_KEY without returning it to clients', async () => {
  const response = await originalFetch(`${baseUrl}/api/health`);
  const health = await response.json();
  assert.equal(health.aiConfigured, true);
  assert.equal(health.provider, 'gemini');
  assert.equal(health.providerSource, 'environment');
  assert.equal(health.model, 'gemini-3.8-flash');
  assert.doesNotMatch(JSON.stringify(health), new RegExp(apiKey));
});

test('rejects Gemini keys sent from the browser and only configures environment credentials', async () => {
  const rejected = await postJson('/api/settings/ai', {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    apiKey: 'browser-supplied-secret',
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /GEMINI_API_KEY/);

  const configured = await postJson('/api/settings/ai', {
    provider: 'gemini',
    model: 'gemini-3.8-flash',
  });
  assert.equal(configured.status, 200);
  assert.deepEqual(await configured.json(), {
    configured: true,
    providerSource: 'environment',
    provider: 'gemini',
    model: 'gemini-3.8-flash',
  });
});

test('mints a short-lived Live token server-side without logging or returning the API key', async () => {
  let upstreamRequest;
  globalThis.fetch = async (input, options) => {
    upstreamRequest = { url: String(input), options };
    return new Response(JSON.stringify({ name: 'auth_tokens/ephemeral-test-token' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const response = await postJson('/api/live-token', {});
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(new URL(upstreamRequest.url).pathname, '/v1beta/auth_tokens');
  assert.equal(upstreamRequest.options.headers['x-goog-api-key'], apiKey);
  assert.equal(JSON.parse(upstreamRequest.options.body).liveConnectConstraints.model, 'models/gemini-3.8-live');
  assert.equal(result.token, 'auth_tokens/ephemeral-test-token');
  assert.equal(result.model, 'gemini-3.8-live');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey));
  assert.ok(Date.parse(result.expiresAt) > Date.now());
});

test('reports invalid-key and exhausted-quota errors without leaking upstream details', async () => {
  const loggedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...parts) => loggedErrors.push(parts.join(' '));
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: { status: 'UNAUTHENTICATED', message: `Rejected ${apiKey}` },
    }), { status: 401, headers: { 'content-type': 'application/json' } });
    const invalidKey = await postJson('/api/live-token', {});
    assert.equal(invalidKey.status, 502);
    const invalidKeyResult = await invalidKey.json();
    assert.equal(invalidKeyResult.code, 'GEMINI_INVALID_API_KEY');
    assert.match(invalidKeyResult.error, /GEMINI_API_KEY/);
    assert.doesNotMatch(JSON.stringify(invalidKeyResult), new RegExp(apiKey));

    globalThis.fetch = async () => new Response(JSON.stringify({
      error: { status: 'RESOURCE_EXHAUSTED', message: `Quota exceeded for ${apiKey}` },
    }), { status: 429, headers: { 'content-type': 'application/json' } });
    const quota = await postJson('/api/live-token', {});
    assert.equal(quota.status, 429);
    const quotaResult = await quota.json();
    assert.equal(quotaResult.code, 'GEMINI_QUOTA_EXCEEDED');
    assert.match(quotaResult.error, /quota/i);
    assert.doesNotMatch(JSON.stringify(quotaResult), new RegExp(apiKey));
    assert.doesNotMatch(loggedErrors.join(' '), new RegExp(apiKey));
  } finally {
    console.error = originalConsoleError;
  }
});
