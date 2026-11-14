// Permission broker for agent actions. Pure logic: no storage, no DOM, no network.
// Every sensitive action needs an explicit user decision; nothing is auto-approved.
import { redactSensitiveText } from './lab-safety.js';

export const RISK = Object.freeze({ SAFE: 'safe', CONFIRM: 'confirm', DANGEROUS: 'dangerous' });

const ACTION_RISK = new Map([
  ['read-text', RISK.SAFE],
  ['read-file', RISK.SAFE],
  ['search-notes', RISK.SAFE],
  ['web-search', RISK.SAFE],
  ['ask-ai', RISK.SAFE],
  ['create-note', RISK.SAFE],
  ['create-file', RISK.CONFIRM],
  ['edit-file', RISK.CONFIRM],
  ['export-file', RISK.CONFIRM],
  ['save-memory', RISK.CONFIRM],
  ['browser-read-page', RISK.CONFIRM],
  ['open-url', RISK.CONFIRM],
  ['desktop-open-folder', RISK.CONFIRM],
  ['desktop-notify', RISK.CONFIRM],
  ['desktop-clipboard-write', RISK.CONFIRM],
  ['desktop-launch-app', RISK.DANGEROUS],
  ['desktop-clipboard-read', RISK.DANGEROUS],
  ['computer-control', RISK.DANGEROUS],
  ['delete-file', RISK.DANGEROUS],
  ['delete-memory', RISK.DANGEROUS],
  ['run-command', RISK.DANGEROUS],
]);

export function classifyAction(action) {
  return ACTION_RISK.get(action) ?? RISK.DANGEROUS; // unknown actions are treated as dangerous
}

export function createPermissionBroker({ ask, now = () => Date.now(), maxAuditEntries = 200 } = {}) {
  if (typeof ask !== 'function') throw new TypeError('A user confirmation callback is required.');
  const sessionGrants = new Set();
  const audit = [];

  function record(action, decision, detail) {
    audit.push({ at: now(), action, decision, detail: redactSensitiveText(String(detail ?? '')).slice(0, 200) });
    if (audit.length > maxAuditEntries) audit.splice(0, audit.length - maxAuditEntries);
  }

  async function request(action, detail = '') {
    const risk = classifyAction(action);
    if (risk === RISK.SAFE) {
      record(action, 'allowed-safe', detail);
      return { allowed: true, risk };
    }
    // Dangerous actions are never remembered: every call asks again.
    if (risk === RISK.CONFIRM && sessionGrants.has(action)) {
      record(action, 'allowed-session', detail);
      return { allowed: true, risk, remembered: true };
    }
    let answer;
    try {
      answer = await ask({ action, risk, detail: redactSensitiveText(String(detail ?? '')) });
    } catch {
      answer = 'deny';
    }
    const choice = answer === 'allow-session' && risk === RISK.CONFIRM ? 'allow-session'
      : (answer === 'allow' || answer === 'allow-session') ? 'allow' : 'deny';
    if (choice === 'deny') {
      record(action, 'denied', detail);
      return { allowed: false, risk };
    }
    if (choice === 'allow-session') sessionGrants.add(action);
    record(action, choice === 'allow-session' ? 'allowed-session-grant' : 'allowed-once', detail);
    return { allowed: true, risk };
  }

  return {
    request,
    revokeAll() { sessionGrants.clear(); record('*', 'revoked-all', ''); },
    getAudit() { return audit.map((entry) => ({ ...entry })); },
  };
}
