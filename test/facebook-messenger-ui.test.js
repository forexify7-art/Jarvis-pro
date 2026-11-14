import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, app] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
]);

test('Facebook Messenger UI uses only server-configured recipients and confirms each reply', () => {
  for (const id of [
    'facebook-messenger-refresh',
    'facebook-messenger-status',
    'facebook-messenger-send-form',
    'facebook-messenger-recipient',
    'facebook-messenger-message',
    'facebook-messenger-send',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /administrator-approved recipients/);
  assert.match(html, /messaging window/);
  assert.doesNotMatch(html, /FACEBOOK_PAGE_ACCESS_TOKEN|FACEBOOK_ALLOWED_RECIPIENT_IDS/i);
  assert.match(app, /fetch\('\/api\/facebook-messenger\/status'/);
  assert.match(app, /fetch\('\/api\/facebook-messenger\/send'/);
  assert.match(app, /window\.confirm\(`Send this Messenger reply to recipient/);
});
