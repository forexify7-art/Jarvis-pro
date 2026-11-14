// Runtime API-base selection for packaged apps (Tauri desktop/Android).
// In a normal browser the page and API share one origin, so this file does nothing.
// Inside a native shell the page is served from tauri://localhost (or
// http(s)://tauri.localhost) and has no JARVIS server of its own, so '/api/...'
// requests are redirected to the configured server.
//
// Set the server once with  ?api=https://your-server.example   (or ?api=reset to clear).
(() => {
  const STORAGE_KEY = 'jarvis.apiBase';
  const DESKTOP_DEFAULT = 'http://127.0.0.1:4173';

  const safeStorage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* storage blocked */ } },
  };

  function normalizeBase(value) {
    try {
      const url = new URL(String(value).trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      if (url.username || url.password) return '';
      return url.origin;
    } catch {
      return '';
    }
  }

  const isNativeShell = location.protocol === 'tauri:'
    || location.hostname === 'tauri.localhost'
    || Boolean(window.__TAURI_INTERNALS__);

  const param = new URLSearchParams(location.search).get('api');
  if (param === 'reset') safeStorage.remove(STORAGE_KEY);
  else if (param && normalizeBase(param)) safeStorage.set(STORAGE_KEY, normalizeBase(param));

  let apiBase = normalizeBase(safeStorage.get(STORAGE_KEY) || '');
  if (!apiBase && isNativeShell) {
    if (/Android/i.test(navigator.userAgent)) {
      const answer = window.prompt('Enter your J.A.R.V.I.S. server address (for example https://jarvis.example.com or http://192.168.1.20:4173):', 'https://');
      apiBase = normalizeBase(answer || '');
      if (apiBase) safeStorage.set(STORAGE_KEY, apiBase);
    } else {
      apiBase = DESKTOP_DEFAULT;
    }
  }

  window.JARVIS_RUNTIME = Object.freeze({ apiBase, isNativeShell });
  if (!apiBase) return;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api/')) return nativeFetch(apiBase + input, init);
    return nativeFetch(input, init);
  };
})();
