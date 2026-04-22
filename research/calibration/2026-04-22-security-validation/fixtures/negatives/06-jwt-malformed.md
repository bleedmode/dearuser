# Negative — malformed JWT-ish tokens

Our validator requires 3 dot-separated parts with middle >= 20 chars. These should fail:

- `eyJhbGciOiJIUzI1NiJ9` — only one segment
- `eyJ.short.signature` — middle too short
- `eyJhbGciOi.eyJzdWIi` — only two parts
