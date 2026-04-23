# Security Policy

## Reporting a vulnerability

If you find a security issue in Dear User, please **do not** open a public GitHub issue.

Instead, report it privately through [GitHub Security Advisories](https://github.com/bleedmode/dearuser/security/advisories/new) or email **rosenlykke@gmail.com**.

Include:
- A description of the issue
- Steps to reproduce (or a proof-of-concept, if you have one)
- The version / commit you tested against
- Your assessment of impact

You can expect an initial acknowledgement within 72 hours. We'll keep you updated as we investigate and coordinate disclosure.

## Scope

Dear User is a local-first MCP server. Most of the tool runs on the user's own machine — the main surfaces worth reporting:

- Secret-detection bypass or false negatives in the `security` tool
- Data leakage in the share flow (`share_report` → `dearuser.ai/r/<token>`)
- Prompt-injection surfaces in the scan output
- Dependency vulnerabilities in the published `dearuser-mcp` package

Out of scope: issues in user-supplied CLAUDE.md content, third-party MCP servers, or Claude Code itself.

## Supported versions

We patch the latest published version of `dearuser-mcp` on npm. Older versions are not backported.
