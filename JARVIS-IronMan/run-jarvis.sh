#!/usr/bin/env bash
# One-command start for Linux/macOS. Installs dependencies on the first run.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js 22.12+ is required: https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env - set GEMINI_API_KEY in it (or use Ollama), then run this script again."
  exit 0
fi
echo "Open http://localhost:4173"
npm start
