#!/bin/bash

# ==========================================
# ENVIRONMENT VARIABLES (set at runtime)
# ==========================================
# AWS_ACCESS_KEY_ID     - AWS access key for Bedrock
# AWS_SECRET_ACCESS_KEY - AWS secret key for Bedrock
# AWS_REGION            - AWS region (default: us-east-1)
# INSTANCE_ID           - Unique identifier for this instance
# BEDROCK_MODEL_ID      - Model to use (default: claude-3-5-sonnet)
# CONNECTION_TOKEN      - Optional auth token for VS Code access
# ==========================================

echo "=========================================="
echo "Starting Vibe Coding Lab Instance"
echo "Instance ID: ${INSTANCE_ID:-not-set}"
echo "=========================================="

# ==========================================
# 1. DYNAMIC CLINE CONFIGURATION
# ==========================================
echo "Configuring Cline for Amazon Bedrock..."

# Define the target directory for Cline settings
CLINE_DIR="/home/.openvscode-server/data/User/globalStorage/saoudrizwan.claude-dev"
mkdir -p "$CLINE_DIR"

# Set defaults for optional variables
AWS_REGION="${AWS_REGION:-us-east-1}"
BEDROCK_MODEL_ID="${BEDROCK_MODEL_ID:-anthropic.claude-3-5-sonnet-20240620-v1:0}"

# Write the config JSON dynamically using environment variables
cat <<EOF > "$CLINE_DIR/state.json"
{
  "apiProvider": "bedrock",
  "apiModelId": "${BEDROCK_MODEL_ID}",
  "awsRegion": "${AWS_REGION}",
  "awsUseProfile": false
}
EOF

# Fix permissions so the user can read/write it
chown openvscode-server:openvscode-server "$CLINE_DIR"
chown openvscode-server:openvscode-server "$CLINE_DIR/state.json"

echo "Cline configuration:"
echo "  - Region: ${AWS_REGION}"
echo "  - Model: ${BEDROCK_MODEL_ID}"
echo "  - AWS credentials: ${AWS_ACCESS_KEY_ID:+provided}${AWS_ACCESS_KEY_ID:-NOT SET}"

# ==========================================
# 2. START THE REACT APP
# ==========================================
echo "Starting React Vibe App on port 3000..."
cd /home/workspace

# Start the dev server in the background
npm run dev -- --host 0.0.0.0 --port 3000 &

# ==========================================
# 3. START VS CODE SERVER
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
