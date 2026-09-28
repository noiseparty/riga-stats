# syntax=docker/dockerfile:1

# ---- build: install everything, typecheck, build client + server ----
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.29.1 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
RUN pnpm build

# ---- runtime: the server has no runtime dependencies, so no node_modules at all ----
FROM node:22-alpine
ENV NODE_ENV=production PORT=3104
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3104
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "dist/node/server/index.js"]
