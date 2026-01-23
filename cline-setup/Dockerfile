# 1. Base Image: OpenVSCode Server
FROM gitpod/openvscode-server:latest

# Build arguments for customization
ARG AI_EXTENSION=continue
ARG CLINE_VERSION=3.51.0
ARG CONTINUE_VERSION=1.3.29
ARG ROO_CODE_VERSION=3.42.0

# Switch to root to perform system installations
USER root

# 2. Install Node.js 20, dos2unix, and other dependencies
RUN apt-get update && apt-get install -y curl gnupg dos2unix sqlite3 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs jq unzip \
    && rm -rf /var/lib/apt/lists/*

# 3. Set Up Workspace Directory
WORKDIR /home/workspace
RUN chown -R openvscode-server:openvscode-server /home/workspace

# 4. Install AI Extension based on build arg
# Install Cline
RUN if [ "$AI_EXTENSION" = "cline" ] || [ "$AI_EXTENSION" = "all" ]; then \
    echo "Installing Cline extension..." && \
    wget -O /tmp/cline.vsix https://open-vsx.org/api/saoudrizwan/claude-dev/${CLINE_VERSION}/file/saoudrizwan.claude-dev-${CLINE_VERSION}.vsix && \
    mkdir -p /home/.openvscode-server/extensions/saoudrizwan.claude-dev-${CLINE_VERSION} && \
    unzip -q /tmp/cline.vsix -d /tmp/cline-ext && \
    cp -r /tmp/cline-ext/extension/* /home/.openvscode-server/extensions/saoudrizwan.claude-dev-${CLINE_VERSION}/ && \
    rm -rf /tmp/cline.vsix /tmp/cline-ext; \
    fi

# Install Continue (requires platform-specific build for linux-x64)
RUN if [ "$AI_EXTENSION" = "continue" ] || [ "$AI_EXTENSION" = "all" ]; then \
    echo "Installing Continue extension..." && \
    wget -O /tmp/continue.vsix "https://open-vsx.org/api/Continue/continue/linux-x64/${CONTINUE_VERSION}/file/Continue.continue-${CONTINUE_VERSION}@linux-x64.vsix" && \
    mkdir -p /home/.openvscode-server/extensions/continue.continue-${CONTINUE_VERSION} && \
    unzip -q /tmp/continue.vsix -d /tmp/continue-ext && \
    cp -r /tmp/continue-ext/extension/* /home/.openvscode-server/extensions/continue.continue-${CONTINUE_VERSION}/ && \
    rm -rf /tmp/continue.vsix /tmp/continue-ext; \
    fi

# Install Roo Code
RUN if [ "$AI_EXTENSION" = "roo-code" ] || [ "$AI_EXTENSION" = "all" ]; then \
    echo "Installing Roo Code extension..." && \
    wget -O /tmp/roo-code.vsix https://open-vsx.org/api/RooVeterinaryInc/roo-cline/${ROO_CODE_VERSION}/file/RooVeterinaryInc.roo-cline-${ROO_CODE_VERSION}.vsix && \
    mkdir -p /home/.openvscode-server/extensions/rooveterinaryinc.roo-cline-${ROO_CODE_VERSION} && \
    unzip -q /tmp/roo-code.vsix -d /tmp/roo-code-ext && \
    cp -r /tmp/roo-code-ext/extension/* /home/.openvscode-server/extensions/rooveterinaryinc.roo-cline-${ROO_CODE_VERSION}/ && \
    rm -rf /tmp/roo-code.vsix /tmp/roo-code-ext; \
    fi

RUN chown -R openvscode-server:openvscode-server /home/.openvscode-server/extensions/

# 5. Install React App (as openvscode-server user)
USER openvscode-server
RUN mkdir temp-app \
    && cd temp-app \
    && npx -y create-vite . --template react \
    && cd .. \
    && cp -a temp-app/. . \
    && rm -rf temp-app \
    && npm install

# 6. Copy configuration files
COPY --chown=openvscode-server:openvscode-server cline-config.json /home/workspace/cline-config.json
COPY --chown=openvscode-server:openvscode-server entrypoint.sh /home/workspace/entrypoint.sh

# 7. Fix line endings and set permissions (need root for dos2unix)
USER root
RUN dos2unix /home/workspace/entrypoint.sh \
    && dos2unix /home/workspace/cline-config.json \
    && chmod +x /home/workspace/entrypoint.sh \
    && chown openvscode-server:openvscode-server /home/workspace/entrypoint.sh \
    && chown openvscode-server:openvscode-server /home/workspace/cline-config.json

# 8. Ensure extension directories have correct permissions
RUN chown -R openvscode-server:openvscode-server /home/.openvscode-server

# 9. Store selected extension for entrypoint
RUN echo "$AI_EXTENSION" > /home/workspace/.ai_extension

# 10. Switch back to non-root user
USER openvscode-server

# 11. Define the startup command
ENTRYPOINT ["/home/workspace/entrypoint.sh"]
