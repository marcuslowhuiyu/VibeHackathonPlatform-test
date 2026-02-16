# 1. Base Image: OpenVSCode Server
FROM gitpod/openvscode-server:latest

# Build arguments for customization
ARG CONTINUE_VERSION=1.3.29

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

# 4. Install Continue AI Extension
RUN echo "Installing Continue extension..." && \
    wget -O /tmp/continue.vsix "https://open-vsx.org/api/Continue/continue/linux-x64/${CONTINUE_VERSION}/file/Continue.continue-${CONTINUE_VERSION}@linux-x64.vsix" && \
    mkdir -p /home/.openvscode-server/extensions/continue.continue-${CONTINUE_VERSION} && \
    unzip -q /tmp/continue.vsix -d /tmp/continue-ext && \
    cp -r /tmp/continue-ext/extension/* /home/.openvscode-server/extensions/continue.continue-${CONTINUE_VERSION}/ && \
    rm -rf /tmp/continue.vsix /tmp/continue-ext

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
COPY --chown=openvscode-server:openvscode-server continue-instance/cline-config.json /home/workspace/cline-config.json
COPY --chown=openvscode-server:openvscode-server continue-instance/entrypoint.sh /home/workspace/entrypoint.sh

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
