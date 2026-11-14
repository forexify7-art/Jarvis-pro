import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'browser/browser_use/**',
      'docs/reference/**',
      'node_modules/**',
      'public/avatar3d.bundle.js',
      'src-tauri/gen/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: [
      'public/app-hub.js',
      'public/file-manager.js',
      'public/lab-safety.js',
      'server.js',
    ],
    rules: {
      'no-control-regex': 'off',
    },
  },
  {
    files: ['voice/live-audio-processor.js'],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
      },
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
];
