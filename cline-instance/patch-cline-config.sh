#!/bin/bash
# ==========================================
# PATCH CLINE EXTENSION FOR AUTO-CONFIG
# ==========================================
# This script injects a shim into Cline's dist/extension.js that
# auto-configures Bedrock API settings via globalState on first launch.
# It runs at Docker build time after the extension is extracted.

set -e

CLINE_VERSION="${1:?Usage: patch-cline-config.sh <cline-version>}"
EXT_DIR="/home/.openvscode-server/extensions/saoudrizwan.claude-dev-${CLINE_VERSION}"
EXT_JS="${EXT_DIR}/dist/extension.js"

if [ ! -f "$EXT_JS" ]; then
    echo "ERROR: Cline extension.js not found at ${EXT_JS}"
    exit 1
fi

echo "Patching Cline extension.js for auto-config..."

# Create the shim that wraps the activate() export
cat >> "$EXT_JS" << 'SHIM_EOF'

// === AUTO-CONFIG SHIM (injected at build time) ===
;(function() {
    const origActivate = module.exports.activate;
    if (typeof origActivate !== 'function') return;

    module.exports.activate = async function(context) {
        try {
            const fs = require('fs');
            const configPath = '/home/workspace/cline-config.json';

            // Only apply if globalState has no provider set (first launch)
            const existing = context.globalState.get('actModeApiProvider');
            if (!existing) {
                if (fs.existsSync(configPath)) {
                    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                    const region = config.awsRegion || 'ap-southeast-1';
                    const modelId = config.apiModelId || 'anthropic.claude-sonnet-4-20250514-v1:0';

                    await context.globalState.update('actModeApiProvider', 'bedrock');
                    await context.globalState.update('planModeApiProvider', 'bedrock');
                    await context.globalState.update('actModeApiModelId', modelId);
                    await context.globalState.update('planModeApiModelId', modelId);
                    await context.globalState.update('awsRegion', region);
                    await context.globalState.update('awsAuthentication', 'profile');
                    await context.globalState.update('awsUseProfile', true);
                    await context.globalState.update('awsProfile', 'default');

                    console.log('[cline-autoconfig] Bedrock config applied: region=' + region + ' model=' + modelId);
                } else {
                    console.log('[cline-autoconfig] No config file at ' + configPath + ', skipping');
                }
            } else {
                console.log('[cline-autoconfig] globalState already configured (provider=' + existing + '), skipping');
            }
        } catch (err) {
            console.error('[cline-autoconfig] Failed to apply config:', err);
        }

        return origActivate.call(this, context);
    };
})();
// === END AUTO-CONFIG SHIM ===
SHIM_EOF

echo "Cline extension.js patched successfully"
