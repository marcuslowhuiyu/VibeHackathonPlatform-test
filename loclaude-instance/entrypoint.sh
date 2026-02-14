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

  # Prepend Tailwind CSS import to existing index.css (preserves default Vite styles)
  { echo '@import "tailwindcss";'; cat src/index.css; } > /tmp/index.css && mv /tmp/index.css src/index.css

  echo "Project scaffolded successfully"
fi

cd /app
exec npx tsx server/index.ts
