# Test fixture — Anthropic key inline in settings.json-shaped snippet

Category: anthropic_key
Expected: critical

```json
{
  "mcpServers": {
    "some-server": {
      "command": "node",
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-api03-ZZzzYYyyXXxxWWwwVVvvUUuuTTttSSssRRrrQQqqPPppOOooNNnnMMmm"
      }
    }
  }
}
```
