# 1. Base Image: OpenVSCode Server
FROM gitpod/openvscode-server:latest

# Build arguments for customization
ARG CLINE_VERSION=3.51.0

# Switch to root to perform system installations
USER root

# 2. Install Node.js 20 AND dos2unix (Fixes the "no such file" error)
RUN apt-get update && apt-get install -y curl gnupg dos2unix \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs jq \
    && rm -rf /var/lib/apt/lists/*

# 3. Install Cline Extension (via Open VSX) - version is configurable via build arg
RUN wget -O cline.vsix https://open-vsx.org/api/saoudrizwan/claude-dev/${CLINE_VERSION}/file/saoudrizwan.claude-dev-${CLINE_VERSION}.vsix \
    && /home/.openvscode-server/bin/openvscode-server --install-extension cline.vsix \
    && rm cline.vsix

# 4. Set Up Workspace Directory
WORKDIR /home/workspace
RUN chown -R openvscode-server:openvscode-server /home/workspace

# 5. Install React App (Using npx to avoid permission issues)
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

# 7. Fix line endings and set permissions
USER root
RUN dos2unix /home/workspace/entrypoint.sh \
    && dos2unix /home/workspace/cline-config.json \
    && chmod +x /home/workspace/entrypoint.sh \
    && chown openvscode-server:openvscode-server /home/workspace/entrypoint.sh \
    && chown openvscode-server:openvscode-server /home/workspace/cline-config.json

# 8. Switch back to non-root user
USER openvscode-server

# 9. Define the startup command
ENTRYPOINT ["/home/workspace/entrypoint.sh"]
