import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_API_BASE = 'https://www.googleapis.com';
const OAUTH_STATE_TTL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const TOKEN_AAD = Buffer.from('jarvis-google-workspace-token-v1');
const DEFAULT_TOKEN_FILE = fileURLToPath(new URL('../.data/google-workspace.tokens.enc', import.meta.url));
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events.owned',
];

function integrationError(message, status = 400, code = 'GOOGLE_WORKSPACE_ERROR') {
  return Object.assign(new Error(message), { status, code });
}

function readConfiguration(environment, defaultTokenFile) {
  const clientId = String(environment.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(environment.GOOGLE_CLIENT_SECRET || '').trim();
  const redirectUriValue = String(environment.GOOGLE_REDIRECT_URI || '').trim();
  const encryptionSecret = String(environment.APP_ENCRYPTION_KEY || '').trim();
  if (!clientId && !clientSecret && !redirectUriValue && !encryptionSecret) return null;
  if (!clientId || !clientSecret || !redirectUriValue || !encryptionSecret) {
    throw integrationError('Google Workspace requires OAuth client settings, a redirect URI, and an encryption key.', 503, 'GOOGLE_WORKSPACE_MISCONFIGURED');
  }

  let redirectUri;
  try {
    redirectUri = new URL(redirectUriValue);
  } catch {
    throw integrationError('Google Workspace redirect URI is invalid.', 503, 'GOOGLE_WORKSPACE_MISCONFIGURED');
  }
  const localHttp = redirectUri.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(redirectUri.hostname);
  if ((!localHttp && redirectUri.protocol !== 'https:')
    || redirectUri.username || redirectUri.password || redirectUri.search || redirectUri.hash
    || redirectUri.pathname !== '/api/google/callback') {
    throw integrationError('Google Workspace redirect URI must use HTTPS (or localhost for development) and end in /api/google/callback.', 503, 'GOOGLE_WORKSPACE_MISCONFIGURED');
  }

  let encryptionKey;
  try {
    encryptionKey = Buffer.from(encryptionSecret, 'base64');
  } catch {
    encryptionKey = Buffer.alloc(0);
  }
  if (encryptionKey.length !== 32 || encryptionKey.toString('base64') !== encryptionSecret) {
    throw integrationError('APP_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key.', 503, 'GOOGLE_WORKSPACE_MISCONFIGURED');
  }

  return {
    clientId,
    clientSecret,
    redirectUri: redirectUri.toString(),
    encryptionKey,
    tokenFile: resolve(environment.GOOGLE_TOKEN_FILE || defaultTokenFile),
  };
}

function parseIsoDateTime(value) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    throw integrationError('Google returned an invalid response.', 502, 'GOOGLE_UPSTREAM_INVALID_RESPONSE');
  }
}

export function createGoogleWorkspace({
  environment = process.env,
  fetcher,
  now = () => Date.now(),
  defaultTokenFile = DEFAULT_TOKEN_FILE,
} = {}) {
  const pendingStates = new Map();
  let refreshPromise = null;

  function getConfiguration() {
    const configuration = readConfiguration(environment, defaultTokenFile);
    if (!configuration) {
      throw integrationError('Google Workspace is not configured on this server.', 503, 'GOOGLE_WORKSPACE_NOT_CONFIGURED');
    }
    return configuration;
  }

  function fetchRequest(url, options) {
    const implementation = fetcher || globalThis.fetch;
    if (typeof implementation !== 'function') {
      throw integrationError('Google Workspace networking is unavailable.', 503, 'GOOGLE_WORKSPACE_UNAVAILABLE');
    }
    return implementation(url, options);
  }

  async function loadTokens(configuration) {
    let envelope;
    try {
      envelope = JSON.parse(await readFile(configuration.tokenFile, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw integrationError('Stored Google Workspace authorization could not be read.', 500, 'GOOGLE_TOKEN_STORE_ERROR');
    }
    if (envelope?.version !== 1 || typeof envelope.iv !== 'string'
      || typeof envelope.tag !== 'string' || typeof envelope.ciphertext !== 'string') {
      throw integrationError('Stored Google Workspace authorization is invalid.', 500, 'GOOGLE_TOKEN_STORE_ERROR');
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', configuration.encryptionKey, Buffer.from(envelope.iv, 'base64'));
      decipher.setAAD(TOKEN_AAD);
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8');
      const tokens = JSON.parse(plaintext);
      if (typeof tokens.refreshToken !== 'string' || !tokens.refreshToken) throw new Error('Missing refresh token.');
      return tokens;
    } catch {
      throw integrationError('Stored Google Workspace authorization could not be decrypted. Check APP_ENCRYPTION_KEY.', 500, 'GOOGLE_TOKEN_STORE_ERROR');
    }
  }

  async function saveTokens(configuration, tokens) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', configuration.encryptionKey, iv);
    cipher.setAAD(TOKEN_AAD);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(tokens), 'utf8'),
      cipher.final(),
    ]);
    const envelope = JSON.stringify({
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    });
    const temporaryFile = `${configuration.tokenFile}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await mkdir(dirname(configuration.tokenFile), { recursive: true, mode: 0o700 });
      await writeFile(temporaryFile, envelope, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporaryFile, configuration.tokenFile);
      await chmod(configuration.tokenFile, 0o600);
    } catch {
      await unlink(temporaryFile).catch(() => {});
      throw integrationError('Google Workspace authorization could not be stored securely.', 500, 'GOOGLE_TOKEN_STORE_ERROR');
    }
  }

  async function postTokenForm(configuration, parameters) {
    let response;
    try {
      response = await fetchRequest(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(parameters),
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw integrationError(error?.name === 'TimeoutError' ? 'Google authorization timed out.' : 'Google authorization is unreachable.', error?.name === 'TimeoutError' ? 504 : 502, 'GOOGLE_UPSTREAM_UNAVAILABLE');
    }
    const result = await readJsonResponse(response);
    if (!response.ok || typeof result.access_token !== 'string' || !Number.isFinite(Number(result.expires_in))) {
      throw integrationError('Google rejected the authorization request.', 502, 'GOOGLE_AUTHORIZATION_FAILED');
    }
    return result;
  }

  async function refreshTokens(configuration, existingTokens) {
    if (!existingTokens?.refreshToken) {
      throw integrationError('Google Workspace is not connected. Connect an account first.', 409, 'GOOGLE_WORKSPACE_NOT_CONNECTED');
    }
    const result = await postTokenForm(configuration, {
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: existingTokens.refreshToken,
    });
    const tokens = {
      refreshToken: typeof result.refresh_token === 'string' ? result.refresh_token : existingTokens.refreshToken,
      accessToken: result.access_token,
      expiresAt: now() + Number(result.expires_in) * 1000,
    };
    await saveTokens(configuration, tokens);
    return tokens;
  }

  async function getAccessToken(configuration, existingTokens) {
    if (existingTokens.accessToken && existingTokens.expiresAt > now() + 60_000) return existingTokens;
    if (!refreshPromise) {
      refreshPromise = refreshTokens(configuration, existingTokens).finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }

  async function googleApi(path, { method = 'GET', body } = {}) {
    const configuration = getConfiguration();
    const existingTokens = await loadTokens(configuration);
    if (!existingTokens) {
      throw integrationError('Google Workspace is not connected. Connect an account first.', 409, 'GOOGLE_WORKSPACE_NOT_CONNECTED');
    }
    let tokens = await getAccessToken(configuration, existingTokens);
    const send = () => fetchRequest(`${GOOGLE_API_BASE}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${tokens.accessToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let response;
    try {
      response = await send();
      if (response.status === 401) {
        tokens = await refreshTokens(configuration, tokens);
        response = await send();
      }
    } catch (error) {
      if (error.status) throw error;
      throw integrationError(error?.name === 'TimeoutError' ? 'Google request timed out.' : 'Google Workspace is unreachable.', error?.name === 'TimeoutError' ? 504 : 502, 'GOOGLE_UPSTREAM_UNAVAILABLE');
    }
    const result = await readJsonResponse(response);
    if (!response.ok) {
      throw integrationError('Google Workspace rejected the request.', 502, 'GOOGLE_UPSTREAM_REJECTED');
    }
    return result;
  }

  return {
    async status() {
      const configuration = readConfiguration(environment, defaultTokenFile);
      if (!configuration) return { configured: false, connected: false };
      const tokens = await loadTokens(configuration);
      return {
        configured: true,
        connected: Boolean(tokens?.refreshToken),
        ...(tokens?.expiresAt ? { accessTokenExpiresAt: tokens.expiresAt } : {}),
      };
    },

    async checkConnection() {
      const result = await googleApi('/calendar/v3/calendars/primary/events?maxResults=1');
      if (!Array.isArray(result.items)) {
        throw integrationError('Google Calendar returned an invalid response.', 502, 'GOOGLE_UPSTREAM_INVALID_RESPONSE');
      }
      return { connected: true };
    },

    startAuthorization() {
      const configuration = getConfiguration();
      const timestamp = now();
      for (const [state, pending] of pendingStates) {
        if (timestamp - pending.createdAt > OAUTH_STATE_TTL_MS) pendingStates.delete(state);
      }
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      pendingStates.set(state, { verifier, createdAt: timestamp });
      const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
      authorizationUrl.search = new URLSearchParams({
        client_id: configuration.clientId,
        redirect_uri: configuration.redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString();
      return { authorizationUrl: authorizationUrl.toString() };
    },

    async completeAuthorization({ code, state } = {}) {
      const configuration = getConfiguration();
      const pending = typeof state === 'string' ? pendingStates.get(state) : null;
      if (!pending || now() - pending.createdAt > OAUTH_STATE_TTL_MS) {
        if (typeof state === 'string') pendingStates.delete(state);
        throw integrationError('Google authorization state is invalid or expired. Start the connection again.', 400, 'GOOGLE_OAUTH_STATE_INVALID');
      }
      pendingStates.delete(state);
      if (typeof code !== 'string' || !code || code.length > 4_096) {
        throw integrationError('Google did not return a valid authorization code.', 400, 'GOOGLE_OAUTH_CODE_INVALID');
      }
      const existingTokens = await loadTokens(configuration);
      const result = await postTokenForm(configuration, {
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        code,
        code_verifier: pending.verifier,
        grant_type: 'authorization_code',
        redirect_uri: configuration.redirectUri,
      });
      const refreshToken = typeof result.refresh_token === 'string' && result.refresh_token
        ? result.refresh_token
        : existingTokens?.refreshToken;
      if (!refreshToken) {
        throw integrationError('Google did not grant offline access. Reconnect and approve the requested access.', 502, 'GOOGLE_REFRESH_TOKEN_MISSING');
      }
      await saveTokens(configuration, {
        accessToken: result.access_token,
        refreshToken,
        expiresAt: now() + Number(result.expires_in) * 1000,
      });
      return { connected: true };
    },

    async createDraft({ to, subject, body } = {}) {
      if (typeof to !== 'string' || to.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) {
        throw integrationError('Enter one valid recipient email address.', 400, 'GOOGLE_DRAFT_INVALID');
      }
      if (typeof subject !== 'string' || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) {
        throw integrationError('Email subject must be 1 to 200 characters without line breaks.', 400, 'GOOGLE_DRAFT_INVALID');
      }
      if (typeof body !== 'string' || !body.trim() || body.length > 12_000) {
        throw integrationError('Email body must be 1 to 12000 characters.', 400, 'GOOGLE_DRAFT_INVALID');
      }
      const message = [
        `To: ${to}`,
        `Subject: ${subject.trim()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        body,
      ].join('\r\n');
      const result = await googleApi('/gmail/v1/users/me/drafts', {
        method: 'POST',
        body: { message: { raw: Buffer.from(message, 'utf8').toString('base64url') } },
      });
      if (typeof result.id !== 'string') {
        throw integrationError('Google did not confirm the Gmail draft.', 502, 'GOOGLE_UPSTREAM_INVALID_RESPONSE');
      }
      return { draftId: result.id };
    },

    async listEvents({ timeMin, timeMax } = {}) {
      const start = parseIsoDateTime(timeMin);
      const end = parseIsoDateTime(timeMax);
      if (start === null || end === null || end <= start || end - start > 31 * 24 * 60 * 60_000) {
        throw integrationError('Calendar range must be valid and no longer than 31 days.', 400, 'GOOGLE_CALENDAR_RANGE_INVALID');
      }
      const query = new URLSearchParams({
        timeMin: new Date(start).toISOString(),
        timeMax: new Date(end).toISOString(),
        maxResults: '50',
        singleEvents: 'true',
        orderBy: 'startTime',
      });
      const result = await googleApi(`/calendar/v3/calendars/primary/events?${query}`);
      return (Array.isArray(result.items) ? result.items : []).slice(0, 50).map((event) => ({
        id: typeof event.id === 'string' ? event.id.slice(0, 256) : '',
        summary: typeof event.summary === 'string' ? event.summary.slice(0, 200) : '(untitled event)',
        start: event.start?.dateTime || event.start?.date || '',
        end: event.end?.dateTime || event.end?.date || '',
      })).filter((event) => event.id && event.start && event.end);
    },

    async createEvent({ summary, description = '', start, end, confirmed } = {}) {
      if (confirmed !== true) {
        throw integrationError('Confirm the calendar event details before creating it.', 400, 'GOOGLE_CALENDAR_CONFIRMATION_REQUIRED');
      }
      const startTime = parseIsoDateTime(start);
      const endTime = parseIsoDateTime(end);
      if (typeof summary !== 'string' || !summary.trim() || summary.length > 200
        || startTime === null || endTime === null || endTime <= startTime
        || endTime - startTime > 31 * 24 * 60 * 60_000
        || (typeof description !== 'string' || description.length > 2_000)) {
        throw integrationError('Calendar event details are invalid.', 400, 'GOOGLE_CALENDAR_EVENT_INVALID');
      }
      const result = await googleApi('/calendar/v3/calendars/primary/events', {
        method: 'POST',
        body: {
          summary: summary.trim(),
          description,
          start: { dateTime: new Date(startTime).toISOString() },
          end: { dateTime: new Date(endTime).toISOString() },
        },
      });
      if (typeof result.id !== 'string') {
        throw integrationError('Google did not confirm the calendar event.', 502, 'GOOGLE_UPSTREAM_INVALID_RESPONSE');
      }
      return { eventId: result.id, summary: summary.trim(), start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString() };
    },

    async disconnect() {
      const configuration = getConfiguration();
      const tokens = await loadTokens(configuration);
      if (!tokens) return { disconnected: true };
      let response;
      try {
        response = await fetchRequest(GOOGLE_REVOKE_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tokens.refreshToken }),
          cache: 'no-store',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        throw integrationError(error?.name === 'TimeoutError' ? 'Google token revocation timed out.' : 'Google token revocation is unreachable.', error?.name === 'TimeoutError' ? 504 : 502, 'GOOGLE_UPSTREAM_UNAVAILABLE');
      }
      if (!response.ok && response.status !== 400) {
        throw integrationError('Google could not revoke the authorization. Local credentials were retained.', 502, 'GOOGLE_REVOCATION_FAILED');
      }
      await unlink(configuration.tokenFile).catch((error) => {
        if (error.code !== 'ENOENT') throw integrationError('Local Google credentials could not be deleted.', 500, 'GOOGLE_TOKEN_STORE_ERROR');
      });
      return { disconnected: true };
    },
  };
}