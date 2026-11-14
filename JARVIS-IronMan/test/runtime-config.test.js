import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/runtime-config.js', import.meta.url), 'utf8');

function run({ href = 'http://localhost:4173/', userAgent = 'Mozilla/5.0', stored = {}, promptAnswer = null, tauri = false } = {}) {
  const url = new URL(href);
  const store = new Map(Object.entries(stored));
  const fetched = [];
  const window = {
    prompt: () => promptAnswer,
    fetch: async (input) => { fetched.push(input); return { ok: true }; },
    ...(tauri ? { __TAURI_INTERNALS__: {} } : {}),
  };
  window.window = window;
  const context = vm.createContext({
    window,
    location: url,
    navigator: { userAgent },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    URL,
    URLSearchParams,
  });
  vm.runInContext(source, context);
  return { window, fetched, store };
}

test('plain browser: fetch is left untouched', async () => {
  const { window, fetched } = run();
  const original = window.fetch;
  assert.equal(window.JARVIS_RUNTIME.apiBase, '');
  await window.fetch('/api/chat');
  assert.deepEqual(fetched, ['/api/chat']);
  assert.equal(window.fetch, original);
});

test('native desktop shell defaults to the local JARVIS server and only rewrites /api paths', async () => {
  const { window, fetched } = run({ href: 'http://tauri.localhost/', tauri: true });
  assert.equal(window.JARVIS_RUNTIME.apiBase, 'http://127.0.0.1:4173');
  await window.fetch('/api/health');
  await window.fetch('/icons/jarvis.svg');
  await window.fetch('https://example.com/api/x');
  assert.deepEqual(fetched, ['http://127.0.0.1:4173/api/health', '/icons/jarvis.svg', 'https://example.com/api/x']);
});

test('Android shell asks for the server once and remembers a valid address', async () => {
  const first = run({ href: 'http://tauri.localhost/', userAgent: 'Mozilla/5.0 (Linux; Android 14)', promptAnswer: 'https://jarvis.example.com/some/path', tauri: true });
  assert.equal(first.window.JARVIS_RUNTIME.apiBase, 'https://jarvis.example.com');
  assert.equal(first.store.get('jarvis.apiBase'), 'https://jarvis.example.com');
  const second = run({ href: 'http://tauri.localhost/', userAgent: 'Android', stored: { 'jarvis.apiBase': 'https://jarvis.example.com' }, promptAnswer: 'https://other.example', tauri: true });
  assert.equal(second.window.JARVIS_RUNTIME.apiBase, 'https://jarvis.example.com');
});

test('invalid or unsafe API addresses are rejected', () => {
  for (const bad of ['javascript:alert(1)', 'ftp://x.example', 'https://user:pw@host.example', 'not a url']) {
    const { window } = run({ href: `http://localhost:4173/?api=${encodeURIComponent(bad)}` });
    assert.equal(window.JARVIS_RUNTIME.apiBase, '', bad);
  }
});

test('?api= sets the server and ?api=reset clears it', () => {
  const set = run({ href: 'http://localhost:4173/?api=http://192.168.1.20:4173' });
  assert.equal(set.window.JARVIS_RUNTIME.apiBase, 'http://192.168.1.20:4173');
  const cleared = run({ href: 'http://localhost:4173/?api=reset', stored: { 'jarvis.apiBase': 'http://192.168.1.20:4173' } });
  assert.equal(cleared.window.JARVIS_RUNTIME.apiBase, '');
});
