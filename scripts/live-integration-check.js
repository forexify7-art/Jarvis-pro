import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFacebookMessengerConfiguration } from '../integrations/facebook-messenger.js';
import { createGoogleWorkspace } from '../integrations/google-workspace.js';
import { readHomeAssistantConfiguration } from '../integrations/home-assistant.js';
import { readTelegramConfiguration } from '../integrations/telegram.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const FACEBOOK_API_BASE = 'https://graph.facebook.com';
const REQUEST_TIMEOUT_MS = 8_000;

function isPresent(environment, keys) {
  return keys.every((key) => {
    const value = typeof environment[key] === 'string' ? environment[key].trim() : '';
    return value && !/^(?:replace_with_|your_)/i.test(value);
  });
}

function notVerified(integration, reason) {
  return { integration, status: 'NOT VERIFIED', reason };
}

async function requestJson(fetcher, url, options = {}) {
  if (typeof fetcher !== 'function') throw new Error('Networking unavailable.');
  const response = await fetcher(url, {
    ...options,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('Upstream rejected the check.');
  try {
    return await response.json();
  } catch {
    throw new Error('Upstream response was invalid.');
  }
}

async function runCheck(integration, check) {
  try {
    await check();
    return { integration, status: 'PASS' };
  } catch (error) {
    return {
      integration,
      status: 'FAIL',
      reason: error?.name === 'TimeoutError' ? 'Connection timed out; details suppressed.' : 'Connection or configuration check failed; details suppressed.',
    };
  }
}

export async function runLiveIntegrationChecks({
  environment = process.env,
  fetcher = globalThis.fetch,
  googleWorkspaceFactory = createGoogleWorkspace,
} = {}) {
  const results = [];
  const geminiApiKey = String(
    environment.GEMINI_API_KEY
      || (environment.AI_PROVIDER === 'gemini' ? environment.AI_API_KEY : '')
      || '',
  ).trim();

  if (!isPresent({ geminiApiKey }, ['geminiApiKey'])) {
    results.push(notVerified('Gemini AI', 'GEMINI_API_KEY is not configured.'));
  } else {
    results.push(await runCheck('Gemini AI', async () => {
      const url = new URL(`${GEMINI_API_BASE}/models`);
      url.searchParams.set('pageSize', '1');
      const response = await requestJson(fetcher, url, {
        headers: { accept: 'application/json', 'x-goog-api-key': geminiApiKey },
      });
      if (!Array.isArray(response.models)) throw new Error('Invalid Gemini response.');
    }));
  }

  const googleSettings = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'APP_ENCRYPTION_KEY'];
  if (!isPresent(environment, googleSettings)) {
    results.push(notVerified('Google OAuth', 'OAuth client settings or encryption key are not configured.'));
  } else {
    let workspace;
    let status;
    try {
      workspace = googleWorkspaceFactory({ environment, fetcher });
      status = await workspace.status();
    } catch {
      results.push({
        integration: 'Google OAuth',
        status: 'FAIL',
        reason: 'Connection or configuration check failed; details suppressed.',
      });
    }
    if (status?.configured && !status.connected) {
      results.push(notVerified('Google OAuth', 'No encrypted Google OAuth connection is available.'));
    } else if (status?.configured && status.connected) {
      results.push(await runCheck('Google OAuth', () => workspace.checkConnection()));
    } else if (status) {
      results.push(notVerified('Google OAuth', 'OAuth configuration is unavailable.'));
    }
  }

  const telegramSettings = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_CHAT_IDS'];
  if (!isPresent(environment, telegramSettings)) {
    results.push(notVerified('Telegram', 'Bot token or approved chat list is not configured.'));
  } else {
    results.push(await runCheck('Telegram', async () => {
      const configuration = readTelegramConfiguration(environment);
      if (!configuration) throw new Error('Telegram configuration is unavailable.');
      const response = await requestJson(
        fetcher,
        `https://api.telegram.org/bot${configuration.token}/getMe`,
        { headers: { accept: 'application/json' } },
      );
      if (response.ok !== true || response.result?.is_bot !== true) throw new Error('Telegram bot check failed.');
    }));
  }

  const facebookSettings = [
    'FACEBOOK_PAGE_ID',
    'FACEBOOK_PAGE_ACCESS_TOKEN',
    'FACEBOOK_GRAPH_API_VERSION',
    'FACEBOOK_ALLOWED_RECIPIENT_IDS',
  ];
  if (!isPresent(environment, facebookSettings)) {
    results.push(notVerified('Facebook Messenger', 'Page credentials or approved recipient list are not configured.'));
  } else {
    results.push(await runCheck('Facebook Messenger', async () => {
      const configuration = readFacebookMessengerConfiguration(environment);
      if (!configuration) throw new Error('Facebook Messenger configuration is unavailable.');
      const url = new URL(`${FACEBOOK_API_BASE}/${configuration.graphApiVersion}/${configuration.pageId}`);
      url.searchParams.set('fields', 'id');
      const response = await requestJson(fetcher, url, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${configuration.pageAccessToken}`,
        },
      });
      if (String(response.id) !== configuration.pageId) throw new Error('Facebook Page check failed.');
    }));
  }

  const homeAssistantSettings = ['HOME_ASSISTANT_URL', 'HOME_ASSISTANT_TOKEN', 'HOME_ASSISTANT_ENTITIES'];
  if (!isPresent(environment, homeAssistantSettings)) {
    results.push(notVerified('Home Assistant', 'Server URL, token, or entity allowlist is not configured.'));
  } else {
    results.push(await runCheck('Home Assistant', async () => {
      const configuration = readHomeAssistantConfiguration(environment);
      if (!configuration) throw new Error('Home Assistant configuration is unavailable.');
      if (typeof fetcher !== 'function') throw new Error('Networking unavailable.');
      const response = await fetcher(`${configuration.baseUrl}/api/`, {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${configuration.token}`,
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error('Home Assistant rejected the check.');
    }));
  }

  return results;
}

export function formatLiveIntegrationResults(results) {
  return [
    'Live integration checks (read-only; secrets and upstream response bodies are not printed)',
    ...results.map(({ integration, status, reason }) => (
      `${integration}: ${status}${reason ? ` — ${reason}` : ''}`
    )),
  ].join('\n');
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entrypoint) {
  const results = await runLiveIntegrationChecks();
  process.stdout.write(`${formatLiveIntegrationResults(results)}\n`);
  if (results.some(({ status }) => status === 'FAIL')) process.exitCode = 1;
}
