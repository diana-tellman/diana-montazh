#!/bin/bash
# Prepares the project automatically in every Claude Code cloud session,
# so students never install Node packages, Remotion or anything else themselves.
# Node.js, ffmpeg/ffprobe and Chromium come preinstalled in the cloud image.
# Speech models are NOT downloaded here: they download on first transcription.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

for tool in node npm ffmpeg ffprobe; do
  if ! command -v "$tool" >/dev/null; then
    echo "session-start: $tool не найден в облачном окружении" >&2
  fi
done

# Install Node packages only when package files (or this script) changed since the last successful install.
hashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  npm ci --no-audit --no-fund --loglevel=error
  sha256sum .claude/hooks/session-start.sh package.json package-lock.json .npmrc > "$hashes"
fi
