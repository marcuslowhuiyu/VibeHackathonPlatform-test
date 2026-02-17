FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ripgrep \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Continue CLI globally
RUN npm i -g @continuedev/cli

# Copy and install server dependencies
COPY continue-dev-instance/package.json continue-dev-instance/tsconfig.json ./
RUN npm install

# Copy and build shared client
COPY shared/instance-client/ ./client/
RUN cd client && npm install && npm run build

# Copy server source
COPY continue-dev-instance/server/ ./server/

# Create workspace
RUN mkdir -p /home/workspace/project

# Copy entrypoint
COPY continue-dev-instance/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080 3000

ENTRYPOINT ["/app/entrypoint.sh"]
