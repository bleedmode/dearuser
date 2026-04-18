#!/usr/bin/env node
// dashboard-standalone.ts — Dear User dashboard as its own process.
//
// Started by the MCP server (as a detached child that survives MCP exit)
// and also runnable manually: `npx dearuser-dashboard` or
// `node dist/dashboard-standalone.js`.
//
// Why separate from the MCP server: Claude Code sessions come and go, but
// the dashboard should stay up so the user can revisit old reports after
// they've closed the chat. Binding in-process coupled the dashboard's
// lifetime to the MCP process — closing Claude Code 404'd every share URL.
//
// This entry point exists SOLELY to run the dashboard. It opens no MCP
// transport, registers no tools — just starts Hono on the first free port
// in 7700..7710 and blocks forever.

import { startDashboard } from './dashboard.js';

async function main() {
  const url = await startDashboard();
  if (!url) {
    console.error('[dearuser-dashboard] could not bind any port in 7700..7709 — exiting');
    process.exit(1);
  }
  // startDashboard returns immediately once serve() has bound. Hold the
  // process open so the HTTP server keeps accepting connections.
  console.error(`[dearuser-dashboard] ready at ${url}`);

  // Handle graceful shutdown for when launchctl/systemctl/Ctrl-C sends us a
  // SIGTERM. Without this, Node.js stays alive but stops responding cleanly.
  const shutdown = () => {
    console.error('[dearuser-dashboard] shutting down');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Block until a signal arrives. Node keeps running as long as the HTTP
  // server has an open listener — this setInterval is belt-and-braces so
  // the event loop never drains to empty.
  setInterval(() => { /* keep-alive */ }, 1 << 30);
}

main().catch((err) => {
  console.error('[dearuser-dashboard] fatal:', err);
  process.exit(1);
});
