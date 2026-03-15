FROM node:22-slim AS base
RUN corepack enable pnpm

# Build stage
FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/agent/package.json packages/agent/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web
COPY packages/agent packages/agent
RUN pnpm --filter @webmux/web build
RUN pnpm --filter @webmux/server build

# Production stage
FROM base AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

RUN pnpm install --frozen-lockfile --prod --filter @webmux/server

COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/web/dist packages/web/dist

EXPOSE 4317

CMD ["node", "packages/server/dist/index.js"]
