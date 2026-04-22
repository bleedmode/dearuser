# Negative — Bearer with short token

Our bearer pattern requires 30+ chars. This 20-char example must NOT trigger:

```
Authorization: Bearer abc123def456ghi789jk
```
