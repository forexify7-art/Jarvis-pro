// Offline, rule-based task planner (no AI call, no network). Splits a request into ordered steps.
// Unrecognised requests become one "ask-ai" step, never a guessed system action.
const SPLITTERS = /\s*(?:,\s*then\s+|\s+and\s+then\s+|\s+then\s+|\s*;\s*|\s+फिर\s+|\s+उसके बाद\s+)/i;
const URL_PATTERN = /\bhttps?:\/\/[^\s,;]+/i;

function stepFor(text, index) {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  const id = `step-${index + 1}`;
  let match;

  if ((match = lower.match(/^(?:delete|remove)\s+(?:the\s+)?file\s+(.+)$/))) {
    return { id, action: 'delete-file', label: `Delete file ${match[1].trim()}`, params: { name: match[1].trim() }, expect: { type: 'defined' } };
  }
  if ((match = raw.match(/^(?:create|make|write)\s+(?:a\s+)?(?:new\s+)?file\s+(?:named|called)\s+(\S+)(?:\s+(?:with|containing)\s+([\s\S]+))?$/i))) {
    return { id, action: 'create-file', label: `Create file ${match[1]}`, params: { name: match[1], content: (match[2] || '').trim() }, expect: { type: 'file-created' } };
  }
  if ((match = raw.match(/^(?:save|export|download)\s+(?:the\s+)?file\s+(\S+)$/i))) {
    return { id, action: 'export-file', label: `Export file ${match[1]}`, params: { name: match[1] }, expect: { type: 'defined' } };
  }
  if ((match = raw.match(/^(?:remember|save to memory|save memory)[:\s]+([\s\S]+)$/i))) {
    return { id, action: 'save-memory', label: 'Save a memory', params: { content: match[1].trim() }, expect: { type: 'defined' } };
  }
  if ((match = lower.match(/^(?:search|find|look up)\s+(?:my\s+)?notes?(?:\s+(?:for|about))?\s*(.*)$/))) {
    return { id, action: 'search-notes', label: 'Search notes', params: { query: match[1].trim() }, expect: { type: 'defined' } };
  }
  if ((match = raw.match(URL_PATTERN))) {
    const url = match[0];
    const question = raw.replace(url, '').replace(/^(?:read|open|summari[sz]e|visit)\s*(?:the\s+)?(?:page\s*)?/i, '').trim();
    if (/^(?:open|visit)\b/i.test(raw) && !question) {
      return { id, action: 'open-url', label: `Open ${url}`, params: { url }, expect: { type: 'defined' } };
    }
    return { id, action: 'browser-read-page', label: `Read ${url}`, params: { url, question: question || 'Summarize this page.' }, expect: { type: 'non-empty-text' } };
  }
  if ((match = raw.match(/^(?:open|launch|start)\s+(?:the\s+)?(calculator|notepad|paint|explorer|file manager)(?:\s+app)?$/i))) {
    const app = match[1].toLowerCase() === 'file manager' ? 'explorer' : match[1].toLowerCase();
    return { id, action: 'desktop-launch-app', label: `Open ${app}`, params: { app }, expect: { type: 'defined' } };
  }
  if ((match = raw.match(/^open\s+(?:my\s+|the\s+)?(downloads|documents|pictures|desktop)(?:\s+folder)?$/i))) {
    return { id, action: 'desktop-open-folder', label: `Open ${match[1].toLowerCase()} folder`, params: { folder: match[1].toLowerCase() }, expect: { type: 'defined' } };
  }
  if ((match = raw.match(/^copy\s+(?:the\s+text\s+)?["“]?([\s\S]+?)["”]?\s+to\s+(?:the\s+)?clipboard$/i))) {
    return { id, action: 'desktop-clipboard-write', label: 'Copy text to clipboard', params: { text: match[1].trim() }, expect: { type: 'defined' } };
  }
  if (/^(?:read|show|paste)\s+(?:my\s+|the\s+)?clipboard$/i.test(raw)) {
    return { id, action: 'desktop-clipboard-read', label: 'Read clipboard', params: {}, expect: { type: 'defined' } };
  }
  if ((match = raw.match(/^(?:notify|show a notification|send a notification)(?:\s+me)?[:\s]+([\s\S]+)$/i))) {
    return { id, action: 'desktop-notify', label: 'Show a notification', params: { title: 'J.A.R.V.I.S.', body: match[1].trim() }, expect: { type: 'defined' } };
  }
  if (/^(?:click|type|press|move the mouse|control the computer|shutdown|restart)\b/i.test(raw)) {
    return { id, action: 'computer-control', label: raw, params: { instruction: raw }, expect: { type: 'defined' } };
  }
  return { id, action: 'ask-ai', label: raw.slice(0, 80), params: { prompt: raw }, expect: { type: 'non-empty-text' } };
}

export function planTask(request) {
  if (typeof request !== 'string' || !request.trim()) {
    throw new TypeError('A non-empty request is required.');
  }
  if (request.length > 4_000) throw new RangeError('Request is too long (4,000 characters maximum).');
  const parts = request.split(SPLITTERS).map((part) => part.trim()).filter(Boolean).slice(0, 12);
  return { goal: request.trim(), steps: parts.map(stepFor) };
}
