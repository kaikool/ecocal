#!/usr/bin/env bash
set -euo pipefail

: "${GH_REPO:=kaikool/ecocal}"   # có thể override qua env
: "${OUTPUT_DIR:=out}"

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

git fetch origin gh-pages || true
git checkout -B gh-pages

mkdir -p .
cp -r "${OUTPUT_DIR}/." .

git add .
git commit -m "Update FF JSON/ICS $(date -u +'%Y-%m-%dT%H:%M:%SZ')" || echo "No changes"
git push "https://${GH_TOKEN}@github.com/${GH_REPO}.git" gh-pages
