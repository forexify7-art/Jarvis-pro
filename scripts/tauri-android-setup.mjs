// Run after `npm run tauri -- android init`. Adds the Android permissions the
// voice features need to the generated manifest. Idempotent.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const manifestPath = resolve(fileURLToPath(new URL('..', import.meta.url)),
  'src-tauri/gen/android/app/src/main/AndroidManifest.xml');
let xml;
try {
  xml = await readFile(manifestPath, 'utf8');
} catch {
  console.error('AndroidManifest.xml not found. Run "npm run tauri -- android init" first.');
  process.exit(1);
}
const wanted = [
  'android.permission.INTERNET',
  'android.permission.RECORD_AUDIO',
  'android.permission.MODIFY_AUDIO_SETTINGS',
  'android.permission.CAMERA',
];
let changed = false;
for (const permission of wanted) {
  if (xml.includes(`android:name="${permission}"`)) continue;
  xml = xml.replace(/<application/, `<uses-permission android:name="${permission}" />\n    <application`);
  changed = true;
}
// LAN servers (http://192.168.x.x) need cleartext traffic; HTTPS servers are unaffected.
if (!xml.includes('usesCleartextTraffic')) {
  xml = xml.replace(/<application/, '<application android:usesCleartextTraffic="true"');
  changed = true;
}
if (changed) await writeFile(manifestPath, xml);
console.log(changed ? 'AndroidManifest.xml updated.' : 'AndroidManifest.xml already configured.');
