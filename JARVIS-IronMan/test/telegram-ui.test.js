import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, app] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
]);

test('Telegram UI uses only server-configured recipients and confirms each send', () => {
  for (const id of ['telegram-refresh', 'telegram-status', 'telegram-send-form', 'telegram-recipient', 'telegram-message', 'telegram-send']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /administrator-approved chats/);
  assert.doesNotMatch(html, /TELEGRAM_BOT_TOKEN|TELEGRAM_ALLOWED_CHAT_IDS/i);
  assert.match(app, /fetch\('\/api\/telegram\/status'/);
  assert.match(app, /fetch\('\/api\/telegram\/send'/);
  assert.match(app, /window\.confirm\(`Send this Telegram message to chat/);
  assert.match(app, /elements\.telegramRecipient\.add\(option\)/);
});