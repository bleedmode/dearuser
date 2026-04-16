# Dear User

**Your AI agent works for you — but how well do you work together?**

Dear User analyzes your human-agent collaboration and tells you exactly what to fix.

## Monorepo structure

- **`mcp/`** — `dearuser-mcp` npm package. MCP server with analyze, audit, security, onboard, and wrapped tools.
- **`web/`** — `dearuser.ai` landing page + web-facing Wrapped experience (Astro).

## Quick start

```bash
claude mcp add dearuser -- npx dearuser-mcp
```

Then ask your agent: *"Analyze my collaboration with Claude"*

See [`mcp/README.md`](mcp/README.md) for full documentation, multi-client install guides, and tool reference.

## License

MIT
