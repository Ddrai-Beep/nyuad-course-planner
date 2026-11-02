#!/usr/bin/env bash
# One-time setup for the free Cloudflare Worker. Needs Node 18+.
# Run from the repo root:  bash worker/setup.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "1/4  Logging in to Cloudflare (a browser window will open)…"
npx --yes wrangler@3 login

echo "2/4  Creating the database…"
OUT=$(npx --yes wrangler@3 d1 create nyuad-planner-votes 2>&1 || true)
ID=$(echo "$OUT" | grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
if [ -z "$ID" ]; then
  ID=$(npx --yes wrangler@3 d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).find(x=>x.name==="nyuad-planner-votes");console.log(d?d.uuid:"")})')
fi
[ -n "$ID" ] || { echo "Couldn't get the database id. Output was:"; echo "$OUT"; exit 1; }
sed -i.bak "s/database_id = \".*\"/database_id = \"$ID\"/" wrangler.toml && rm -f wrangler.toml.bak

echo "3/4  Creating the table…"
npx --yes wrangler@3 d1 execute nyuad-planner-votes --remote --file=schema.sql

echo "4/4  Deploying…"
npx --yes wrangler@3 deploy | tee /tmp/deploy.log
URL=$(grep -Eo 'https://[a-zA-Z0-9.-]+\.workers\.dev' /tmp/deploy.log | head -1)
if [ -n "$URL" ]; then
  sed -i.bak "s#WORKER_URL = '.*'#WORKER_URL = '$URL'#" ../config.js && rm -f ../config.js.bak
  echo ""
  echo "Done. Worker live at $URL. config.js updated. Commit and push to switch it on:"
  echo "  git add -A && git commit -m 'Connect worker' && git push"
fi
