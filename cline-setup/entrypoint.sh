#!/bin/bash

# ==========================================
# VIBE CODING LAB - CONTAINER STARTUP
# ==========================================

echo "=========================================="
echo "Starting Vibe Coding Lab Instance"
echo "Instance ID: ${INSTANCE_ID:-not-set}"
echo "=========================================="

# Set defaults
AWS_REGION="${AWS_REGION:-us-east-1}"
CONFIG_FILE="/home/workspace/cline-config.json"
AI_EXTENSION_FILE="/home/workspace/.ai_extension"

# Read which AI extension was installed
if [ -f "$AI_EXTENSION_FILE" ]; then
    AI_EXTENSION=$(cat "$AI_EXTENSION_FILE" | tr -d '[:space:]')
else
    AI_EXTENSION="continue"
fi

echo "AI Extension: $AI_EXTENSION"

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
    API_MODEL_ID=$(jq -r '.apiModelId // "us.anthropic.claude-3-5-sonnet-20241022-v2:0"' "$CONFIG_FILE")
    CUSTOM_INSTRUCTIONS=$(jq -r '.customInstructions // ""' "$CONFIG_FILE")
else
    API_MODEL_ID="us.anthropic.claude-3-5-sonnet-20241022-v2:0"
    CUSTOM_INSTRUCTIONS=""
fi

# ==========================================
# 2. CONFIGURE AI EXTENSION
# ==========================================
echo "Configuring $AI_EXTENSION extension..."

case "$AI_EXTENSION" in
    "continue")
        # Continue uses file-based configuration - most reliable!
        CONTINUE_DIR="$HOME/.continue"
        mkdir -p "$CONTINUE_DIR"

        cat > "$CONTINUE_DIR/config.json" << EOF
{
  "models": [
    {
      "title": "Claude Sonnet (Bedrock)",
      "provider": "bedrock",
      "model": "${API_MODEL_ID}",
      "region": "${AWS_REGION}",
      "profile": "default"
    }
  ],
  "tabAutocompleteModel": {
    "title": "Claude Haiku (Bedrock)",
    "provider": "bedrock",
    "model": "anthropic.claude-3-haiku-20240307-v1:0",
    "region": "${AWS_REGION}",
    "profile": "default"
  },
  "customCommands": [
    {
      "name": "test",
      "prompt": "{{{ input }}}\n\nWrite a comprehensive set of unit tests for the selected code. Use the appropriate testing framework for the language.",
      "description": "Write unit tests for highlighted code"
    }
  ],
  "contextProviders": [
    { "name": "code" },
    { "name": "docs" },
    { "name": "diff" },
    { "name": "terminal" },
    { "name": "problems" },
    { "name": "folder" },
    { "name": "codebase" }
  ],
  "slashCommands": [
    { "name": "edit", "description": "Edit selected code" },
    { "name": "comment", "description": "Add comments to code" },
    { "name": "share", "description": "Share session" },
    { "name": "cmd", "description": "Generate shell command" },
    { "name": "commit", "description": "Generate commit message" }
  ],
  "systemMessage": "${CUSTOM_INSTRUCTIONS}"
}
EOF
        chmod 644 "$CONTINUE_DIR/config.json"
        echo "  Continue configured with AWS Bedrock"
        echo "    Model: ${API_MODEL_ID}"
        echo "    Config: $CONTINUE_DIR/config.json"
        ;;

    "cline")
        # Cline uses VS Code globalState database
        CLINE_STORAGE="/home/.openvscode-server/data/User/globalStorage/saoudrizwan.claude-dev"
        VSCODE_GLOBAL_STORAGE="/home/.openvscode-server/data/User/globalStorage"
        STATE_DB="$VSCODE_GLOBAL_STORAGE/state.vscdb"
        mkdir -p "$CLINE_STORAGE"
        mkdir -p "$VSCODE_GLOBAL_STORAGE"

        sqlite3 "$STATE_DB" "CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);"
        sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('saoudrizwan.claude-dev.apiProvider', '\"bedrock\"');"
        sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('saoudrizwan.claude-dev.apiModelId', '\"${API_MODEL_ID}\"');"
        sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('saoudrizwan.claude-dev.awsRegion', '\"${AWS_REGION}\"');"
        sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('saoudrizwan.claude-dev.awsUseProfile', '\"default\"');"

        ESCAPED_INSTRUCTIONS=$(echo "$CUSTOM_INSTRUCTIONS" | sed 's/"/\\"/g' | sed "s/'/\\\\'/g")
        sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('saoudrizwan.claude-dev.customInstructions', '\"${ESCAPED_INSTRUCTIONS}\"');"

        chmod -R 755 "$CLINE_STORAGE" 2>/dev/null || true
        chmod 644 "$STATE_DB" 2>/dev/null || true

        echo "  Cline configured for AWS Bedrock"
        echo "    Model: ${API_MODEL_ID}"
        ;;

    "roo-code")
        # Roo Code uses similar VS Code globalState database as Cline
        ROO_STORAGE="/home/.openvscode-server/data/User/globalStorage/rooveterinaryinc.roo-cline"
        VSCODE_GLOBAL_STORAGE="/home/.openvscode-server/data/User/globalStorage"
        STATE_DB="$VSCODE_GLOBAL_STORAGE/state.vscdb"
        mkdir -p "$ROO_STORAGE"
        mkdir -p "$VSCODE_GLOBAL_STORAGE"

        sqlite3 "$STATE_DB" "CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);"
        sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('rooveterinaryinc.roo-cline.apiProvider', '\"bedrock\"');"
        sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('rooveterinaryinc.roo-cline.apiModelId', '\"${API_MODEL_ID}\"');"
        sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('rooveterinaryinc.roo-cline.awsRegion', '\"${AWS_REGION}\"');"
        sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('rooveterinaryinc.roo-cline.awsUseProfile', '\"default\"');"

        ESCAPED_INSTRUCTIONS=$(echo "$CUSTOM_INSTRUCTIONS" | sed 's/"/\\"/g' | sed "s/'/\\\\'/g")
        sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('rooveterinaryinc.roo-cline.customInstructions', '\"${ESCAPED_INSTRUCTIONS}\"');"

        chmod -R 755 "$ROO_STORAGE" 2>/dev/null || true
        chmod 644 "$STATE_DB" 2>/dev/null || true

        echo "  Roo Code configured for AWS Bedrock"
        echo "    Model: ${API_MODEL_ID}"
        ;;

    *)
        echo "  Unknown extension: $AI_EXTENSION, skipping configuration"
        ;;
esac

# ==========================================
# 3. CONFIGURE VS CODE SETTINGS
# ==========================================
echo "Configuring VS Code..."

VSCODE_USER="/home/.openvscode-server/data/User"
mkdir -p "$VSCODE_USER"

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
echo "  AI Extension: $AI_EXTENSION"
echo "  VS Code:   http://<public-ip>:8080"
echo "  React App: http://<public-ip>:3000"
echo "=========================================="
echo ""

exec /home/.openvscode-server/bin/openvscode-server \
    --host 0.0.0.0 \
    --port 8080 \
    --without-connection-token \
    --default-folder /home/workspace
