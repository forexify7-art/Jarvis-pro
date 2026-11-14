import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  formatLiveIntegrationResults,
  runLiveIntegrationChecks,
} from '../scripts/live-integration-check.js';

const allIntegrations = [
  'Gemini AI',
  'Google OAuth',
  'Telegram',
  'Facebook Messenger',
  'Home Assistant',
];

const completeEnvironment = {
  GEMINI_API_KEY: 'test-gemini-secret',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  GOOGLE_REDIRECT_URI: 'https://jarvis.example/api/google/callback',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  TELEGRAM_BOT_TOKEN: `123456:${'a'.repeat(35)}`,
  TELEGRAM_ALLOWED_CHAT_IDS: '123456789',
  FACEBOOK_PAGE_ID: '123456789012345',
  FACEBOOK_PAGE_ACCESS_TOKEN: 'test-facebook-secret',
  FACEBOOK_GRAPH_API_VERSION: 'v22.0',
  FACEBOOK_ALLOWED_RECIPIENT_IDS: '123456789012345',
  HOME_ASSISTANT_URL: 'https://ha.example',
  HOME_ASSISTANT_TOKEN: 'test-home-assistant-secret',
  HOME_ASSISTANT_ENTITIES: 'sensor.room_temperature',
};

test('marks missing or example credentials NOT VERIFIED without making requests', async () => {
  let requests = 0;
  const results = await runLiveIntegrationChecks({
    environment: {
      GEMINI_API_KEY: 'replace_with_your_google_ai_studio_key',
      TELEGRAM_BOT_TOKEN: 'your_bot_token',
    },
    fetcher: async () => { requests += 1; throw new Error('Unexpected request.'); },
  });

  assert.deepEqual(results.map(({ integration, status }) => [integration, status]), allIntegrations.map((integration) => [integration, 'NOT VERIFIED']));
  assert.equal(requests, 0);
});

test('marks configured Google OAuth without a connected account NOT VERIFIED', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-live-google-'));
  try {
    const results = await runLiveIntegrationChecks({
      environment: {
        GOOGLE_CLIENT_ID: completeEnvironment.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: completeEnvironment.GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI: completeEnvironment.GOOGLE_REDIRECT_URI,
        APP_ENCRYPTION_KEY: completeEnvironment.APP_ENCRYPTION_KEY,
        GOOGLE_TOKEN_FILE: join(directory, 'missing.tokens.enc'),
      },
      fetcher: async () => { throw new Error('An unconnected account must not make requests.'); },
    });

    assert.deepEqual(results.find(({ integration }) => integration === 'Google OAuth'), {
      integration: 'Google OAuth',
      status: 'NOT VERIFIED',
      reason: 'No encrypted Google OAuth connection is available.',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('uses the server Gemini key fallback only when Gemini is selected', async () => {
  const secret = 'test-gemini-fallback-secret';
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify({ models: [] }));
  };
  const environment = { AI_PROVIDER: 'gemini', AI_API_KEY: secret };

  const results = await runLiveIntegrationChecks({ environment, fetcher });

  assert.equal(results.find(({ integration }) => integration === 'Gemini AI').status, 'PASS');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers['x-goog-api-key'], secret);
  assert.equal(formatLiveIntegrationResults(results).includes(secret), false);

  const nonGeminiResults = await runLiveIntegrationChecks({
    environment: { AI_PROVIDER: 'openai-compatible', AI_API_KEY: secret },
    fetcher: async () => { throw new Error('Non-Gemini fallback must not call Google.'); },
  });
  assert.equal(nonGeminiResults.find(({ integration }) => integration === 'Gemini AI').status, 'NOT VERIFIED');
});

test('runs read-only connection checks and returns no credential or private response data', async () => {
  const requests = [];
  let googleChecks = 0;
  const fetcher = async (url, options) => {
    requests.push({ url: String(url), options });
    const requestUrl = new URL(String(url));
    if (requestUrl.hostname === 'generativelanguage.googleapis.com') {
      return new Response(JSON.stringify({ models: [{ name: 'models/test' }] }));
    }
    if (requestUrl.hostname === 'api.telegram.org') {
      return new Response(JSON.stringify({ ok: true, result: { is_bot: true, username: 'private-bot-name' } }));
    }
    if (requestUrl.hostname === 'graph.facebook.com') {
      return new Response(JSON.stringify({ id: completeEnvironment.FACEBOOK_PAGE_ID }));
    }
    if (requestUrl.hostname === 'ha.example') {
      return new Response(JSON.stringify({ message: 'API running', private: 'do not print' }));
    }
    throw new Error('Unexpected upstream.');
  };
  const googleWorkspaceFactory = () => ({
    async status() { return { configured: true, connected: true }; },
    async checkConnection() { googleChecks += 1; return { connected: true }; },
  });

  const results = await runLiveIntegrationChecks({
    environment: completeEnvironment,
    fetcher,
    googleWorkspaceFactory,
  });

  assert.deepEqual(results.map(({ integration, status }) => [integration, status]), allIntegrations.map((integration) => [integration, 'PASS']));
  assert.equal(googleChecks, 1);
  assert.equal(requests.length, 4);
  assert.ok(requests.every(({ options }) => options.cache === 'no-store' && options.redirect === 'error'));
  assert.ok(requests.every(({ options }) => !options.method || options.method === 'GET'));
  assert.ok(requests.every(({ options }) => !options.body));
  const report = formatLiveIntegrationResults(results);
  for (const secret of [
    completeEnvironment.GEMINI_API_KEY,
    completeEnvironment.GOOGLE_CLIENT_SECRET,
    completeEnvironment.TELEGRAM_BOT_TOKEN,
    completeEnvironment.FACEBOOK_PAGE_ACCESS_TOKEN,
    completeEnvironment.HOME_ASSISTANT_TOKEN,
    'private-bot-name',
    'do not print',
  ]) {
    assert.equal(report.includes(secret), false);
  }
});

test('suppresses upstream error details from live-check reports', async () => {
  const results = await runLiveIntegrationChecks({
    environment: completeEnvironment,
    fetcher: async () => { throw new Error(`request failed with ${completeEnvironment.GEMINI_API_KEY}`); },
    googleWorkspaceFactory: () => ({
      async status() { return { configured: true, connected: true }; },
      async checkConnection() { throw new Error(`token ${completeEnvironment.GOOGLE_CLIENT_SECRET}`); },
    }),
  });

  assert.ok(results.every(({ status }) => status === 'FAIL'));
  const report = formatLiveIntegrationResults(results);
  assert.equal(report.includes(completeEnvironment.GEMINI_API_KEY), false);
  assert.equal(report.includes(completeEnvironment.GOOGLE_CLIENT_SECRET), false);
});
