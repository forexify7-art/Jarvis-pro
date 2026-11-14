// Stages the static web UI for Tauri: public/ plus the three browser voice
// modules that server.js normally serves from /voice/. Output is generated
// (src-tauri/frontend-dist, git-ignored) so the source tree stays single-copy.
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = resolve(root, 'src-tauri/frontend-dist');
const voiceModules = ['gemini-live.js', 'live-audio-processor.js', 'speech-input.js'];

await stat(resolve(root, 'public/avatar3d.bundle.js')).catch(() => {
  console.error('public/avatar3d.bundle.js is missing. Run "npm install" and "npm run build:avatar" first.');
  process.exit(1);
});

await rm(out, { recursive: true, force: true });
await cp(resolve(root, 'public'), out, { recursive: true });
await mkdir(resolve(out, 'voice'), { recursive: true });
for (const file of voiceModules) await cp(resolve(root, 'voice', file), resolve(out, 'voice', file));
console.log(`Tauri frontend staged in ${out}`);
