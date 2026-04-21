// audit-graph — extract relational edges between artifacts.
//
// Produces edges: artifact writes to a path
// Consumes edges: artifact reads from a path
// References edges: artifact mentions another artifact by name
// Similar_to edges: two artifacts have similar descriptions (possible overlap)
//
// Heuristic-based. Expect some false positives — keep thresholds conservative.

import type { AuditArtifact, AuditEdge, AuditGraph } from '../types.js';

// ============================================================================
// Produces / consumes path extraction
// ============================================================================

/**
 * Extract file-ish paths that an artifact *writes to*.
 * Patterns we match:
 *   - explicit redirects: `> /path/to/file`, `>> /path/to/file`
 *   - mv/cp destination: `mv src /dest`, `cp src /dest`
 *   - verbs in prose: "writes to X", "saves to X", "creates X", "appends to X", "updates X"
 *   - file extensions: .json, .md, .jsonl, .csv, .log, .txt (filter out generic words)
 */
export function extractProducedPaths(prompt: string): string[] {
  const paths = new Set<string>();

  // Shell redirect (unescaped > or >>)
  for (const m of prompt.matchAll(/(?<![-<])(>>?)\s+([^\s|&;`"']{2,200})/g)) {
    const p = m[2].trim();
    if (looksLikePath(p)) paths.add(normalizePath(p));
  }

  // tee -a file
  for (const m of prompt.matchAll(/\btee(?:\s+-a)?\s+([^\s|&;`"']+)/g)) {
    const p = m[1].trim();
    if (looksLikePath(p)) paths.add(normalizePath(p));
  }

  // Prose write-verbs — match verb + up to a few words + a path
  // "writes to ~/foo.json", "saves to cache/scan.json", "appends to memory/X.md"
  const writeVerbs = /\b(writes?|saves?|creates?|appends?|updates?|persists?|stores?|outputs?|emits?|logs?|skriver|gemmer|opretter)\s+(?:to\s+|til\s+)?[`"']?([^\s`"'\n,;)\]]+)[`"']?/gi;
  for (const m of prompt.matchAll(writeVerbs)) {
    const p = m[2].trim();
    if (looksLikePath(p)) paths.add(normalizePath(p));
  }

  // Python/JS file-write API
  for (const m of prompt.matchAll(/(?:writeFileSync|writeFile|fs\.write|open\s*\(\s*["']([^"']+)["']\s*,\s*["']?[wa])/g)) {
    if (m[1] && looksLikePath(m[1])) paths.add(normalizePath(m[1]));
  }

  // `-o outfile` / `--output outfile` common CLI patterns
  for (const m of prompt.matchAll(/(?:^|\s)(?:-o|--output|--out)\s+([^\s|&;`"']+)/g)) {
    const p = m[1].trim();
    if (looksLikePath(p)) paths.add(normalizePath(p));
  }

  return Array.from(paths);
}

/**
 * Extract file-ish paths that an artifact *reads from*.
 */
export function extractConsumedPaths(prompt: string): string[] {
  const paths = new Set<string>();

  // cat / less / head / tail / read
  for (const m of prompt.matchAll(/\b(?:cat|less|more|head|tail|readFileSync|readFile|fs\.read)\s+(?:-\w+\s+)*([^\s|&;`"']{2,200})/g)) {
    const p = m[1].trim();
    if (looksLikePath(p) && !p.startsWith('-')) paths.add(normalizePath(p));
  }

  // Prose read-verbs
  const readVerbs = /\b(reads?|loads?|scans?|checks?|opens?|parses?|consumes?|monitors?|watches?|læser|indlæser|tjekker|scanner)\s+(?:from\s+|fra\s+)?[`"']?([^\s`"'\n,;)\]]+)[`"']?/gi;
  for (const m of prompt.matchAll(readVerbs)) {
    const p = m[2].trim();
    if (looksLikePath(p)) paths.add(normalizePath(p));
  }

  // find path -name X (the path is being read/scanned)
  for (const m of prompt.matchAll(/\bfind\s+([^\s|&;`"']+)/g)) {
    const p = m[1].trim();
    if (looksLikePath(p)) paths.add(normalizePath(p));
  }

  // grep PATTERN path
  for (const m of prompt.matchAll(/\bgrep\s+(?:-\w+\s+)*["'][^"']+["']\s+([^\s|&;`"']+)/g)) {
    const p = m[1].trim();
    if (looksLikePath(p)) paths.add(normalizePath(p));
  }

  // Input redirect `< file`
  for (const m of prompt.matchAll(/(?:^|[^<])<\s+([^\s|&;`"']{2,200})/g)) {
    const p = m[1].trim();
    if (looksLikePath(p)) paths.add(normalizePath(p));
  }

  return Array.from(paths);
}

/**
 * Path heuristic — keep edges meaningful by filtering out obvious non-paths.
 * A path must look like a path and not be a generic English word.
 */
function looksLikePath(s: string): boolean {
  if (!s || s.length < 3 || s.length > 300) return false;
  // Reject currency/number patterns that start with $ or ~ followed by digits
  if (/^[$]/.test(s)) return false;
  if (/^~\d/.test(s)) return false;
  // Reject pure numbers or percentages
  if (/^\d+([.,]\d+)?[%KkMmBb]?$/.test(s)) return false;
  // Has a slash (absolute or relative)
  if (s.includes('/') || s.startsWith('~/') || s.startsWith('./')) {
    // Not just a URL
    if (s.startsWith('http://') || s.startsWith('https://')) return false;
    // Not a glob-only pattern like "**/*.js" — that's too generic
    if (s.startsWith('**') || s === '*' || s === '*/') return false;
    return true;
  }
  // Has a recognisable extension
  if (/\.(json|jsonl|md|mdc|csv|tsv|log|txt|yaml|yml|sqlite|db|sql)$/i.test(s)) {
    // But not something like "this.is" or "index.md" without context
    // Allow if it has a hyphen or underscore (suggests a real filename)
    if (/[-_/]/.test(s) || s.length > 15) return true;
    return false;
  }
  return false;
}

/**
 * Normalise a path for comparison:
 *   - strip surrounding quotes
 *   - strip trailing punctuation
 *   - expand `~` relative to user home (for comparison only)
 *   - collapse duplicate slashes
 */
function normalizePath(p: string): string {
  let out = p.trim();
  // Strip surrounding quotes/backticks
  out = out.replace(/^["'`]+|["'`]+$/g, '');
  // Strip trailing punctuation
  out = out.replace(/[.,;:!?)\]}>]+$/, '');
  // Collapse duplicate slashes
  out = out.replace(/\/+/g, '/');
  return out;
}

// ============================================================================
// Description similarity (for overlap detection)
// ============================================================================

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'this', 'that', 'these', 'those', 'i', 'you',
  'he', 'she', 'it', 'we', 'they', 'your', 'my', 'our', 'their', 'its',
  'og', 'eller', 'men', 'i', 'på', 'at', 'til', 'for', 'af', 'med',
  'den', 'det', 'der', 'de', 'som', 'en', 'et', 'du', 'vi', 'skal',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\såæø]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

/** Jaccard similarity between token sets. 0-1. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) if (b.has(tok)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ============================================================================
// Edge building
// ============================================================================

export function buildEdges(artifacts: AuditArtifact[]): AuditEdge[] {
  const edges: AuditEdge[] = [];
  const artifactsByName = new Map<string, AuditArtifact>();
  for (const a of artifacts) {
    artifactsByName.set(a.name.toLowerCase(), a);
  }

  // Precompute tokens once per artifact for similarity
  const tokens = new Map<string, Set<string>>();
  for (const a of artifacts) {
    // Combine description + first 500 chars of prompt for similarity
    tokens.set(a.id, tokenize(`${a.description} ${a.prompt.slice(0, 500)}`));
  }

  for (const artifact of artifacts) {
    // Memory files don't "run" — skip produces/consumes for them (but they
    // are still targets of produces edges from other artifacts).
    if (artifact.type !== 'memory_file') {
      // Produces edges — prompt describes paths this artifact writes
      for (const path of extractProducedPaths(artifact.prompt)) {
        edges.push({
          from: artifact.id,
          to: path,
          type: 'produces',
          evidence: `${artifact.name} writes to ${path}`,
        });
      }
      // Consumes edges
      for (const path of extractConsumedPaths(artifact.prompt)) {
        edges.push({
          from: artifact.id,
          to: path,
          type: 'consumes',
          evidence: `${artifact.name} reads ${path}`,
        });
      }

      // References edges — prompt mentions another artifact's name
      for (const [name, target] of artifactsByName) {
        if (target.id === artifact.id) continue;
        if (name.length < 4) continue; // too generic (e.g., "ship")
        // Word-boundary check on the name
        const re = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i');
        if (re.test(artifact.prompt)) {
          edges.push({
            from: artifact.id,
            to: target.id,
            type: 'references',
            evidence: `${artifact.name} mentions ${target.name}`,
          });
        }
      }
    }
  }

  // Similar-to edges — only between artifacts of same type or skill↔scheduled_task
  for (let i = 0; i < artifacts.length; i++) {
    for (let j = i + 1; j < artifacts.length; j++) {
      const a = artifacts[i];
      const b = artifacts[j];
      if (a.type === 'memory_file' || b.type === 'memory_file') continue;
      if (a.type === 'mcp_server' || b.type === 'mcp_server') continue;
      if (a.type === 'hook' || b.type === 'hook') continue;

      // Same type, or skill/scheduled_task/command cross-type (they all drive behavior)
      const comparableTypes = new Set(['skill', 'scheduled_task', 'command']);
      if (a.type !== b.type && !(comparableTypes.has(a.type) && comparableTypes.has(b.type))) continue;

      const sim = jaccard(tokens.get(a.id) || new Set(), tokens.get(b.id) || new Set());
      if (sim >= 0.4) {
        edges.push({
          from: a.id,
          to: b.id,
          type: 'similar_to',
          evidence: `Jaccard similarity: ${sim.toFixed(2)}`,
        });
      }
    }
  }

  return edges;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build the full graph from an artifact list. */
export function buildGraph(artifacts: AuditArtifact[]): AuditGraph {
  return {
    nodes: artifacts,
    edges: buildEdges(artifacts),
  };
}
