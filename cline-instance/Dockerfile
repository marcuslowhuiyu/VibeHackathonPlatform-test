# 1. Base Image: OpenVSCode Server
FROM gitpod/openvscode-server:latest

# Build arguments for customization
ARG CLINE_VERSION=3.57.1

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

# 4. Install Cline AI Extension (formerly Claude Dev)
RUN echo "Installing Cline extension..." && \
    wget -O /tmp/cline.vsix "https://open-vsx.org/api/saoudrizwan/claude-dev/${CLINE_VERSION}/file/saoudrizwan.claude-dev-${CLINE_VERSION}.vsix" && \
    mkdir -p /home/.openvscode-server/extensions/saoudrizwan.claude-dev-${CLINE_VERSION} && \
    unzip -q /tmp/cline.vsix -d /tmp/cline-ext && \
    cp -r /tmp/cline-ext/extension/* /home/.openvscode-server/extensions/saoudrizwan.claude-dev-${CLINE_VERSION}/ && \
    rm -rf /tmp/cline.vsix /tmp/cline-ext

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

# 9. Switch back to non-root user
USER openvscode-server

# 10. Define the startup command
ENTRYPOINT ["/home/workspace/entrypoint.sh"]
