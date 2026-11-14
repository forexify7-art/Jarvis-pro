import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createHomeAssistantClient, readHomeAssistantConfiguration } from '../integrations/home-assistant.js';

const configuredEnvironment = {
  HOME_ASSISTANT_URL: 'http://homeassistant.local:8123',
  HOME_ASSISTANT_TOKEN: 'server-only-test-token',
  HOME_ASSISTANT_ENTITIES: 'light.office,sensor.room_temperature',
};

test('requires a complete server-side Home Assistant configuration', () => {
  assert.equal(readHomeAssistantConfiguration({}), null);
  assert.throws(() => readHomeAssistantConfiguration({ HOME_ASSISTANT_URL: configuredEnvironment.HOME_ASSISTANT_URL }), /requires a server URL, token, and entity allowlist/);
  assert.throws(() => readHomeAssistantConfiguration({
    ...configuredEnvironment,
    HOME_ASSISTANT_URL: 'https://user:password@example.com',
  }), /must be an http\(s\) origin without credentials or a path/);
  assert.throws(() => readHomeAssistantConfiguration({
    ...configuredEnvironment,
    HOME_ASSISTANT_ENTITIES: 'light.office,lock.front_door',
  }), /unsupported entity/);
  assert.throws(() => readHomeAssistantConfiguration({
    ...configuredEnvironment,
    HOME_ASSISTANT_ENTITIES: 'light.office,../../private',
  }), /unsupported entity/);
  assert.throws(() => readHomeAssistantConfiguration({
    ...configuredEnvironment,
    HOME_ASSISTANT_CONTROL_ENTITIES: 'sensor.room_temperature',
  }), /only allowlisted lights or switches/);
  assert.throws(() => readHomeAssistantConfiguration({
    ...configuredEnvironment,
    HOME_ASSISTANT_CONTROL_ENTITIES: 'switch.unlisted',
  }), /only allowlisted lights or switches/);
});

test('fetches only allowlisted entity states and returns minimal data without credentials', async () => {
  const configuration = readHomeAssistantConfiguration(configuredEnvironment);
  const requests = [];
  const client = createHomeAssistantClient({
    configuration,
    fetcher: async (url, options) => {
      requests.push({ url, options });
      const entityId = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
      return new Response(JSON.stringify({
        entity_id: entityId,
        state: entityId === 'light.office' ? 'on' : '21.5',
        attributes: { friendly_name: `${entityId} room`, secret: 'must not escape' },
        last_changed: '2026-01-01T00:00:00Z',
      }));
    },
  });

  const entities = await client.listEntities();
  assert.deepEqual(entities, [
    { entityId: 'light.office', state: 'on', name: 'light.office room' },
    { entityId: 'sensor.room_temperature', state: '21.5', name: 'sensor.room_temperature room' },
  ]);
  assert.equal(requests.length, 2);
  for (const { url, options } of requests) {
    assert.match(url, /^http:\/\/homeassistant\.local:8123\/api\/states\//);
    assert.equal(options.headers.authorization, 'Bearer server-only-test-token');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal);
  }
  assert.doesNotMatch(JSON.stringify(entities), /server-only-test-token|must not escape|last_changed/);
});

test('omits missing entities and converts upstream failures to redacted errors', async () => {
  const configuration = readHomeAssistantConfiguration(configuredEnvironment);
  const missingClient = createHomeAssistantClient({
    configuration,
    fetcher: async () => new Response('', { status: 404 }),
  });
  assert.deepEqual(await missingClient.listEntities(), []);

  const failedClient = createHomeAssistantClient({
    configuration,
    fetcher: async () => new Response('private upstream detail', { status: 401 }),
  });
  await assert.rejects(failedClient.listEntities(), (error) => (
    error.status === 502 && !error.message.includes('private upstream detail') && !error.message.includes('server-only-test-token')
  ));
});

test('controls only confirmed allowlisted light/switch on/off actions and verifies state', async () => {
  const configuration = readHomeAssistantConfiguration({
    ...configuredEnvironment,
    HOME_ASSISTANT_CONTROL_ENTITIES: 'light.office',
  });
  const requests = [];
  let state = 'off';
  const client = createHomeAssistantClient({
    configuration,
    fetcher: async (url, options) => {
      requests.push({ url, options });
      if (options.method === 'POST') {
        state = url.endsWith('/turn_on') ? 'on' : 'off';
        return new Response('[]');
      }
      return new Response(JSON.stringify({ entity_id: 'light.office', state }));
    },
  });

  await assert.rejects(client.controlEntity({ entityId: 'light.office', targetState: 'on', confirmed: false }), (error) => error.status === 400);
  await assert.rejects(client.controlEntity({ entityId: 'switch.unlisted', targetState: 'on', confirmed: true }), (error) => error.status === 403);
  await assert.rejects(client.controlEntity({ entityId: 'light.office', targetState: 'toggle', confirmed: true }), (error) => error.status === 400);
  assert.equal(requests.length, 0);

  const result = await client.controlEntity({ entityId: 'light.office', targetState: 'on', confirmed: true });
  assert.deepEqual(result, { entityId: 'light.office', state: 'on', canControl: true });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, 'http://homeassistant.local:8123/api/services/light/turn_on');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), { entity_id: 'light.office' });
  assert.equal(requests[0].options.headers.authorization, 'Bearer server-only-test-token');
});

test('exposes a user-triggered read-only view without a browser token field', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="home-assistant-refresh"/);
  assert.match(html, /id="home-assistant-entities"/);
  assert.match(html, /after confirmation/);
  assert.doesNotMatch(html, /home-assistant-token|home-assistant-api-key/i);
  assert.match(app, /homeAssistantRefresh\.addEventListener\('click', refreshHomeAssistantEntities\)/);
  assert.match(app, /fetch\('\/api\/home-assistant\/entities'[\s\S]*?headers: apiHeaders\(\)/);
  assert.match(app, /name\.textContent = entity\.name \|\| entity\.entityId/);
  assert.match(app, /state\.textContent = ` \$\{entity\.state\}`/);
  assert.match(app, /window\.confirm\(`Set \$\{label\} \(\$\{entityId\}\) to \$\{targetState\}\?`\)/);
  assert.match(app, /fetch\('\/api\/home-assistant\/control'/);
});