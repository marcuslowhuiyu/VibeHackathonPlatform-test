#!/bin/bash

# ==========================================
# VIBE CODING LAB - CONTAINER STARTUP
# ==========================================
# Environment variables (auto-injected by dashboard):
#   AWS_ACCESS_KEY_ID     - AWS access key for Bedrock
#   AWS_SECRET_ACCESS_KEY - AWS secret key for Bedrock
#   AWS_REGION            - AWS region (default: us-east-1)
#   INSTANCE_ID           - Unique identifier for this instance
#   AI_EXTENSION          - Which AI extension to use (cline, continue, roo-code)
# ==========================================

echo "=========================================="
echo "Starting Vibe Coding Lab Instance"
echo "Instance ID: ${INSTANCE_ID:-not-set}"
echo "AI Extension: ${AI_EXTENSION:-cline}"
echo "=========================================="

# Set defaults
AWS_REGION="${AWS_REGION:-us-east-1}"
AI_EXTENSION="${AI_EXTENSION:-cline}"
CONFIG_FILE="/home/workspace/cline-config.json"

# ==========================================
# 1. CONFIGURE AWS CREDENTIALS
# ==========================================
echo "Configuring AWS credentials..."

# Ensure HOME is set correctly for the openvscode-server user
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
    echo "  AWS credentials configured at $AWS_DIR"
    echo "    Access Key ID: ${AWS_ACCESS_KEY_ID:0:8}..."
    echo "    Region: ${AWS_REGION}"
else
    echo "  WARNING: AWS credentials not provided!"
fi

# Export AWS environment variables so they're available to all processes
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}"
export AWS_DEFAULT_REGION="${AWS_REGION}"
export AWS_REGION="${AWS_REGION}"
export AWS_PROFILE="default"

# Read common settings from config file
if [ -f "$CONFIG_FILE" ]; then
    API_MODEL_ID=$(jq -r '.apiModelId // "anthropic.claude-sonnet-4-20250514-v1:0"' "$CONFIG_FILE")
    CUSTOM_INSTRUCTIONS=$(jq -r '.customInstructions // ""' "$CONFIG_FILE")
    echo "  Loaded settings from cline-config.json"
else
    API_MODEL_ID="anthropic.claude-sonnet-4-20250514-v1:0"
    CUSTOM_INSTRUCTIONS=""
    echo "  Using default settings"
fi

# ==========================================
# EXTENSION CONFIGURATION FUNCTIONS
# ==========================================

configure_cline() {
    echo "  Setting up Cline extension..."

    CLINE_STORAGE="/home/.openvscode-server/data/User/globalStorage/saoudrizwan.claude-dev"
    VSCODE_GLOBAL_STORAGE="/home/.openvscode-server/data/User/globalStorage"
    STATE_DB="$VSCODE_GLOBAL_STORAGE/state.vscdb"
    mkdir -p "$CLINE_STORAGE"
    mkdir -p "$VSCODE_GLOBAL_STORAGE"

    # Write to VS Code globalState database
    sqlite3 "$STATE_DB" "CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);"
    sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('saoudrizwan.claude-dev.apiProvider', '\"bedrock\"');"
    sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('saoudrizwan.claude-dev.apiModelId', '\"${API_MODEL_ID}\"');"
    sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('saoudrizwan.claude-dev.awsRegion', '\"${AWS_REGION}\"');"
    # Use 'credentials' authentication which reads from environment variables
    sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('saoudrizwan.claude-dev.awsAuthentication', '\"credentials\"');"
    # Store credentials directly in globalState (Cline can read these)
    sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('saoudrizwan.claude-dev.awsAccessKeyId', '\"${AWS_ACCESS_KEY_ID}\"');"
    sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('saoudrizwan.claude-dev.awsSecretAccessKey', '\"${AWS_SECRET_ACCESS_KEY}\"');"

    # Custom instructions
    ESCAPED_INSTRUCTIONS=$(echo "$CUSTOM_INSTRUCTIONS" | sed 's/"/\\"/g')
    sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('saoudrizwan.claude-dev.customInstructions', '\"${ESCAPED_INSTRUCTIONS}\"');"

    # Also create JSON files as backup
    jq -n \
      --arg model "$API_MODEL_ID" \
      --arg region "$AWS_REGION" \
      --arg instructions "$CUSTOM_INSTRUCTIONS" \
      '{
        apiProvider: "bedrock",
        apiModelId: $model,
        awsRegion: $region,
        awsAuthentication: "credentials",
        customInstructions: $instructions
      }' > "$CLINE_STORAGE/settings.json"

    chmod -R 755 "$CLINE_STORAGE" 2>/dev/null || true
    chmod 644 "$STATE_DB" 2>/dev/null || true

    echo "  Cline configured for AWS Bedrock"
    echo "    Model: ${API_MODEL_ID}"
    echo "    Auth: credentials-based (stored in globalState)"
}

configure_continue() {
    echo "  Setting up Continue extension..."

    CONTINUE_DIR="$HOME/.continue"
    mkdir -p "$CONTINUE_DIR"

    # Continue uses config.json with direct credential support
    # This is the most reliable way to configure Continue
    cat > "$CONTINUE_DIR/config.json" << EOF
{
  "models": [
    {
      "title": "Claude (AWS Bedrock)",
      "provider": "bedrock",
      "model": "${API_MODEL_ID}",
      "region": "${AWS_REGION}",
      "accessKeyId": "${AWS_ACCESS_KEY_ID}",
      "secretAccessKey": "${AWS_SECRET_ACCESS_KEY}"
    }
  ],
  "tabAutocompleteModel": {
    "title": "Claude Autocomplete",
    "provider": "bedrock",
    "model": "${API_MODEL_ID}",
    "region": "${AWS_REGION}",
    "accessKeyId": "${AWS_ACCESS_KEY_ID}",
    "secretAccessKey": "${AWS_SECRET_ACCESS_KEY}"
  },
  "customCommands": [
    {
      "name": "explain",
      "description": "Explain the selected code",
      "prompt": "Explain this code in detail: {{{ input }}}"
    },
    {
      "name": "fix",
      "description": "Fix bugs in the selected code",
      "prompt": "Fix any bugs in this code and explain what was wrong: {{{ input }}}"
    }
  ],
  "systemMessage": "${CUSTOM_INSTRUCTIONS}"
}
EOF

    chmod 600 "$CONTINUE_DIR/config.json"
    echo "  Continue configured with direct AWS credentials"
    echo "    Config: $CONTINUE_DIR/config.json"
    echo "    Model: ${API_MODEL_ID}"
}

configure_roo_code() {
    echo "  Setting up Roo Code extension..."

    ROO_STORAGE="/home/.openvscode-server/data/User/globalStorage/RooVeterinaryInc.roo-cline"
    VSCODE_GLOBAL_STORAGE="/home/.openvscode-server/data/User/globalStorage"
    STATE_DB="$VSCODE_GLOBAL_STORAGE/state.vscdb"
    mkdir -p "$ROO_STORAGE"
    mkdir -p "$VSCODE_GLOBAL_STORAGE"

    # Create settings file for auto-import
    cat > "$ROO_STORAGE/roo-settings.json" << EOF
{
  "apiProvider": "bedrock",
  "apiModelId": "${API_MODEL_ID}",
  "awsRegion": "${AWS_REGION}",
  "awsAccessKeyId": "${AWS_ACCESS_KEY_ID}",
  "awsSecretAccessKey": "${AWS_SECRET_ACCESS_KEY}",
  "customInstructions": "${CUSTOM_INSTRUCTIONS}"
}
EOF

    # Write to VS Code globalState database (similar to Cline)
    sqlite3 "$STATE_DB" "CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);"
    sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('RooVeterinaryInc.roo-cline.apiProvider', '\"bedrock\"');"
    sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('RooVeterinaryInc.roo-cline.apiModelId', '\"${API_MODEL_ID}\"');"
    sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('RooVeterinaryInc.roo-cline.awsRegion', '\"${AWS_REGION}\"');"
    sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('RooVeterinaryInc.roo-cline.awsAccessKeyId', '\"${AWS_ACCESS_KEY_ID}\"');"
    sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('RooVeterinaryInc.roo-cline.awsSecretAccessKey', '\"${AWS_SECRET_ACCESS_KEY}\"');"

    chmod -R 755 "$ROO_STORAGE" 2>/dev/null || true
    chmod 644 "$STATE_DB" 2>/dev/null || true

    echo "  Roo Code configured for AWS Bedrock"
    echo "    Model: ${API_MODEL_ID}"
}

# ==========================================
# 2. CONFIGURE AI EXTENSION
# ==========================================
echo "Configuring AI extension: ${AI_EXTENSION}..."

case "$AI_EXTENSION" in
    "continue")
        configure_continue
        ;;
    "roo-code")
        configure_roo_code
        ;;
    "cline"|*)
        configure_cline
        ;;
esac

# ==========================================
# 3. CONFIGURE VS CODE SETTINGS
# ==========================================
echo "Configuring VS Code..."

VSCODE_USER="/home/.openvscode-server/data/User"
mkdir -p "$VSCODE_USER"

# Create VS Code settings with environment variables for terminal
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
  "files.autoSaveDelay": 1000
}
EOF

chmod 644 "$VSCODE_USER/settings.json" 2>/dev/null || true
echo "  VS Code settings configured"

# ==========================================
# 4. START REACT DEV SERVER
# ==========================================
echo "Starting React app on port 3000..."
cd /home/workspace
npm run dev -- --host 0.0.0.0 --port 3000 &
REACT_PID=$!
echo "  React dev server started (PID: $REACT_PID)"

# ==========================================
# 5. START VS CODE SERVER
# ==========================================
echo "Starting VS Code Server on port 8080..."
echo ""
echo "=========================================="
echo "  Instance Ready!"
echo "  AI Extension: ${AI_EXTENSION}"
echo "  VS Code:   http://<public-ip>:8080"
echo "  React App: http://<public-ip>:3000"
echo "=========================================="
echo ""

exec /home/.openvscode-server/bin/openvscode-server \
    --host 0.0.0.0 \
    --port 8080 \
    --without-connection-token \
    --default-folder /home/workspace
