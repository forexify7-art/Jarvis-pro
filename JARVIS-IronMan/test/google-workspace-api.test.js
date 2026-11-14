import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer } from '../server.js';

function requestServer(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, {
      method: options.method || 'GET',
      headers: options.headers,
      localAddress: '127.0.0.2',
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

const environmentKeys = [
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI',
  'GOOGLE_TOKEN_FILE', 'APP_ENCRYPTION_KEY', 'APP_ACCESS_TOKEN', 'NODE_ENV',
];
const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
const tokenDirectory = await mkdtemp(join(tmpdir(), 'jarvis-google-api-'));
process.env.GOOGLE_CLIENT_ID = 'server-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'server-google-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:4173/api/google/callback';
process.env.GOOGLE_TOKEN_FILE = join(tokenDirectory, 'tokens.enc');
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64');
process.env.APP_ACCESS_TOKEN = 'google-api-session-key';
delete process.env.NODE_ENV;

const originalFetch = globalThis.fetch;
const upstreamRequests = [];
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  upstreamRequests.push({ url, options });
  if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.ok(body.get('code_verifier'));
    return new Response(JSON.stringify({ access_token: 'oauth-access-secret', refresh_token: 'oauth-refresh-secret', expires_in: 3_600 }));
  }
  if (url.pathname === '/gmail/v1/users/me/drafts') return new Response(JSON.stringify({ id: 'draft-api-1' }));
  if (url.pathname === '/oauth2/revoke') return new Response(null, { status: 200 });
  throw new Error(`Unexpected upstream request: ${url}`);
};

const server = createAppServer();
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  globalThis.fetch = originalFetch;
  await rm(tokenDirectory, { recursive: true, force: true });
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('protects Google Workspace APIs, completes the callback with state, and never returns OAuth tokens', async () => {
  const unauthorized = await requestServer(`${baseUrl}/api/google/status`);
  assert.equal(unauthorized.status, 401);
  assert.equal(upstreamRequests.length, 0);

  const headers = { authorization: 'Bearer google-api-session-key' };
  const connect = await requestServer(`${baseUrl}/api/google/connect`, { method: 'POST', headers });
  assert.equal(connect.status, 200);
  const connectBody = JSON.parse(connect.text);
  const state = new URL(connectBody.authorizationUrl).searchParams.get('state');
  assert.ok(state);
  assert.doesNotMatch(connect.text, /oauth-access-secret|oauth-refresh-secret|server-google-client-secret/);

  const callback = await requestServer(`${baseUrl}/api/google/callback?code=authorization-code&state=${encodeURIComponent(state)}`);
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.location, '/?google_workspace=connected');
  assert.match(callback.headers['cache-control'], /no-store/);

  const status = await requestServer(`${baseUrl}/api/google/status`, { headers });
  assert.equal(status.status, 200);
  assert.deepEqual(JSON.parse(status.text).connected, true);
  assert.doesNotMatch(status.text, /oauth-access-secret|oauth-refresh-secret/);

  const invalidEvent = await requestServer(`${baseUrl}/api/google/events`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ summary: 'Unconfirmed', start: '2026-11-09T10:00:00Z', end: '2026-11-09T11:00:00Z', confirmed: false }),
  });
  assert.equal(invalidEvent.status, 400);
  assert.equal(upstreamRequests.some(({ url }) => url.pathname.includes('/calendar/')), false);

  const draft = await requestServer(`${baseUrl}/api/google/drafts`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ to: 'person@example.com', subject: 'Draft', body: 'Not sent' }),
  });
  assert.equal(draft.status, 200);
  assert.deepEqual(JSON.parse(draft.text), { draftId: 'draft-api-1' });
  assert.equal(upstreamRequests.at(-1).options.method, 'POST');
  assert.doesNotMatch(draft.text, /oauth-access-secret|oauth-refresh-secret/);

  const replay = await requestServer(`${baseUrl}/api/google/callback?code=authorization-code&state=${encodeURIComponent(state)}`);
  assert.equal(replay.status, 303);
  assert.equal(replay.headers.location, '/?google_workspace=error');
});