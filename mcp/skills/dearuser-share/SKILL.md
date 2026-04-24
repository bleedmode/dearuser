---
name: dearuser:share
description: Generate a public shareable link for the latest Dear User report. Powered by Dear User.
allowed-tools: "mcp__dearuser__share_report, mcp__dearuser__history, Bash"
---

# Dear User — Share

Upload an anonymized copy of a Dear User report to dearuser.ai and return a public URL the user can paste anywhere.

## What to do

1. Figure out WHICH report to share. If the user said a kind (e.g. "share my collab report"), use that. Otherwise default to `collab`. Allowed kinds: `collab`, `health`, `security`, `wrapped`.
2. Fetch the latest structured report as JSON:
   - Try `mcp__dearuser__history` with `{ "scope": "<kind>", "format": "json" }`. The returned text is the raw JSON string of the latest stored report for that scope.
   - **If the tool is not available** (first turn):
     ```
     npx -y -p dearuser-mcp dearuser-run history '{"scope":"<kind>","format":"json"}'
     ```
   - If the response is `{"error":"..."}`, surface the error to the user and stop — typically it means no stored report exists yet (run `/dearuser-<kind>` first).
3. Parse the returned text as JSON, then call `mcp__dearuser__share_report` with `{ "report_type": "<kind>", "report_json": <parsed object> }`.
   - Bash fallback (pipe the report JSON via stdin so content with apostrophes or quotes doesn't break shell quoting):
     ```
     jq -n --argjson rpt "$(cat /tmp/du-report.json)" --arg kind "<kind>" '{report_type:$kind, report_json:$rpt}' \
       | npx -y -p dearuser-mcp dearuser-run share_report -
     ```
     Save the history response to `/tmp/du-report.json` first (step 2), then run the above.
4. Show the returned URL prominently and remind the user it's public.

## Rules

- The privacy contract is enforced client-side before upload: paths collapsed to basenames, emails stripped, secret patterns redacted — nothing sensitive leaves the machine. Mention this to the user if they ask.
- Do NOT auto-paste the URL into social media, email, or anywhere on the user's behalf — hand it back and let them share.
- If `DEARUSER_SUPABASE_URL` / `DEARUSER_SUPABASE_SERVICE_KEY` are missing, the tool errors — explain that sharing requires those env vars; everything else in Dear User still works locally.
- If any tool returns an error, show the error text — the share was NOT completed.
