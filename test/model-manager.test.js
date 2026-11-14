import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createAppServer } from '../server.js';

const environmentKeys = ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_PROVIDER', 'APP_ACCESS_TOKEN', 'GEMINI_API_KEY', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL', 'NODE_ENV'];
const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
for (const key of environmentKeys) delete process.env[key];

const server = createAppServer();
const originalFetch = globalThis.fetch;
const accessToken = 'test-only-model-manager-access';
const providerKey = 'test-only-model-manager-key';
const providerBase = 'https://models.example.test/v1/';
let baseUrl;

async function request(path, { method = 'GET', body, authorization = `Bearer ${accessToken}` } = {}) {
  return originalFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(authorization ? { authorization } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function configureOpenAI() {
  const response = await request('/api/settings/ai', {
    method: 'POST',
    body: {
      provider: 'openai-compatible',
      model: 'initial-model',
      baseUrl: providerBase,
      apiKey: providerKey,
    },
  });
  assert.equal(response.status, 200);
}

before(async () => {
  process.env.APP_ACCESS_TOKEN = accessToken;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('model discovery requires API authorization and an active provider configuration', async () => {
  const unauthorized = await request('/api/models', { authorization: '' });
  assert.equal(unauthorized.status, 401);

  const unconfigured = await request('/api/models');
  assert.equal(unconfigured.status, 503);
  assert.equal((await unconfigured.json()).code, 'AI_PROVIDER_NOT_CONFIGURED');
});

test('discovers real OpenAI-compatible models as untested without returning the provider key', async () => {
  await configureOpenAI();
  const upstreamRequests = [];
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith(baseUrl)) return originalFetch(input, options);
    upstreamRequests.push({ url: String(input), options });
    return Response.json({
      data: [
        { id: 'fast-model', owned_by: 'mock-provider', context_length: 8_192 },
        { id: 'reasoning-model', owned_by: 'mock-provider', context_length: 65_536 },
      ],
    });
  };

  const response = await request('/api/models');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(new URL(upstreamRequests[0].url).pathname, '/v1/models');
  assert.equal(upstreamRequests[0].options.headers.authorization, `Bearer ${providerKey}`);
  assert.deepEqual(body.models.map(({ id, status, verified }) => ({ id, status, verified })), [
    { id: 'fast-model', status: 'Untested', verified: false },
    { id: 'reasoning-model', status: 'Untested', verified: false },
  ]);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(providerKey));
});

test('model compatibility probe sends a bounded real request and reports measured availability', async () => {
  await configureOpenAI();
  let probe;
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith(baseUrl)) return originalFetch(input, options);
    probe = { url: String(input), options, body: JSON.parse(options.body) };
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  };

  const response = await request('/api/models/test', {
    method: 'POST',
    body: { model: 'fast-model' },
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(new URL(probe.url).pathname, '/v1/chat/completions');
  assert.equal(probe.options.headers.authorization, `Bearer ${providerKey}`);
  assert.equal(probe.body.model, 'fast-model');
  assert.ok(probe.body.max_tokens <= 8);
  assert.ok(probe.options.signal instanceof AbortSignal);
  assert.equal(result.status, 'Available');
  assert.equal(result.verified, true);
  assert.ok(Number.isFinite(result.latencyMs));
  assert.ok(result.latencyMs >= 0);
  assert.ok(result.capabilities.includes('text'));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(providerKey));
});

test('model discovery and probes classify authentication, rate limiting, and unsupported endpoints', async () => {
  await configureOpenAI();
  let upstreamStatus = 401;
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith(baseUrl)) return originalFetch(input, options);
    return new Response(JSON.stringify({ error: { message: 'provider error' } }), { status: upstreamStatus });
  };

  const authentication = await (await request('/api/models')).json();
  assert.equal(authentication.status, 'Authentication Required');

  upstreamStatus = 429;
  const rateLimited = await (await request('/api/models')).json();
  assert.equal(rateLimited.status, 'Rate Limited');

  upstreamStatus = 404;
  const unsupported = await (await request('/api/models/test', {
    method: 'POST',
    body: { model: 'missing-model' },
  })).json();
  assert.equal(unsupported.status, 'Unsupported');
});
/*
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createAppServer } from '../server.js';

const environmentKeys = ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'AI_PROVIDER', 'APP_ACCESS_TOKEN', 'GEMINI_API_KEY', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL', 'NODE_ENV'];
const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
for (const key of environmentKeys) delete process.env[key];

const server = createAppServer();
const originalFetch = globalThis.fetch;
const accessToken = 'test-only-model-manager-access';
const providerKey = 'test-only-model-manager-key';
const providerBase = 'https://models.example.test/v1/';
let baseUrl;

async function request(path, { method = 'GET', body, authorization = `Bearer ${accessToken}` } = {}) {
  return originalFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(authorization ? { authorization } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function configureOpenAI() {
  const response = await request('/api/settings/ai', {
    method: 'POST',
    body: {
      provider: 'openai-compatible',
      model: 'initial-model',
      baseUrl: providerBase,
      apiKey: providerKey,
    },
  });
  assert.equal(response.status, 200);
}

before(async () => {
  process.env.APP_ACCESS_TOKEN = accessToken;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('model discovery requires API authorization and an active provider configuration', async () => {
  const unauthorized = await request('/api/models', { authorization: '' });
  assert.equal(unauthorized.status, 401);

  const unconfigured = await request('/api/models');
  assert.equal(unconfigured.status, 503);
  assert.equal((await unconfigured.json()).code, 'AI_PROVIDER_NOT_CONFIGURED');
});

test('discovers real OpenAI-compatible models as untested without returning the provider key', async () => {
  await configureOpenAI();
  const upstreamRequests = [];
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith(baseUrl)) return originalFetch(input, options);
    upstreamRequests.push({ url: String(input), options });
    return Response.json({
      data: [
        { id: 'fast-model', owned_by: 'mock-provider', context_length: 8_192 },
        { id: 'reasoning-model', owned_by: 'mock-provider', context_length: 65_536 },
      ],
    });
  };

  const response = await request('/api/models');
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(new URL(upstreamRequests[0].url).pathname, '/v1/models');
  assert.equal(upstreamRequests[0].options.headers.authorization, `Bearer ${providerKey}`);
  assert.deepEqual(body.models.map(({ id, status, verified }) => ({ id, status, verified })), [
    { id: 'fast-model', status: 'Untested', verified: false },
    { id: 'reasoning-model', status: 'Untested', verified: false },
  ]);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(providerKey));
});

test('model compatibility probe sends a bounded real request and reports measured availability', async () => {
  await configureOpenAI();
  let probe;
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith(baseUrl)) return originalFetch(input, options);
    probe = { url: String(input), options, body: JSON.parse(options.body) };
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  };

  const response = await request('/api/models/test', {
    method: 'POST',
    body: { model: 'fast-model' },
  });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(new URL(probe.url).pathname, '/v1/chat/completions');
  assert.equal(probe.options.headers.authorization, `Bearer ${providerKey}`);
  assert.equal(probe.body.model, 'fast-model');
  assert.ok(probe.body.max_tokens <= 8);
  assert.ok(probe.options.signal instanceof AbortSignal);
  assert.equal(result.status, 'Available');
  assert.equal(result.verified, true);
  assert.ok(Number.isFinite(result.latencyMs));
  assert.ok(result.latencyMs >= 0);
  assert.ok(result.capabilities.includes('text'));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(providerKey));
});

test('model discovery and probes classify authentication, rate limiting, and unsupported endpoints', async () => {
  await configureOpenAI();
  let upstreamStatus = 401;
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith(baseUrl)) return originalFetch(input, options);
    return new Response(JSON.stringify({ error: { message: 'provider error' } }), { status: upstreamStatus });
  };

  const authentication = await (await request('/api/models')).json();
  assert.equal(authentication.status, 'Authentication Required');

  upstreamStatus = 429;
  const rateLimited = await (await request('/api/models')).json();
  assert.equal(rateLimited.status, 'Rate Limited');

  upstreamStatus = 404;
  const unsupported = await (await request('/api/models/test', {
    method: 'POST',
    body: { model: 'missing-model' },
  })).json();
  assert.equal(unsupported.status, 'Unsupported');
});
*/
