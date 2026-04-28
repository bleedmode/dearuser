# Install Dear User

Dear User is an **MCP server** — Model Context Protocol is the plugin system Claude Code, Claude Desktop and other AI clients use to add tools. You install it once per client.

No global npm install needed. The command below fetches the `@poisedhq/dearuser-mcp` package via `npx` and wires it up.

## Prerequisites

- Node.js 18 or newer (`node --version` should print `v18.x` or higher)
- One of the supported clients installed:
  - Claude Code (CLI or VS Code/JetBrains extension)
  - Claude Desktop
  - Cursor, Windsurf, Cline, or Zed

If you don't have Node, install it from [nodejs.org](https://nodejs.org) or via your package manager (`brew install node`, `winget install OpenJS.NodeJS`, etc.).

## Claude Code (CLI)

```bash
claude mcp add --scope user dearuser -- npx -y @poisedhq/dearuser-mcp@latest
```

Restart Claude Code afterwards so the tools appear, then open any project with Claude Code and ask:

```
Analyze my collaboration with Claude
```

Optional — install the slash commands (`/dearuser-collab`, `/dearuser-security`, `/dearuser-health`, `/dearuser-onboard`, `/dearuser-wrapped`, `/dearuser-history`, `/dearuser-help`, `/dearuser-feedback`):

```bash
npx -p @poisedhq/dearuser-mcp dearuser-install-skills
```

Restart Claude Code for slash commands to appear.

## Claude Code (VS Code / JetBrains extension)

1. Open the extension's settings
2. Go to **MCP Servers** → **Add Server**
3. Paste:

```json
{
  "dearuser": {
    "command": "npx",
    "args": ["@poisedhq/dearuser-mcp"]
  }
}
```

## Claude Desktop

Edit the Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Add (or merge into existing `mcpServers`):

```json
{
  "mcpServers": {
    "dearuser": {
      "command": "npx",
      "args": ["@poisedhq/dearuser-mcp"]
    }
  }
}
```

Restart Claude Desktop.

## Cursor

Create or edit `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "dearuser": {
      "command": "npx",
      "args": ["@poisedhq/dearuser-mcp"]
    }
  }
}
```

## Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "dearuser": {
      "command": "npx",
      "args": ["@poisedhq/dearuser-mcp"]
    }
  }
}
```

## Cline (VS Code)

Open the Cline MCP settings panel and add:

```json
{
  "dearuser": {
    "command": "npx",
    "args": ["@poisedhq/dearuser-mcp"]
  }
}
```

## Zed

Edit Zed's `settings.json`:

```json
{
  "context_servers": {
    "dearuser": {
      "command": {
        "path": "npx",
        "args": ["@poisedhq/dearuser-mcp"]
      }
    }
  }
}
```

## Dashboard (optional)

Dear User ships a read-only localhost dashboard that reads from `~/.dearuser/dearuser.db`. Launch it with:

```bash
npx -p @poisedhq/dearuser-mcp dearuser-dashboard
```

It starts on `http://localhost:7700` (or the next open port up to 7709).

## Platform advisors (optional, for `security`)

The `security` tool can pull findings from Supabase, GitHub, npm and Vercel if you give it tokens. All optional — what you don't configure is skipped cleanly.

See [`setup/README.md`](setup/README.md) for per-platform guides.

## Common failure modes

**`command not found: claude`** — you don't have Claude Code's CLI installed. Install from [claude.com/code](https://claude.com/code), or use the Claude Desktop instructions above.

**`npx -y @poisedhq/dearuser-mcp@latest` hangs** — first run downloads the package; can take 30-60s on slow connections. Subsequent runs are instant (npx caches).

**Tools don't appear in the client** — restart the client after adding the MCP server. Claude Code picks up new servers on launch.

**"No module found: better-sqlite3"** — your Node version may be too old, or your npm cache is corrupt. Try `node --version` (need 18+) and `npx --yes @poisedhq/dearuser-mcp` to force a fresh fetch.

**Permission errors writing to `~/.dearuser/`** — Dear User stores its local DB there. Make sure your home folder is writable: `mkdir -p ~/.dearuser && chmod 700 ~/.dearuser`.

**Slash commands don't appear** — run `npx -p @poisedhq/dearuser-mcp dearuser-install-skills`, then restart the client. Slash commands live in `~/.claude/skills/` and are loaded at startup.

**Dashboard won't start / port 7700 taken** — something else is using the port. Dear User probes 7700-7709. Free one of them, or check `lsof -ti:7700` (macOS/Linux) to see what's holding it.

## Uninstall

```bash
claude mcp remove dearuser
```

Delete the local database if you want to start clean:

```bash
rm -rf ~/.dearuser/
```

Remove the slash commands:

```bash
rm -rf ~/.claude/skills/dearuser-*
```

That's it — no global packages, no system services, nothing else left behind.
