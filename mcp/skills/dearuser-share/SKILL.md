---
name: dearuser:share
description: Generate a public shareable link for the latest Dear User report. Powered by Dear User.
allowed-tools: "mcp__dearuser__share_report, mcp__dearuser__history, Bash"
---

# Dear User — Share

Upload an anonymized copy of a Dear User report to dearuser.ai and return a public URL the user can paste anywhere.

## What to do

1. Figure out WHICH report to share. If the user said a kind (e.g. "share my collab report"), use that. Otherwise default to `collab`.
2. Fetch the latest structured report:
   - Try `mcp__dearuser__history` with `{ "report_type": "<kind>", "format": "json" }` to get the latest stored report as JSON.
   - **If the tool is not available** (first turn):
     ```
     npx -y -p dearuser-mcp dearuser-run history '{"report_type":"<kind>","format":"json"}' 2>/dev/null
     ```
3. Call `mcp__dearuser__share_report` with `{ "report_type": "<kind>", "report_json": <the JSON from step 2> }`.
   - Bash fallback:
     ```
     npx -y -p dearuser-mcp dearuser-run share_report '{"report_type":"<kind>","report_json":<json>}' 2>/dev/null
     ```
4. Show the returned URL prominently and remind the user it's public.

## Rules

- The privacy contract is already enforced server-side: paths collapsed to basenames, emails stripped, secret patterns redacted. Mention this to the user if they ask.
- Do NOT auto-paste the URL into social media, email, or anywhere on the user's behalf — hand it back and let them share.
- If `DEARUSER_SUPABASE_URL` / `DEARUSER_SUPABASE_SERVICE_KEY` are missing, the tool errors — explain that sharing requires those env vars; everything else in Dear User still works locally.
