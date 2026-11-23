apt-get install -y -qq libegl1 libgles2 >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq libegl1 libgles2) || true
for d in */; do
  if grep -q '"diana-mobile-motion-studio"' "$d/package.json" 2>/dev/null; then (cd "$d" && npm ci --no-audit --no-fund --loglevel=error && npm run setup) || true; fi
done
