import { expect, test } from '@playwright/test';

const baseURL = `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || '4175'}`;
const testOpenAIKey = 'test-only-browser-openai-key';

function providerLabel(provider) {
  if (provider === 'gemini') return 'Google Gemini';
  if (provider === 'ollama') return 'Ollama';
  return 'OpenAI-compatible';
}

async function installApiMocks(page, { provider = null, configured = false, failFirstChat = false } = {}) {
  const state = {
    provider,
    model: provider === 'ollama' ? 'llama3.2:3b' : 'gemini-test-model',
    baseUrl: provider === 'ollama' ? 'http://127.0.0.1:11434' : null,
    configured,
    failFirstChat,
    chatCalls: [],
    browserResearchCalls: [],
    visionCalls: [],
    settingsCalls: [],
    modelDiscoveryCalls: [],
    telegramCalls: [],
    apiResponses: [],
    unexpectedApiRequests: [],
    externalRequests: [],
    browserErrors: [],
    failedLocalRequests: [],
    browserMessages: [],
  };

  page.on('console', (message) => {
    state.browserMessages.push(message.text());
    if (message.type() === 'error') state.browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => state.browserErrors.push(error.message));
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(baseURL)) {
      state.failedLocalRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`);
    }
  });

  await page.route('**/*', async (route) => {
    if (!route.request().url().startsWith(baseURL)) {
      state.externalRequests.push(route.request().url());
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const fulfill = async (data, status = 200) => {
      state.apiResponses.push(JSON.stringify(data));
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(data),
      });
    };

    if (url.pathname === '/api/health' && request.method() === 'GET') {
      await fulfill({
        aiConfigured: state.configured,
        providerSource: state.configured ? 'session' : 'none',
        aiAvailable: state.configured,
        ollamaAvailable: state.provider === 'ollama' ? true : null,
        modelInstalled: state.provider === 'ollama' ? true : null,
        provider: state.provider,
        model: state.configured ? state.model : null,
        baseUrl: state.baseUrl,
        accessRequired: false,
        accessConfigured: false,
      });
      return;
    }

    if (url.pathname === '/api/system' && request.method() === 'GET') {
      await fulfill({
        cpuUsagePercent: 12,
        cpuCount: 4,
        memoryUsedBytes: 512,
        memoryTotalBytes: 1024,
        memoryPercent: 50,
        diskUsedBytes: 1_024,
        diskTotalBytes: 2_048,
        diskPercent: 50,
        source: 'local browser mock',
        measuredAt: new Date().toISOString(),
      });
      return;
    }

    if (url.pathname === '/api/settings/ai' && request.method() === 'POST') {
      const body = request.postDataJSON();
      state.settingsCalls.push(body);
      state.provider = body.provider === 'environment' ? null : body.provider;
      state.configured = body.provider !== 'environment';
      state.model = body.model || null;
      state.baseUrl = body.baseUrl || null;
      await fulfill({
        configured: state.configured,
        providerSource: state.configured ? 'session' : 'none',
        provider: state.provider,
        model: state.model,
        ...(state.provider === 'ollama' || state.provider === 'openai-compatible'
          ? { baseUrl: state.baseUrl }
          : {}),
      });
      return;
    }

    if (url.pathname === '/api/models' && request.method() === 'GET') {
      state.modelDiscoveryCalls.push({ provider: state.provider, configured: state.configured });
      const model = state.model || 'mock-model';
      await fulfill({
        status: state.configured ? 'Available' : 'Unavailable',
        models: state.configured ? [{ id: model, name: model, status: 'Untested', verified: false }] : [],
        latencyMs: 0,
      }, state.configured ? 200 : 503);
      return;
    }

    if (url.pathname === '/api/models/test' && request.method() === 'POST') {
      const body = request.postDataJSON();
      await fulfill({ status: 'Available', message: `${body.model} is compatible.`, verified: true, latencyMs: 0 });
      return;
    }

    if (url.pathname === '/api/settings/ai/model' && request.method() === 'POST') {
      const body = request.postDataJSON();
      state.model = body.model;
      await fulfill({ configured: true, provider: state.provider, model: state.model });
      return;
    }

    if (url.pathname === '/api/chat' && request.method() === 'POST') {
      const body = request.postDataJSON();
      state.chatCalls.push(body);
      if (state.failFirstChat) {
        state.failFirstChat = false;
        await fulfill({ error: 'Mock provider temporarily unavailable.', code: 'UPSTREAM_UNAVAILABLE' }, 503);
        return;
      }
      await fulfill({
        reply: `Mock reply for ${body.provider}.`,
        provider: `${providerLabel(body.provider)} / ${state.model || 'mock-model'}`,
      });
      return;
    }

    if (url.pathname === '/api/search' && request.method() === 'GET') {
      await fulfill({
        query: url.searchParams.get('q'),
        source: 'Mock source index',
        results: [{
          title: 'Source-backed mock article',
          source: 'Mock Publisher',
          url: 'https://news.example.test/article',
          snippet: 'A mock excerpt linked to its source.',
          datePublished: '2026-10-30',
        }],
        notice: null,
      });
      return;
    }

    if (url.pathname === '/api/vision' && request.method() === 'POST') {
      const body = request.postDataJSON();
      state.visionCalls.push(body);
      await fulfill({ reply: 'Mock Vision response.', provider: `${providerLabel(body.provider)} / mock-model` });
      return;
    }

    if (url.pathname === '/api/browser/research' && request.method() === 'POST') {
      const body = request.postDataJSON();
      state.browserResearchCalls.push(body);
      await fulfill({ url: body.url, result: 'Mock summary from the requested public page.' });
      return;
    }

    if (url.pathname === '/api/telegram/status' && request.method() === 'GET') {
      await fulfill({ configured: true, recipients: ['123456789', '-1009876543210'] });
      return;
    }

    if (url.pathname === '/api/telegram/send' && request.method() === 'POST') {
      const body = request.postDataJSON();
      state.telegramCalls.push(body);
      await fulfill({ sent: true, chatId: body.chatId, messageId: 81 });
      return;
    }

    state.unexpectedApiRequests.push(`${request.method()} ${url.pathname}`);
    await fulfill({ error: 'Unexpected API request in browser test.', code: 'UNEXPECTED_API_REQUEST' }, 500);
  });

  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('jarvis.interface.mode.v7', 'old');
  });

  return state;
}

async function activate(page, locator) {
  const supportsTouch = await page.evaluate(() => (
    matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0
  ));
  if (supportsTouch) {
    await locator.tap();
    return;
  }
  await locator.click();
}

async function openSettings(page) {
  const topbarSettings = page.locator('#settings-button');
  const dashboardSettings = page.locator('#dashboard-settings-button');
  const settingsButton = await topbarSettings.isVisible() ? topbarSettings : dashboardSettings;
  await activate(page, settingsButton);
  await expect(page.locator('#settings-dialog')).toBeVisible();
}

async function saveProvider(page, provider) {
  const select = page.locator('#ai-provider-select');
  await select.selectOption(provider);
  if (provider === 'ollama') {
    await page.locator('#ai-model-input').fill('llama3.2:3b');
    await page.locator('#ai-base-url').fill('http://127.0.0.1:11434');
    await activate(page, page.locator('#ai-settings-save'));
  } else if (provider === 'openai-compatible') {
    await page.locator('#ai-model-input').fill('gpt-test-model');
    await page.locator('#ai-base-url').fill('https://mock.openai.example/v1/');
    await page.locator('#ai-api-key').fill(testOpenAIKey);
    await activate(page, page.locator('#ai-settings-save'));
  }
}

async function submitChat(page, text) {
  const dashboardMessage = page.locator('#dashboard-message:visible');
  if (await dashboardMessage.count()) {
    await dashboardMessage.fill(text);
    await dashboardMessage.press('Enter');
    return;
  }
  await page.locator('#message-input:visible').fill(text);
  await activate(page, page.locator('#send-button:visible'));
}

async function clickMoreNavigation(page) {
  await activate(page, page.locator('.mobile-nav [data-nav="more"]'));
  await expect(page.locator('#more-navigation-dialog')).toBeVisible();
}

async function enableFullAccess(page) {
  const desktopToggle = page.locator('#full-access-toggle');
  if (await desktopToggle.isVisible()) {
    await activate(page, page.locator('.access-switch'));
    await expect(desktopToggle).toBeChecked();
    return;
  }
  await clickMoreNavigation(page);
  await activate(page, page.locator('.mobile-access-control .switch'));
  await expect(page.locator('#full-access-mobile-toggle')).toBeChecked();
  await activate(page, page.locator('#more-navigation-dialog .settings-head button'));
}

async function expectNoBrowserOrNetworkErrors(state, { browserErrors = [] } = {}) {
  expect(state.externalRequests).toEqual([]);
  expect(state.unexpectedApiRequests).toEqual([]);
  expect(state.failedLocalRequests).toEqual([]);
  expect(state.browserErrors).toEqual(browserErrors);
}

test('responsive layouts, dialogs, chat tools, and navigation fit desktop, tablet, and narrow mobile widths', async ({ page }, testInfo) => {
  const state = await installApiMocks(page);
  await page.goto('/');
  await expect(page.locator('#dashboard-layout')).toBeVisible();

  const widths = testInfo.project.name === 'android-mobile'
    ? [412]
    : [320, 360, 390, 768, 1024, 1440];
  for (const width of widths) {
    if (testInfo.project.name !== 'android-mobile') {
      await page.setViewportSize({ width, height: width <= 780 ? 844 : 960 });
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await openSettings(page);
    const dialogBounds = await page.locator('#settings-dialog').boundingBox();
    expect(dialogBounds).not.toBeNull();
    expect(dialogBounds.x).toBeGreaterThanOrEqual(0);
    expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(width + 1);
    await page.locator('#ai-provider-select').scrollIntoViewIfNeeded();
    const providerBounds = await page.locator('#ai-provider-select').boundingBox();
    expect(providerBounds.x).toBeGreaterThanOrEqual(0);
    expect(providerBounds.x + providerBounds.width).toBeLessThanOrEqual(width + 1);
    await activate(page, page.locator('#settings-dialog [aria-label="Close settings"]'));
  }

  if (testInfo.project.name !== 'android-mobile') {
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await activate(page, page.locator('.mobile-nav [data-nav="dashboard"]'));
  await expect(page.locator('#dashboard-layout')).toBeVisible();
  if (testInfo.project.name === 'android-mobile') {
    await expect(page.locator('.mobile-nav')).toBeVisible();
    await expect(page.locator('.mobile-nav [data-nav="more"]')).toBeVisible();
  }
  await expectNoBrowserOrNetworkErrors(state);
});

test('reload opens the app shell and keeps dashboard assets available', async ({ page }) => {
  const state = await installApiMocks(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#dashboard-layout')).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#dashboard-layout')).toBeVisible();
  await activate(page, page.locator('[data-nav="dashboard"]:visible').first());
  await expect(page.locator('#dashboard-layout')).toBeVisible();
  await expect.poll(() => page.locator('#ai-avatar').evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.locator('[data-holo-state]')).toHaveCount(4);
  await expect(page.locator('#holo-waveform')).toBeVisible();
  await expect(page.locator('#system-panel')).toBeVisible();
  await expectNoBrowserOrNetworkErrors(state);
});

test('provider settings remain keyboard-operable in desktop and mobile browsers', async ({ page }) => {
  const state = await installApiMocks(page);
  await page.goto('/');
  await openSettings(page);
  const provider = page.locator('#ai-provider-select');
  await provider.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(provider).toHaveValue('openai-compatible');
  await page.locator('#settings-dialog [aria-label="Close settings"]').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
  await expectNoBrowserOrNetworkErrors(state);
});

test('Telegram loads approved recipients and requires confirmation before sending', async ({ page }) => {
  const state = await installApiMocks(page);
  await page.goto('/');
  await openSettings(page);

  await activate(page, page.locator('#telegram-refresh'));
  await expect(page.locator('#telegram-status')).toContainText('2 approved Telegram recipient(s)');
  const recipient = page.locator('#telegram-recipient');
  await expect(recipient.locator('option')).toHaveCount(3);
  await recipient.selectOption('123456789');
  await page.locator('#telegram-message').fill('Browser test message');

  let confirmationSeen = false;
  page.once('dialog', async (dialog) => {
    confirmationSeen = true;
    expect(dialog.message()).toContain('123456789');
    expect(dialog.message()).toContain('Browser test message');
    await dialog.accept();
  });
  await activate(page, page.locator('#telegram-send'));

  await expect(page.locator('#telegram-status')).toContainText('Message sent to approved chat 123456789');
  await expect(page.locator('#telegram-message')).toHaveValue('');
  expect(confirmationSeen).toBe(true);
  expect(state.telegramCalls).toEqual([{ chatId: '123456789', text: 'Browser test message', confirmed: true }]);
  await expectNoBrowserOrNetworkErrors(state);
});

test('Gemini keys are environment-only while other provider settings continue to work', async ({ page }) => {
  const state = await installApiMocks(page, { provider: 'gemini', configured: true });
  await page.goto('/');
  await openSettings(page);

  await expect(page.locator('#ai-provider-select')).toHaveValue('gemini');
  await expect(page.locator('#ai-key-field')).toBeHidden();
  await expect(page.locator('#ai-settings-save')).toBeHidden();
  await expect(page.locator('#ai-provider-help')).toContainText('GEMINI_API_KEY');

  for (const provider of ['ollama', 'openai-compatible']) {
    await saveProvider(page, provider);
    await expect(page.locator('#ai-setup-status')).toContainText(`Current: ${providerLabel(provider)}`);
    await expect(page.locator('#ai-setup-status')).toContainText('temporary server-session setting');
  }

  await expect(page.locator('#ai-provider-select')).toHaveValue('openai-compatible');
  await activate(page, page.locator('#settings-dialog [aria-label="Close settings"]'));
  await page.reload();
  await openSettings(page);
  await expect(page.locator('#ai-provider-select')).toHaveValue('openai-compatible');
  await expect(page.locator('#ai-model-input')).toHaveValue('gpt-test-model');
  await expect(page.locator('#ai-api-key')).toHaveValue('');

  const storedValues = await page.evaluate(() => JSON.stringify({
    local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(storedValues).not.toContain(testOpenAIKey);
  expect(state.apiResponses.join('\n')).not.toContain(testOpenAIKey);
  expect(state.browserMessages.join('\n')).not.toContain(testOpenAIKey);
  expect(state.settingsCalls.map(({ provider }) => provider)).toEqual([
    'ollama',
    'openai-compatible',
  ]);
  await expectNoBrowserOrNetworkErrors(state);
});

test('Electron renderer bridge does not expose Gemini API key operations', async ({ page }) => {
  const state = await installApiMocks(page);
  await page.addInitScript(() => {
    window.jarvisDesktop = {
      openExternalUrl: async () => false,
      copyText: async () => false,
    };
  });
  await page.goto('/');
  await openSettings(page);
  await expect(page.locator('#ai-provider-select')).toHaveValue('gemini');
  await expect(page.locator('#ai-key-field')).toBeHidden();

  const rendererState = await page.evaluate(() => JSON.stringify({
    local: Object.values(localStorage),
    session: Object.values(sessionStorage),
    html: document.documentElement.outerHTML,
    text: document.body.innerText,
    bridge: Object.keys(window.jarvisDesktop),
  }));
  expect(rendererState).not.toMatch(/GeminiApiKey|gemini-key/);
  expect(state.apiResponses.join('\n')).not.toMatch(/apiKey/i);
  expect(state.browserMessages.join('\n')).not.toMatch(/Gemini API key/i);
  await expectNoBrowserOrNetworkErrors(state);
});

test('chat retry, Study Mode, and source-backed summaries use the active mocked provider', async ({ page }) => {
  const state = await installApiMocks(page, {
    provider: 'gemini',
    configured: true,
    failFirstChat: true,
  });
  await page.goto('/');
  await enableFullAccess(page);

  await submitChat(page, 'Test retry routing');
  const dashboardActive = await page.locator('#dashboard-layout').isVisible();
  const retryButton = page.locator(dashboardActive ? '#dashboard-retry-button' : '#conversation-retry-button');
  await expect(retryButton).toBeVisible();

  await openSettings(page);
  await saveProvider(page, 'ollama');
  await activate(page, page.locator('#settings-dialog [aria-label="Close settings"]'));
  await activate(page, retryButton);
  await expect(page.locator(dashboardActive ? '#dashboard-chat-state' : '#conversation-chat-state')).toBeHidden();
  expect(state.chatCalls.map(({ provider }) => provider)).toEqual(['gemini', 'ollama']);

  if (await page.locator('.primary-nav [data-nav="study"]').isVisible()) {
    await activate(page, page.locator('.primary-nav [data-nav="study"]'));
  } else {
    await clickMoreNavigation(page);
    await activate(page, page.locator('#more-navigation-dialog [data-nav="study"]'));
  }
  await submitChat(page, 'Explain the water cycle');
  await expect(page.locator(dashboardActive ? '#dashboard-transcript' : '#transcript')).toContainText('Mock reply for ollama.');
  expect(state.chatCalls.at(-1).mode).toBe('study');
  expect(state.chatCalls.at(-1).provider).toBe('ollama');

  await activate(page, page.locator('[data-quick-action="search"]:visible'));
  await submitChat(page, 'verified source query');
  const summaryButtons = page.locator('.search-summary-button:visible');
  await expect(summaryButtons).toHaveCount(1);
  const summaryButton = summaryButtons.first();
  await expect(summaryButton).toBeVisible();
  await activate(page, summaryButton);
  await expect(page.locator(dashboardActive ? '#dashboard-transcript' : '#transcript')).toContainText('Mock reply for ollama.');
  expect(state.chatCalls.at(-1).provider).toBe('ollama');
  expect(state.chatCalls.at(-1).messages[0].content).toContain('"title":"Source-backed mock article"');
  expect(state.chatCalls.at(-1).messages[0].content).toContain('"url":"https://news.example.test/article"');
  await expectNoBrowserOrNetworkErrors(state, {
    browserErrors: ['Failed to load resource: the server responded with a status of 503 (Service Unavailable)'],
  });
});

test('Vision permission, local preview, send, and emergency stop stay inside mocked local routes', async ({ page }) => {
  const state = await installApiMocks(page, { provider: 'gemini', configured: true });
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const context = canvas.getContext('2d');
    context.fillStyle = '#123456';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const stream = canvas.captureStream(10);
    let frame = 0;
    window.setInterval(() => {
      context.fillStyle = frame % 2 ? '#123456' : '#123457';
      context.fillRect(0, 0, canvas.width, canvas.height);
      frame += 1;
    }, 100);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        ...navigator.mediaDevices,
        getDisplayMedia: async () => stream,
      },
    });
  });
  await page.goto('/');
  await enableFullAccess(page);
  await activate(page, page.locator('[data-quick-action="capture"]:visible').first());
  await expect(page.locator('#screen-capture-dialog')).toBeVisible();
  await expect(page.locator('#capture-frame-button')).toBeEnabled();
  await page.waitForFunction(() => document.querySelector('#capture-preview').videoWidth > 0);
  await activate(page, page.locator('#capture-frame-button'));
  await expect(page.locator('#vision-question')).toBeEnabled();
  await page.locator('#vision-question').fill('Describe this test frame.');
  await activate(page, page.locator('#vision-send-button'));
  await expect(page.locator('#screen-capture-dialog')).toBeHidden();
  expect(state.visionCalls).toHaveLength(1);
  expect(state.visionCalls[0].provider).toBe('gemini');
  expect(state.visionCalls[0].question).toBe('Describe this test frame.');
  expect(state.visionCalls[0].image).toMatch(/^data:image\/jpeg;base64,/);
  await activate(page, page.locator('[data-quick-action="capture"]:visible').first());
  await expect(page.locator('#capture-frame-button')).toBeEnabled();
  await page.waitForFunction(() => document.querySelector('#capture-preview').videoWidth > 0);
  await activate(page, page.locator('#stop-capture-button'));
  await expect(page.locator('#capture-status')).toContainText('Emergency Stop');
  await expectNoBrowserOrNetworkErrors(state);
});

test('Browser Research is an explicit read-only action and renders the mocked result as text', async ({ page }) => {
  const state = await installApiMocks(page, { configured: true, provider: 'gemini' });
  await page.goto(baseURL);
  await enableFullAccess(page);
  await activate(page, page.locator('#browser-research-open'));
  await expect(page.locator('#browser-research-dialog')).toBeVisible();
  await page.locator('#browser-research-url').fill('https://example.com/article');
  await page.locator('#browser-research-question').fill('Summarize the article');
  await activate(page, page.locator('#browser-research-submit'));

  await expect(page.locator('#browser-research-result')).toHaveText('Mock summary from the requested public page.');
  await expect(page.locator('#browser-research-status')).toContainText('Research complete');
  expect(state.browserResearchCalls).toEqual([{
    url: 'https://example.com/article',
    question: 'Summarize the article',
  }]);
  expect(state.unexpectedApiRequests).toEqual([]);
  expect(state.externalRequests).toEqual([]);
});
