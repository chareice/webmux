# Stage 1: Build Expo Web frontend
FROM node:22-slim AS frontend
RUN corepack enable && corepack prepare pnpm@10.23.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared packages/shared
COPY packages/app packages/app
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Stage 2: Build Rust server
# Keep builder and runtime on the same Debian suite so the linked glibc
# version never drifts past what the runtime image provides.
FROM rust:1-slim-bookworm AS builder
RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
RUN cargo build --release --bin webmux-server

# Stage 3: Production
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/webmux-server /usr/local/bin/
COPY --from=frontend /app/packages/app/dist /app/web

ENV WEBMUX_STATIC_DIR=/app/web
ENV DATABASE_PATH=/app/data/tc.db
EXPOSE 4317

CMD ["webmux-server"]
