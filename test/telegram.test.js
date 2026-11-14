import assert from 'node:assert/strict';
import test from 'node:test';
import { createTelegramClient, readTelegramConfiguration } from '../integrations/telegram.js';

const token = `123456:${'a'.repeat(35)}`;

function makeClient(overrides = {}, fetcher = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }))) {
  const environment = {
    TELEGRAM_BOT_TOKEN: token,
    TELEGRAM_ALLOWED_CHAT_IDS: '123456789,-1009876543210',
    ...overrides,
  };
  return { client: createTelegramClient({ environment, fetcher }), environment };
}

test('requires a valid server token and a bounded numeric recipient allowlist', () => {
  assert.equal(readTelegramConfiguration({}), null);
  assert.throws(() => readTelegramConfiguration({ TELEGRAM_BOT_TOKEN: token }), (error) => error.code === 'TELEGRAM_MISCONFIGURED');
  assert.throws(() => readTelegramConfiguration({ TELEGRAM_BOT_TOKEN: 'bad', TELEGRAM_ALLOWED_CHAT_IDS: '123' }), (error) => error.code === 'TELEGRAM_MISCONFIGURED');
  assert.throws(() => readTelegramConfiguration({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_ALLOWED_CHAT_IDS: '123,https://example.com' }), (error) => error.code === 'TELEGRAM_MISCONFIGURED');
  assert.deepEqual(readTelegramConfiguration({
    TELEGRAM_BOT_TOKEN: token,
    TELEGRAM_ALLOWED_CHAT_IDS: '123456789,123456789,-1009876543210',
  }).chatIds, ['123456789', '-1009876543210']);
});

test('does not contact Telegram for unapproved recipients, unconfirmed messages, or invalid text', async () => {
  let requests = 0;
  const { client } = makeClient({}, async () => { requests += 1; return new Response('{}'); });
  await assert.rejects(client.sendMessage({ chatId: '555555555', text: 'Hi', confirmed: true }), (error) => error.code === 'TELEGRAM_RECIPIENT_NOT_ALLOWED');
  await assert.rejects(client.sendMessage({ chatId: '123456789', text: 'Hi', confirmed: false }), (error) => error.code === 'TELEGRAM_CONFIRMATION_REQUIRED');
  await assert.rejects(client.sendMessage({ chatId: '123456789', text: '  ', confirmed: true }), (error) => error.code === 'TELEGRAM_MESSAGE_INVALID');
  await assert.rejects(client.sendMessage({ chatId: '123456789', text: 'x'.repeat(4_097), confirmed: true }), (error) => error.code === 'TELEGRAM_MESSAGE_INVALID');
  assert.equal(requests, 0);
});

test('sends bounded plain text only to an allowlisted chat without exposing the bot token', async () => {
  const requests = [];
  const { client } = makeClient({}, async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }));
  });
  const result = await client.sendMessage({ chatId: '-1009876543210', text: 'नमस्ते', confirmed: true });
  assert.deepEqual(result, { sent: true, chatId: '-1009876543210', messageId: 42 });
  assert.equal(requests[0].url, `https://api.telegram.org/bot${token}/sendMessage`);
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), { chat_id: '-1009876543210', text: 'नमस्ते' });
  assert.equal(JSON.stringify(result).includes(token), false);
});

test('returns only configured recipient IDs in status and sanitizes upstream failures', async () => {
  const { client } = makeClient();
  assert.deepEqual(client.status(), { configured: true, recipients: ['123456789', '-1009876543210'] });

  const rejecting = makeClient({}, async () => new Response(JSON.stringify({ ok: false, description: `invalid token ${token}` }), { status: 401 }));
  await assert.rejects(rejecting.client.sendMessage({ chatId: '123456789', text: 'Hi', confirmed: true }), (error) => {
    assert.equal(error.code, 'TELEGRAM_UPSTREAM_REJECTED');
    assert.doesNotMatch(error.message, new RegExp(token));
    return true;
  });
});