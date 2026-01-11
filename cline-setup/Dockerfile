# 1. Base Image: OpenVSCode Server
FROM gitpod/openvscode-server:latest

# Switch to root to perform system installations
USER root

# 2. Install Node.js 20 AND dos2unix (Fixes the "no such file" error)
# We added 'dos2unix' to the install list here.
RUN apt-get update && apt-get install -y curl gnupg dos2unix \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs jq \
    && rm -rf /var/lib/apt/lists/*

# 3. Install Cline Extension (via Open VSX)
RUN wget -O cline.vsix https://open-vsx.org/api/saoudrizwan/claude-dev/3.46.1/file/saoudrizwan.claude-dev-3.46.1.vsix \
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

# 6. Install the Entrypoint Script (With Line Ending Fix)
# We copy the file, then run dos2unix to strip the Windows \r characters.
COPY --chown=openvscode-server:openvscode-server entrypoint.sh /home/workspace/entrypoint.sh
RUN dos2unix /home/workspace/entrypoint.sh \
    && chmod +x /home/workspace/entrypoint.sh

# 7. Define the startup command
ENTRYPOINT ["/home/workspace/entrypoint.sh"]