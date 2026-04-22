# Test fixture — .env-style API_KEY

Category: env_secret
Expected: recommended

Planted secret:

```
SENDGRID_API_KEY=SG.abc123def456ghi789jkl012mno345pqr678stu901vwx234yz
```

Note: SendGrid has a dedicated `SG.` prefix pattern in industry scanners. Our scanner catches it via the generic `env_secret` rule but misses the vendor-specific classification.
