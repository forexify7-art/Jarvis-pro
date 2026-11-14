import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { request as httpRequest } from 'node:http';
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
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

const environmentKeys = [
  'FACEBOOK_PAGE_ID',
  'FACEBOOK_PAGE_ACCESS_TOKEN',
  'FACEBOOK_GRAPH_API_VERSION',
  'FACEBOOK_ALLOWED_RECIPIENT_IDS',
  'APP_ACCESS_TOKEN',
  'NODE_ENV',
];
const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
const pageAccessToken = `EAAG${'c'.repeat(40)}`;
process.env.FACEBOOK_PAGE_ID = '123456789012345';
process.env.FACEBOOK_PAGE_ACCESS_TOKEN = pageAccessToken;
process.env.FACEBOOK_GRAPH_API_VERSION = 'v22.0';
process.env.FACEBOOK_ALLOWED_RECIPIENT_IDS = '123456789012345,987654321098765';
process.env.APP_ACCESS_TOKEN = 'facebook-api-access-key';
delete process.env.NODE_ENV;

const originalFetch = globalThis.fetch;
const upstreamRequests = [];
globalThis.fetch = async (input, options = {}) => {
  upstreamRequests.push({ url: String(input), options });
  return new Response(JSON.stringify({
    recipient_id: '123456789012345',
    message_id: 'mid.81',
  }));
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
  for (const [key, value] of previousEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('Facebook Messenger endpoints require app auth, enforce allowlist and confirmation, and keep tokens private', async () => {
  const unauthorized = await requestServer(`${baseUrl}/api/facebook-messenger/status`);
  assert.equal(unauthorized.status, 401);
  assert.equal(upstreamRequests.length, 0);

  const headers = { authorization: 'Bearer facebook-api-access-key' };
  const status = await requestServer(`${baseUrl}/api/facebook-messenger/status`, { headers });
  assert.equal(status.status, 200);
  assert.deepEqual(JSON.parse(status.text), {
    configured: true,
    recipients: ['123456789012345', '987654321098765'],
  });
  assert.doesNotMatch(status.text, new RegExp(pageAccessToken));

  const unapproved = await requestServer(`${baseUrl}/api/facebook-messenger/send`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ recipientId: '111111111111111', text: 'Hello', confirmed: true }),
  });
  assert.equal(unapproved.status, 403);
  assert.equal(upstreamRequests.length, 0);

  const unconfirmed = await requestServer(`${baseUrl}/api/facebook-messenger/send`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ recipientId: '123456789012345', text: 'Hello', confirmed: false }),
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal(upstreamRequests.length, 0);

  const sent = await requestServer(`${baseUrl}/api/facebook-messenger/send`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ recipientId: '123456789012345', text: 'Hello from JARVIS', confirmed: true }),
  });
  assert.equal(sent.status, 200);
  assert.deepEqual(JSON.parse(sent.text), {
    sent: true,
    recipientId: '123456789012345',
    messageId: 'mid.81',
  });
  assert.doesNotMatch(sent.text, new RegExp(pageAccessToken));
  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].url, 'https://graph.facebook.com/v22.0/123456789012345/messages');
  assert.equal(upstreamRequests[0].options.headers.authorization, `Bearer ${pageAccessToken}`);
  assert.deepEqual(JSON.parse(upstreamRequests[0].options.body), {
    recipient: { id: '123456789012345' },
    messaging_type: 'RESPONSE',
    message: { text: 'Hello from JARVIS' },
  });
});
