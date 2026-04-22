import { describe, it, expect } from 'vitest';
import { lintClaudeMd } from './lint-checks.js';
import type { ParseResult, ScanResult } from '../types.js';

function scan(content: string): ScanResult {
  return {
    scope: 'project',
    scanRoots: [],
    globalClaudeMd: null,
    projectClaudeMd: {
      path: '/tmp/fake-CLAUDE.md',
      content,
      size: content.length,
    },
    memoryFiles: [],
    settingsFiles: [],
    hooksCount: 0,
    skillsCount: 0,
    scheduledTasksCount: 0,
    commandsCount: 0,
    mcpServersCount: 0,
    installedServers: [],
    competingFormats: { cursorrules: false, agentsMd: false, copilotInstructions: false },
    projectsObserved: 1,
  };
}

const emptyParsed: ParseResult = { rules: [], sections: [], learnings: [], projectCount: 0 };

describe('empty_section lint (R4 calibration suppressions)', () => {
  it('does NOT flag a convention-named Overview section with only sub-headings underneath', () => {
    const md = `# My Project

## Overview

### Background

Some background prose.

### Goals

Goal prose.
`;
    const result = lintClaudeMd(scan(md), emptyParsed);
    const hits = result.findings.filter(f => f.check === 'empty_section');
    // The ## Overview and other conventional headers should pass through.
    expect(hits.filter(h => /overview/i.test(h.title)).length).toBe(0);
  });

  it('does NOT flag Table of Contents', () => {
    const md = `# Project

## Table of Contents

- [Section 1](#s1)
- [Section 2](#s2)

## Section 1

Content.
`;
    const result = lintClaudeMd(scan(md), emptyParsed);
    const hits = result.findings.filter(f => f.check === 'empty_section');
    expect(hits.filter(h => /table of contents/i.test(h.title)).length).toBe(0);
  });

  it('DOES still flag truly empty non-convention sections', () => {
    const md = `# Project

## Setup

## Configuration

We configure things here.
`;
    const result = lintClaudeMd(scan(md), emptyParsed);
    const hits = result.findings.filter(f => f.check === 'empty_section');
    expect(hits.some(h => /setup/i.test(h.title))).toBe(true);
  });
});
