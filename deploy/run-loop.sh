#!/bin/sh
# Regenerates the market every GENERATE_INTERVAL seconds into OUT_DIR.
# A failed run keeps the previously published files untouched.
# Set GENERATE_ONCE=1 to run a single generation and exit (for host cron).
set -u
OUT_DIR="${OUT_DIR:-/site}"
GENERATE_INTERVAL="${GENERATE_INTERVAL:-21600}"

while :; do
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] generation started"
  if node /app/bin/generate.mjs --out "$OUT_DIR"; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] generation finished"
  else
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] generation failed; keeping previous output" >&2
    [ "${GENERATE_ONCE:-0}" = "1" ] && exit 1
  fi
  [ "${GENERATE_ONCE:-0}" = "1" ] && exit 0
  sleep "$GENERATE_INTERVAL"
done
