FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

COPY loclaude-instance/package.json loclaude-instance/tsconfig.json ./
RUN npm install

# Copy and build shared client
COPY shared/instance-client/ ./client/
RUN cd client && npm install && npm run build

COPY loclaude-instance/server/ ./server/

RUN mkdir -p /home/workspace/project

COPY loclaude-instance/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080 3000

ENTRYPOINT ["/app/entrypoint.sh"]
