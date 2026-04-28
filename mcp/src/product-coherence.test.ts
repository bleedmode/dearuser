// product-coherence.test.ts — fitness function for surfaces that show users
// how to install + use Dear User.
//
// Why this exists: install commands and product names live in 9+ places
// (README, web pages, blog, docs, share layout, wrapped slides). Whenever
// we change one, the others drift silently — the test machine session on
// 2026-04-28 found dearuser.ai serving an outdated `npx @poisedhq/dearuser-mcp`
// command after we'd shipped the `@latest` variant in code. New users got the
// stale flow; we only learned because Jarl's tester complained.
//
// Solution: define the canonical install command in ONE place and assert
// that every public surface contains it. Test fails in CI when drift
// happens, before users see it.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ESM-safe __dirname
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Canonical strings — single source of truth.
// ---------------------------------------------------------------------------

/**
 * The install command we tell users to paste into Claude Code.
 *
 * - `--scope user` so the MCP is available across all projects.
 * - `npx -y` so npx auto-installs without prompting.
 * - `@latest` so npx checks the registry on every Claude Code start
 *   instead of pinning to whatever version was first cached.
 *
 * If you change this, the test will fail across every surface that hasn't
 * been updated — that's the point. Update them all in the same commit.
 */
const CANONICAL_INSTALL = 'claude mcp add --scope user dearuser -- npx -y @poisedhq/dearuser-mcp@latest';

/**
 * Patterns that USED to be the install command but shouldn't appear in any
 * public surface anymore. Catches the common drift: forgetting to update one
 * surface when the canonical command changes.
 *
 * Kept narrow on purpose — \`npx @poisedhq/dearuser-mcp\` literally means
 * "old form without -y/@latest". Internal references (e.g. an inline code
 * snippet in a comment quoting the OLD form for historical context) need
 * to be tagged with the marker comment below to be exempted.
 */
const STALE_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /npx @poisedhq\/dearuser-mcp(?!@latest)(?!\/)/,
    description: '`npx @poisedhq/dearuser-mcp` (without -y or @latest) — pre-1.0.8 form that lets npx pin to a stale cached version',
  },
];

const COHERENCE_EXEMPT_MARKER = 'coherence-exempt:';

// ---------------------------------------------------------------------------
// Surfaces — files where the canonical install command must appear AND no
// stale form may. Keep this list explicit so adding a new public surface
// (a new landing page, a new blog post) is a deliberate decision.
// ---------------------------------------------------------------------------

const SURFACES_THAT_SHOW_INSTALL: string[] = [
  'README.md',
  'mcp/README.md',
  'docs/install.md',
  'docs/launch/social.md',
  'web/src/pages/index.astro',
  'web/src/pages/example.astro',
  'web/src/layouts/ShareLayout.astro',
  'web/src/lib/wrapped-slides.ts',
  'web/src/content/blog/why-we-built-dear-user.md',
];

// ---------------------------------------------------------------------------

interface SurfaceCheck {
  path: string;
  exists: boolean;
  hasCanonical: boolean;
  staleHits: Array<{ pattern: string; line: number; excerpt: string }>;
}

function checkSurface(relativePath: string): SurfaceCheck {
  const fullPath = join(REPO_ROOT, relativePath);
  if (!existsSync(fullPath)) {
    return { path: relativePath, exists: false, hasCanonical: false, staleHits: [] };
  }
  const content = readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n');
  const hasCanonical = content.includes(CANONICAL_INSTALL);

  const staleHits: SurfaceCheck['staleHits'] = [];
  for (const { pattern, description } of STALE_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!pattern.test(line)) continue;
      // Allow exemption via inline marker — for prose explaining the old
      // form, e.g. release notes or the version-check.ts comment that
      // describes why we moved away from the old command.
      const above = i > 0 ? lines[i - 1] : '';
      const inline = line;
      if (above.includes(COHERENCE_EXEMPT_MARKER) || inline.includes(COHERENCE_EXEMPT_MARKER)) continue;
      staleHits.push({
        pattern: description,
        line: i + 1,
        excerpt: line.trim().slice(0, 120),
      });
    }
  }

  return { path: relativePath, exists: true, hasCanonical, staleHits };
}

describe('product coherence', () => {
  describe('install command', () => {
    for (const surface of SURFACES_THAT_SHOW_INSTALL) {
      it(`${surface} — exists and contains the canonical install command`, () => {
        const check = checkSurface(surface);
        expect(check.exists, `surface listed in product-coherence.test.ts but missing on disk: ${surface}`).toBe(true);
        expect(check.hasCanonical, `${surface} doesn't contain the canonical install command. Expected to find:\n  ${CANONICAL_INSTALL}\nUpdate the file or remove it from SURFACES_THAT_SHOW_INSTALL.`).toBe(true);
      });

      it(`${surface} — has no stale install patterns`, () => {
        const check = checkSurface(surface);
        if (!check.exists) return; // covered by previous test
        const summary = check.staleHits.map(h => `  line ${h.line}: ${h.excerpt}\n  reason: ${h.pattern}`).join('\n\n');
        expect(check.staleHits, `${surface} contains a stale install pattern:\n\n${summary}\n\nUpdate to the canonical form, or — if the stale form is being quoted for legitimate reasons (release notes, historical context) — add a "${COHERENCE_EXEMPT_MARKER}" marker on the same line or the line above.`).toEqual([]);
      });
    }
  });
});
