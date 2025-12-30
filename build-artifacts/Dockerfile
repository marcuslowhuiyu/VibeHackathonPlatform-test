# 1. Base Image: OpenVSCode Server
FROM gitpod/openvscode-server:latest

# Switch to root to perform system installations
USER root

# 2. Install Node.js 20 (Fixes "EBADENGINE" error)
# We use curl to fetch the modern Node setup script
RUN apt-get update && apt-get install -y curl gnupg \
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

# 5. Install React App (Fixes "EACCES" error)
# We switch to the user for this step so files are owned by them
USER openvscode-server

# EXPLANATION:
# 1. 'npx -y' runs the command without installing it globally (avoiding permission errors).
# 2. We use a temp folder to avoid "directory not empty" errors.
# 3. We move the files and run npm install.
RUN mkdir temp-app \
    && cd temp-app \
    && npx -y create-vite . --template react \
    && cd .. \
    && cp -a temp-app/. . \
    && rm -rf temp-app \
    && npm install

# 6. Install the Entrypoint Script
# (Ensure entrypoint.sh is in the same folder as this Dockerfile)
COPY --chown=openvscode-server:openvscode-server entrypoint.sh /home/workspace/entrypoint.sh
RUN chmod +x /home/workspace/entrypoint.sh

# 7. Define the startup command
ENTRYPOINT ["/home/workspace/entrypoint.sh"]