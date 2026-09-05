#!/bin/sh
# Fails if anything under src/ could talk to the network. agtc is read-only and
# offline by design; this keeps that promise visible in CI and easy to re-check.
set -eu
cd "$(dirname "$0")/.."
pattern='fetch\(|https?://|node:(net|http|https|http2|tls|dgram|dns)|WebSocket|Bun\.(serve|connect|listen|fetch|udpSocket)|XMLHttpRequest|EventSource'
if hits=$(grep -rnE "$pattern" src); then
  echo "network access found in src/:"
  echo "$hits"
  exit 1
fi
echo "ok: no network access in src/"
