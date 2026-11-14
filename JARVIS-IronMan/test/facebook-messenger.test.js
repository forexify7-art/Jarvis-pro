import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFacebookMessengerClient,
  readFacebookMessengerConfiguration,
} from '../integrations/facebook-messenger.js';

const pageAccessToken = `EAAG${'a'.repeat(40)}`;

function makeClient(overrides = {}, fetcher = async () => new Response(JSON.stringify({
  recipient_id: '123456789012345',
  message_id: 'mid.123',
}))) {
  const environment = {
    FACEBOOK_PAGE_ID: '123456789012345',
    FACEBOOK_PAGE_ACCESS_TOKEN: pageAccessToken,
    FACEBOOK_GRAPH_API_VERSION: 'v22.0',
    FACEBOOK_ALLOWED_RECIPIENT_IDS: '123456789012345,987654321098765',
    ...overrides,
  };
  return { client: createFacebookMessengerClient({ environment, fetcher }), environment };
}

test('requires a valid Page configuration and bounded numeric recipient allowlist', () => {
  assert.equal(readFacebookMessengerConfiguration({}), null);
  assert.throws(() => readFacebookMessengerConfiguration({ FACEBOOK_PAGE_ID: '123456789012345' }), (error) => (
    error.code === 'FACEBOOK_MESSENGER_MISCONFIGURED'
  ));
  assert.throws(() => readFacebookMessengerConfiguration({
    FACEBOOK_PAGE_ID: '123456789012345',
    FACEBOOK_PAGE_ACCESS_TOKEN: pageAccessToken,
    FACEBOOK_GRAPH_API_VERSION: 'v22/0',
    FACEBOOK_ALLOWED_RECIPIENT_IDS: '123456789012345',
  }), (error) => error.code === 'FACEBOOK_MESSENGER_MISCONFIGURED');
  assert.throws(() => readFacebookMessengerConfiguration({
    FACEBOOK_PAGE_ID: '123456789012345',
    FACEBOOK_PAGE_ACCESS_TOKEN: pageAccessToken,
    FACEBOOK_GRAPH_API_VERSION: 'v22.0',
    FACEBOOK_ALLOWED_RECIPIENT_IDS: '123456789012345,https://example.com',
  }), (error) => error.code === 'FACEBOOK_MESSENGER_MISCONFIGURED');
  assert.deepEqual(readFacebookMessengerConfiguration({
    FACEBOOK_PAGE_ID: '123456789012345',
    FACEBOOK_PAGE_ACCESS_TOKEN: pageAccessToken,
    FACEBOOK_GRAPH_API_VERSION: 'v22.0',
    FACEBOOK_ALLOWED_RECIPIENT_IDS: '123456789012345,123456789012345,987654321098765',
  }).recipientIds, ['123456789012345', '987654321098765']);
});

test('does not contact Meta for unapproved recipients, unconfirmed messages, or invalid text', async () => {
  let requests = 0;
  const { client } = makeClient({}, async () => {
    requests += 1;
    return new Response('{}');
  });
  await assert.rejects(client.sendMessage({
    recipientId: '111111111111111',
    text: 'Hi',
    confirmed: true,
  }), (error) => error.code === 'FACEBOOK_MESSENGER_RECIPIENT_NOT_ALLOWED');
  await assert.rejects(client.sendMessage({
    recipientId: '123456789012345',
    text: 'Hi',
    confirmed: false,
  }), (error) => error.code === 'FACEBOOK_MESSENGER_CONFIRMATION_REQUIRED');
  await assert.rejects(client.sendMessage({
    recipientId: '123456789012345',
    text: ' ',
    confirmed: true,
  }), (error) => error.code === 'FACEBOOK_MESSENGER_MESSAGE_INVALID');
  await assert.rejects(client.sendMessage({
    recipientId: '123456789012345',
    text: 'x'.repeat(2_001),
    confirmed: true,
  }), (error) => error.code === 'FACEBOOK_MESSENGER_MESSAGE_INVALID');
  assert.equal(requests, 0);
});

test('sends a confirmed plain-text response to an allowlisted recipient with a server-only token', async () => {
  const requests = [];
  const { client } = makeClient({}, async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({
      recipient_id: '123456789012345',
      message_id: 'mid.456',
    }));
  });
  const result = await client.sendMessage({
    recipientId: '123456789012345',
    text: 'नमस्ते',
    confirmed: true,
  });
  assert.deepEqual(result, { sent: true, recipientId: '123456789012345', messageId: 'mid.456' });
  assert.equal(requests[0].url, 'https://graph.facebook.com/v22.0/123456789012345/messages');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.authorization, `Bearer ${pageAccessToken}`);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    recipient: { id: '123456789012345' },
    messaging_type: 'RESPONSE',
    message: { text: 'नमस्ते' },
  });
  assert.equal(JSON.stringify(result).includes(pageAccessToken), false);
});

test('returns only approved recipient IDs and sanitizes Meta errors', async () => {
  const { client } = makeClient();
  assert.deepEqual(client.status(), {
    configured: true,
    recipients: ['123456789012345', '987654321098765'],
  });

  const rejecting = makeClient({}, async () => new Response(JSON.stringify({
    error: { message: `invalid token ${pageAccessToken}` },
  }), { status: 401 }));
  await assert.rejects(rejecting.client.sendMessage({
    recipientId: '123456789012345',
    text: 'Hello',
    confirmed: true,
  }), (error) => {
    assert.equal(error.code, 'FACEBOOK_MESSENGER_UPSTREAM_REJECTED');
    assert.doesNotMatch(error.message, new RegExp(pageAccessToken));
    return true;
  });
});
