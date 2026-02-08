#!/bin/bash
set -e

# Scaffold starter project if empty
if [ ! -f /home/workspace/project/package.json ]; then
  cd /home/workspace/project
  npm create vite@latest . -- --template react-ts <<< "y"
  npm install
  npm install -D tailwindcss @tailwindcss/vite
  echo "Project scaffolded successfully"
fi

# Start the vibe server (which also starts the Vite dev server)
cd /app
exec npx tsx server/index.ts
