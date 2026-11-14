import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = async (path) => readFile(join(root, path), 'utf8');

test('Tauri config hosts the staged web UI with a strict CSP and no native permissions', async () => {
  const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
  assert.equal(config.identifier, 'com.jarvisbykhan.assistant');
  assert.equal(config.build.frontendDist, './frontend-dist');
  assert.match(config.build.beforeBuildCommand, /prepare-tauri-frontend/);
  assert.doesNotMatch(config.app.security.csp, /unsafe-inline|unsafe-eval/);
  assert.match(config.app.security.csp, /media-src 'self' blob:/);
  const capability = JSON.parse(await read('src-tauri/capabilities/default.json'));
  assert.deepEqual(capability.permissions, [], 'the web UI must not receive native APIs');
  for (const icon of config.bundle.icon) await access(join(root, 'src-tauri', icon));
});

test('Tauri Rust sources expose the mobile entry point and run the generated context', async () => {
  const lib = await read('src-tauri/src/lib.rs');
  assert.match(lib, /tauri::mobile_entry_point/);
  assert.match(lib, /generate_context!/);
  assert.match(await read('src-tauri/src/main.rs'), /jarvis_lib::run\(\)/);
  assert.match(await read('src-tauri/Cargo.toml'), /crate-type = \["staticlib", "cdylib", "rlib"\]/);
});

test('the Android setup script adds voice permissions to a generated manifest and is idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jarvis-android-'));
  try {
    const manifestDir = join(dir, 'src-tauri/gen/android/app/src/main');
    await mkdir(manifestDir, { recursive: true });
    await mkdir(join(dir, 'scripts'), { recursive: true });
    await writeFile(join(dir, 'scripts/tauri-android-setup.mjs'), await read('scripts/tauri-android-setup.mjs'));
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    const manifest = join(manifestDir, 'AndroidManifest.xml');
    await writeFile(manifest, '<manifest>\n    <application android:label="x"></application>\n</manifest>');
    execFileSync(process.execPath, [join(dir, 'scripts/tauri-android-setup.mjs')]);
    const once = await readFile(manifest, 'utf8');
    for (const permission of ['INTERNET', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS']) assert.match(once, new RegExp(`android.permission.${permission}`));
    assert.match(once, /usesCleartextTraffic="true"/);
    execFileSync(process.execPath, [join(dir, 'scripts/tauri-android-setup.mjs')]);
    assert.equal(await readFile(manifest, 'utf8'), once);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Electron packaging ships the voice modules that server.js serves from /voice/', async () => {
  const pkg = JSON.parse(await read('package.json'));
  for (const file of ['voice/gemini-live.js', 'voice/live-audio-processor.js', 'voice/speech-input.js']) {
    assert.ok(pkg.build.files.includes(file), `${file} must be packaged`);
  }
});
