import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptMemories, decryptMemories } from '../public/memory-crypto.js';

const memories = [{ id: 'm1', type: 'fact', title: 'चाय पसंद है', content: 'Likes masala chai' }];
const fast = { iterations: 100_000 };

test('round-trips memories including Hindi text', async () => {
  const backup = await encryptMemories(memories, 'correct horse battery', fast);
  assert.ok(!backup.includes('masala'));
  assert.deepEqual(await decryptMemories(backup, 'correct horse battery'), memories);
});

test('wrong passphrase and tampering are rejected', async () => {
  const backup = JSON.parse(await encryptMemories(memories, 'correct horse battery', fast));
  await assert.rejects(decryptMemories(JSON.stringify(backup), 'wrong passphrase!'), /Wrong passphrase/);
  const tampered = { ...backup, iterations: 100_001 };
  await assert.rejects(decryptMemories(JSON.stringify(tampered), 'correct horse battery'), /Wrong passphrase/);
  const bytes = Buffer.from(backup.data, 'base64'); bytes[0] ^= 1;
  await assert.rejects(decryptMemories(JSON.stringify({ ...backup, data: bytes.toString('base64') }), 'correct horse battery'), /Wrong passphrase/);
});

test('rejects weak passphrases, junk files and weakened KDF settings', async () => {
  await assert.rejects(encryptMemories(memories, 'short'), /at least 8/);
  await assert.rejects(decryptMemories('not json', 'long enough pass'), /not a valid backup/);
  await assert.rejects(decryptMemories(JSON.stringify({ format: 'jarvis-memory-backup', version: 1, iterations: 1, salt: 'a', iv: 'a', data: 'a' }), 'long enough pass'), /Unsupported/);
});

test('each export uses a fresh salt and IV', async () => {
  const a = JSON.parse(await encryptMemories(memories, 'correct horse battery', fast));
  const b = JSON.parse(await encryptMemories(memories, 'correct horse battery', fast));
  assert.notEqual(a.salt, b.salt); assert.notEqual(a.iv, b.iv);
});
