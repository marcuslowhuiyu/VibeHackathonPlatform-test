#!/bin/bash

# ==========================================
# VIBE CODING LAB - CLINE AI CONTAINER STARTUP
# ==========================================

echo "=========================================="
echo "Starting Vibe Coding Lab Instance"
echo "Instance ID: ${INSTANCE_ID:-not-set}"
echo "=========================================="

# Set defaults
AWS_REGION="${AWS_REGION:-ap-southeast-1}"
CONFIG_FILE="/home/workspace/cline-config.json"

echo "AI Extension: Cline"

# ==========================================
# 1. CONFIGURE AWS CREDENTIALS
# ==========================================
echo "Configuring AWS credentials..."

export HOME="/home/openvscode-server"
AWS_DIR="$HOME/.aws"
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
    echo "  AWS credentials configured"
else
    echo "  WARNING: AWS credentials not provided!"
fi

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}"
export AWS_DEFAULT_REGION="${AWS_REGION}"
export AWS_REGION="${AWS_REGION}"

# Read settings from config file
if [ -f "$CONFIG_FILE" ]; then
    API_MODEL_ID=$(jq -r '.apiModelId // "anthropic.claude-sonnet-4-20250514-v1:0"' "$CONFIG_FILE")
    CUSTOM_INSTRUCTIONS=$(jq -r '.customInstructions // ""' "$CONFIG_FILE")
else
    API_MODEL_ID="anthropic.claude-sonnet-4-20250514-v1:0"
    CUSTOM_INSTRUCTIONS=""
fi

# ==========================================
# 2. CONFIGURE CLINE EXTENSION
# ==========================================
echo "Configuring Cline extension..."

# Cline stores its configuration in VS Code's globalState
# We configure it via VS Code settings and let Cline pick it up
CLINE_DIR="$HOME/.cline"
mkdir -p "$CLINE_DIR"

# Create Cline MCP settings (if needed)
cat > "$CLINE_DIR/cline_mcp_settings.json" << EOF
{
  "mcpServers": {}
}
EOF

echo "  Cline configured for AWS Bedrock"
echo "    Model: ${API_MODEL_ID}"

# ==========================================
# 3. CONFIGURE VS CODE SETTINGS
# ==========================================
echo "Configuring VS Code..."

VSCODE_USER="/home/.openvscode-server/data/User"
mkdir -p "$VSCODE_USER"

# Escape custom instructions for JSON
ESCAPED_INSTRUCTIONS=$(echo "$CUSTOM_INSTRUCTIONS" | jq -Rs '.')

cat > "$VSCODE_USER/settings.json" << EOF
{
  "workbench.colorTheme": "Default Dark+",
  "editor.fontSize": 14,
  "editor.tabSize": 2,
  "editor.wordWrap": "on",
  "editor.formatOnSave": true,
  "terminal.integrated.defaultProfile.linux": "bash",
  "terminal.integrated.env.linux": {
    "AWS_ACCESS_KEY_ID": "${AWS_ACCESS_KEY_ID}",
    "AWS_SECRET_ACCESS_KEY": "${AWS_SECRET_ACCESS_KEY}",
    "AWS_REGION": "${AWS_REGION}",
    "AWS_DEFAULT_REGION": "${AWS_REGION}"
  },
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000,
  "cline.apiProvider": "bedrock",
  "cline.awsRegion": "${AWS_REGION}",
  "cline.apiModelId": "${API_MODEL_ID}",
  "cline.customInstructions": ${ESCAPED_INSTRUCTIONS}
}
EOF

# ==========================================
# 4. START REACT DEV SERVER
# ==========================================
echo "Starting React app on port 3000..."
cd /home/workspace
npm run dev -- --host 0.0.0.0 --port 3000 &

# ==========================================
# 5. START VS CODE SERVER
# ==========================================
echo ""
echo "=========================================="
echo "  Instance Ready!"
echo "  AI Extension: Cline"
echo "  VS Code:   http://<public-ip>:8080"
echo "  React App: http://<public-ip>:3000"
echo "=========================================="
echo ""

# Determine base path for ALB routing
SERVER_BASE_PATH=""
if [ -n "$INSTANCE_ID" ]; then
    SERVER_BASE_PATH="/i/${INSTANCE_ID}"
    echo "  Server base path: ${SERVER_BASE_PATH}"
fi

exec /home/.openvscode-server/bin/openvscode-server \
    --host 0.0.0.0 \
    --port 8080 \
    --without-connection-token \
    --default-folder /home/workspace \
    ${SERVER_BASE_PATH:+--serverBasePath "$SERVER_BASE_PATH"}
