# Test fixture — Vercel token

Category: vercel_token
Expected: NONE (pattern disabled in production)

Planted secret (synthetic; Vercel tokens are 24 char alnum):

```
VERCEL_TOKEN=aBcDeFgHiJkLmNoPqRsTuVwX
```

Note: Dear User's `vercel_token` pattern is defined but `validate: () => false` disables it — too many false positives on 24-char strings. This fixture documents that the category is tracked-but-disabled; it should NOT trigger.
