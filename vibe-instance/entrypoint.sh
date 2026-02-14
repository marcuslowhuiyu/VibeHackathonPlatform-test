#!/bin/bash
set -e

# Scaffold starter project if empty
if [ ! -f /home/workspace/project/package.json ]; then
  cd /home/workspace/project
  npm create vite@latest . -- --template react-ts <<< "y"
  npm install
  npm install -D tailwindcss @tailwindcss/vite

  # Configure Tailwind CSS plugin in vite.config.ts
  cat > vite.config.ts << 'VITEEOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
VITEEOF

  # Configure Tailwind CSS in index.css
  cat > src/index.css << 'CSSEOF'
@import "tailwindcss";
CSSEOF

  echo "Project scaffolded successfully"
fi

# Start the vibe server (which also starts the Vite dev server)
cd /app
exec npx tsx server/index.ts
