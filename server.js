import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile, statfs } from 'node:fs/promises';
import { isIP } from 'node:net';
import { cpus, freemem, platform, totalmem } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHomeAssistantClient, readHomeAssistantConfiguration } from './integrations/home-assistant.js';
import { createGoogleWorkspace } from './integrations/google-workspace.js';
import { createFacebookMessengerClient } from './integrations/facebook-messenger.js';
import { createTelegramClient } from './integrations/telegram.js';
import { containsAsciiControlCharacters, replaceAsciiControlCharacters } from './public/ascii-controls.js';

const root = resolve(fileURLToPath(new URL('./public', import.meta.url)));
const voiceRoot = resolve(fileURLToPath(new URL('./voice', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const maxBodyBytes = 24_000;
const maxVisionRequestBytes = 700_000;
const maxVisionImageBytes = 500 * 1024;
const maxVisionDimension = 1_280;
const requestWindowMs = 60_000;
const requestLimit = 30;
const visionRequestLimit = 5;
const liveTokenRequestLimit = 30;
const DEFAULT_AI_TIMEOUTS = Object.freeze({ gemini: 45_000, 'openai-compatible': 45_000, ollama: 60_000 });
const MIN_AI_TIMEOUT_MS = 5_000;
const MAX_AI_TIMEOUT_MS = 180_000;
const maxTransientRetries = 2;
const modelDiscoveryTimeoutMs = 12_000;
const modelProbeTimeoutMs = 15_000;
const modelDiscoveryClientRequests = new Map();
const modelProbeClientRequests = new Map();
const modelRequestLimit = 10;
const geminiApiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';
const clientRequests = new Map();
const visionClientRequests = new Map();
const liveTokenClientRequests = new Map();
const browserResearchClientRequests = new Map();
const browserResearchRequestLimit = 5;
const homeAssistantClientRequests = new Map();
const homeAssistantRequestLimit = 10;
const homeAssistantControlClientRequests = new Map();
const homeAssistantControlRequestLimit = 5;
const googleWorkspace = createGoogleWorkspace();
const googleWorkspaceClientRequests = new Map();
const googleWorkspaceRequestLimit = 10;
const googleWorkspaceWriteClientRequests = new Map();
const googleWorkspaceWriteRequestLimit = 5;
const telegram = createTelegramClient();
const telegramClientRequests = new Map();
const telegramRequestLimit = 10;
const telegramSendClientRequests = new Map();
const telegramSendRequestLimit = 3;
const facebookMessenger = createFacebookMessengerClient();
const facebookMessengerClientRequests = new Map();
const facebookMessengerRequestLimit = 10;
const facebookMessengerSendClientRequests = new Map();
const facebookMessengerSendRequestLimit = 3;
const browserResearchServiceUrl = 'http://127.0.0.1:4174/research';
const browserResearchTimeoutMs = 150_000;
const ttsClientRequests = new Map();
const ttsRequestLimit = 20;
const maxTtsTextChars = 1_200;
const ttsTimeoutMs = 120_000;
const maxTtsAudioBytes = 25 * 1024 * 1024;
const localTtsUrl = (process.env.OMNIVOICE_URL || 'http://127.0.0.1:4175').replace(/\/+$/, '');
const localTtsProbeTtlMs = 10_000;
let localTtsProbe = { at: 0, available: false, info: null };
const builtInCorsOrigins = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'];
const voiceStaticAllowlist = new Set(['/gemini-live.js', '/live-audio-processor.js', '/speech-input.js']);
let runtimeAIConfig = null;
let previousCpuTimes = null;

function getProviderTimeoutMs(provider) {
  const environmentKey = {
    gemini: 'GEMINI_TIMEOUT_MS',
    'openai-compatible': 'OPENAI_COMPATIBLE_TIMEOUT_MS',
    ollama: 'OLLAMA_TIMEOUT_MS',
  }[provider];
  const configured = Number(environmentKey ? process.env[environmentKey] : NaN);
  return Number.isInteger(configured) && configured >= MIN_AI_TIMEOUT_MS && configured <= MAX_AI_TIMEOUT_MS
    ? configured
    : DEFAULT_AI_TIMEOUTS[provider] || DEFAULT_AI_TIMEOUTS['openai-compatible'];
}

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function sendJson(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function getClientKey(request) {
  // Behind a reverse proxy (Render, Nginx) every client shares the proxy's address.
  // Only honour X-Forwarded-For when the operator explicitly opts in.
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded && isIP(forwarded)) return forwarded;
  }
  return request.socket.remoteAddress || 'unknown';
}

function isRateLimited(request, limit = requestLimit, requests = clientRequests) {
  const now = Date.now();
  const clientKey = getClientKey(request);
  const recentRequests = (requests.get(clientKey) || []).filter((time) => now - time < requestWindowMs);

  if (recentRequests.length >= limit) {
    requests.set(clientKey, recentRequests);
    return true;
  }

  recentRequests.push(now);
  requests.set(clientKey, recentRequests);
  return false;
}

function isAuthorized(request) {
  const expected = process.env.APP_ACCESS_TOKEN;
  if (!expected) return process.env.NODE_ENV !== 'production';
  const authorization = request.headers.authorization || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function authorizeApiRequest(request, response) {
  if (process.env.NODE_ENV === 'production' && !process.env.APP_ACCESS_TOKEN) {
    sendJson(response, 503, { error: 'This production server is locked until its administrator configures APP_ACCESS_TOKEN.' });
    return false;
  }
  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: 'This server requires an access key. Enter it in Settings to continue.' });
    return false;
  }
  return true;
}

async function readJson(request, maxBytes = maxBodyBytes) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 });
  }
}

function validateBrowserResearchInput(body) {
  const rawUrl = typeof body?.url === 'string' ? body.url.trim() : '';
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!rawUrl || rawUrl.length > 2_048) {
    throw Object.assign(new Error('Enter a page URL of 1 to 2,048 characters.'), { status: 400 });
  }
  if (!question || question.length > 2_000) {
    throw Object.assign(new Error('Enter a research question of 1 to 2,000 characters.'), { status: 400 });
  }
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('Enter a valid public http:// or https:// page URL.'), { status: 400 });
  }
  const host = parsed.hostname.toLowerCase();
  const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':');
  const isLocalName = host === 'localhost' || !host.includes('.')
    || /\.(?:local|localhost|internal|test|invalid|example|lan|home)$/.test(host);
  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username || parsed.password || isIpLiteral || isLocalName) {
    throw Object.assign(new Error('Browser Research accepts only public http(s) page URLs without credentials, IP addresses, or local hostnames.'), { status: 400 });
  }
  return { url: parsed.href, question };
}

async function handleBrowserResearch(request, response) {
  const { url: pageUrl, question } = validateBrowserResearchInput(await readJson(request));
  const config = getAIConfig();
  if (!config) {
    throw Object.assign(new Error('No AI provider is configured. Configure one on the server before using Browser Research.'), { status: 503 });
  }

  const payload = { url: pageUrl, question, provider: config.provider, model: config.model };
  if (config.apiKey) payload.apiKey = config.apiKey;
  if (config.baseUrl && config.provider !== 'gemini') payload.baseUrl = config.baseUrl;

  let upstream;
  try {
    upstream = await fetch(browserResearchServiceUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(browserResearchTimeoutMs),
    });
  } catch {
    throw Object.assign(new Error('Browser Research service is not running. Start it with: python3 browser/jarvis_browser_service.py'), { status: 503 });
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    data = null;
  }
  if (!upstream.ok) {
    const message = typeof data?.error === 'string' ? data.error : 'Browser Research failed.';
    throw Object.assign(new Error(message), { status: upstream.status === 429 ? 429 : 502 });
  }
  if (typeof data?.result !== 'string' || !data.result.trim()) {
    throw Object.assign(new Error('Browser Research returned no readable result.'), { status: 502 });
  }
  sendJson(response, 200, { url: pageUrl, result: data.result.trim() });
}

function validateMessages(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) {
    throw Object.assign(new Error('Send between 1 and 24 conversation messages.'), { status: 400 });
  }

  return value.map((message) => {
    if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') {
      throw Object.assign(new Error('Each message needs a supported role and text content.'), { status: 400 });
    }

    const content = message.content.trim();
    if (!content || content.length > 4_000) {
      throw Object.assign(new Error('Each message must contain 1 to 4,000 characters.'), { status: 400 });
    }
    return { role: message.role, content };
  });
}

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function getJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;

  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;

    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) return null;
      return {
        height: bytes.readUInt16BE(offset + 3),
        width: bytes.readUInt16BE(offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function validateVisionRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
  }
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 500) {
    throw Object.assign(new Error('Enter a question of 1 to 500 characters about the captured screen.'), { status: 400 });
  }
  const match = typeof body.image === 'string'
    ? /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.image)
    : null;
  if (!match) {
    throw Object.assign(new Error('Vision accepts one JPEG screen capture only.'), { status: 400 });
  }
  const encoded = match[1];
  const image = Buffer.from(encoded, 'base64');
  if (!image.length || image.length > maxVisionImageBytes || image.toString('base64') !== encoded) {
    throw Object.assign(new Error('The screen capture must be a valid JPEG no larger than 500 KB.'), { status: 400 });
  }
  const dimensions = getJpegDimensions(image);
  if (!dimensions || !dimensions.width || !dimensions.height) {
    throw Object.assign(new Error('The screen capture is not a valid JPEG image.'), { status: 400 });
  }
  if (Math.max(dimensions.width, dimensions.height) > maxVisionDimension) {
    throw Object.assign(new Error('Resize the screen capture so its longest side is no more than 1280 pixels.'), { status: 400 });
  }
  return { question, image, imageDataUrl: body.image };
}

function isValidGeminiModelName(value) {
  return /^gemini-[A-Za-z0-9][A-Za-z0-9._-]{0,112}$/.test(value);
}

function isLocalOllamaHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;

  const address = normalized.replace(/^\[|\]$/g, '');
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    return octets[0] === 127
      || octets[0] === 10
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 169 && octets[1] === 254);
  }
  if (isIP(address) === 6) {
    const normalizedAddress = address.toLowerCase();
    return normalizedAddress === '::1'
      || normalizedAddress.startsWith('fc')
      || normalizedAddress.startsWith('fd')
      || /^fe[89ab]/.test(normalizedAddress);
  }
  return false;
}

function parseOllamaBaseUrl(value, status = 400) {
  let parsedUrl;
  try {
    parsedUrl = new URL(value);
  } catch {
    throw Object.assign(new Error('Enter a valid local Ollama base URL.'), { status });
  }
  if (
    typeof value !== 'string'
    || value.length > 2_048
    || !['http:', 'https:'].includes(parsedUrl.protocol)
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.search
    || parsedUrl.hash
    || !isLocalOllamaHostname(parsedUrl.hostname)
  ) {
    throw Object.assign(new Error('Ollama base URL must use HTTP or HTTPS and point to localhost or a private-network address, without credentials, query parameters, or a fragment.'), { status });
  }
  return parsedUrl.href.replace(/\/+$/, '');
}

function isValidOllamaModelName(value) {
  return typeof value === 'string'
    && value.length <= 120
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(value);
}

function validateEnvironmentApiKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1_024 || containsAsciiControlCharacters(value)) {
    throw Object.assign(new Error('The AI API key configured in the server environment is invalid.'), {
      status: 500,
      code: 'INVALID_AI_PROVIDER_CONFIG',
    });
  }
  return value.trim();
}

function validateEnvironmentOpenAIConfig() {
  const model = process.env.AI_MODEL || 'gemini-3.8-flash';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(model)) {
    throw Object.assign(new Error('The OpenAI-compatible model configured in the server environment is invalid.'), {
      status: 500,
      code: 'INVALID_AI_PROVIDER_CONFIG',
    });
  }
  const baseUrl = process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/';
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw Object.assign(new Error('The OpenAI-compatible base URL configured in the server environment is invalid.'), {
      status: 500,
      code: 'INVALID_AI_PROVIDER_CONFIG',
    });
  }
  if (typeof baseUrl !== 'string'
    || baseUrl.length > 2_048
    || !['http:', 'https:'].includes(parsedBaseUrl.protocol)
    || parsedBaseUrl.username
    || parsedBaseUrl.password
    || parsedBaseUrl.search
    || parsedBaseUrl.hash) {
    throw Object.assign(new Error('The OpenAI-compatible base URL configured in the server environment is invalid.'), {
      status: 500,
      code: 'INVALID_AI_PROVIDER_CONFIG',
    });
  }
  return { model, baseUrl: parsedBaseUrl.href };
}

function getAIConfig() {
  if (runtimeAIConfig) return runtimeAIConfig;

  const environmentProvider = process.env.AI_PROVIDER
    || (process.env.GEMINI_API_KEY ? 'gemini' : undefined);
  if (environmentProvider
    && !['gemini', 'ollama', 'openai-compatible'].includes(environmentProvider)) {
    throw Object.assign(new Error('AI_PROVIDER must be gemini, ollama, or openai-compatible.'), {
      status: 500,
      code: 'INVALID_AI_PROVIDER_CONFIG',
    });
  }

  if (environmentProvider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY;
    if (!apiKey) return null;
    const model = process.env.AI_MODEL || 'gemini-3.8-flash';
    if (!isValidGeminiModelName(model)) {
      throw Object.assign(new Error('The Gemini model configured in the server environment is invalid.'), { status: 500 });
    }
    return {
      provider: 'gemini',
      model,
      apiKey: validateEnvironmentApiKey(apiKey),
    };
  }

  if (
    process.env.AI_PROVIDER === 'ollama'
    || (process.env.AI_PROVIDER !== 'openai-compatible' && !process.env.AI_API_KEY && process.env.OLLAMA_BASE_URL)
  ) {
    const model = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
    if (!isValidOllamaModelName(model)) {
      throw Object.assign(new Error('The Ollama model configured in the server environment is invalid.'), { status: 500 });
    }
    return {
      provider: 'ollama',
      model,
      baseUrl: parseOllamaBaseUrl(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434', 500),
    };
  }
  if (process.env.AI_API_KEY) {
    const { model, baseUrl } = validateEnvironmentOpenAIConfig();
    return {
      provider: 'openai-compatible',
      model,
      apiKey: validateEnvironmentApiKey(process.env.AI_API_KEY),
      baseUrl,
    };
  }
  return null;
}

function getAIConfigSource(config = getAIConfig()) {
  if (!config) return 'none';
  return runtimeAIConfig ? 'session' : 'environment';
}

function publicAIConfig(config = getAIConfig()) {
  return config ? {
    provider: config.provider,
    model: config.model,
    ...(config.provider === 'openai-compatible' || config.provider === 'ollama' ? { baseUrl: config.baseUrl } : {}),
  } : null;
}

function getOpenAIChatCompletionsUrl(baseUrl) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  return normalizedBaseUrl.endsWith('/chat/completions')
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/chat/completions`;
}

function getOpenAIModelsUrl(baseUrl) {
  let normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  if (normalizedBaseUrl.endsWith('/chat/completions')) {
    normalizedBaseUrl = normalizedBaseUrl.slice(0, -'/chat/completions'.length);
  }
  return normalizedBaseUrl.endsWith('/models') ? normalizedBaseUrl : `${normalizedBaseUrl}/models`;
}

function getModelStatusForHttp(status) {
  if (status === 401 || status === 403) return 'Authentication Required';
  if (status === 429) return 'Rate Limited';
  if ([404, 405, 501].includes(status)) return 'Unsupported';
  return 'Unavailable';
}

function modelProviderHeaders(config) {
  return {
    accept: 'application/json',
    ...(config.provider === 'gemini'
      ? { 'x-goog-api-key': config.apiKey }
      : config.provider === 'openai-compatible'
        ? { authorization: `Bearer ${config.apiKey}` }
        : {}),
  };
}

function getModelCatalogUrl(config) {
  if (config.provider === 'gemini') return `${geminiApiBaseUrl}/models`;
  if (config.provider === 'ollama') return `${config.baseUrl.replace(/\/+$/, '')}/api/tags`;
  return getOpenAIModelsUrl(config.baseUrl);
}

function getModelResponseMessage(status) {
  if (status === 'Authentication Required') return 'Provider authentication failed. Check the server-side credential in Settings.';
  if (status === 'Rate Limited') return 'The provider rate-limited this request. Wait and retry.';
  if (status === 'Unsupported') return 'This provider endpoint does not support model discovery or the selected model.';
  return 'The configured provider is unavailable or timed out. Check its URL and try again.';
}

function isValidAIModelName(provider, model) {
  if (provider === 'gemini') return isValidGeminiModelName(model);
  if (provider === 'ollama') return isValidOllamaModelName(model);
  return typeof model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(model);
}

function mapDiscoveredModel(provider, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const rawId = provider === 'gemini' && typeof item.name === 'string'
    ? item.name.replace(/^models\//, '')
    : item.id ?? item.name;
  if (!isValidAIModelName(provider, rawId)) return null;
  const supportedMethods = Array.isArray(item.supportedGenerationMethods)
    ? item.supportedGenerationMethods.filter((method) => typeof method === 'string').slice(0, 20)
    : [];
  const inputModalities = Array.isArray(item.architecture?.input_modalities)
    ? item.architecture.input_modalities.filter((value) => typeof value === 'string').slice(0, 20)
    : [];
  const outputModalities = Array.isArray(item.architecture?.output_modalities)
    ? item.architecture.output_modalities.filter((value) => typeof value === 'string').slice(0, 20)
    : [];
  const providerCapabilities = Array.isArray(item.capabilities)
    ? item.capabilities.filter((value) => typeof value === 'string').slice(0, 20)
    : [];
  if (supportedMethods.length) providerCapabilities.push(...supportedMethods);
  if (inputModalities.length || outputModalities.length) {
    providerCapabilities.push(`input: ${inputModalities.join(', ') || 'unknown'}`);
    providerCapabilities.push(`output: ${outputModalities.join(', ') || 'unknown'}`);
  }
  const contextLength = [item.context_length, item.context_window, item.inputTokenLimit]
    .find((value) => Number.isSafeInteger(value) && value > 0) ?? null;
  const model = {
    id: rawId,
    displayName: typeof item.displayName === 'string' ? item.displayName.slice(0, 160) : rawId,
    provider,
    status: provider === 'gemini' && !supportedMethods.includes('generateContent') ? 'Unsupported' : 'Untested',
    verified: false,
    capabilities: [...new Set(providerCapabilities)],
    contextLength,
  };
  if (typeof item.owned_by === 'string') model.owner = item.owned_by.slice(0, 120);
  if (typeof item.details?.parameter_size === 'string') model.parameterSize = item.details.parameter_size.slice(0, 40);
  if (Number.isSafeInteger(item.size) && item.size > 0) model.sizeBytes = item.size;
  return model;
}

function getGeminiGenerateContentUrl(model) {
  return new URL(`${geminiApiBaseUrl}/models/${encodeURIComponent(model)}:generateContent`);
}

function getGeminiAssistantText(data) {
  const parts = data.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part) => part && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
}

function getRetryDelayMs(upstream, retryIndex) {
  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(1_000, seconds * 1_000);
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.min(1_000, Math.max(0, retryAt - Date.now()));
  }
  return 250 * (2 ** retryIndex);
}

async function fetchOpenAICompatibleWithRetry(url, options, maxRetries = maxTransientRetries, timeoutMs = DEFAULT_AI_TIMEOUTS['openai-compatible']) {
  const deadline = Date.now() + timeoutMs;
  for (let retryIndex = 0; ; retryIndex += 1) {
    if (options.signal?.aborted) throw options.signal.reason || new DOMException('Aborted', 'AbortError');
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new DOMException('Timed out', 'TimeoutError');
    const upstream = await fetch(url, {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(remainingMs)])
        : AbortSignal.timeout(remainingMs),
    });
    if (![500, 502, 503, 504].includes(upstream.status) || retryIndex >= maxRetries) {
      return upstream;
    }

    await upstream.body?.cancel();
    const delayMs = Math.min(getRetryDelayMs(upstream, retryIndex), Math.max(0, deadline - Date.now()));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function getUpstreamRequestError(error) {
  const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
  return Object.assign(
    new Error(isTimeout
      ? 'The AI provider timed out. Check the provider/model and retry.'
      : 'Could not connect to the AI provider. Check the server network connection and provider URL.'),
    { status: isTimeout ? 504 : 502, code: isTimeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE' },
  );
}

async function readUpstreamJson(upstream, provider) {
  try {
    const data = await upstream.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw Object.assign(new Error(`${provider} returned an invalid JSON response object.`), {
        status: 502,
        code: 'INVALID_UPSTREAM_RESPONSE',
      });
    }
    return data;
  } catch (error) {
    if (error?.code === 'INVALID_UPSTREAM_RESPONSE') throw error;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw getUpstreamRequestError(error);
    throw Object.assign(new Error(`${provider} returned an invalid response. Check the selected model and provider configuration.`), {
      status: 502,
      code: 'INVALID_UPSTREAM_RESPONSE',
    });
  }
}

function getSafeProviderErrorCode(value, status) {
  if (Number.isInteger(value) && value >= 100 && value <= 599) return String(value);
  if (typeof value === 'string') {
    const code = value.trim().toUpperCase();
    if (/^\d{3}$/.test(code) && Number(code) >= 100 && Number(code) <= 599) return code;
    if ([
      'ALREADY_EXISTS',
      'CANCELLED',
      'DEADLINE_EXCEEDED',
      'FAILED_PRECONDITION',
      'INSUFFICIENT_QUOTA',
      'INTERNAL',
      'INVALID_API_KEY',
      'INVALID_ARGUMENT',
      'MODEL_NOT_FOUND',
      'NOT_FOUND',
      'OUT_OF_RANGE',
      'PERMISSION_DENIED',
      'RATE_LIMIT_EXCEEDED',
      'RESOURCE_EXHAUSTED',
      'UNAUTHENTICATED',
      'UNAVAILABLE',
      'UNKNOWN',
      'UNIMPLEMENTED',
    ].includes(code)) return code;
  }
  return `HTTP_${status}`;
}

function sanitizeProviderErrorMessage(message, apiKey, status) {
  if (typeof message !== 'string' || !message.trim()) {
    return `AI provider returned HTTP ${status}. Check the model and provider settings.`;
  }

  let sanitized = replaceAsciiControlCharacters(message)
    .replace(/\b(?:authorization|proxy-authorization)\s*[:=]\s*bearer\s+[^\s,;]+/gi, '[redacted credential]')
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*["']?[^"'\s,;]+["']?/gi, '[redacted credential]')
    .replace(/\b(?:authorization|api[_-]?key)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, '[redacted credential]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/[?&](?:key|api[_-]?key|token)=([^&\s]+)/gi, (match) => `${match.slice(0, match.indexOf('=') + 1)}[redacted]`)
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[redacted]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/gi, '[redacted]');
  if (apiKey) sanitized = sanitized.split(apiKey).join('[redacted]');

  sanitized = sanitized.replace(/\s+/g, ' ').trim().slice(0, 500);
  return sanitized || `AI provider returned HTTP ${status}. Check the model and provider settings.`;
}

async function getSafeProviderError(upstream, apiKey) {
  const status = upstream.status;
  let details = null;
  let bodyShape = 'invalid JSON';
  try {
    const body = JSON.parse(await upstream.text());
    bodyShape = Array.isArray(body) ? 'JSON array' : body === null ? 'JSON null' : typeof body === 'object' ? 'JSON object without a structured error' : `JSON ${typeof body}`;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      if (body.error && typeof body.error === 'object' && !Array.isArray(body.error)) {
        details = body.error;
        bodyShape = 'JSON object with structured error';
      } else {
        details = body;
      }
    }
  } catch {
    // Keep diagnostics limited to parsed, allowlisted fields.
  }
  const providerCode = getSafeProviderErrorCode(details?.status, status);
  const fallbackCode = getSafeProviderErrorCode(details?.code, status);
  const code = providerCode === `HTTP_${status}` ? fallbackCode : providerCode;
  const message = typeof details?.message === 'string' && details.message.trim()
    ? sanitizeProviderErrorMessage(details.message, apiKey, status)
    : `AI provider returned HTTP ${status}; its response was ${bodyShape} and contained no usable error message.`;
  const rawContentType = upstream.headers.get('content-type')?.split(';', 1)[0].trim() || '';
  const contentType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(rawContentType)
    ? rawContentType.slice(0, 100)
    : 'unknown';
  const bodyPreview = JSON.stringify({
    code: code === `HTTP_${status}` ? undefined : code,
    message: typeof details?.message === 'string' && details.message.trim() ? message : undefined,
    shape: bodyShape,
    ...(typeof details?.message === 'string' && details.message.trim() ? {} : { diagnostic: 'No allowlisted error message found; other upstream fields omitted.' }),
  }).slice(0, 700);
  return {
    code,
    message,
    ...(status === 404 ? { diagnostics: { contentType, body: bodyPreview } } : {}),
  };
}

async function configureAI(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
  }
  if (body.provider === 'environment') {
    runtimeAIConfig = null;
    return publicAIConfig();
  }
  if (!['gemini', 'openai-compatible', 'ollama'].includes(body.provider)) {
    throw Object.assign(new Error('Choose Gemini, OpenAI-compatible, or Ollama as the AI provider.'), { status: 400 });
  }
  if (typeof body.model !== 'string') {
    throw Object.assign(new Error('Enter a valid model name using letters, numbers, dots, underscores, colons, slashes, or hyphens.'), { status: 400 });
  }
  const model = body.model.trim();
  if (body.provider === 'ollama' && !isValidOllamaModelName(model)) {
    throw Object.assign(new Error('Enter a valid Ollama model name of up to 120 characters.'), { status: 400 });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(model)) {
    throw Object.assign(new Error('Enter a valid model name using letters, numbers, dots, underscores, colons, slashes, or hyphens.'), { status: 400 });
  }

  if (body.provider === 'ollama') {
    const baseUrl = parseOllamaBaseUrl(
      body.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
    );
    runtimeAIConfig = {
      provider: 'ollama',
      model,
      baseUrl,
    };
  } else if (body.provider === 'gemini') {
    if (!isValidGeminiModelName(model)) {
      throw Object.assign(new Error('Enter a valid Gemini model name beginning with gemini-.'), { status: 400 });
    }
    if (Object.hasOwn(body, 'baseUrl') || Object.hasOwn(body, 'endpoint')) {
      throw Object.assign(new Error('Gemini uses the official Google API endpoint, which cannot be overridden.'), { status: 400 });
    }
    if (Object.hasOwn(body, 'apiKey')) {
      throw Object.assign(new Error('Gemini API keys must be configured on the server as GEMINI_API_KEY; this endpoint does not accept Gemini keys.'), { status: 400 });
    }
    const config = getAIConfig();
    if (!config || config.provider !== 'gemini') {
      throw Object.assign(new Error('Configure GEMINI_API_KEY in the server environment or deployment secrets to use Google Gemini.'), { status: 503 });
    }
    runtimeAIConfig = null;
  } else {
    if (typeof body.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 1_024) {
      throw Object.assign(new Error('Enter a provider API key, or configure AI_API_KEY on the server. The key must be no longer than 1,024 characters.'), { status: 400 });
    }
    const baseUrl = body.baseUrl ?? process.env.AI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai/';
    let parsedBaseUrl;
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      throw Object.assign(new Error('Enter a valid provider base URL.'), { status: 400 });
    }
    if (
      typeof baseUrl !== 'string'
      || baseUrl.length > 2_048
      || !['http:', 'https:'].includes(parsedBaseUrl.protocol)
      || parsedBaseUrl.username
      || parsedBaseUrl.password
      || parsedBaseUrl.search
      || parsedBaseUrl.hash
    ) {
      throw Object.assign(new Error('Provider base URL must be a valid HTTP or HTTPS URL without credentials, query parameters, or a fragment.'), { status: 400 });
    }
    runtimeAIConfig = {
      provider: 'openai-compatible',
      model,
      apiKey: body.apiKey.trim(),
      baseUrl: parsedBaseUrl.href,
    };
  }
  return publicAIConfig();
}

function configureAIModel(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.model !== 'string') {
    throw Object.assign(new Error('Choose a model from the current provider.'), { status: 400 });
  }
  const config = getAIConfig();
  if (!config) {
    throw Object.assign(new Error('Configure an AI provider before selecting a model.'), { status: 503, code: 'AI_PROVIDER_NOT_CONFIGURED' });
  }
  if (body.provider !== undefined && body.provider !== config.provider) {
    throw Object.assign(new Error('The selected provider changed. Refresh Settings and choose a model for the active provider.'), { status: 409, code: 'AI_PROVIDER_MISMATCH' });
  }
  const model = body.model.trim();
  if (!isValidAIModelName(config.provider, model)) {
    throw Object.assign(new Error('Enter a valid model name for the configured provider.'), { status: 400 });
  }
  runtimeAIConfig = { ...config, model };
  return publicAIConfig(runtimeAIConfig);
}

async function getProviderModels(config) {
  const startedAt = Date.now();
  let upstream;
  try {
  upstream = await fetch(getModelCatalogUrl(config), {
    method: 'GET',
    redirect: 'error',
    headers: modelProviderHeaders(config),
    cache: 'no-store',
    signal: AbortSignal.timeout(modelDiscoveryTimeoutMs),
  });
  } catch (error) {
  const latencyMs = Date.now() - startedAt;
  const result = {
    provider: config.provider,
    status: 'Unavailable',
    message: error?.name === 'TimeoutError' || error?.name === 'AbortError'
    ? 'Model discovery timed out.'
    : 'Could not connect to the configured provider for model discovery.',
    models: [],
    latencyMs,
  };
  console.info('[J.A.R.V.I.S.] Model discovery', JSON.stringify({ provider: config.provider, status: result.status, latencyMs }));
  return result;
  }

  const latencyMs = Date.now() - startedAt;
  if (!upstream.ok) {
  const status = getModelStatusForHttp(upstream.status);
  const result = { provider: config.provider, status, message: getModelResponseMessage(status), models: [], latencyMs };
  console.info('[J.A.R.V.I.S.] Model discovery', JSON.stringify({ provider: config.provider, status, httpStatus: upstream.status, latencyMs }));
  return result;
  }

  let data;
  try {
  data = await upstream.json();
  } catch {
  const result = { provider: config.provider, status: 'Unsupported', message: 'Provider returned an invalid model list.', models: [], latencyMs };
  console.info('[J.A.R.V.I.S.] Model discovery', JSON.stringify({ provider: config.provider, status: result.status, latencyMs }));
  return result;
  }
  const entries = config.provider === 'gemini' ? data?.models : data?.data ?? data?.models;
  if (!Array.isArray(entries)) {
  const result = { provider: config.provider, status: 'Unsupported', message: 'Provider did not return a supported model list.', models: [], latencyMs };
  console.info('[J.A.R.V.I.S.] Model discovery', JSON.stringify({ provider: config.provider, status: result.status, latencyMs }));
  return result;
  }
  const models = entries.map((entry) => mapDiscoveredModel(config.provider, entry)).filter(Boolean);
  const result = { provider: config.provider, status: 'Available', models, latencyMs };
  console.info('[J.A.R.V.I.S.] Model discovery', JSON.stringify({ provider: config.provider, status: result.status, modelCount: models.length, latencyMs }));
  return result;
}

function getModelProbeUrl(config, model) {
  if (config.provider === 'gemini') return getGeminiGenerateContentUrl(model);
  if (config.provider === 'ollama') return `${config.baseUrl.replace(/\/+$/, '')}/api/chat`;
  return getOpenAIChatCompletionsUrl(config.baseUrl);
}

function getModelProbeBody(config, model) {
  const prompt = 'Reply with OK.';
  if (config.provider === 'gemini') {
    return {
      systemInstruction: { parts: [{ text: 'Reply with only OK.' }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 8, candidateCount: 1 },
    };
  }
  if (config.provider === 'ollama') {
    return { model, messages: [{ role: 'user', content: prompt }], stream: false, options: { num_predict: 8 } };
  }
  return { model, messages: [{ role: 'user', content: prompt }], max_tokens: 8, stream: false };
}

function getModelProbeText(config, data) {
  if (config.provider === 'gemini') return getGeminiAssistantText(data);
  if (config.provider === 'ollama') return typeof data.message?.content === 'string' ? data.message.content.trim() : '';
  return getAssistantText(data.choices?.[0]?.message?.content);
}

async function testProviderModel(config, model) {
  if (!isValidAIModelName(config.provider, model)) {
    throw Object.assign(new Error('Enter a valid model name for the configured provider.'), { status: 400 });
  }
  const startedAt = Date.now();
  let upstream;
  try {
    upstream = await fetch(getModelProbeUrl(config, model), {
      method: 'POST',
      redirect: 'error',
      headers: { ...modelProviderHeaders(config), 'content-type': 'application/json' },
      body: JSON.stringify(getModelProbeBody(config, model)),
      signal: AbortSignal.timeout(modelProbeTimeoutMs),
    });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const result = {
      provider: config.provider,
      model,
      status: 'Unavailable',
      message: error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'The model test timed out.'
        : 'Could not connect to the configured provider for this model test.',
      verified: false,
      latencyMs,
      capabilities: [],
    };
    console.info('[J.A.R.V.I.S.] Model probe', JSON.stringify({ provider: config.provider, model, status: result.status, latencyMs }));
    return result;
  }

  const latencyMs = Date.now() - startedAt;
  if (!upstream.ok) {
    const status = getModelStatusForHttp(upstream.status);
    const result = { provider: config.provider, model, status, message: getModelResponseMessage(status), verified: false, latencyMs, capabilities: [] };
    console.info('[J.A.R.V.I.S.] Model probe', JSON.stringify({ provider: config.provider, model, status, httpStatus: upstream.status, latencyMs }));
    return result;
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    const result = { provider: config.provider, model, status: 'Unsupported', message: 'Provider returned an invalid test response.', verified: false, latencyMs, capabilities: [] };
    console.info('[J.A.R.V.I.S.] Model probe', JSON.stringify({ provider: config.provider, model, status: result.status, latencyMs }));
    return result;
  }
  if (!getModelProbeText(config, data)) {
    const result = { provider: config.provider, model, status: 'Unsupported', message: 'The selected model did not return a usable text response.', verified: false, latencyMs, capabilities: [] };
    console.info('[J.A.R.V.I.S.] Model probe', JSON.stringify({ provider: config.provider, model, status: result.status, latencyMs }));
    return result;
  }
  const result = { provider: config.provider, model, status: 'Available', message: 'Model returned a test response.', verified: true, latencyMs, capabilities: ['text'] };
  console.info('[J.A.R.V.I.S.] Model probe', JSON.stringify({ provider: config.provider, model, status: result.status, latencyMs }));
  return result;
}

export function getAssistantText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
}

function validateRequestedAIProvider(config, provider) {
  if (provider === undefined) return;
  if (!['gemini', 'ollama', 'openai-compatible'].includes(provider)) {
    throw Object.assign(new Error('Choose Gemini, Ollama, or OpenAI-compatible as the selected AI provider.'), {
      status: 400,
      code: 'INVALID_AI_PROVIDER',
    });
  }
  if (!config) {
    const guidance = provider === 'gemini'
      ? 'Configure GEMINI_API_KEY in the server environment or deployment secrets.'
      : provider === 'ollama'
        ? 'Configure the local Ollama endpoint and model in Settings.'
        : 'Configure an OpenAI-compatible provider and API key in Settings.';
    throw Object.assign(new Error(`The selected ${provider === 'gemini' ? 'Google Gemini' : provider === 'ollama' ? 'Ollama' : 'OpenAI-compatible'} provider is not configured. ${guidance}`), {
      status: 503,
      code: 'AI_PROVIDER_NOT_CONFIGURED',
    });
  }
  if (config.provider !== provider) {
    throw Object.assign(new Error(`The selected provider is ${provider}, but the server is configured for ${config.provider}. Save that provider in Settings before retrying.`), {
      status: 409,
      code: 'AI_PROVIDER_MISMATCH',
    });
  }
}

async function handleChat(request, response) {
  const body = await readJson(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
  }
  if (body.max_tokens !== undefined && (!Number.isInteger(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 256)) {
    throw Object.assign(new Error('Chat output token limit must be an integer from 1 to 256.'), { status: 400 });
  }
  if (body.singleAttempt !== undefined && typeof body.singleAttempt !== 'boolean') {
    throw Object.assign(new Error('singleAttempt must be a boolean.'), { status: 400 });
  }
  const messages = validateMessages(body.messages);
  const language = body.language === 'hi' ? 'Hindi' : 'English';
  const modeInstruction = body.mode === 'study'
    ? 'The user selected Study Mode. Teach interactively with clear short steps and examples, and ask a brief comprehension question when useful.'
    : '';
  const systemMessage = {
    role: 'system',
    content: `You are J.A.R.V.I.S., a capable and thoughtful assistant. Answer the user's actual request directly and use relevant conversation history without repeating it. Prioritize the latest message when the topic changes. Ask a focused clarifying question only when essential. Give useful specifics, short steps, or examples when they help. Reply in ${language} naturally unless the user clearly requests another language; preserve names, code, and technical terms as written. Be honest about uncertainty and never claim to have performed actions or accessed information you cannot. ${modeInstruction}`,
  };

  const config = getAIConfig();
  validateRequestedAIProvider(config, body.provider);
  if (config?.provider === 'ollama') {
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    const model = config.model;
    let upstream;
    try {
      upstream = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [systemMessage, ...messages],
          stream: false,
          ...(body.max_tokens ? { options: { num_predict: body.max_tokens } } : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw Object.assign(new Error(`Local Ollama at ${config.baseUrl} timed out. Check that the model is loaded and the server has enough resources, then retry.`), {
          status: 504,
          code: 'UPSTREAM_TIMEOUT',
        });
      }
      throw Object.assign(new Error(`Local Ollama is unavailable at ${config.baseUrl}. Start Ollama at the configured local endpoint and retry.`), {
        status: 503,
        code: 'UPSTREAM_UNAVAILABLE',
      });
    }

    if (!upstream.ok) {
      if (upstream.status === 404) {
        throw Object.assign(new Error(`Ollama model "${model}" is not installed or the local endpoint is unavailable. Install the selected model and retry.`), {
          status: 503,
          code: 'MODEL_NOT_FOUND',
        });
      }
      throw Object.assign(new Error(`Local Ollama at ${config.baseUrl} returned HTTP ${upstream.status}. Check its connection and selected model.`), {
        status: 502,
        code: `HTTP_${upstream.status}`,
      });
    }
    const data = await readUpstreamJson(upstream, 'Local Ollama');
    const content = data.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw Object.assign(new Error('Local model returned an empty response.'), { status: 502 });
    }
    sendJson(response, 200, { reply: content.trim(), provider: `Ollama / ${model}` });
    return;
  }

  if (config?.provider === 'gemini') {
    let upstream;
    try {
      upstream = await fetchOpenAICompatibleWithRetry(getGeminiGenerateContentUrl(config.model), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemMessage.content }] },
          contents: messages.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          ...(body.max_tokens ? { generationConfig: { maxOutputTokens: body.max_tokens } } : {}),
        }),
      }, body.singleAttempt ? 0 : maxTransientRetries, getProviderTimeoutMs('gemini'));
    } catch (error) {
      throw getUpstreamRequestError(error);
    }

    if (!upstream.ok) {
      const providerError = await getSafeProviderError(upstream, config.apiKey);
      const guidance = upstream.status === 401 || upstream.status === 403
        ? ' Check that the Google Gemini API key is valid and has permission to use this model.'
        : upstream.status === 429
          ? ' Check the Gemini quota or rate limit, then retry.'
          : upstream.status === 404
            ? ' Check that the Gemini model exists, is enabled for this key, and supports the requested capability.'
            : '';
      throw Object.assign(new Error(`${providerError.message}${guidance}`), {
        status: upstream.status === 503 ? 503 : 502,
        code: providerError.code,
        ...(providerError.diagnostics ? { diagnostics: providerError.diagnostics } : {}),
      });
    }
    const data = await readUpstreamJson(upstream, 'Google Gemini');
    const content = getGeminiAssistantText(data);
    if (!content) {
      throw Object.assign(new Error('Google Gemini returned no usable text. Check the selected model response and safety settings.'), {
        status: 502,
        code: 'EMPTY_AI_RESPONSE',
      });
    }
    sendJson(response, 200, { reply: content, provider: `Gemini / ${config.model}` });
    return;
  }

  if (config?.provider === 'openai-compatible') {
    let upstream;
    try {
      upstream = await fetchOpenAICompatibleWithRetry(getOpenAIChatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [systemMessage, ...messages],
        ...(body.max_tokens ? { max_tokens: body.max_tokens } : {}),
        ...(config.baseUrl.includes('generativelanguage.googleapis.com') ? { reasoning_effort: 'low' } : {}),
      }),
      }, body.singleAttempt ? 0 : maxTransientRetries, getProviderTimeoutMs('openai-compatible'));
    } catch (error) {
      throw getUpstreamRequestError(error);
    }

    if (!upstream.ok) {
      const providerError = await getSafeProviderError(upstream, config.apiKey);
      const guidance = upstream.status === 401 || upstream.status === 403
        ? ' Check that the API key is valid and has permission to use this model in Settings.'
        : upstream.status === 429
          ? ' Check the provider quota or rate limit, then retry.'
          : upstream.status === 503
            ? ' The AI provider is temporarily unavailable; try again shortly.'
          : upstream.status === 404
            ? config.baseUrl.includes('generativelanguage.googleapis.com')
              ? ' For Gemini, verify that this model is enabled for your key and keep the base URL at https://generativelanguage.googleapis.com/v1beta/openai/.'
              : ' Check the model name and provider base URL in Settings.'
            : '';
      throw Object.assign(new Error(`${providerError.message}${guidance}`), {
        status: upstream.status === 503 ? 503 : 502,
        code: providerError.code,
        ...(providerError.diagnostics ? { diagnostics: providerError.diagnostics } : {}),
      });
    }
    const data = await readUpstreamJson(upstream, 'AI provider');
    const content = getAssistantText(data.choices?.[0]?.message?.content);
    if (!content) {
      throw Object.assign(new Error('AI provider returned no usable text. Check the selected model response format and provider logs.'), {
        status: 502,
        code: 'EMPTY_AI_RESPONSE',
      });
    }
    sendJson(response, 200, { reply: content, provider: config.model });
    return;
  }

  throw Object.assign(new Error('No AI provider is configured. Configure GEMINI_API_KEY or another provider on the server.'), { status: 503 });
}

async function handleVision(request, response) {
  const body = await readJson(request, maxVisionRequestBytes);
  const { question, image, imageDataUrl } = validateVisionRequest(body);
  const config = getAIConfig();
  validateRequestedAIProvider(config, body.provider);
  if (!config) {
    throw Object.assign(new Error('No AI provider is configured. Configure an image-capable provider before using Vision.'), { status: 503 });
  }

  const systemMessage = {
    role: 'system',
    content: 'Answer the user’s question using only visible details in this single screen image. Be concise and say when text or content is unclear.',
  };
  let upstream;
  let providerName = config.model;
  try {
    if (config.provider === 'ollama') {
      providerName = `Ollama / ${config.model}`;
      upstream = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/api/chat`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [systemMessage, { role: 'user', content: question, images: [image.toString('base64')] }],
          stream: false,
          options: { num_predict: 256 },
        }),
        signal: AbortSignal.timeout(getProviderTimeoutMs('ollama')),
      });
    } else if (config.provider === 'gemini') {
      providerName = `Gemini / ${config.model}`;
      upstream = await fetch(getGeminiGenerateContentUrl(config.model), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemMessage.content }] },
          contents: [{
            role: 'user',
            parts: [
              { text: question },
              { inlineData: { mimeType: 'image/jpeg', data: image.toString('base64') } },
            ],
          }],
          generationConfig: { maxOutputTokens: 256 },
        }),
        signal: AbortSignal.timeout(getProviderTimeoutMs('gemini')),
      });
    } else {
      upstream = await fetch(getOpenAIChatCompletionsUrl(config.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            systemMessage,
            {
              role: 'user',
              content: [
                { type: 'text', text: question },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ],
            },
          ],
          max_tokens: 256,
          ...(config.baseUrl.includes('generativelanguage.googleapis.com') ? { reasoning_effort: 'low' } : {}),
        }),
        signal: AbortSignal.timeout(getProviderTimeoutMs('openai-compatible')),
      });
    }
  } catch (error) {
    if (config.provider === 'ollama') {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw Object.assign(new Error(timedOut
        ? `Local Ollama at ${config.baseUrl} timed out. Check that the selected model is loaded and retry.`
        : `Local Ollama is unavailable at ${config.baseUrl}. Start Ollama at the configured local endpoint and retry.`), {
        status: timedOut ? 504 : 503,
        code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
      });
    }
    throw getUpstreamRequestError(error);
  }

  if (!upstream.ok) {
    if (config.provider === 'ollama') {
      const missingModel = upstream.status === 404;
      throw Object.assign(new Error(missingModel
        ? `Ollama model "${config.model}" is not installed or does not support Vision. Install an image-capable model and retry.`
        : `Local Ollama at ${config.baseUrl} returned HTTP ${upstream.status}. Check its connection and confirm the model supports images.`), {
        status: missingModel ? 503 : 502,
        code: missingModel ? 'MODEL_NOT_FOUND' : `HTTP_${upstream.status}`,
      });
    }
    const providerError = await getSafeProviderError(upstream, config.apiKey);
    const guidance = upstream.status === 429
      ? ' Check the provider quota or rate limit, then retry manually.'
      : upstream.status === 404
        ? ` Check that the configured ${config.provider === 'gemini' ? 'Gemini' : 'provider'} model is enabled and supports image input.`
        : '';
    throw Object.assign(new Error(`${providerError.message}${guidance}`), {
      status: 502,
      code: providerError.code,
      ...(providerError.diagnostics ? { diagnostics: providerError.diagnostics } : {}),
    });
  }

  const data = await readUpstreamJson(upstream, providerName);
  const content = config.provider === 'ollama'
    ? getAssistantText(data.message?.content)
    : config.provider === 'gemini'
      ? getGeminiAssistantText(data)
      : getAssistantText(data.choices?.[0]?.message?.content);
  if (!content) {
    throw Object.assign(new Error('The selected AI model returned no Vision response. Confirm that it supports image input.'), {
      status: 502,
      code: 'EMPTY_VISION_RESPONSE',
    });
  }
  sendJson(response, 200, { reply: content, provider: providerName });
}

async function inspectOllama(config) {
  if (config?.provider !== 'ollama') return null;
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const model = config.model;
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      redirect: 'error',
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return { available: false, modelInstalled: false, model };
    const data = await response.json();
    const modelInstalled = Array.isArray(data.models) && data.models.some((item) => item.name === model);
    return { available: true, modelInstalled, model };
  } catch {
    return { available: false, modelInstalled: false, model };
  }
}

async function getSystemMetrics() {
  const totalMemory = totalmem();
  const freeMemory = freemem();
  const disk = await statfs(root);
  const diskTotal = Number(disk.blocks) * Number(disk.bsize);
  const diskFree = Number(disk.bavail) * Number(disk.bsize);
  const cpuTimes = cpus().map(({ times }) => times);
  let cpuUsagePercent = null;
  if (previousCpuTimes && previousCpuTimes.length === cpuTimes.length) {
    let totalDelta = 0;
    let idleDelta = 0;
    for (const [index, times] of cpuTimes.entries()) {
      for (const [key, value] of Object.entries(times)) {
        const delta = Math.max(0, value - previousCpuTimes[index][key]);
        totalDelta += delta;
        if (key === 'idle') idleDelta += delta;
      }
    }
    if (totalDelta > 0) cpuUsagePercent = Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
  }
  previousCpuTimes = cpuTimes;

  return {
    source: process.env.CODESPACE_NAME ? 'Codespaces container' : `${platform()} server`,
    cpuUsagePercent,
    cpuCount: cpuTimes.length,
    memoryUsedBytes: totalMemory - freeMemory,
    memoryTotalBytes: totalMemory,
    memoryPercent: Math.round(((totalMemory - freeMemory) / totalMemory) * 100),
    diskUsedBytes: Math.max(0, diskTotal - diskFree),
    diskTotalBytes: diskTotal,
    diskPercent: diskTotal ? Math.round(((diskTotal - diskFree) / diskTotal) * 100) : 0,
    measuredAt: new Date().toISOString(),
  };
}

function flattenTopics(topics, results) {
  for (const topic of topics || []) {
    if (topic.Topics) {
      flattenTopics(topic.Topics, results);
    } else if (topic.FirstURL && topic.Text) {
      results.push({ title: topic.Text.split(' - ')[0], snippet: topic.Text, url: topic.FirstURL });
    }
    if (results.length >= 8) return;
  }
}

async function searchDuckDuckGo(query) {
  const searchUrl = new URL('https://api.duckduckgo.com/');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('format', 'json');
  searchUrl.searchParams.set('no_html', '1');
  searchUrl.searchParams.set('skip_disambig', '1');
  const upstream = await fetch(searchUrl, { signal: AbortSignal.timeout(8_000) });
  if (!upstream.ok) throw new Error(`DuckDuckGo returned HTTP ${upstream.status}.`);
  const data = await upstream.json();
  const results = [];
  if (data.AbstractURL && data.AbstractText) {
    results.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL });
  }
  flattenTopics(data.RelatedTopics, results);
  return results.slice(0, 8);
}

async function searchWikipedia(query, language) {
  const searchUrl = new URL(`https://${language}.wikipedia.org/w/api.php`);
  searchUrl.searchParams.set('action', 'query');
  searchUrl.searchParams.set('generator', 'search');
  searchUrl.searchParams.set('gsrsearch', query);
  searchUrl.searchParams.set('gsrlimit', '8');
  searchUrl.searchParams.set('prop', 'extracts');
  searchUrl.searchParams.set('exintro', '1');
  searchUrl.searchParams.set('explaintext', '1');
  searchUrl.searchParams.set('exsentences', '2');
  searchUrl.searchParams.set('format', 'json');
  const upstream = await fetch(searchUrl, {
    headers: { 'user-agent': 'JARVIS-Personal-Assistant/1.0 (Wikipedia search)' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!upstream.ok) throw new Error(`Wikipedia returned HTTP ${upstream.status}.`);
  const data = await upstream.json();
  return Object.values(data.query?.pages || {})
    .filter((page) => Number.isInteger(page.pageid) && typeof page.title === 'string')
    .slice(0, 8)
    .map((page) => ({
      title: page.title,
      snippet: typeof page.extract === 'string' ? page.extract.trim() : '',
      url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(' ', '_'))}`,
    }));
}

async function handleSearch(url, response) {
  const query = (url.searchParams.get('q') || '').trim();
  if (!query || query.length > 200) {
    throw Object.assign(new Error('Enter a search query of 1 to 200 characters.'), { status: 400 });
  }
  const language = url.searchParams.get('lang') || 'en';
  if (!['en', 'hi'].includes(language)) {
    throw Object.assign(new Error('Search language must be English or Hindi.'), { status: 400 });
  }

  let results;
  try {
    results = await searchDuckDuckGo(query);
    if (results.length) {
      sendJson(response, 200, { query, source: 'DuckDuckGo Instant Answer', results, notice: null });
      return;
    }
  } catch {
    // Continue to Wikipedia when DuckDuckGo is unavailable.
  }

  try {
    results = await searchWikipedia(query, language);
  } catch {
    throw Object.assign(new Error('Internet search is temporarily unavailable. DuckDuckGo Instant Answers and Wikipedia search could not be reached. Check your connection and try again.'), { status: 502 });
  }
  sendJson(response, 200, {
    query,
    source: `Wikipedia search (${language === 'hi' ? 'Hindi' : 'English'})`,
    results,
    notice: results.length ? null : 'No results were found by DuckDuckGo Instant Answers or Wikipedia search.',
  });
}

async function handleGeminiLiveToken(response) {
  const config = getAIConfig();
  if (!config || config.provider !== 'gemini') {
    throw Object.assign(new Error('Configure Google Gemini in Settings to use Live voice.'), { status: 503 });
  }

  const now = Date.now();
  let upstream;
  try {
    upstream = await fetch(`${geminiApiBaseUrl}/auth_tokens`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': config.apiKey,
      },
      body: JSON.stringify({
        uses: 1,
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        liveConnectConstraints: {
          model: 'models/gemini-3.8-live',
          config: { responseModalities: ['AUDIO'] },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw Object.assign(new Error('Google Gemini Live could not be reached. Check the server connection and try again.'), { status: 502 });
  }

  const data = await upstream.json().catch(() => ({}));
  const token = typeof data.name === 'string' ? data.name : '';
  if (!upstream.ok || !token) {
    const providerStatus = data?.error?.status;
    if (upstream.status === 401 || providerStatus === 'UNAUTHENTICATED') {
      throw Object.assign(new Error('The server Gemini API key is invalid or inactive. Check GEMINI_API_KEY in the server environment.'), { status: 502, code: 'GEMINI_INVALID_API_KEY' });
    }
    if (upstream.status === 403 || providerStatus === 'PERMISSION_DENIED') {
      throw Object.assign(new Error('The server Gemini API key does not have access to Gemini Live. Check model and API access for this key.'), { status: 502, code: 'GEMINI_LIVE_ACCESS_DENIED' });
    }
    if (upstream.status === 429 || providerStatus === 'RESOURCE_EXHAUSTED') {
      throw Object.assign(new Error('Gemini Live quota is exhausted or rate-limited. Check the Google AI quota and try again later.'), { status: 429, code: 'GEMINI_QUOTA_EXCEEDED' });
    }
    if (upstream.status === 404 || providerStatus === 'NOT_FOUND') {
      throw Object.assign(new Error('The configured Gemini Live model is unavailable to this API key.'), { status: 502, code: 'GEMINI_LIVE_MODEL_UNAVAILABLE' });
    }
    throw Object.assign(new Error('Google Gemini Live could not create a session token. Check model access, quota, and server connectivity.'), { status: 502, code: 'GEMINI_LIVE_TOKEN_FAILED' });
  }
  sendJson(response, 200, {
    token,
    model: 'gemini-3.8-live',
    expiresAt: new Date(now + 30 * 60_000).toISOString(),
  });
}

async function probeLocalTts(force = false) {
  const now = Date.now();
  if (!force && now - localTtsProbe.at < localTtsProbeTtlMs) return localTtsProbe;
  let next = { at: now, available: false, info: null };
  try {
    const upstream = await fetch(`${localTtsUrl}/health`, { signal: AbortSignal.timeout(800) });
    if (upstream.ok) {
      const info = await upstream.json().catch(() => null);
      next = { at: now, available: Boolean(info?.ready), info: info && typeof info === 'object' ? { engine: String(info.engine || 'omnivoice'), device: String(info.device || ''), languages: Array.isArray(info.languages) ? info.languages.map(String).slice(0, 8) : [] } : null };
    }
  } catch {
    // Sidecar not running: the browser voice engine remains the fallback.
  }
  localTtsProbe = next;
  return next;
}

export function validateTtsRequest(body) {
  const text = typeof body?.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
  if (!text) throw Object.assign(new Error('Text to speak is required.'), { status: 400, code: 'TTS_TEXT_REQUIRED' });
  if (text.length > maxTtsTextChars) {
    throw Object.assign(new Error(`Text to speak must be ${maxTtsTextChars} characters or fewer.`), { status: 400, code: 'TTS_TEXT_TOO_LONG' });
  }
  const language = body?.language === 'hi' ? 'hi' : 'en';
  return { text, language };
}

async function handleTts(request, response) {
  const { text, language } = validateTtsRequest(await readJson(request));
  let upstream;
  try {
    upstream = await fetch(`${localTtsUrl}/tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, language }),
      signal: AbortSignal.timeout(ttsTimeoutMs),
    });
  } catch (error) {
    localTtsProbe = { at: Date.now(), available: false, info: null };
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw Object.assign(new Error(timedOut
      ? 'The local OmniVoice engine took too long to answer.'
      : 'The local OmniVoice engine is not running. Using the browser voice instead.'), { status: timedOut ? 504 : 503, code: 'LOCAL_TTS_UNAVAILABLE' });
  }
  if (!upstream.ok) {
    throw Object.assign(new Error('The local OmniVoice engine could not generate speech.'), { status: 502, code: 'LOCAL_TTS_FAILED' });
  }
  const audio = Buffer.from(await upstream.arrayBuffer());
  const looksLikeWav = audio.length > 44 && audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE';
  if (!looksLikeWav || audio.length > maxTtsAudioBytes) {
    throw Object.assign(new Error('The local OmniVoice engine returned invalid audio.'), { status: 502, code: 'LOCAL_TTS_INVALID_AUDIO' });
  }
  response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': audio.length, 'cache-control': 'no-store' });
  response.end(audio);
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (!origin) return false;
  const extra = String(process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!builtInCorsOrigins.includes(origin) && !extra.includes(origin)) return false;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-headers', 'authorization, content-type');
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.setHeader('access-control-max-age', '600');
  return true;
}

async function serveStatic(url, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendJson(response, 400, { error: 'Invalid URL path.' });
    return;
  }

  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const isVoiceAsset = requestedPath.startsWith('/voice/');
  const staticRoot = isVoiceAsset ? voiceRoot : root;
  const relativePath = isVoiceAsset ? requestedPath.slice('/voice'.length) : requestedPath;
  const filePath = resolve(staticRoot, `.${relativePath}`);
  if (filePath !== staticRoot && !filePath.startsWith(`${staticRoot}${sep}`)) {
    sendJson(response, 403, { error: 'Forbidden.' });
    return;
  }
  // Only the three browser modules are public; reference examples, .env.example and Python sources are not.
  if (isVoiceAsset && !voiceStaticAllowlist.has(relativePath)) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

  try {
    const content = await readFile(filePath);
    const headers = {
      'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    };
    if (filePath.endsWith('service-worker.js')) {
      headers['service-worker-allowed'] = '/';
      headers['cache-control'] = 'no-cache';
    } else if (filePath.endsWith('index.html') || filePath.endsWith('manifest.webmanifest')) {
      headers['cache-control'] = 'no-cache';
    }
    response.writeHead(200, headers);
    response.end(content);
  } catch {
    sendJson(response, 404, { error: 'Not found.' });
  }
}

export function createAppServer() {
  const server = createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss://generativelanguage.googleapis.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");

    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) response.setHeader('cache-control', 'no-store');
    if (url.pathname.startsWith('/api/')) {
      const corsAllowed = applyCors(request, response);
      if (request.method === 'OPTIONS') {
        response.writeHead(corsAllowed ? 204 : 403);
        response.end();
        return;
      }
    }
    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        const config = getAIConfig();
        const ollama = await inspectOllama(config);
        const aiConfigured = Boolean(config);
        sendJson(response, 200, {
          aiConfigured,
          providerSource: getAIConfigSource(config),
          aiAvailable: ollama ? ollama.available && ollama.modelInstalled : Boolean(config),
          ollamaAvailable: ollama?.available ?? null,
          modelInstalled: ollama?.modelInstalled ?? null,
          provider: config?.provider ?? null,
          model: config?.model ?? null,
          baseUrl: config?.provider === 'openai-compatible' || config?.provider === 'ollama' ? config.baseUrl : null,
          accessRequired: Boolean(process.env.APP_ACCESS_TOKEN) || process.env.NODE_ENV === 'production',
          accessConfigured: Boolean(process.env.APP_ACCESS_TOKEN),
          search: 'DuckDuckGo Instant Answers with Wikipedia search fallback',
          voice: 'Google Gemini Live API over WebSocket; browser speech fallback when available',
          localTts: await (async () => {
            const probe = await probeLocalTts();
            return { engine: 'omnivoice', available: probe.available, ...(probe.info ? { device: probe.info.device, languages: probe.info.languages } : {}) };
          })(),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/settings/ai') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request)) {
          sendJson(response, 429, { error: 'Too many requests. Please wait a minute and try again.' });
          return;
        }
        const config = await configureAI(await readJson(request));
        sendJson(response, 200, {
          configured: Boolean(config),
          providerSource: getAIConfigSource(config),
          ...config,
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/models') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, modelRequestLimit, modelDiscoveryClientRequests)) {
          sendJson(response, 429, { status: 'Rate Limited', message: 'Model discovery is limited. Wait and retry.', models: [] });
          return;
        }
        const config = getAIConfig();
        if (!config) {
          sendJson(response, 503, { status: 'Unavailable', code: 'AI_PROVIDER_NOT_CONFIGURED', message: 'Configure an AI provider before discovering models.', models: [] });
          return;
        }
        sendJson(response, 200, await getProviderModels(config));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/models/test') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, modelRequestLimit, modelProbeClientRequests)) {
          sendJson(response, 429, { status: 'Rate Limited', message: 'Model tests are limited. Wait and retry.' });
          return;
        }
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
        }
        const config = getAIConfig();
        if (!config) {
          sendJson(response, 503, { status: 'Unavailable', code: 'AI_PROVIDER_NOT_CONFIGURED', message: 'Configure an AI provider before testing models.' });
          return;
        }
        sendJson(response, 200, await testProviderModel(config, body.model));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/settings/ai/model') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, modelRequestLimit, modelProbeClientRequests)) {
          sendJson(response, 429, { error: 'Model selection is limited. Wait and retry.' });
          return;
        }
        const config = configureAIModel(await readJson(request));
        sendJson(response, 200, { configured: true, providerSource: getAIConfigSource(config), ...config });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/live-token') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, liveTokenRequestLimit, liveTokenClientRequests)) {
          sendJson(response, 429, { error: 'Too many Live voice sessions. Wait a minute and try again.' });
          return;
        }
        await handleGeminiLiveToken(response);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/system') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request)) {
          sendJson(response, 429, { error: 'Too many requests. Please wait a minute and try again.' });
          return;
        }
        sendJson(response, 200, await getSystemMetrics());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/browser/research') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, browserResearchRequestLimit, browserResearchClientRequests)) {
          sendJson(response, 429, { error: 'Browser Research is limited to five requests per minute. Wait a minute and try again.' });
          return;
        }
        await handleBrowserResearch(request, response);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/home-assistant/entities') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, homeAssistantRequestLimit, homeAssistantClientRequests)) {
          sendJson(response, 429, { error: 'Home Assistant status is limited to ten requests per minute.' });
          return;
        }
        const configuration = readHomeAssistantConfiguration();
        if (!configuration) {
          sendJson(response, 503, { error: 'Home Assistant is not configured on this server.' });
          return;
        }
        const entities = await createHomeAssistantClient({ configuration }).listEntities();
        sendJson(response, 200, { entities });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/home-assistant/control') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, homeAssistantControlRequestLimit, homeAssistantControlClientRequests)) {
          sendJson(response, 429, { error: 'Home Assistant control is limited to five requests per minute.' });
          return;
        }
        const configuration = readHomeAssistantConfiguration();
        if (!configuration) {
          sendJson(response, 503, { error: 'Home Assistant is not configured on this server.' });
          return;
        }
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
        }
        const entity = await createHomeAssistantClient({ configuration }).controlEntity({
          entityId: body.entityId,
          targetState: body.targetState,
          confirmed: body.confirmed,
        });
        sendJson(response, 200, { entity });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/google/status') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, googleWorkspaceRequestLimit, googleWorkspaceClientRequests)) {
          sendJson(response, 429, { error: 'Google Workspace status is limited. Wait and retry.' });
          return;
        }
        sendJson(response, 200, await googleWorkspace.status());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/google/connect') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, googleWorkspaceWriteRequestLimit, googleWorkspaceWriteClientRequests)) {
          sendJson(response, 429, { error: 'Google Workspace connection requests are limited. Wait and retry.' });
          return;
        }
        sendJson(response, 200, googleWorkspace.startAuthorization());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/google/callback') {
        try {
          await googleWorkspace.completeAuthorization({
            code: url.searchParams.get('code'),
            state: url.searchParams.get('state'),
          });
          response.writeHead(303, {
            location: '/?google_workspace=connected',
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
          });
        } catch {
          response.writeHead(303, {
            location: '/?google_workspace=error',
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
          });
        }
        response.end();
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/google/disconnect') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, googleWorkspaceWriteRequestLimit, googleWorkspaceWriteClientRequests)) {
          sendJson(response, 429, { error: 'Google Workspace changes are limited. Wait and retry.' });
          return;
        }
        sendJson(response, 200, await googleWorkspace.disconnect());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/google/drafts') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, googleWorkspaceWriteRequestLimit, googleWorkspaceWriteClientRequests)) {
          sendJson(response, 429, { error: 'Google Workspace changes are limited. Wait and retry.' });
          return;
        }
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
        }
        sendJson(response, 200, await googleWorkspace.createDraft(body));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/google/events') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, googleWorkspaceRequestLimit, googleWorkspaceClientRequests)) {
          sendJson(response, 429, { error: 'Google Calendar requests are limited. Wait and retry.' });
          return;
        }
        sendJson(response, 200, { events: await googleWorkspace.listEvents({
          timeMin: url.searchParams.get('timeMin'),
          timeMax: url.searchParams.get('timeMax'),
        }) });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/google/events') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, googleWorkspaceWriteRequestLimit, googleWorkspaceWriteClientRequests)) {
          sendJson(response, 429, { error: 'Google Workspace changes are limited. Wait and retry.' });
          return;
        }
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
        }
        sendJson(response, 200, await googleWorkspace.createEvent(body));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/telegram/status') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, telegramRequestLimit, telegramClientRequests)) {
          sendJson(response, 429, { error: 'Telegram status is limited. Wait and retry.' });
          return;
        }
        sendJson(response, 200, telegram.status());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/telegram/send') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, telegramSendRequestLimit, telegramSendClientRequests)) {
          sendJson(response, 429, { error: 'Telegram sending is limited to three messages per minute.' });
          return;
        }
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
        }
        sendJson(response, 200, await telegram.sendMessage({
          chatId: body.chatId,
          text: body.text,
          confirmed: body.confirmed,
        }));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/facebook-messenger/status') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, facebookMessengerRequestLimit, facebookMessengerClientRequests)) {
          sendJson(response, 429, { error: 'Facebook Messenger status is limited. Wait and retry.' });
          return;
        }
        sendJson(response, 200, facebookMessenger.status());
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/facebook-messenger/send') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, facebookMessengerSendRequestLimit, facebookMessengerSendClientRequests)) {
          sendJson(response, 429, { error: 'Facebook Messenger sending is limited to three messages per minute.' });
          return;
        }
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw Object.assign(new Error('Request body must be a JSON object.'), { status: 400 });
        }
        sendJson(response, 200, await facebookMessenger.sendMessage({
          recipientId: body.recipientId,
          text: body.text,
          confirmed: body.confirmed,
        }));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/chat') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request)) {
          sendJson(response, 429, { error: 'Too many requests. Please wait a minute and try again.' });
          return;
        }
        await handleChat(request, response);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/tts') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, ttsRequestLimit, ttsClientRequests)) {
          sendJson(response, 429, { error: 'Too many speech requests. Please wait a minute and try again.' });
          return;
        }
        await handleTts(request, response);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/vision') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request, visionRequestLimit, visionClientRequests)) {
          sendJson(response, 429, { error: 'Vision is limited to five requests per minute. Wait a minute and try again.' });
          return;
        }
        await handleVision(request, response);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/search') {
        if (!authorizeApiRequest(request, response)) return;
        if (isRateLimited(request)) {
          sendJson(response, 429, { error: 'Too many requests. Please wait a minute and try again.' });
          return;
        }
        await handleSearch(url, response);
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        sendJson(response, 404, { error: 'API endpoint not found.' });
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      await serveStatic(url, response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status = error.status || (error.name === 'TimeoutError' || error.name === 'AbortError' ? 504 : 502);
      const message = sanitizeProviderErrorMessage(
        error.message,
        runtimeAIConfig?.apiKey || process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '',
        status,
      );
      if (url.pathname.startsWith('/api/')) {
        const code = typeof error.code === 'string' ? error.code : `HTTP_${status}`;
        console.error('[J.A.R.V.I.S.] API request failed', JSON.stringify({
          method: request.method,
          path: url.pathname,
          status,
          code,
          message,
        }));
      }
      sendJson(response, status, {
        error: message || 'The request could not be completed.',
        ...(typeof error.code === 'string' ? { code: error.code } : {}),
        ...(error.diagnostics && typeof error.diagnostics === 'object' ? { diagnostics: error.diagnostics } : {}),
      });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 35_000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createAppServer();
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the existing server before starting J.A.R.V.I.S. again.`);
    } else {
      console.error(`J.A.R.V.I.S. could not listen on port ${port}: ${error.message}`);
    }
    process.exitCode = 1;
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`J.A.R.V.I.S. ready at http://localhost:${port}`);
  });
}