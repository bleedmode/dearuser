---
name: stale-watcher
description: Hourly watcher — intentionally stale in fixture (lastRunAt set to 30 days ago).
---

# Stale watcher

Scheduled task that should run every hour. Writes to `/tmp/watcher-heartbeat.txt` which downstream tooling reads (consumer exists via pattern-match). Used in the fixture to exercise the `stale_schedule` detector: cron is set, enabled=true, but lastRunAt is ancient.

Consumes `/tmp/watcher-heartbeat.txt`.
