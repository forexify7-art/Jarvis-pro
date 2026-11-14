// Passphrase-encrypted memory backup (AES-256-GCM, PBKDF2-SHA256). Runs in browsers and Node via WebCrypto.
// The passphrase and key never leave the device and are never stored; losing the passphrase loses the backup.
const FORMAT = 'jarvis-memory-backup';
const VERSION = 1;
const ITERATIONS = 310_000;
const MIN_PASSPHRASE = 8;

const toBase64 = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function checkPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) {
    throw new TypeError(`Passphrase must be at least ${MIN_PASSPHRASE} characters.`);
  }
}

export async function encryptMemories(memories, passphrase, { iterations = ITERATIONS } = {}) {
  checkPassphrase(passphrase);
  if (!Array.isArray(memories)) throw new TypeError('Memories must be an array.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const plain = new TextEncoder().encode(JSON.stringify(memories));
  const header = { format: FORMAT, version: VERSION, kdf: 'PBKDF2-SHA256', iterations };
  const additionalData = new TextEncoder().encode(JSON.stringify(header));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, plain));
  return JSON.stringify({ ...header, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(cipher) });
}

export async function decryptMemories(backupText, passphrase) {
  checkPassphrase(passphrase);
  let backup;
  try { backup = JSON.parse(backupText); } catch { throw new Error('This is not a valid backup file.'); }
  if (backup?.format !== FORMAT || backup.version !== VERSION || !Number.isInteger(backup.iterations)
    || backup.iterations < 100_000 || backup.iterations > 5_000_000
    || typeof backup.salt !== 'string' || typeof backup.iv !== 'string' || typeof backup.data !== 'string') {
    throw new Error('Unsupported or corrupted backup file.');
  }
  const header = { format: backup.format, version: backup.version, kdf: backup.kdf, iterations: backup.iterations };
  try {
    const key = await deriveKey(passphrase, fromBase64(backup.salt), backup.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(backup.iv),
      additionalData: new TextEncoder().encode(JSON.stringify(header)) }, key, fromBase64(backup.data));
    const memories = JSON.parse(new TextDecoder().decode(plain));
    if (!Array.isArray(memories)) throw new Error('bad payload');
    return memories;
  } catch {
    throw new Error('Wrong passphrase or the backup was modified.');
  }
}
