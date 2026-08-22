#!/usr/bin/env bash
# One-time setup. Writes .env (gitignored) and starts the target apps.
set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  cp .env.example .env
  echo "created .env from .env.example - fill in the keys, then rerun"
fi

docker start vikunja gitea >/dev/null 2>&1 || true
npm install --silent
node src/doctor.js
