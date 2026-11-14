const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MAX_MESSAGE_LENGTH = 4_096;
const DEFAULT_TIMEOUT_MS = 8_000;

function telegramError(message, status = 400, code = 'TELEGRAM_ERROR') {
  return Object.assign(new Error(message), { status, code });
}

export function readTelegramConfiguration(environment = process.env) {
  const token = String(environment.TELEGRAM_BOT_TOKEN || '').trim();
  const rawChatIds = String(environment.TELEGRAM_ALLOWED_CHAT_IDS || '').trim();
  if (!token && !rawChatIds) return null;
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token) || !rawChatIds) {
    throw telegramError('Telegram requires a valid bot token and an allowed chat ID list.', 503, 'TELEGRAM_MISCONFIGURED');
  }
  const chatIds = [...new Set(rawChatIds.split(',').map((chatId) => chatId.trim()).filter(Boolean))];
  if (!chatIds.length || chatIds.length > 50 || chatIds.some((chatId) => !/^-?[1-9]\d{0,19}$/.test(chatId))) {
    throw telegramError('Telegram allowed chat IDs must be valid numeric IDs (maximum 50).', 503, 'TELEGRAM_MISCONFIGURED');
  }
  return { token, chatIds };
}

export function createTelegramClient({
  environment = process.env,
  fetcher,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  function getConfiguration() {
    const configuration = readTelegramConfiguration(environment);
    if (!configuration) {
      throw telegramError('Telegram messaging is not configured on this server.', 503, 'TELEGRAM_NOT_CONFIGURED');
    }
    return configuration;
  }

  return {
    status() {
      const configuration = readTelegramConfiguration(environment);
      return configuration
        ? { configured: true, recipients: [...configuration.chatIds] }
        : { configured: false, recipients: [] };
    },

    async sendMessage({ chatId, text, confirmed } = {}) {
      const configuration = getConfiguration();
      const selectedChatId = typeof chatId === 'string' ? chatId : '';
      if (!configuration.chatIds.includes(selectedChatId)) {
        throw telegramError('This Telegram chat is not allowlisted by the server administrator.', 403, 'TELEGRAM_RECIPIENT_NOT_ALLOWED');
      }
      if (confirmed !== true) {
        throw telegramError('Confirm the exact Telegram recipient and message before sending.', 400, 'TELEGRAM_CONFIRMATION_REQUIRED');
      }
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_MESSAGE_LENGTH) {
        throw telegramError('Telegram messages must contain 1 to 4096 characters.', 400, 'TELEGRAM_MESSAGE_INVALID');
      }
      const request = fetcher || globalThis.fetch;
      if (typeof request !== 'function') {
        throw telegramError('Telegram networking is unavailable.', 503, 'TELEGRAM_UNAVAILABLE');
      }

      let response;
      try {
        response = await request(`${TELEGRAM_API_BASE}/bot${configuration.token}/sendMessage`, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: selectedChatId, text }),
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw telegramError(
          error?.name === 'TimeoutError' ? 'Telegram message request timed out.' : 'Telegram is unreachable.',
          error?.name === 'TimeoutError' ? 504 : 502,
          'TELEGRAM_UPSTREAM_UNAVAILABLE',
        );
      }

      let result;
      try {
        result = await response.json();
      } catch {
        throw telegramError('Telegram returned an invalid response.', 502, 'TELEGRAM_UPSTREAM_INVALID_RESPONSE');
      }
      if (!response.ok || result?.ok !== true || !Number.isSafeInteger(result.result?.message_id)) {
        throw telegramError('Telegram rejected the message request.', 502, 'TELEGRAM_UPSTREAM_REJECTED');
      }
      return { sent: true, chatId: selectedChatId, messageId: result.result.message_id };
    },
  };
}