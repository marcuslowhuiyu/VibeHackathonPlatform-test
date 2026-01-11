#!/bin/bash

# ==========================================
# 1. DYNAMIC CLINE CONFIGURATION
# ==========================================
echo "Configuring Cline for Amazon Bedrock..."

# Define the target directory for Cline settings
# Note: The extension ID 'saoudrizwan.claude-dev' might change if the fork evolves.
# Verify this path by checking the container manually if settings don't stick.
CLINE_DIR="/home/.openvscode-server/data/User/globalStorage/saoudrizwan.claude-dev"
mkdir -p "$CLINE_DIR"

# Write the config JSON dynamically
# This forces the provider to Bedrock and the region to us-east-1
cat <<EOF > "$CLINE_DIR/state.json"
{
  "apiProvider": "bedrock",
  "apiModelId": "anthropic.claude-3-5-sonnet-20240620-v1:0",
  "awsRegion": "us-east-1",
  "awsUseProfile": false
}
EOF

# Fix permissions so the user can read/write it
chown openvscode-server:openvscode-server "$CLINE_DIR"
chown openvscode-server:openvscode-server "$CLINE_DIR/state.json"

echo "Cline configuration seeded."

# ==========================================
# 2. START THE REACT APP (Zero-Terminal Mode)
# ==========================================
echo "Starting React Vibe App..."
cd /home/workspace

# Start the dev server in the background (&)
# We bind to 0.0.0.0 so the external Load Balancer can see it.
# Adjust the command based on your package.json (e.g., 'vite' or 'react-scripts')
npm run dev -- --host 0.0.0.0 --port 3000 &

# ==========================================
# 3. START VS CODE SERVER
# ==========================================
echo "Starting VS Code..."
# We use 'exec' so VS Code becomes the main process (PID 1)
exec /home/.openvscode-server/bin/openvscode-server \
    --host 0.0.0.0 \
    --port 8080 \
    --without-connection-token \
    --default-folder /home/workspace