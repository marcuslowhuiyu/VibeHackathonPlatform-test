#!/bin/bash
set -e

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

cd /app
exec npx tsx server/index.ts
