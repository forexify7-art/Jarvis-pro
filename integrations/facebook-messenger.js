const FACEBOOK_GRAPH_API_BASE = 'https://graph.facebook.com';
const MAX_MESSAGE_LENGTH = 2_000;
const DEFAULT_TIMEOUT_MS = 8_000;

function facebookMessengerError(message, status = 400, code = 'FACEBOOK_MESSENGER_ERROR') {
  return Object.assign(new Error(message), { status, code });
}

export function readFacebookMessengerConfiguration(environment = process.env) {
  const pageId = String(environment.FACEBOOK_PAGE_ID || '').trim();
  const pageAccessToken = String(environment.FACEBOOK_PAGE_ACCESS_TOKEN || '').trim();
  const rawRecipientIds = String(environment.FACEBOOK_ALLOWED_RECIPIENT_IDS || '').trim();
  const graphApiVersion = String(environment.FACEBOOK_GRAPH_API_VERSION || '').trim();
  if (!pageId && !pageAccessToken && !rawRecipientIds && !graphApiVersion) return null;

  if (
    !/^[1-9]\d{5,19}$/.test(pageId)
    || !pageAccessToken
    || pageAccessToken.length > 4_096
    || /\s/.test(pageAccessToken)
    || !/^v\d{1,3}\.\d{1,2}$/.test(graphApiVersion)
    || !rawRecipientIds
  ) {
    throw facebookMessengerError(
      'Facebook Messenger requires a valid Page ID, Page access token, Graph API version, and recipient allowlist.',
      503,
      'FACEBOOK_MESSENGER_MISCONFIGURED',
    );
  }

  const recipientIds = [...new Set(rawRecipientIds.split(',').map((recipientId) => recipientId.trim()).filter(Boolean))];
  if (!recipientIds.length || recipientIds.length > 50 || recipientIds.some((recipientId) => !/^[1-9]\d{5,19}$/.test(recipientId))) {
    throw facebookMessengerError(
      'Facebook Messenger recipient IDs must be valid numeric IDs (maximum 50).',
      503,
      'FACEBOOK_MESSENGER_MISCONFIGURED',
    );
  }

  return { pageId, pageAccessToken, graphApiVersion, recipientIds };
}

export function createFacebookMessengerClient({
  environment = process.env,
  fetcher,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  function getConfiguration() {
    const configuration = readFacebookMessengerConfiguration(environment);
    if (!configuration) {
      throw facebookMessengerError(
        'Facebook Messenger is not configured on this server.',
        503,
        'FACEBOOK_MESSENGER_NOT_CONFIGURED',
      );
    }
    return configuration;
  }

  return {
    status() {
      const configuration = readFacebookMessengerConfiguration(environment);
      return configuration
        ? { configured: true, recipients: [...configuration.recipientIds] }
        : { configured: false, recipients: [] };
    },

    async sendMessage({ recipientId, text, confirmed } = {}) {
      const configuration = getConfiguration();
      const selectedRecipientId = typeof recipientId === 'string' ? recipientId : '';
      if (!configuration.recipientIds.includes(selectedRecipientId)) {
        throw facebookMessengerError(
          'This Facebook recipient is not allowlisted by the server administrator.',
          403,
          'FACEBOOK_MESSENGER_RECIPIENT_NOT_ALLOWED',
        );
      }
      if (confirmed !== true) {
        throw facebookMessengerError(
          'Confirm the exact Facebook recipient and message before sending.',
          400,
          'FACEBOOK_MESSENGER_CONFIRMATION_REQUIRED',
        );
      }
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_MESSAGE_LENGTH) {
        throw facebookMessengerError(
          'Facebook Messenger messages must contain 1 to 2000 characters.',
          400,
          'FACEBOOK_MESSENGER_MESSAGE_INVALID',
        );
      }
      const request = fetcher || globalThis.fetch;
      if (typeof request !== 'function') {
        throw facebookMessengerError('Facebook networking is unavailable.', 503, 'FACEBOOK_MESSENGER_UNAVAILABLE');
      }

      let response;
      try {
        response = await request(
          `${FACEBOOK_GRAPH_API_BASE}/${configuration.graphApiVersion}/${configuration.pageId}/messages`,
          {
            method: 'POST',
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${configuration.pageAccessToken}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              recipient: { id: selectedRecipientId },
              messaging_type: 'RESPONSE',
              message: { text },
            }),
            cache: 'no-store',
            signal: AbortSignal.timeout(timeoutMs),
          },
        );
      } catch (error) {
        throw facebookMessengerError(
          error?.name === 'TimeoutError' ? 'Facebook Messenger request timed out.' : 'Facebook Messenger is unreachable.',
          error?.name === 'TimeoutError' ? 504 : 502,
          'FACEBOOK_MESSENGER_UPSTREAM_UNAVAILABLE',
        );
      }

      let result;
      try {
        result = await response.json();
      } catch {
        throw facebookMessengerError(
          'Facebook returned an invalid response.',
          502,
          'FACEBOOK_MESSENGER_UPSTREAM_INVALID_RESPONSE',
        );
      }
      if (
        !response.ok
        || typeof result?.message_id !== 'string'
        || !result.message_id
        || String(result.recipient_id) !== selectedRecipientId
      ) {
        throw facebookMessengerError(
          'Facebook rejected the message request.',
          502,
          'FACEBOOK_MESSENGER_UPSTREAM_REJECTED',
        );
      }
      return { sent: true, recipientId: selectedRecipientId, messageId: result.message_id };
    },
  };
}
