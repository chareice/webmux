#!/usr/bin/env bash
set -euo pipefail

out_dir="$(dirname "$0")/.generated-certs"
mkdir -p "$out_dir"

openssl req \
  -x509 \
  -nodes \
  -newkey rsa:2048 \
  -sha256 \
  -days 2 \
  -keyout "$out_dir/zellij-ca.key" \
  -out "$out_dir/zellij-ca.crt" \
  -subj "/CN=webmux-e2e-zellij-ca" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  >/dev/null 2>&1

openssl req \
  -nodes \
  -newkey rsa:2048 \
  -sha256 \
  -keyout "$out_dir/zellij-node.key" \
  -out "$out_dir/zellij-node.csr" \
  -subj "/CN=node" \
  -addext "subjectAltName=DNS:node" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" \
  >/dev/null 2>&1

openssl x509 \
  -req \
  -in "$out_dir/zellij-node.csr" \
  -CA "$out_dir/zellij-ca.crt" \
  -CAkey "$out_dir/zellij-ca.key" \
  -CAcreateserial \
  -out "$out_dir/zellij-node.crt" \
  -days 2 \
  -sha256 \
  -extfile <(
    printf '%s\n' \
      'subjectAltName=DNS:node' \
      'basicConstraints=critical,CA:FALSE' \
      'keyUsage=critical,digitalSignature,keyEncipherment' \
      'extendedKeyUsage=serverAuth'
  ) \
  >/dev/null 2>&1

rm -f "$out_dir/zellij-node.csr" "$out_dir/zellij-ca.srl"
