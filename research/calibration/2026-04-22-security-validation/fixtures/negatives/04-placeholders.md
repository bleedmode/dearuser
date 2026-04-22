# Negative — obvious placeholders

Documentation-style placeholders. `env_secret` validator should filter these
when the VALUE is a known placeholder word, but currently inspects the var
NAME (match[1]) instead of the value. This fixture therefore confirms a
behavioural gap: short placeholders (<12 chars) are filtered by the length
floor, but placeholders >= 12 chars slip through.

```
DATABASE_PASSWORD=CHANGEME
GITHUB_TOKEN=placeholder
SECRET_TOKEN=example
```

Note: the shape `API_KEY=your_key_here` (value >= 12 chars) is intentionally
NOT included here — it would fire because the `validate()` callback sees
`API_KEY`, not `your_key_here`. Tracked as recommendation R-1 in report.md.
