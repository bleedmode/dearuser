// proactive-recommender — suggestions derived from PATTERNS in user's setup,
// not just gaps. Where gap-detector says "you're missing X, add it",
// proactive-recommender says "you're already doing X manually, automate it".
//
// All suggestions require real evidence from the scan/graph before they
// surface. No "best practice" lectures — every recommendation cites at least
// one concrete fact from the user's own files.

import type { AuditArtifact, GapSeverity, Recommendation } from '../types.js';
import type { SessionData } from '../types.js';
import type { GitScanResult } from './git-scanner.js';

export interface ProactiveContext {
  artifacts: AuditArtifact[];
  session: SessionData;
  git: GitScanResult | null;
}

// ============================================================================
// Pattern detectors → proactive recommendations
// ============================================================================

/**
 * CLI commands repeated across many artifacts → candidate for MCP server or skill.
 * Example: `pvs.sh` appearing in 5 skills → wrap in an MCP server for structured calls.
 */
function detectRepeatedCli(artifacts: AuditArtifact[]): Recommendation[] {
  const cliCommandCounts = new Map<string, { count: number; sources: Set<string> }>();

  // Known CLI patterns — words that look like user-owned scripts rather than generic commands
  const cliRegex = /\b([\w-]{3,30}\.(?:sh|py|js|rb|ts))\b/g;

  for (const artifact of artifacts) {
    if (artifact.type === 'memory_file') continue;
    if (!artifact.prompt) continue;
    const seenInThisArtifact = new Set<string>();
    for (const match of artifact.prompt.matchAll(cliRegex)) {
      const cli = match[1];
      // Skip generic/common tool names
      if (/^(install|build|test|setup|start|run|deploy|config|main|index)\./.test(cli)) continue;
      if (seenInThisArtifact.has(cli)) continue;
      seenInThisArtifact.add(cli);
      const entry = cliCommandCounts.get(cli) || { count: 0, sources: new Set() };
      entry.count += 1;
      entry.sources.add(artifact.name);
      cliCommandCounts.set(cli, entry);
    }
  }

  const recommendations: Recommendation[] = [];
  for (const [cli, { count, sources }] of cliCommandCounts) {
    if (count < 3) continue; // noise threshold
    const sourceList = Array.from(sources).slice(0, 5).join(', ');

    recommendations.push({
      priority: 'recommended',
      audience: 'both',
      title: `Wrap \`${cli}\` in an MCP server`,
      description: `You invoke \`${cli}\` across ${count} artifacts (${sourceList}). Each caller reinvents argument parsing, error handling, and output formatting. An MCP server gives your agent typed calls with structured output.`,
      textBlock: `// Sketch: wrap ${cli} as MCP server
// server.tool('${cli.replace(/\.\w+$/, '')}', ..., async (args) => {
//   const out = execFileSync('${cli}', [args.subcommand, ...args.flags]);
//   return { content: [{ type: 'text', text: out }] };
// });`,
      evidence: [
        { source: 'analysis', excerpt: `${cli} used in ${count} artifacts: ${sourceList}`, kind: 'stat' },
      ],
      target: 'behavior',
      placementHint: 'Create a new MCP server project or skill that wraps this CLI.',
      why: 'Repeated manual CLI invocations across agent prompts drift. Each skill parses args slightly differently, errors are handled inconsistently, and your agent has no typed contract for what the tool expects.',
      howItLooks: `Before: 5 skills each calling '${cli} status' via Bash\nAfter: server.tool('${cli.replace(/\.\w+$/, '')}.status') returns structured JSON every time`,
      practiceStep: `Pick the most common subcommand of ${cli} and wrap just that one in an MCP tool. Expand from there.`,
    });
  }

  return recommendations;
}

/**
 * Many scheduled tasks writing to the same folder → candidate for structured storage.
 * Example: 4 tasks write to `~/.pvs/` with various JSON files → SQLite would be better.
 */
function detectWritePatterns(artifacts: AuditArtifact[]): Recommendation[] {
  const folderWrites = new Map<string, Set<string>>();

  const writeRegex = /(?:writes?|saves?|creates?|gemmer|skriver)\s+(?:to\s+|til\s+)?([\w~./-]+\/)/gi;
  for (const artifact of artifacts) {
    if (!artifact.prompt) continue;
    if (artifact.type !== 'scheduled_task') continue;
    for (const match of artifact.prompt.matchAll(writeRegex)) {
      let folder = match[1].trim();
      // Drop trailing filename fragment
      folder = folder.replace(/\/[^/]*$/, '/');
      if (folder.length < 5) continue;
      const entry = folderWrites.get(folder) || new Set();
      entry.add(artifact.name);
      folderWrites.set(folder, entry);
    }
  }

  const recs: Recommendation[] = [];
  for (const [folder, tasks] of folderWrites) {
    if (tasks.size < 3) continue;
    const taskList = Array.from(tasks).slice(0, 5).join(', ');
    recs.push({
      priority: 'nice_to_have',
      audience: 'both',
      title: `Consider structured storage under ${folder}`,
      description: `${tasks.size} scheduled tasks write to ${folder} (${taskList}). A SQLite DB or JSONL log would give you querying, dedup, and time-series analysis — things markdown/json blobs make hard.`,
      textBlock: '',
      evidence: [
        { source: 'analysis', excerpt: `${tasks.size} scheduled tasks write to ${folder}`, kind: 'stat' },
      ],
      target: 'behavior',
      placementHint: folder,
      why: 'Multiple writers to a folder with ad-hoc file formats means every consumer re-parses. Structured storage is cheap to add and makes the data actually useful.',
    });
  }
  return recs;
}

/**
 * Many /clear commands in sessions → context-management issue.
 * Suggest a context-packing skill or prompt-condensation hook.
 */
function detectClearPatterns(session: SessionData): Recommendation[] {
  const clears = session.promptPatterns.clearCommands || 0;
  const sessions = session.stats.totalSessions || 1;
  const clearRate = clears / sessions;
  if (clears < 5) return [];
  if (clearRate < 0.15) return []; // need to be a meaningful share of sessions

  return [{
    priority: 'recommended',
    audience: 'user',
    title: `You run /clear ${clears} times — context overflow pattern`,
    description: `${clears} /clear invocations across ${sessions} sessions (${Math.round(clearRate * 100)}% of sessions). The model forgets context every clear. This usually means something loads too much context (a verbose CLAUDE.md, auto-context memories, or long chat history).`,
    textBlock: '',
    evidence: [
      { source: 'sessions', excerpt: `${clears} /clear commands across ${sessions} sessions`, kind: 'stat' },
    ],
    target: 'behavior',
    placementHint: 'CLAUDE.md size, auto-loaded memory file count',
    why: 'Frequent /clear usage is a signal that your context load is too heavy. The cost is real: every clear loses the agent\'s in-session learning about what you already tried.',
    howItLooks: 'Before: you clear because context feels sluggish.\nAfter: a condensed CLAUDE.md + on-demand memories mean you can run entire features without clearing.',
    practiceStep: 'Check your CLAUDE.md size. If over 8KB, split it into a core `.md` + on-demand sections loaded by skill.',
  }];
}

/**
 * Stale git repos that still have Claude config — dormant projects eating context.
 */
function detectStaleRepos(git: GitScanResult | null): Recommendation[] {
  if (!git || git.stale.length === 0) return [];
  const stale = git.stale.slice(0, 5);
  const names = stale.map(r => r.name).join(', ');
  return [{
    priority: 'nice_to_have',
    audience: 'user',
    title: `${git.stale.length} stale project${git.stale.length === 1 ? '' : 's'} haven't been touched in 60+ days`,
    description: `${names}${git.stale.length > 5 ? `, and ${git.stale.length - 5} more` : ''}. If these are dead, removing them from Claude's working set cuts context and noise.`,
    textBlock: '',
    evidence: stale.map(r => ({
      source: r.path,
      excerpt: `${r.name} — last commit ${r.staleDays} days ago`,
      kind: 'stat' as const,
    })),
    target: 'behavior',
    placementHint: '~/.claude/projects/, CLAUDE.md project list',
    why: 'Every dormant project that Claude enumerates (via CLAUDE.md references or scheduled scans) uses context that could go to live work. Archival is free.',
    howItLooks: 'Before: 14 projects, 6 of them cold, all in CLAUDE.md.\nAfter: 8 active projects in rotation, cold ones in an archive section you can re-enable if revived.',
    practiceStep: `Check ${stale[0].name} — if it\'s dead, delete its memory dir and drop it from CLAUDE.md. If it\'s paused, note that explicitly.`,
  }];
}

/**
 * Repos with revert signals in recent commits — same thing getting "fixed" repeatedly.
 * That's friction worth surfacing.
 */
function detectRevertHotspots(git: GitScanResult | null): Recommendation[] {
  if (!git) return [];
  const hotspots = git.repos.filter(r => r.revertSignals.length >= 2);
  if (hotspots.length === 0) return [];

  const top = hotspots.slice(0, 3);
  return [{
    priority: 'recommended',
    audience: 'user',
    title: `${hotspots.length} project${hotspots.length === 1 ? '' : 's'} show repeated "fix again" commits`,
    description: `Recent commits with patterns like "revert", "fix again", "still broken" suggest work that isn't sticking. Something about how features are built or tested in these repos invites rework.`,
    textBlock: '',
    evidence: top.flatMap(r =>
      r.revertSignals.slice(0, 2).map(sig => ({
        source: r.path,
        excerpt: `${r.name}: "${sig}"`,
        kind: 'quote' as const,
      }))
    ),
    target: 'behavior',
    placementHint: 'CLAUDE.md quality section',
    why: 'Commits that revert or re-fix in the same month are the clearest signal that your "done" criteria aren\'t catching real-world failures. Usually means tests aren\'t catching the thing that breaks.',
    practiceStep: 'Pick the most recent revert. Add a test or hook that would have caught it before the commit.',
  }];
}

/**
 * Repos with many uncommitted files — process issue or abandoned experiments.
 */
function detectUncommittedPile(git: GitScanResult | null): Recommendation[] {
  if (!git) return [];
  const messy = git.repos.filter(r => r.uncommittedFiles >= 10);
  if (messy.length === 0) return [];

  const top = messy.slice(0, 3);
  return [{
    priority: 'nice_to_have',
    audience: 'user',
    title: `${messy.length} project${messy.length === 1 ? '' : 's'} ${messy.length === 1 ? 'has' : 'have'} 10+ uncommitted files`,
    description: `${top.map(r => `${r.name} (${r.uncommittedFiles} files)`).join(', ')}. Long-lived uncommitted work drifts away from main and gets harder to integrate every day.`,
    textBlock: '',
    evidence: top.map(r => ({
      source: r.path,
      excerpt: `${r.name} has ${r.uncommittedFiles} uncommitted files`,
      kind: 'stat' as const,
    })),
    target: 'behavior',
    placementHint: 'ship skill / commit discipline',
    why: 'Uncommitted piles are invisible work. If you stop, you lose context. If you resume, merge risk grows daily.',
    practiceStep: `Open ${top[0].name} and either commit the useful bits or stash + delete the rest.`,
  }];
}

// ============================================================================
// Orchestration
// ============================================================================

export function generateProactiveRecommendations(ctx: ProactiveContext): Recommendation[] {
  const recs: Recommendation[] = [];

  recs.push(...detectRepeatedCli(ctx.artifacts));
  recs.push(...detectWritePatterns(ctx.artifacts));
  recs.push(...detectClearPatterns(ctx.session));
  recs.push(...detectStaleRepos(ctx.git));
  recs.push(...detectRevertHotspots(ctx.git));
  recs.push(...detectUncommittedPile(ctx.git));

  return recs;
}
