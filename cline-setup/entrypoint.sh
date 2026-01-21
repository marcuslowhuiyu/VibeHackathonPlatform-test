#!/bin/bash

# ==========================================
# VIBE CODING LAB - CONTAINER STARTUP
# ==========================================
# Environment variables (auto-injected by dashboard):
#   AWS_ACCESS_KEY_ID     - AWS access key for Bedrock
#   AWS_SECRET_ACCESS_KEY - AWS secret key for Bedrock
#   AWS_REGION            - AWS region (default: us-east-1)
#   INSTANCE_ID           - Unique identifier for this instance
# ==========================================

echo "=========================================="
echo "Starting Vibe Coding Lab Instance"
echo "Instance ID: ${INSTANCE_ID:-not-set}"
echo "=========================================="

# Set defaults
AWS_REGION="${AWS_REGION:-us-east-1}"
CONFIG_FILE="/home/workspace/cline-config.json"

# ==========================================
# 1. CONFIGURE AWS CREDENTIALS
# ==========================================
echo "Configuring AWS credentials..."

AWS_DIR="/home/openvscode-server/.aws"
mkdir -p "$AWS_DIR"

if [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ]; then
    cat > "$AWS_DIR/credentials" << EOF
[default]
aws_access_key_id = ${AWS_ACCESS_KEY_ID}
aws_secret_access_key = ${AWS_SECRET_ACCESS_KEY}
EOF

    cat > "$AWS_DIR/config" << EOF
[default]
region = ${AWS_REGION}
output = json
EOF

    chmod 600 "$AWS_DIR/credentials"
    chmod 600 "$AWS_DIR/config"
    echo "  ✓ AWS credentials configured"
else
    echo "  ✗ WARNING: AWS credentials not provided!"
fi

# ==========================================
# 2. CONFIGURE CLINE EXTENSION
# ==========================================
echo "Configuring Cline extension..."

CLINE_STORAGE="/home/.openvscode-server/data/User/globalStorage/saoudrizwan.claude-dev"
mkdir -p "$CLINE_STORAGE"

# Read settings from config file if it exists
if [ -f "$CONFIG_FILE" ]; then
    API_PROVIDER=$(jq -r '.apiProvider // "bedrock"' "$CONFIG_FILE")
    API_MODEL_ID=$(jq -r '.apiModelId // "anthropic.claude-sonnet-4-20250514-v1:0"' "$CONFIG_FILE")
    CUSTOM_INSTRUCTIONS=$(jq -r '.customInstructions // ""' "$CONFIG_FILE")
    echo "  ✓ Loaded settings from cline-config.json"
else
    API_PROVIDER="bedrock"
    API_MODEL_ID="anthropic.claude-sonnet-4-20250514-v1:0"
    CUSTOM_INSTRUCTIONS=""
    echo "  ⚠ Using default Cline settings"
fi

# Write Cline's settings.json (used by newer versions)
cat > "$CLINE_STORAGE/settings.json" << EOF
{
  "apiProvider": "${API_PROVIDER}",
  "apiModelId": "${API_MODEL_ID}",
  "awsRegion": "${AWS_REGION}",
  "awsUseProfile": "default",
  "customInstructions": "${CUSTOM_INSTRUCTIONS}"
}
EOF

# Write Cline's state.json (legacy support)
cat > "$CLINE_STORAGE/state.json" << EOF
{
  "apiProvider": "${API_PROVIDER}",
  "apiModelId": "${API_MODEL_ID}",
  "awsRegion": "${AWS_REGION}",
  "awsUseProfile": "default"
}
EOF

# Set proper permissions
chown -R openvscode-server:openvscode-server "$CLINE_STORAGE"

echo "  ✓ Cline configured for ${API_PROVIDER}"
echo "    Model: ${API_MODEL_ID}"
echo "    Region: ${AWS_REGION}"

# ==========================================
# 3. CONFIGURE VS CODE SETTINGS
# ==========================================
echo "Configuring VS Code..."

VSCODE_USER="/home/.openvscode-server/data/User"
mkdir -p "$VSCODE_USER"

# Create VS Code settings
cat > "$VSCODE_USER/settings.json" << EOF
{
  "workbench.colorTheme": "Default Dark+",
  "editor.fontSize": 14,
  "editor.tabSize": 2,
  "editor.wordWrap": "on",
  "editor.formatOnSave": true,
  "terminal.integrated.defaultProfile.linux": "bash",
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000
}
EOF

chown openvscode-server:openvscode-server "$VSCODE_USER/settings.json"
echo "  ✓ VS Code settings configured"

# ==========================================
# 4. START REACT DEV SERVER
# ==========================================
echo "Starting React app on port 3000..."
cd /home/workspace
npm run dev -- --host 0.0.0.0 --port 3000 &
REACT_PID=$!
echo "  ✓ React dev server started (PID: $REACT_PID)"

# ==========================================
# 5. START VS CODE SERVER
# ==========================================
echo "Starting VS Code Server on port 8080..."
echo ""
echo "=========================================="
echo "  Instance Ready!"
echo "  VS Code:   http://<public-ip>:8080"
echo "  React App: http://<public-ip>:3000"
echo "=========================================="
echo ""

exec /home/.openvscode-server/bin/openvscode-server \
    --host 0.0.0.0 \
    --port 8080 \
    --without-connection-token \
    --default-folder /home/workspace
