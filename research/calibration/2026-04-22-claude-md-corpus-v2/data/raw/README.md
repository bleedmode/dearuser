# Raw corpus files not committed

The 2,895 fetched CLAUDE.md files (~60MB) are not committed to the repo — only the manifest (with repo slug, path, stars, content hash, size) and scores.

Re-fetch them with:
```bash
node research/calibration/2026-04-22-claude-md-corpus-v2/fetch.mjs content
```

This reads `data/manifest.jsonl` and re-downloads the files to `data/raw/`. Content hashes in the manifest let you verify byte-for-byte reproducibility.
