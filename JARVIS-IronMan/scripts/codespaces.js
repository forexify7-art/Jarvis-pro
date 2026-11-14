import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIN_NODE = [22, 12, 0];
// Packages/binaries that must exist for the build and server to work.
const REQUIRED_PATHS = [
  'node_modules/three/package.json',
  'node_modules/@pixiv/three-vrm/package.json',
  'node_modules/esbuild/package.json',
  'node_modules/.bin/esbuild',
];

export function isNodeVersionSupported(version = process.versions.node, minimum = MIN_NODE) {
  const parts = String(version).split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < 3; index += 1) {
    const have = parts[index] ?? 0;
    if (have > minimum[index]) return true;
    if (have < minimum[index]) return false;
  }
  return true;
}

export function findMissingDependencies(root = PROJECT_ROOT, fileExists = existsSync) {
  return REQUIRED_PATHS.filter((relative) => !fileExists(resolve(root, relative)));
}

export function describeConfiguration(environment = {}) {
  const provider = (environment.AI_PROVIDER || 'gemini').toLowerCase();
  const problems = [];
  const notes = [];
  if (provider === 'gemini') {
    const key = environment.GEMINI_API_KEY || '';
    if (!key || key.startsWith('replace_with')) {
      problems.push('GEMINI_API_KEY is not set. Add it to the .env file (never paste keys into the browser or commit them).');
    }
  } else if (provider === 'ollama') {
    notes.push('Ollama selected: it must be reachable at OLLAMA_BASE_URL (Codespaces cannot reach your PC\'s Ollama).');
  } else if (!environment.AI_API_KEY && !environment.OPENAI_API_KEY) {
    notes.push(`Provider "${provider}" selected: make sure its API key variable is set in .env.`);
  }
  return { provider, problems, notes };
}

function parseEnvFile(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !line.trim().startsWith('#')) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function run(command, args, label) {
  console.log(`> ${label}`);
  const result = spawnSync(command, args, { cwd: PROJECT_ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status === 0;
}

// Returns true when everything needed to start the server is ready.
export function prepareProject(environment = process.env) {
  if (!isNodeVersionSupported()) {
    console.error(`Node.js ${MIN_NODE.join('.')}+ is required (found ${process.versions.node}). In Codespaces, rebuild the container or run: nvm install 22`);
    return false;
  }

  const missing = findMissingDependencies();
  if (missing.length) {
    console.log('Dependencies missing or incomplete; installing (one-time).');
    const useCi = existsSync(resolve(PROJECT_ROOT, 'package-lock.json'));
    if (!run('npm', [useCi ? 'ci' : 'install', '--no-audit', '--no-fund'], useCi ? 'npm ci' : 'npm install')) {
      console.error('Dependency installation failed. Check your network and run "npm ci" manually to see the full error.');
      return false;
    }
    const stillMissing = findMissingDependencies();
    if (stillMissing.length) {
      console.error(`Install finished but these are still missing: ${stillMissing.join(', ')}`);
      return false;
    }
  } else {
    console.log('Dependencies OK (skipping install).');
  }

  const envPath = resolve(PROJECT_ROOT, '.env');
  const examplePath = resolve(PROJECT_ROOT, '.env.example');
  if (!existsSync(envPath) && existsSync(examplePath)) {
    copyFileSync(examplePath, envPath); // only when absent; an existing .env is never touched
    console.log('Created .env from .env.example (it did not exist).');
  }
  const fileValues = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : {};
  const config = describeConfiguration({ ...fileValues, ...environment });
  for (const note of config.notes) console.log(`Note: ${note}`);
  for (const problem of config.problems) console.warn(`Warning: ${problem}`);
  if (config.problems.length) {
    console.warn('JARVIS will still start so you can open Settings, but AI replies need a key. Edit .env (or use Codespaces secrets) and restart.');
  }

  if (!run('npm', ['run', 'build:avatar', '--silent'], 'Building avatar assets')) {
    console.error('Avatar build failed; see the error above.');
    return false;
  }
  return true;
}

export function getForwardedUrl({ codespaceName, forwardingDomain, port = 4173 }) {
  if (!codespaceName) return null;
  const domain = (forwardingDomain || 'app.github.dev').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${codespaceName}-${port}.${domain}`;
}

export function getServerEnvironment(environment = process.env, args = []) {
  const port = String(environment.PORT || 4173);
  const useOllama = args.includes('--ollama') || environment.AI_PROVIDER === 'ollama';
  const serverEnvironment = { ...environment, PORT: port };
  if (useOllama) {
    serverEnvironment.AI_PROVIDER = 'ollama';
    serverEnvironment.OLLAMA_BASE_URL ||= 'http://127.0.0.1:11434';
    serverEnvironment.OLLAMA_MODEL ||= 'qwen2.5:3b';
  }
  return serverEnvironment;
}

export function startCodespacesServer(environment = process.env) {
  if (!prepareProject(environment)) {
    process.exitCode = 1;
    return null;
  }
  const serverEnvironment = getServerEnvironment(environment, process.argv.slice(2));
  const port = serverEnvironment.PORT;
  const forwardedUrl = getForwardedUrl({
    codespaceName: environment.CODESPACE_NAME,
    forwardingDomain: environment.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN,
    port,
  });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: resolve(fileURLToPath(new URL('..', import.meta.url))),
    env: serverEnvironment,
    stdio: 'inherit',
  });

  child.once('spawn', () => {
    console.log(`J.A.R.V.I.S. is starting on port ${port}.`);
    if (forwardedUrl) {
      console.log(`Open JARVIS (private Codespaces port; sign in to GitHub if asked): ${forwardedUrl}`);
    } else {
      console.log('Open the Ports tab in VS Code and use the forwarded URL for port 4173.');
    }
  });
  child.once('error', (error) => {
    console.error(`Could not start J.A.R.V.I.S.: ${error.message}`);
    process.exitCode = 1;
  });

  const forwardSignal = (signal) => child.kill(signal);
  process.once('SIGINT', forwardSignal);
  process.once('SIGTERM', forwardSignal);
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', forwardSignal);
    process.removeListener('SIGTERM', forwardSignal);
    process.exitCode = code ?? (signal ? 1 : 0);
  });

  return child;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startCodespacesServer();
}