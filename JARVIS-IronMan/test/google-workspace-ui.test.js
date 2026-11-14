import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, app] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
]);

test('Google Workspace UI exposes server-side connect, draft, calendar, and disconnect actions', () => {
  for (const id of [
    'google-workspace-connect', 'google-workspace-refresh', 'google-workspace-disconnect',
    'google-workspace-status', 'google-draft-form', 'google-draft-to', 'google-draft-subject',
    'google-draft-body', 'google-calendar-refresh', 'google-calendar-events', 'google-event-form',
  ]) assert.match(html, new RegExp(`id="${id}"`));

  assert.match(app, /googleWorkspaceConnect\.addEventListener\('click', connectGoogleWorkspace\)/);
  assert.match(app, /googleDraftForm\.addEventListener\('submit', createGoogleDraft\)/);
  assert.match(app, /googleEventForm\.addEventListener\('submit', createGoogleCalendarEvent\)/);
  assert.match(app, /window\.confirm\(`Save a Gmail draft[\s\S]*?It will not be sent\.`\)/);
  assert.match(app, /window\.confirm\(`Create “\$\{summary\}[\s\S]*?Google Calendar\?`\)/);
  assert.match(app, /authorizationUrl\.origin !== 'https:\/\/accounts\.google\.com'/);
  assert.doesNotMatch(html, /GOOGLE_CLIENT_SECRET|APP_ENCRYPTION_KEY|refresh_token/i);
});