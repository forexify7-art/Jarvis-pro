import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [app, html, serviceWorker] = await Promise.all([
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8'),
]);

test('chat agent mode runs a plan and asks before every protected step', () => {
  assert.match(app, /import \{ planTask \} from '\.\/agent-planner\.js'/);
  assert.match(app, /import \{ runPlan \} from '\.\/agent-engine\.js'/);
  assert.match(app, /createPermissionBroker\(\{ ask: askAgentPermission \}\)/);
  assert.match(app, /runPlan\(plan,\s*\{[\s\S]*?broker,[\s\S]*?onProgress:/);
  assert.match(app, /signal: controller\.signal/);
  assert.match(app, /signal: AbortSignal\.any\(\[signal, AbortSignal\.timeout\(50_000\)\]\)/);
  assert.match(app, /elements\.agentConfirmDialog\.showModal\(\)/);
  assert.match(app, /elements\.agentStopButton\.addEventListener\('click', stopAgentPlan\)/);
  assert.match(app, /decision === 'cancel-plan'[\s\S]*?agentAbortController\?\.abort\(\)/);
  assert.match(app, /elements\.agentModeButtons\.forEach/);
  assert.match(html, /data-agent-mode-toggle/);
  assert.match(html, /id="agent-confirm-dialog"/);
  assert.match(html, /id="agent-stop-button"[^>]*>Stop plan/);
  assert.match(html, /value="cancel-plan">Stop plan/);
  assert.match(html, /value="deny">Deny/);
  assert.match(html, /value="allow">Allow this step/);
});

test('agent browser research uses the authorized read-only client and cancellation signal', () => {
  assert.match(app, /import \{ researchBrowserPage \} from '\.\/browser-agent\.js'/);
  assert.match(html, /id="browser-research-open"/);
  assert.match(html, /id="browser-research-dialog"/);
  const handler = app.match(/'browser-read-page':\s+async \(\{ url, question \}, \{ signal \}\) => \{([\s\S]*?)\n {4}\},/);
  assert.ok(handler, 'agent handler is connected for planned browser-read-page steps');
  assert.match(handler[1], /researchBrowserPage\(\{/);
  assert.match(handler[1], /headers: apiHeaders\(true\)/);
  assert.match(handler[1], /signal:/);
  assert.match(handler[1], /result\.url/);
  assert.match(handler[1], /result\.result/);
  assert.match(app, /elements\.browserResearchForm\.addEventListener\('submit', submitBrowserResearch\)/);
  assert.match(app, /state\.browserResearchAbortController\?\.abort\(\)/);
});

test('agent UI displays a terminal status and any reason for each planned step', () => {
  assert.match(html, /id="agent-step-list"/);
  assert.match(app, /\['done', 'denied', 'failed', 'unverified', 'cancelled'\]\.includes\(result\.status\)/);
  assert.match(app, /status\.textContent = step\.status/);
  assert.match(app, /item\.dataset\.status = step\.status/);
  assert.match(app, /reason\.textContent = step\.reason/);
  assert.match(app, /Not run because an earlier step stopped the plan/);
});

test('file panel reads safe text and ZIP entries and exposes real edit and export actions', () => {
  assert.match(app, /readUploadedFile\(file\)/);
  assert.match(app, /readZipEntry\(state\.uploadedZip\.bytes, entry\)/);
  assert.match(app, /editFile\(state\.activeWorkspaceFile/);
  assert.match(app, /downloadFile\(createZip\(state\.workspaceFiles\)\)/);
  assert.match(app, /uploaded\.kind === 'unsupported'/);
  assert.match(html, /id="file-workspace-content"/);
  assert.match(html, /id="file-create-form"/);
  assert.match(html, /id="file-save-button"/);
  assert.match(html, /id="file-download-button"/);
  assert.match(html, /id="file-export-button"/);
  assert.match(html, /\.pdf/);
  assert.match(html, /\.docx/);
  assert.match(html, /\.xlsx/);
});

test('Smart Memory transfer and conversation saving use explicit controls', () => {
  assert.match(app, /import \{ exportMemories, importMemories, summarizeConversation \} from '\.\/memory-engine\.js'/);
  assert.match(app, /elements\.smartMemoryExport\.addEventListener\('click'/);
  assert.match(app, /elements\.smartMemoryImportFile\.addEventListener\('change'/);
  assert.match(app, /elements\.smartMemorySaveConversation\.addEventListener\('click'/);
  assert.match(app, /createMemory\(summarizeConversation\(state\.messages\)\)/);
  assert.match(html, /id="smart-memory-export"/);
  assert.match(html, /id="smart-memory-import"/);
  assert.match(html, /id="smart-memory-save-conversation"/);
  assert.match(html, /id="smart-memory-import-file"/);
});

test('voice playback uses noise-gated barge-in and exposes a text fallback on mic failure', () => {
  assert.match(app, /createNoiseGate\(\)/);
  assert.match(app, /createInterruptionController\(/);
  assert.match(app, /onFrame: \(frame\) => speechInterruptionController\.handleFrame\(frame\)/);
  assert.match(app, /speechInterruptionController\.setAssistantSpeaking\(true\)/);
  assert.match(app, /cancelSpeech: \(\) => stopSpeechOutput\(\)/);
  assert.match(app, /Microphone unavailable for voice interruption:[\s\S]*Use the text box to continue/);
  assert.match(app, /startSpeechInterruptionMonitor\(\)/);
  assert.match(app, /stopSpeechInterruptionMonitor\(\)/);
  assert.match(html, /id="message-input"/);
  for (const module of ['security-permissions.js', 'agent-planner.js', 'agent-engine.js', 'error-recovery.js', 'task-verifier.js', 'file-manager.js', 'memory-engine.js', 'voice-noise-control.js', 'voice-interruption.js']) {
    assert.match(serviceWorker, new RegExp(`/${module}`));
  }
});