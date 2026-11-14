import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';

// A stand-in for the Python OmniVoice sidecar (the real model cannot run in CI).
function wavBytes() {
  const bytes = Buffer.alloc(44 + 480);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8, 'ascii');
  return bytes;
}

let sidecarMode = 'ok';
const requests = [];
const sidecar = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ engine: 'omnivoice', ready: sidecarMode !== 'loading', device: 'cpu', languages: ['en', 'hi'] }));
    return;
  }
  let raw = '';
  request.on('data', (chunk) => { raw += chunk; });
  request.on('end', () => {
    requests.push(JSON.parse(raw));
    if (sidecarMode === 'garbage') {
      response.writeHead(200, { 'content-type': 'audio/wav' });
      response.end('not audio');
      return;
    }
    if (sidecarMode === 'error') {
      response.writeHead(500);
      response.end('boom');
      return;
    }
    response.writeHead(200, { 'content-type': 'audio/wav' });
    response.end(wavBytes());
  });
});

const savedEnv = { ...process.env };
let app;
let baseUrl;
let validateTtsRequest;

before(async () => {
  await new Promise((resolve) => sidecar.listen(0, '127.0.0.1', resolve));
  process.env.OMNIVOICE_URL = `http://127.0.0.1:${sidecar.address().port}`;
  delete process.env.APP_ACCESS_TOKEN;
  delete process.env.NODE_ENV;
  process.env.ALLOWED_ORIGINS = 'https://app.example.test';
  const module = await import('../server.js?tts-test');
  validateTtsRequest = module.validateTtsRequest;
  app = module.createAppServer();
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${app.address().port}`;
});

after(async () => {
  await new Promise((resolve) => app.close(resolve));
  await new Promise((resolve) => sidecar.close(resolve));
  for (const key of ['OMNIVOICE_URL', 'ALLOWED_ORIGINS']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const post = (path, body, headers = {}) => fetch(`${baseUrl}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

test('validateTtsRequest normalises text and language and rejects bad input', () => {
  assert.deepEqual(validateTtsRequest({ text: '  hello \n world ', language: 'hi' }), { text: 'hello world', language: 'hi' });
  assert.deepEqual(validateTtsRequest({ text: 'x', language: 'fr' }), { text: 'x', language: 'en' });
  assert.throws(() => validateTtsRequest({ text: '   ' }), { code: 'TTS_TEXT_REQUIRED' });
  assert.throws(() => validateTtsRequest({ text: 'a'.repeat(1201) }), { code: 'TTS_TEXT_TOO_LONG' });
  assert.throws(() => validateTtsRequest({ text: 42 }), { code: 'TTS_TEXT_REQUIRED' });
});

test('/api/health reports local OmniVoice availability', async () => {
  sidecarMode = 'ok';
  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.equal(health.localTts.engine, 'omnivoice');
  assert.equal(health.localTts.available, true);
  assert.deepEqual(health.localTts.languages, ['en', 'hi']);
});

test('/api/tts returns real WAV audio from the sidecar for Hindi and English', async () => {
  sidecarMode = 'ok';
  const response = await post('/api/tts', { text: 'नमस्ते, मैं जार्विस हूँ।', language: 'hi' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/wav');
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(body.toString('ascii', 0, 4), 'RIFF');
  assert.deepEqual(requests.at(-1), { text: 'नमस्ते, मैं जार्विस हूँ।', language: 'hi' });
  await post('/api/tts', { text: 'Hello there.', language: 'en' });
  assert.equal(requests.at(-1).language, 'en');
});

test('/api/tts rejects empty and oversized text before contacting the sidecar', async () => {
  const before = requests.length;
  assert.equal((await post('/api/tts', { text: '' })).status, 400);
  assert.equal((await post('/api/tts', { text: 'a'.repeat(1300) })).status, 400);
  assert.equal(requests.length, before);
});

test('/api/tts never forwards invalid audio or sidecar errors as success', async () => {
  sidecarMode = 'garbage';
  const garbage = await post('/api/tts', { text: 'hello' });
  assert.equal(garbage.status, 502);
  assert.equal((await garbage.json()).code, 'LOCAL_TTS_INVALID_AUDIO');
  sidecarMode = 'error';
  const failed = await post('/api/tts', { text: 'hello' });
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).code, 'LOCAL_TTS_FAILED');
  sidecarMode = 'ok';
});

test('/api/tts reports 503 so the browser can fall back when the sidecar is down', async () => {
  await new Promise((resolve) => sidecar.close(resolve));
  const response = await post('/api/tts', { text: 'hello' });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'LOCAL_TTS_UNAVAILABLE');
  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.equal(health.localTts.available, false);
  await new Promise((resolve) => sidecar.listen(sidecar.address()?.port || 0, '127.0.0.1', resolve));
});

test('/voice only serves the three browser modules, not reference examples or secrets', async () => {
  assert.equal((await fetch(`${baseUrl}/voice/gemini-live.js`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/voice/speech-input.js`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/voice/live-audio-processor.js`)).status, 200);
  for (const path of [
    '/voice/omnivoice-server/server.py',
    '/voice/README.md',
    '/voice/JARVIS_VOICE_README.md',
  ]) {
    assert.equal((await fetch(`${baseUrl}${path}`)).status, 404, path);
  }
});

test('CORS allows only the packaged-app origins and explicitly configured origins', async () => {
  for (const origin of ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'https://app.example.test']) {
    const preflight = await fetch(`${baseUrl}/api/chat`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST' } });
    assert.equal(preflight.status, 204, origin);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    const health = await fetch(`${baseUrl}/api/health`, { headers: { origin } });
    assert.equal(health.headers.get('access-control-allow-origin'), origin);
  }
  const hostile = await fetch(`${baseUrl}/api/chat`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  assert.equal(hostile.status, 403);
  assert.equal(hostile.headers.get('access-control-allow-origin'), null);
  const hostileGet = await fetch(`${baseUrl}/api/health`, { headers: { origin: 'https://evil.example' } });
  assert.equal(hostileGet.headers.get('access-control-allow-origin'), null);
});

test('CSP allows blob audio playback for OmniVoice while staying restrictive', async () => {
  const csp = (await fetch(`${baseUrl}/`)).headers.get('content-security-policy');
  assert.match(csp, /media-src 'self' blob:/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
});
