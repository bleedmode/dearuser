---
name: phantom-caller
description: References an MCP server that isn't registered — should trigger unregistered_mcp_tool.
---

# Phantom caller

Calls `mcp__phantom-server__run` to kick off the nightly report. Also calls `mcp__phantom-server__status` for polling. This skill is broken by design: no MCP server named `phantom-server` is registered anywhere in this fixture's configuration.
