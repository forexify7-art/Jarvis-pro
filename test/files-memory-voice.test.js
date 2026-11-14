import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFile, createZip, editFile, listZipEntries, readZipEntry, readUploadedFile, validateFileName, isSafeZipPath } from '../public/file-manager.js';
import { exportMemories, importMemories, summarizeConversation } from '../public/memory-engine.js';
import { createMemory } from '../public/local-memory.js';
import { computeRms, createNoiseGate } from '../public/voice-noise-control.js';
import { createInterruptionController } from '../public/voice-interruption.js';

test('file names and zip paths reject traversal and odd types', () => {
  assert.equal(validateFileName('notes.txt').valid, true);
  for (const bad of ['../x.txt', 'a/b.txt', '.env', 'run.exe', '', 'a'.repeat(101) + '.txt']) assert.equal(validateFileName(bad).valid, false, bad);
  assert.equal(isSafeZipPath('src/app.js'), true);
  assert.equal(isSafeZipPath('../evil'), false);
  assert.equal(isSafeZipPath('/abs'), false);
});

test('createFile/editFile produce real bytes and refuse empty content', () => {
  const file = createFile('a.md', '# Hi');
  assert.equal(file.size, 4);
  assert.equal(new TextDecoder().decode(editFile(file, (t) => t + '!').data), '# Hi!');
  assert.throws(() => createFile('a.md', ''), TypeError);
});

test('ZIP written by createZip is readable and matches content; deflated ZIP also reads', async () => {
  const zip = createZip([createFile('a.txt', 'alpha'), createFile('dir-b.json', '{"x":1}')]);
  const entries = listZipEntries(zip.data);
  assert.deepEqual(entries.map((e) => e.name), ['a.txt', 'dir-b.json']);
  assert.equal(new TextDecoder().decode(await readZipEntry(zip.data, entries[1])), '{"x":1}');
  const uploaded = await readUploadedFile({ name: 'x.zip', size: zip.size, arrayBuffer: async () => zip.data.buffer.slice(zip.data.byteOffset, zip.data.byteOffset + zip.size) });
  assert.equal(uploaded.kind, 'zip');
  assert.equal(uploaded.entries.length, 2);
});

test('real deflate ZIP from the system zip tool is decoded', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'jz-'));
  writeFileSync(join(dir, 'hello.txt'), 'hello hello hello hello hello hello hello hello');
  try { execFileSync('zip', ['-q', '-j', join(dir, 't.zip'), join(dir, 'hello.txt')]); } catch { return; /* zip tool unavailable */ }
  const bytes = new Uint8Array(readFileSync(join(dir, 't.zip')));
  const [entry] = listZipEntries(bytes);
  assert.equal(entry.method, 8);
  assert.match(new TextDecoder().decode(await readZipEntry(bytes, entry)), /^hello hello/);
});

test('unsupported and oversized uploads are reported, never silently read', async () => {
  const pdf = await readUploadedFile({ name: 'a.pdf', size: 10, type: 'application/pdf' });
  assert.equal(pdf.kind, 'unsupported');
  await assert.rejects(() => readUploadedFile({ name: 'big.txt', size: 6 * 1024 * 1024 }), RangeError);
  const txt = await readUploadedFile({ name: 'a.txt', size: 2, text: async () => 'hi' });
  assert.equal(txt.text, 'hi');
});

test('memory export/import round-trips, blocks sensitive data and duplicates, resets approval', () => {
  const m = createMemory({ type: 'preference', title: 'Tone', content: 'Short replies' }, new Date('2026-01-01'));
  const json = exportMemories([{ ...m, includeInContext: true }], new Date('2026-01-02'));
  const imported = importMemories(json, []);
  assert.equal(imported.added, 1);
  assert.equal(imported.memories[0].includeInContext, false);
  assert.equal(importMemories(json, imported.memories).added, 0);
  const tampered = JSON.stringify({ app: 'jarvis-memory-export', version: 1, memories: [{ type: 'fact', title: 'k', content: 'api_key=sk-abcdefghijklmnop1234' }] });
  const result = importMemories(tampered, []);
  assert.equal(result.added, 0);
  assert.equal(result.skipped.length, 1);
  assert.throws(() => importMemories('{"x":1}', []));
  assert.throws(() => importMemories('not json', []));
});

test('conversation summary only uses user messages and rejects empty chats', () => {
  const s = summarizeConversation([{ role: 'user', content: 'Plan my week' }, { role: 'assistant', content: 'Sure' }], new Date('2026-03-04'));
  assert.equal(s.title, 'Conversation on 2026-03-04');
  assert.match(s.content, /Plan my week/);
  assert.doesNotMatch(s.content, /Sure/);
  assert.throws(() => summarizeConversation([]), TypeError);
});

test('noise gate ignores steady background noise, detects speech, and holds briefly', () => {
  assert.equal(computeRms(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5);
  const gate = createNoiseGate({ holdFrames: 2 });
  for (let i = 0; i < 40; i += 1) assert.equal(gate.update(0.006).speaking, false);
  assert.equal(gate.update(0.2).speaking, true);
  assert.equal(gate.update(0.001).speaking, true);
  assert.equal(gate.update(0.001).speaking, true);
  assert.equal(gate.update(0.001).speaking, false);
});

test('barge-in cancels speech only after sustained user speech while assistant speaks', () => {
  let cancelled = 0;
  const c = createInterruptionController({ cancelSpeech: () => { cancelled += 1; }, framesRequired: 3 });
  assert.equal(c.handleFrame({ speaking: true }), false);
  c.setAssistantSpeaking(true);
  c.handleFrame({ speaking: true }); c.handleFrame({ speaking: false });
  c.handleFrame({ speaking: true }); c.handleFrame({ speaking: true });
  assert.equal(cancelled, 0, 'spike was reset');
  assert.equal(c.handleFrame({ speaking: true }), true);
  assert.equal(cancelled, 1);
  assert.equal(c.handleFrame({ speaking: true }), false);
  assert.throws(() => createInterruptionController({}), TypeError);
});
