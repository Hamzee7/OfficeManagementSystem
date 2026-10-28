# NOTE: written but not built in the development environment (no Docker available there). Test it before relying on it.
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATABASE_PATH=/data/cms.db STORAGE_DIR=/data/files
COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
# The web server and the background worker are two processes of the same image (see docker-compose.yml).
CMD ["npx", "next", "start", "-p", "3000"]
