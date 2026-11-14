// Memory import/export and explicit conversation-summary saving, built on local-memory.js.
// Nothing here saves automatically: callers invoke these only after an explicit user action.
import { createMemory, upsertMemory } from './local-memory.js';

export const MEMORY_EXPORT_VERSION = 1;
const MAX_IMPORT_ITEMS = 200;

export function exportMemories(memories, now = new Date()) {
  if (!Array.isArray(memories)) throw new TypeError('Memories must be a list.');
  return JSON.stringify({
    app: 'jarvis-memory-export',
    version: MEMORY_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    memories: memories.map(({ type, title, content }) => ({ type, title, content })),
  }, null, 2);
}

// Imported items go through the same sensitive-data checks as typed ones, and always start
// unapproved for AI context, so the user must review each one again.
export function importMemories(text, existing = [], now = new Date()) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('This is not a valid JSON file.'); }
  if (parsed?.app !== 'jarvis-memory-export' || !Array.isArray(parsed.memories)) {
    throw new Error('This file is not a J.A.R.V.I.S. memory export.');
  }
  if (parsed.memories.length > MAX_IMPORT_ITEMS) throw new RangeError(`Import is limited to ${MAX_IMPORT_ITEMS} memories.`);
  let memories = [...existing];
  const skipped = [];
  let added = 0;
  for (const [index, item] of parsed.memories.entries()) {
    const duplicate = memories.some((m) => m.title === item?.title?.trim?.() && m.content === item?.content?.trim?.());
    if (duplicate) { skipped.push({ index, reason: 'Already saved.' }); continue; }
    try {
      memories = upsertMemory(memories, createMemory({ type: item?.type, title: item?.title, content: item?.content }, now));
      added += 1;
    } catch (error) {
      skipped.push({ index, reason: error.message });
    }
  }
  return { memories, added, skipped };
}

// Extractive, local summary of what the user asked in a conversation. No AI call.
export function summarizeConversation(messages, now = new Date(), maxUserMessages = 5) {
  const userMessages = (Array.isArray(messages) ? messages : [])
    .filter((m) => m?.role === 'user' && typeof m.content === 'string' && m.content.trim())
    .map((m) => m.content.trim().replace(/\s+/g, ' ').slice(0, 160))
    .slice(-maxUserMessages);
  if (!userMessages.length) throw new TypeError('There is no conversation to summarize.');
  return {
    type: 'fact',
    title: `Conversation on ${now.toISOString().slice(0, 10)}`,
    content: `Topics I asked about: ${userMessages.join(' | ')}`.slice(0, 1_000),
  };
}
