#!/bin/bash
# Wait for expand + substrate to finish, then run metadata + content + scoring.
set -e
cd "$(dirname "$0")"

echo "[$(date)] waiting for expand..."
while pgrep -f fetch-expand > /dev/null; do sleep 30; done
echo "[$(date)] expand done. candidates.jsonl: $(wc -l < data/candidates.jsonl)"

echo "[$(date)] waiting for substrate (initial)..."
while pgrep -f "fetch.ts substrate" > /dev/null; do sleep 30; done

# Re-run substrate so any candidates added by expand after stage started get walked.
echo "[$(date)] re-running substrate for any new candidates..."
npx tsx fetch.ts substrate 2>&1 | tee -a substrate.log

echo "[$(date)] running metadata..."
npx tsx fetch.ts metadata 2>&1 | tee metadata.log

echo "[$(date)] running content..."
npx tsx fetch.ts content 2>&1 | tee content.log

echo "[$(date)] running scoring..."
npx tsx score-corpus.ts 2>&1 | tee score.log

echo "[$(date)] ALL DONE"
wc -l data/*.jsonl
