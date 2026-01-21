#!/bin/bash

# ==========================================
# ENVIRONMENT VARIABLES (set at runtime)
# ==========================================
# AWS_ACCESS_KEY_ID     - AWS access key for Bedrock (auto-injected by dashboard)
# AWS_SECRET_ACCESS_KEY - AWS secret key for Bedrock (auto-injected by dashboard)
# AWS_REGION            - AWS region (default: us-east-1)
# INSTANCE_ID           - Unique identifier for this instance
# BEDROCK_MODEL_ID      - Model to use (default: claude-sonnet-4-20250514)
# CONNECTION_TOKEN      - Optional auth token for VS Code access
# ==========================================

echo "=========================================="
echo "Starting Vibe Coding Lab Instance"
echo "Instance ID: ${INSTANCE_ID:-not-set}"
echo "=========================================="

# Set defaults for optional variables
AWS_REGION="${AWS_REGION:-us-east-1}"
BEDROCK_MODEL_ID="${BEDROCK_MODEL_ID:-anthropic.claude-sonnet-4-20250514-v1:0}"

# ==========================================
# 1. CONFIGURE AWS CREDENTIALS
# ==========================================
echo "Configuring AWS credentials..."

# Create AWS credentials directory
AWS_DIR="/home/openvscode-server/.aws"
mkdir -p "$AWS_DIR"

# Write AWS credentials file (used by AWS SDK and Cline)
if [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ]; then
    cat <<EOF > "$AWS_DIR/credentials"
[default]
aws_access_key_id = ${AWS_ACCESS_KEY_ID}
aws_secret_access_key = ${AWS_SECRET_ACCESS_KEY}
EOF

    cat <<EOF > "$AWS_DIR/config"
[default]
region = ${AWS_REGION}
output = json
EOF

    # Fix permissions
    chown -R openvscode-server:openvscode-server "$AWS_DIR"
    chmod 600 "$AWS_DIR/credentials"
    chmod 600 "$AWS_DIR/config"

    echo "  - AWS credentials configured at $AWS_DIR"
    echo "  - Region: ${AWS_REGION}"
else
    echo "  - WARNING: AWS credentials not provided!"
    echo "  - Cline will not be able to use Bedrock"
fi

# ==========================================
# 2. CONFIGURE CLINE EXTENSION
# ==========================================
echo "Configuring Cline for Amazon Bedrock..."

# Define the target directory for Cline settings
CLINE_DIR="/home/.openvscode-server/data/User/globalStorage/saoudrizwan.claude-dev"
mkdir -p "$CLINE_DIR"

# Write the Cline config JSON
# Note: With awsUseProfile: "default", Cline will use ~/.aws/credentials
cat <<EOF > "$CLINE_DIR/settings.json"
{
  "apiProvider": "bedrock",
  "apiModelId": "${BEDROCK_MODEL_ID}",
  "awsRegion": "${AWS_REGION}",
  "awsUseProfile": "default"
}
EOF

# Also write to state.json (Cline may use either file)
cat <<EOF > "$CLINE_DIR/state.json"
{
  "apiProvider": "bedrock",
  "apiModelId": "${BEDROCK_MODEL_ID}",
  "awsRegion": "${AWS_REGION}",
  "awsUseProfile": "default"
}
EOF

# Fix permissions so the user can read/write it
chown -R openvscode-server:openvscode-server "$CLINE_DIR"

echo "Cline configuration:"
echo "  - Provider: Amazon Bedrock"
echo "  - Region: ${AWS_REGION}"
echo "  - Model: ${BEDROCK_MODEL_ID}"
echo "  - AWS Profile: default (using ~/.aws/credentials)"

# ==========================================
# 3. CONFIGURE VS CODE SETTINGS
# ==========================================
echo "Configuring VS Code settings..."

VSCODE_SETTINGS_DIR="/home/.openvscode-server/data/User"
mkdir -p "$VSCODE_SETTINGS_DIR"

# Create VS Code settings if not exists
if [ ! -f "$VSCODE_SETTINGS_DIR/settings.json" ]; then
    cat <<EOF > "$VSCODE_SETTINGS_DIR/settings.json"
{
  "workbench.colorTheme": "Default Dark+",
  "editor.fontSize": 14,
  "editor.tabSize": 2,
  "editor.wordWrap": "on",
  "terminal.integrated.defaultProfile.linux": "bash",
  "cline.enableAutoApprove": false
}
EOF
    chown openvscode-server:openvscode-server "$VSCODE_SETTINGS_DIR/settings.json"
    echo "  - VS Code settings configured"
fi

# ==========================================
# 4. START THE REACT APP
# ==========================================
echo "Starting React Vibe App on port 3000..."
cd /home/workspace

# Start the dev server in the background
npm run dev -- --host 0.0.0.0 --port 3000 &

# ==========================================
# 5. START VS CODE SERVER
# ==========================================
echo "Starting VS Code Server on port 8080..."

# Use connection token if provided for security, otherwise allow unauthenticated
if [ -n "$CONNECTION_TOKEN" ]; then
    echo "VS Code access: Protected with connection token"
    exec /home/.openvscode-server/bin/openvscode-server \
        --host 0.0.0.0 \
        --port 8080 \
        --connection-token "$CONNECTION_TOKEN" \
        --default-folder /home/workspace
else
    echo "VS Code access: Open (no token required)"
    exec /home/.openvscode-server/bin/openvscode-server \
        --host 0.0.0.0 \
        --port 8080 \
        --without-connection-token \
        --default-folder /home/workspace
fi
