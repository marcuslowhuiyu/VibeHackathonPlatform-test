#!/bin/bash
set -e

if [ ! -f /home/workspace/project/package.json ]; then
  cd /home/workspace/project
  npm create vite@latest . -- --template react-ts <<< "y"
  npm install
  npm install -D tailwindcss @tailwindcss/vite
  echo "Project scaffolded successfully"
fi

cd /app
exec npx tsx server/index.ts
