// Typed, allowlisted desktop actions. This is NOT arbitrary computer control:
// there is no shell string, no mouse/keyboard synthesis and no window control.
// Every action is validated, confirmed natively by the main process, audited, rate-limited and cancellable.

export const COMPUTER_ACTIONS = Object.freeze(['launch-app', 'open-folder', 'clipboard-write', 'clipboard-read', 'notify']);

// App ids map to fixed executables. Arguments are never taken from the caller.
export const APP_ALLOWLIST = Object.freeze({
  calculator: { win32: 'calc.exe', darwin: 'Calculator', linux: 'gnome-calculator', label: 'Calculator' },
  notepad: { win32: 'notepad.exe', darwin: 'TextEdit', linux: 'gedit', label: 'Text editor' },
  paint: { win32: 'mspaint.exe', darwin: 'Preview', linux: 'gimp', label: 'Paint / image viewer' },
  explorer: { win32: 'explorer.exe', darwin: 'Finder', linux: 'xdg-open', label: 'File manager' },
});

// Folder ids map to Electron app.getPath() names only.
export const FOLDER_ALLOWLIST = Object.freeze({
  downloads: 'downloads',
  documents: 'documents',
  pictures: 'pictures',
  desktop: 'desktop',
});

const MAX_TEXT = 20_000;
const MAX_NOTIFICATION_TITLE = 80;
const MAX_NOTIFICATION_BODY = 300;
const MAX_AUDIT = 200;

function fail(message) {
  const error = new Error(message);
  error.name = 'ComputerActionError';
  return error;
}

export function validateComputerAction(action, params = {}) {
  if (!COMPUTER_ACTIONS.includes(action)) throw fail(`Unsupported desktop action "${action}".`);
  if (params === null || typeof params !== 'object' || Array.isArray(params)) throw fail('Action parameters must be an object.');
  switch (action) {
    case 'launch-app': {
      const app = typeof params.app === 'string' ? params.app.trim().toLowerCase() : '';
      if (!Object.hasOwn(APP_ALLOWLIST, app)) throw fail(`"${params.app}" is not an allowlisted app. Allowed: ${Object.keys(APP_ALLOWLIST).join(', ')}.`);
      return { app, summary: `Open ${APP_ALLOWLIST[app].label}` };
    }
    case 'open-folder': {
      const folder = typeof params.folder === 'string' ? params.folder.trim().toLowerCase() : '';
      if (!Object.hasOwn(FOLDER_ALLOWLIST, folder)) throw fail(`"${params.folder}" is not an allowlisted folder. Allowed: ${Object.keys(FOLDER_ALLOWLIST).join(', ')}.`);
      return { folder, summary: `Open your ${folder} folder` };
    }
    case 'clipboard-write': {
      const text = params.text;
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT || text.includes('\u0000')) {
        throw fail(`Clipboard text must be 1-${MAX_TEXT} characters of plain text.`);
      }
      return { text, summary: `Copy ${text.length} characters to the clipboard` };
    }
    case 'clipboard-read':
      return { summary: 'Read the current clipboard text' };
    case 'notify': {
      const title = typeof params.title === 'string' ? params.title.trim() : 'J.A.R.V.I.S.';
      const body = typeof params.body === 'string' ? params.body.trim() : '';
      if (!body || body.length > MAX_NOTIFICATION_BODY || title.length > MAX_NOTIFICATION_TITLE || !title) {
        throw fail(`Notification needs a title (max ${MAX_NOTIFICATION_TITLE}) and body (max ${MAX_NOTIFICATION_BODY}).`);
      }
      return { title, body, summary: `Show a notification: ${body.slice(0, 60)}` };
    }
    default:
      throw fail('Unsupported desktop action.');
  }
}

// deps: { platform, confirm(summary, action) => Promise<boolean>, spawnApp(cmd, platform), openPath(path),
//         getPath(name), readClipboard(), writeClipboard(text), showNotification({title, body}), now() }
export function createComputerActionRunner(deps) {
  const { platform = 'linux', confirm, spawnApp, openPath, getPath, readClipboard, writeClipboard, showNotification, now = () => Date.now(),
    maxPerMinute = 10 } = deps || {};
  if (typeof confirm !== 'function') throw new TypeError('A native confirmation callback is required.');
  const audit = [];
  const recent = [];

  function record(action, decision, summary) {
    audit.push({ at: now(), action, decision, summary: String(summary).slice(0, 200) });
    if (audit.length > MAX_AUDIT) audit.splice(0, audit.length - MAX_AUDIT);
  }

  async function run(action, params = {}, { signal } = {}) {
    let valid;
    try {
      valid = validateComputerAction(action, params);
    } catch (error) {
      record(String(action), 'rejected-invalid', error.message);
      throw error;
    }
    if (signal?.aborted) { record(action, 'cancelled', valid.summary); throw fail('Cancelled before it started.'); }

    const cutoff = now() - 60_000;
    while (recent.length && recent[0] < cutoff) recent.shift();
    if (recent.length >= maxPerMinute) { record(action, 'rate-limited', valid.summary); throw fail('Too many desktop actions. Wait a minute and try again.'); }

    const approved = await confirm(valid.summary, action);
    if (!approved) { record(action, 'denied', valid.summary); return { ok: false, denied: true }; }
    if (signal?.aborted) { record(action, 'cancelled', valid.summary); throw fail('Cancelled before it started.'); }
    recent.push(now());

    try {
      let result;
      switch (action) {
        case 'launch-app': {
          const entry = APP_ALLOWLIST[valid.app];
          const command = entry[platform];
          if (!command) throw fail(`${entry.label} is not available on ${platform}.`);
          await spawnApp(command, platform);
          result = { launched: valid.app };
          break;
        }
        case 'open-folder': {
          const path = getPath(FOLDER_ALLOWLIST[valid.folder]);
          const error = await openPath(path);
          if (error) throw fail(`Could not open the folder: ${error}`);
          result = { opened: valid.folder };
          break;
        }
        case 'clipboard-write':
          await writeClipboard(valid.text);
          result = { copied: valid.text.length };
          break;
        case 'clipboard-read': {
          const text = String(await readClipboard() ?? '').slice(0, MAX_TEXT);
          result = { text };
          break;
        }
        case 'notify':
          await showNotification({ title: valid.title, body: valid.body });
          result = { notified: true };
          break;
        default:
          throw fail('Unsupported desktop action.');
      }
      record(action, 'executed', valid.summary);
      return { ok: true, ...result };
    } catch (error) {
      record(action, 'failed', `${valid.summary}: ${error.message}`);
      throw error;
    }
  }

  return { run, getAudit: () => audit.map((entry) => ({ ...entry })) };
}
