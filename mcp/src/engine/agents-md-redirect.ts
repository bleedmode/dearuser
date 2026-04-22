// agents-md-redirect.ts — R2 (calibration study)
//
// Some repositories use the Linux Foundation AGENTS.md cross-tool standard
// and keep CLAUDE.md as a thin redirect: "See AGENTS.md in the repo root."
// Two of the lowest-5 files in our April 2026 calibration corpus were
// legitimate AGENTS.md redirects that scored 7/100 because our scorer only
// read CLAUDE.md. That penalises authors who followed a good practice.
//
// Fix: if CLAUDE.md is small AND references AGENTS.md, read AGENTS.md and
// swap its content into the slot the parser sees. The downstream scoring
// pipeline (parser, linter, scorer) becomes blind to the redirect — it just
// sees a real agent contract.
//
// Heuristic (kept tight to avoid false positives):
//   • CLAUDE.md < 500 bytes  (redirect files are tiny)
//   • Contains "AGENTS.md" or "agents.md" reference
//   • AGENTS.md exists at the repo root (same directory as CLAUDE.md)

import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import type { ScanResult } from '../types.js';

const SIZE_LIMIT = 500;

export interface AgentsMdRedirect {
  agentsMdPath: string;
  claudeMdSize: number;
}

function looksLikeRedirect(content: string, size: number): boolean {
  if (size >= SIZE_LIMIT) return false;
  return /\bAGENTS\.md\b/i.test(content);
}

function findAgentsMd(claudeMdPath: string): string | null {
  const dir = dirname(claudeMdPath);
  for (const name of ['AGENTS.md', 'agents.md']) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Mutate scanResult in place: if CLAUDE.md (project or global) is a trivial
 * AGENTS.md redirect, replace its content with AGENTS.md's content so the
 * rest of the pipeline scores what the user actually wrote.
 *
 * Returns a description of the redirect so the tool output can tell the user
 * "we scored AGENTS.md instead" — transparency matters, especially when the
 * score jumps because of a redirect follow.
 */
export function followAgentsMdRedirect(scanResult: ScanResult): AgentsMdRedirect | undefined {
  // Try project CLAUDE.md first (project scope), then global.
  const candidates = [scanResult.projectClaudeMd, scanResult.globalClaudeMd]
    .filter((f): f is NonNullable<typeof f> => f !== null);

  for (const file of candidates) {
    if (!looksLikeRedirect(file.content, file.size)) continue;
    const agentsMdPath = findAgentsMd(file.path);
    if (!agentsMdPath) continue;

    try {
      const content = readFileSync(agentsMdPath, 'utf8');
      const size = statSync(agentsMdPath).size;
      const originalSize = file.size;

      // Swap in-place: downstream parser + scorer read from this slot.
      file.content = content;
      file.size = size;

      return { agentsMdPath, claudeMdSize: originalSize };
    } catch {
      continue;
    }
  }

  return undefined;
}
