FROM node:22-slim AS base
RUN corepack enable pnpm

# Build stage — only build server and web (no agent, no node-pty)
FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Create a stub agent package.json without node-pty so pnpm workspace resolves
RUN mkdir -p packages/agent && echo '{"name":"@webmux/agent","version":"0.0.0","private":true}' > packages/agent/package.json

COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @webmux/shared build
RUN pnpm --filter @webmux/web build
RUN pnpm --filter @webmux/server build

# Production stage
FROM base AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
RUN mkdir -p packages/agent && echo '{"name":"@webmux/agent","version":"0.0.0","private":true}' > packages/agent/package.json
RUN mkdir -p packages/web && echo '{"name":"@webmux/web","version":"0.0.0","private":true}' > packages/web/package.json
RUN pnpm install --no-frozen-lockfile --prod --filter @webmux/server

COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/web/dist packages/web/dist

EXPOSE 4317

CMD ["node", "packages/server/dist/index.js"]
