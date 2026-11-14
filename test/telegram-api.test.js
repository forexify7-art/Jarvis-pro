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

const environmentKeys = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHAT_IDS', 'APP_ACCESS_TOKEN', 'NODE_ENV'];
const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
const botToken = `765432:${'b'.repeat(35)}`;
process.env.TELEGRAM_BOT_TOKEN = botToken;
process.env.TELEGRAM_ALLOWED_CHAT_IDS = '123456789,-1009876543210';
process.env.APP_ACCESS_TOKEN = 'telegram-api-access-key';
delete process.env.NODE_ENV;

const originalFetch = globalThis.fetch;
const upstreamRequests = [];
globalThis.fetch = async (input, options = {}) => {
  upstreamRequests.push({ url: String(input), options });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 81 } }));
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

test('Telegram endpoints require the app access key and never expose the bot token', async () => {
  const unauthorized = await requestServer(`${baseUrl}/api/telegram/status`);
  assert.equal(unauthorized.status, 401);
  assert.equal(upstreamRequests.length, 0);

  const headers = { authorization: 'Bearer telegram-api-access-key' };
  const status = await requestServer(`${baseUrl}/api/telegram/status`, { headers });
  assert.equal(status.status, 200);
  assert.deepEqual(JSON.parse(status.text), { configured: true, recipients: ['123456789', '-1009876543210'] });
  assert.doesNotMatch(status.text, new RegExp(botToken));

  const unapproved = await requestServer(`${baseUrl}/api/telegram/send`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ chatId: '555555555', text: 'Hi', confirmed: true }),
  });
  assert.equal(unapproved.status, 403);
  assert.equal(upstreamRequests.length, 0);

  const unconfirmed = await requestServer(`${baseUrl}/api/telegram/send`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ chatId: '123456789', text: 'Hi', confirmed: false }),
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal(upstreamRequests.length, 0);

  const sent = await requestServer(`${baseUrl}/api/telegram/send`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ chatId: '123456789', text: 'Hello from JARVIS', confirmed: true }),
  });
  assert.equal(sent.status, 200);
  assert.deepEqual(JSON.parse(sent.text), { sent: true, chatId: '123456789', messageId: 81 });
  assert.doesNotMatch(sent.text, new RegExp(botToken));
  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].url, `https://api.telegram.org/bot${botToken}/sendMessage`);
  assert.deepEqual(JSON.parse(upstreamRequests[0].options.body), { chat_id: '123456789', text: 'Hello from JARVIS' });
});