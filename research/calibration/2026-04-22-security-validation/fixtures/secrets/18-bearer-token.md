# Test fixture — Bearer token in HTTP header

Category: bearer_token
Expected: recommended

Planted secret:

```
fetch('/api/resource', {
  headers: {
    'Authorization': 'Bearer abcdef1234567890ABCDEF1234567890zzzz.aaaa.bbbb'
  }
})
```
