/**
 * MCP Tool Description Quality Tests
 *
 * Validates that all Dear User tool descriptions follow MCP best practices:
 * - Purpose: clearly states what the tool does
 * - Guidelines: explains when/how to use it
 * - Limitations: what the tool does NOT do
 * - Parameter docs: all parameters have descriptions
 * - Adequate length: not too short, not too long
 * - Examples: usage examples in description (TODO — being added separately)
 *
 * These tests extract tool definitions via the MCP protocol (tools/list)
 * to test what agents actually see — not our source code.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    properties?: Record<string, { description?: string }>;
    required?: string[];
  };
}

let tools: ToolDef[] = [];

beforeAll(async () => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
  });
  const client = new Client({ name: 'test', version: '1.0' });
  await client.connect(transport);
  const result = await client.listTools();
  tools = result.tools as ToolDef[];
  await client.close();
}, 15000);

describe('MCP tool descriptions', () => {
  const EXPECTED_TOOLS = ['collab', 'health', 'history', 'onboard', 'security', 'wrapped', 'help'];

  it('all expected tools are registered', () => {
    const names = tools.map(t => t.name);
    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected);
    }
  });

  describe.each(EXPECTED_TOOLS)('%s', (toolName) => {
    let tool: ToolDef;

    beforeAll(() => {
      tool = tools.find(t => t.name === toolName)!;
    });

    // --- Purpose ---
    it('has a description (purpose)', () => {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
    });

    // --- Adequate length ---
    it('description is between 50 and 2000 chars', () => {
      expect(tool.description.length).toBeGreaterThanOrEqual(50);
      expect(tool.description.length).toBeLessThanOrEqual(2000);
    });

    // --- Guidelines ---
    it('description explains what it does in the first sentence', () => {
      const firstSentence = tool.description.split(/[.!]\s/)[0];
      // First sentence should be substantive (not just "A tool" or "This tool")
      expect(firstSentence.length).toBeGreaterThan(15);
    });

    // --- Parameter docs ---
    it('all parameters have descriptions', () => {
      const props = tool.inputSchema?.properties || {};
      for (const [paramName, paramDef] of Object.entries(props)) {
        expect(paramDef.description, `parameter "${paramName}" missing description`).toBeTruthy();
        expect(paramDef.description!.length, `parameter "${paramName}" description too short`).toBeGreaterThan(5);
      }
    });
  });

  // --- Specific tool requirements ---
  describe('collab-specific', () => {
    it('documents the format parameter options', () => {
      const tool = tools.find(t => t.name === 'collab')!;
      expect(tool.description).toContain('text');
      expect(tool.description).toContain('detailed');
      expect(tool.description).toContain('json');
    });

    it('mentions that data stays local', () => {
      const tool = tools.find(t => t.name === 'collab')!;
      const desc = tool.description.toLowerCase();
      expect(desc).toMatch(/local|no data leaves|never modified/);
    });
  });

  describe('health-specific', () => {
    it('lists detection capabilities', () => {
      const tool = tools.find(t => t.name === 'health')!;
      expect(tool.description).toContain('Orphan');
      expect(tool.description).toContain('Overlap');
    });
  });

  describe('security-specific', () => {
    it('mentions what it scans for', () => {
      const tool = tools.find(t => t.name === 'security')!;
      const desc = tool.description.toLowerCase();
      expect(desc).toMatch(/secret|injection|leak/);
    });
  });
});
