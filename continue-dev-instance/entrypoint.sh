#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# Write AWS credentials for Continue CLI
# ---------------------------------------------------------------------------
if [ -n "$AWS_ACCESS_KEY_ID" ]; then
  mkdir -p ~/.aws
  cat > ~/.aws/credentials << AWSEOF
[default]
aws_access_key_id = $AWS_ACCESS_KEY_ID
aws_secret_access_key = $AWS_SECRET_ACCESS_KEY
AWSEOF
  cat > ~/.aws/config << AWSEOF
[default]
region = ${AWS_REGION:-ap-southeast-1}
AWSEOF
fi

# ---------------------------------------------------------------------------
# Write Continue config.yaml for Bedrock
# ---------------------------------------------------------------------------
REGION="${AWS_REGION:-ap-southeast-1}"
MODEL="${BEDROCK_MODEL_ID:-us.anthropic.claude-sonnet-4-20250514}"

cat > /app/continue-config.yaml << CFGEOF
name: Hackathon Assistant
version: 0.0.1
schema: v1
models:
  - name: Claude Sonnet
    provider: bedrock
    model: $MODEL
    env:
      region: $REGION
    roles:
      - chat
      - edit
CFGEOF

echo "Continue config written (model: $MODEL, region: $REGION)"

# ---------------------------------------------------------------------------
# Scaffold starter project if empty
# ---------------------------------------------------------------------------
if [ ! -f /home/workspace/project/package.json ]; then
  cd /home/workspace/project
  npm create vite@latest . -- --template react-ts <<< "y"
  npm install
  npm install -D tailwindcss @tailwindcss/vite

  cat > vite.config.ts << 'VITEEOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
VITEEOF

  { echo '@import "tailwindcss";'; cat src/index.css; } > /tmp/index.css && mv /tmp/index.css src/index.css

  echo "Project scaffolded successfully"
fi

# ---------------------------------------------------------------------------
# Start the server
# ---------------------------------------------------------------------------
cd /app
exec npx tsx server/index.ts
