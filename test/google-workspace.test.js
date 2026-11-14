import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createGoogleWorkspace } from '../integrations/google-workspace.js';

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-google-workspace-'));
  const environment = {
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:4173/api/google/callback',
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    GOOGLE_TOKEN_FILE: join(directory, 'tokens.enc'),
  };
  const requests = [];
  let timestamp = Date.now();
  const fetcher = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    const requestUrl = new URL(String(url));
    if (requestUrl.hostname === 'oauth2.googleapis.com' && requestUrl.pathname === '/token') {
      const body = new URLSearchParams(options.body);
      return new Response(JSON.stringify(body.get('grant_type') === 'authorization_code'
        ? { access_token: 'access-token-secret', refresh_token: 'refresh-token-secret', expires_in: 3_600 }
        : { access_token: 'refreshed-access-token', expires_in: 3_600 }));
    }
    if (requestUrl.pathname === '/gmail/v1/users/me/drafts') return new Response(JSON.stringify({ id: 'draft-123' }));
    if (requestUrl.pathname === '/calendar/v3/calendars/primary/events' && options.method === 'POST') {
      return new Response(JSON.stringify({ id: 'event-456' }));
    }
    if (requestUrl.pathname === '/calendar/v3/calendars/primary/events') {
      return new Response(JSON.stringify({ items: [{ id: 'event-456', summary: 'Planning', start: { dateTime: '2026-11-09T10:00:00Z' }, end: { dateTime: '2026-11-09T11:00:00Z' } }] }));
    }
    if (requestUrl.hostname === 'oauth2.googleapis.com' && requestUrl.pathname === '/revoke') return new Response(null, { status: 200 });
    throw new Error(`Unexpected Google request: ${url}`);
  };
  const workspace = createGoogleWorkspace({ environment, fetcher, now: () => timestamp });
  return {
    directory,
    environment,
    requests,
    workspace,
    advanceTime(milliseconds) { timestamp += milliseconds; },
  };
}

test('requires complete OAuth configuration and rejects insecure remote redirects', async () => {
  const unconfigured = createGoogleWorkspace({ environment: {} });
  assert.deepEqual(await unconfigured.status(), { configured: false, connected: false });
  assert.throws(() => unconfigured.startAuthorization(), (error) => error.code === 'GOOGLE_WORKSPACE_NOT_CONFIGURED');

  const fixture = await createFixture();
  try {
    fixture.environment.GOOGLE_REDIRECT_URI = 'http://example.com/api/google/callback';
    assert.throws(() => fixture.workspace.startAuthorization(), (error) => error.code === 'GOOGLE_WORKSPACE_MISCONFIGURED');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('uses one-time PKCE OAuth state and encrypts refresh tokens with owner-only permissions', async () => {
  const fixture = await createFixture();
  try {
    const { authorizationUrl } = fixture.workspace.startAuthorization();
    const authorization = new URL(authorizationUrl);
    const state = authorization.searchParams.get('state');
    assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorization.searchParams.get('access_type'), 'offline');
    assert.match(authorization.searchParams.get('scope'), /gmail\.compose/);
    assert.match(authorization.searchParams.get('scope'), /calendar\.events\.owned/);

    await assert.rejects(fixture.workspace.completeAuthorization({ code: 'code', state: 'attacker-state' }), (error) => error.code === 'GOOGLE_OAUTH_STATE_INVALID');
    assert.equal(fixture.requests.length, 0);
    assert.deepEqual(await fixture.workspace.completeAuthorization({ code: 'authorization-code', state }), { connected: true });
    const status = await fixture.workspace.status();
    assert.equal(status.configured, true);
    assert.equal(status.connected, true);
    assert.ok(status.accessTokenExpiresAt > Date.now());
    const tokenFile = await readFile(fixture.environment.GOOGLE_TOKEN_FILE, 'utf8');
    assert.doesNotMatch(tokenFile, /access-token-secret|refresh-token-secret/);
    assert.equal((await stat(fixture.environment.GOOGLE_TOKEN_FILE)).mode & 0o777, 0o600);
    assert.equal(new URLSearchParams(fixture.requests[0].options.body).get('code_verifier')?.length, 43);
    await assert.rejects(fixture.workspace.completeAuthorization({ code: 'authorization-code', state }), (error) => error.code === 'GOOGLE_OAUTH_STATE_INVALID');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('creates Gmail drafts, reads bounded calendar ranges, and requires confirmation for event writes', async () => {
  const fixture = await createFixture();
  try {
    const { authorizationUrl } = fixture.workspace.startAuthorization();
    await fixture.workspace.completeAuthorization({ code: 'authorization-code', state: new URL(authorizationUrl).searchParams.get('state') });
    fixture.advanceTime(3_600_001);
    assert.deepEqual(await fixture.workspace.createDraft({ to: 'person@example.com', subject: 'Hello', body: 'Draft only' }), { draftId: 'draft-123' });
    const gmailRequest = fixture.requests.find(({ url }) => url.includes('/gmail/v1/users/me/drafts'));
    assert.equal(gmailRequest.options.method, 'POST');
    assert.equal(gmailRequest.options.headers.authorization, 'Bearer refreshed-access-token');
    const refreshRequest = fixture.requests.find(({ url, options }) => url.endsWith('/token')
      && new URLSearchParams(options.body).get('grant_type') === 'refresh_token');
    assert.equal(new URLSearchParams(refreshRequest.options.body).get('refresh_token'), 'refresh-token-secret');
    const draftBody = JSON.parse(gmailRequest.options.body);
    assert.match(Buffer.from(draftBody.message.raw, 'base64url').toString('utf8'), /Draft only/);

    const timeMin = '2026-11-09T00:00:00Z';
    const timeMax = '2026-11-10T00:00:00Z';
    assert.deepEqual(await fixture.workspace.listEvents({ timeMin, timeMax }), [
      { id: 'event-456', summary: 'Planning', start: '2026-11-09T10:00:00Z', end: '2026-11-09T11:00:00Z' },
    ]);
    await assert.rejects(fixture.workspace.listEvents({ timeMin, timeMax: '2027-01-01T00:00:00Z' }), (error) => error.code === 'GOOGLE_CALENDAR_RANGE_INVALID');
    await assert.rejects(fixture.workspace.createEvent({ summary: 'Planning', start: timeMin, end: timeMax, confirmed: false }), (error) => error.code === 'GOOGLE_CALENDAR_CONFIRMATION_REQUIRED');
    assert.equal(fixture.requests.filter(({ url }) => url.includes('/calendar/v3/calendars/primary/events') && url.endsWith('/events') && fixture.requests.length).filter(({ options }) => options.method === 'POST').length, 0);

    assert.deepEqual(await fixture.workspace.createEvent({ summary: 'Planning', start: timeMin, end: timeMax, confirmed: true }), {
      eventId: 'event-456', summary: 'Planning', start: '2026-11-09T00:00:00.000Z', end: '2026-11-10T00:00:00.000Z',
    });
    const eventRequest = fixture.requests.find(({ url, options }) => url.includes('/calendar/v3/calendars/primary/events') && options.method === 'POST');
    assert.deepEqual(JSON.parse(eventRequest.options.body), {
      summary: 'Planning', description: '',
      start: { dateTime: '2026-11-09T00:00:00.000Z' },
      end: { dateTime: '2026-11-10T00:00:00.000Z' },
    });
    await assert.rejects(fixture.workspace.createDraft({ to: 'bad\r\nBcc: victim@example.com', subject: 'Hello', body: 'Nope' }), (error) => error.code === 'GOOGLE_DRAFT_INVALID');
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test('revokes Google access before deleting local tokens', async () => {
  const fixture = await createFixture();
  try {
    const { authorizationUrl } = fixture.workspace.startAuthorization();
    await fixture.workspace.completeAuthorization({ code: 'authorization-code', state: new URL(authorizationUrl).searchParams.get('state') });
    assert.deepEqual(await fixture.workspace.disconnect(), { disconnected: true });
    assert.deepEqual(await fixture.workspace.status(), { configured: true, connected: false });
    assert.ok(fixture.requests.some(({ url }) => url.endsWith('/revoke')));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});