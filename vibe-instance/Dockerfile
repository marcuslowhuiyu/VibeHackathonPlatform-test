FROM node:20-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy and install server dependencies
COPY package.json tsconfig.json ./
RUN npm install

# Copy and build client
COPY client/ ./client/
RUN cd client && npm install && npm run build

# Copy server source
COPY server/ ./server/

# Create project directory
RUN mkdir -p /home/workspace/project

# Copy entrypoint
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV INSTANCE_MODE=vibe
EXPOSE 8080 3000

ENTRYPOINT ["/app/entrypoint.sh"]
