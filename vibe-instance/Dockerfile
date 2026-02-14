FROM node:20-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy and install server dependencies
COPY vibe-instance/package.json vibe-instance/tsconfig.json ./
RUN npm install

# Copy and build shared client
COPY shared/instance-client/ ./client/
RUN cd client && npm install && npm run build

# Copy server source
COPY vibe-instance/server/ ./server/

# Create project directory
RUN mkdir -p /home/workspace/project

# Copy entrypoint
COPY vibe-instance/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080 3000

ENTRYPOINT ["/app/entrypoint.sh"]
