# Stage 1: Build frontend
FROM node:22-slim AS frontend
RUN corepack enable pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN mkdir -p packages/agent && echo '{"name":"@webmux/agent","version":"0.0.0","private":true}' > packages/agent/package.json
RUN mkdir -p packages/server && echo '{"name":"@webmux/server","version":"0.0.0","private":true}' > packages/server/package.json
COPY packages/shared packages/shared
COPY packages/web packages/web
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @webmux/shared build
RUN pnpm --filter @webmux/web build

# Stage 2: Build Rust server
FROM rust:slim AS builder
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY rust/ .
RUN cargo build --release --bin webmux-server

# Stage 3: Production
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/webmux-server /usr/local/bin/
COPY --from=frontend /app/packages/web/dist /app/web

ENV WEBMUX_STATIC_DIR=/app/web
EXPOSE 4317

CMD ["webmux-server"]
