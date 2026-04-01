#!/bin/sh
set -e
# The named volume static_files is mounted at /app/app/static, which hides the
# files baked into the image. Without this sync, `docker compose up --build`
# would still show the old UI until the volume was removed (ex. via prune).
if [ -d /opt/opus-ui ] && [ -n "$(ls -A /opt/opus-ui 2>/dev/null)" ]; then
  mkdir -p /app/app/static
  if [ -w /app/app/static ]; then
    find /app/app/static -mindepth 1 -delete 2>/dev/null || true
    cp -rf /opt/opus-ui/. /app/app/static/ || true
  else
    echo "WARN: /app/app/static is not writable; skipping UI sync."
  fi
fi
exec "$@"
