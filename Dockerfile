# Stage 1: Build Flutter Web frontend
FROM ghcr.io/cirruslabs/flutter:3.22.1 AS frontend
WORKDIR /app
COPY packages/flutter_app packages/flutter_app
WORKDIR /app/packages/flutter_app
RUN flutter pub get
RUN flutter build web --release --pwa-strategy=none

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
COPY --from=frontend /app/packages/flutter_app/build/web /app/web

ENV WEBMUX_STATIC_DIR=/app/web
EXPOSE 4317

CMD ["webmux-server"]
