# Dear User — Audit Tool Design

## Purpose

`audit` finds **structural incoherence** in a user's AI setup — overlaps, orphan jobs, broken data flows, and substrate mismatches. This is different from `analyze`, which looks at collaboration *language*. Audit looks at system *architecture*.

## What `audit` detects (v1, week 1 scope)

| # | Signal | Example |
|---|---|---|
| 1 | **Orphan scheduled jobs** | Task writes to `~/scan-results.json`; no skill/task/briefing reads it |
| 2 | **Overlap** | `standup` skill + `daily-briefing` scheduled task both produce morning summaries |
| 3 | **Missing closure** | `security-check` scheduled task writes findings; no consumer exists |
| 4 | **Substrate mismatch** | `memory/scan-rejections.md` has 14 dated entries — markdown used as database |

Out of scope for v1 (later phases):
- LLM→LLM verify-gate detection (v1.5)
- CLAUDE.md-as-spec diff (v2)
- GitHub repo scanning (v2, opt-in)

## Architecture: build a graph, find broken patterns

### Step 1: Scanner extensions

Extend existing `scanner.ts` or add `audit-scanner.ts` that returns:

```typescript
interface AuditArtifact {
  id: string;           // stable identifier (path-based)
  type: 'skill' | 'command' | 'scheduled_task' | 'hook' | 'mcp_server' | 'memory_file';
  name: string;         // human-readable
  path: string;         // absolute path
  description: string;  // from frontmatter, prompt first line, or filename
  prompt: string;       // full prompt text (for scheduled tasks + skills)
  metadata: {
    lastModified?: Date;
    size: number;
    frontmatter?: Record<string, string>;
    entryCount?: number;  // for memory files: count of list-like entries
  };
}
```

Read from:
- `~/.claude/skills/*/SKILL.md` → skills
- `~/.claude/scheduled-tasks/*/SKILL.md` + `.config.json` → scheduled tasks (prompt + cron)
- `~/.claude/commands/*.md` → commands
- `~/.claude/projects/*/memory/*.md` → memory files (already scanned)
- `~/.claude/settings.json` hooks → hooks

### Step 2: Build the graph

```typescript
interface AuditGraph {
  nodes: AuditArtifact[];
  edges: AuditEdge[];
}

interface AuditEdge {
  from: string;           // artifact id
  to: string;             // artifact id OR file path
  type: 'produces' | 'consumes' | 'references' | 'similar_to';
  evidence: string;       // the exact quote/path from source
}
```

Graph-building heuristics:

- **Produces edges** — prompts containing patterns like "writes to X", "saves to X", "creates X.json", "updates X.md". Regex extraction of file paths.
- **Consumes edges** — prompts containing "reads X", "loads X", "scans X", "checks X". Also regex-extract paths.
- **References edges** — one artifact's prompt mentions another's name (`pvs.sh`, `standup`, etc.)
- **Similar_to edges** — cosine similarity on description text (cheap: token overlap) OR same verb+noun pattern in first sentence

### Step 3: Run detectors

```typescript
interface AuditFinding {
  id: string;
  type: 'orphan_job' | 'overlap' | 'missing_closure' | 'substrate_mismatch';
  severity: 'critical' | 'recommended' | 'nice_to_have';
  title: string;
  description: string;
  affectedArtifacts: string[];  // artifact ids
  evidence: Array<{
    source: string;
    excerpt: string;
    kind: 'path' | 'quote' | 'stat';
  }>;
  recommendation: string;
}
```

#### Detector 1: Orphan jobs

For each scheduled_task node:
- Get outgoing `produces` edges → list of output paths
- For each output path, search graph for any `consumes` or `references` edge pointing at that path
- If none: finding. severity=`recommended` unless output-path is in `~/.pvs/` or another data-dir (then `critical`)

#### Detector 2: Overlap

For every pair of artifacts of same type (or skill+task cross-type):
- Compute description similarity (Jaccard on stemmed tokens, threshold 0.5)
- OR: check if they produce the same output path
- If match: finding. severity=`nice_to_have` for description-only match, `recommended` for output-path match, `critical` for both

#### Detector 3: Missing closure

For each produces edge that lands on a non-artifact path (e.g., `~/foo.json`):
- If no other artifact consumes it AND it's not a "terminal" path (CLAUDE.md, .dearuser/, .pvs/dashboard/): finding
- This overlaps with orphan jobs — we deduplicate by preferring orphan_job finding if the producer is a scheduled task

#### Detector 4: Substrate mismatch

For each memory file:
- Parse content. Count list-like entries (bullet points, numbered, or `---`-separated blocks)
- If entries > 5 AND structured (match patterns like `date: X`, `type: Y`, or table rows)
- AND (size > 5KB OR mtime updated in last 7 days while size stable): substrate_mismatch finding
- Recommendation: migrate to SQLite/JSONL/DB

### Step 4: Store + feedback loop

`~/.dearuser/audit-findings.json`:
```json
[
  {
    "id": "orphan-scheduled-security-check",
    "firstSeenAt": "2026-04-14T...",
    "lastSeenAt": "2026-04-14T...",
    "status": "pending|acknowledged|fixed|dismissed",
    "finding": { ... }
  }
]
```

On each run:
- Compute findings
- Match against stored — if previously flagged but now gone: mark `fixed`
- If user added a `[DISMISSED]` marker in CLAUDE.md with the finding id: mark `dismissed`
- Update `lastSeenAt` for still-present findings

## MCP tool signatures — all 5 tools

### 1. `onboard` (NEW — v2 week 3)

```typescript
server.tool(
  'onboard',
  'Conversational setup — learns about you, your goals, and your current AI stack, then produces a tailored setup plan. Use this when starting with a new user or revisiting goals.',
  {
    step: z.enum(['intro', 'role', 'goals', 'stack', 'substrate', 'plan']).optional()
      .describe('Multi-turn dialog step. Omit to start from beginning.'),
    answer: z.string().optional()
      .describe('User answer to the previous step. Used to inform the next question.'),
    state: z.string().optional()
      .describe('Opaque state from previous turn. Pass back unchanged.'),
  },
  // Returns: { question, suggestions[], state (to pass to next call), done: boolean, plan?: SetupPlan }
);
```

### 2. `analyze` (EXISTS — extend in week 2)

```typescript
server.tool(
  'analyze',
  '[existing description + new capabilities for GitHub repo scan and proactive recommendations]',
  {
    projectRoot: z.string().optional(),
    scope: z.enum(['global', 'project']).optional(),
    includeGit: z.boolean().optional().describe('Include local .git scanning for commit patterns. Default: true.'),
  },
);
```

### 3. `audit` (NEW — v1 week 1 — BUILDING NOW)

```typescript
server.tool(
  'audit',
  'Audit your AI setup for structural incoherence — overlapping skills, orphan scheduled jobs, missing data-flow closure, and markdown-as-database substrate mismatches. Complement to analyze: where analyze looks at collaboration language, audit looks at system architecture.',
  {
    projectRoot: z.string().optional().describe('Project root. Defaults to cwd.'),
    scope: z.enum(['global', 'project']).optional().describe('Default: global. Audit is most useful across the whole setup.'),
    focus: z.enum(['orphan', 'overlap', 'closure', 'substrate', 'all']).optional()
      .describe('Narrow to one finding type, or "all" (default).'),
  },
);
```

Returns: markdown report with findings, evidence, recommendations.

### 4. `security` (NEW — week 4)

```typescript
server.tool(
  'security',
  'Security scan of your AI setup. Detects secret leaks in CLAUDE.md/memory, prompt injection surfaces (hooks with user input, MCP servers with broad permissions), permission escalation paths, and conflicting rules (e.g., "never delete" in CLAUDE.md but a hook that runs rm).',
  {
    projectRoot: z.string().optional(),
    scope: z.enum(['global', 'project']).optional(),
  },
);
```

### 5. `wrapped` (EXISTS — no change)

```typescript
server.tool(
  'wrapped',
  '[existing]',
  { projectRoot, scope, format },
);
```

## Presentation: audit output format

Markdown, consistent with analyze:

```markdown
# Dear User — System Audit

*Scope: global — 7 projects, 34 artifacts analyzed*

## Summary
- 🔴 2 critical findings
- 🟡 5 recommended  
- 🟢 3 nice-to-have

## 🔴 Critical Findings

### [orphan_job] Scheduled task `security-check` produces output nothing reads
**Evidence:**
- 📍 Task prompt: "writes findings to ~/.pvs/security/"
- 📊 No artifact references ~/.pvs/security/

**Why it matters:** Silent failures. The job runs daily, produces data, and you'd never know if it stopped working because nothing fails downstream.

**Recommendation:** Either (a) add a consumer (e.g., have your morning /standup skill read the latest findings file) or (b) add a failure-notification hook so you know when the job breaks.

---
[more findings...]

## Graph overview
- 12 skills, 8 scheduled tasks, 14 commands, 23 memory files
- 7 produces edges, 4 consumes edges, 2 similar_to edges
- **Closure rate: 57%** (4 of 7 produced outputs have a consumer)

## Progress since last audit
- ✅ Fixed: overlap between `research` and `brief` skills (2 weeks ago)
- ⏳ Still pending: substrate mismatch in `memory/scan-rejections.md`
```

## Implementation plan (concrete)

Week 1 build order:

1. `src/engine/audit-scanner.ts` — builds `AuditArtifact[]` from filesystem
2. `src/engine/audit-graph.ts` — extracts edges from artifacts (produces/consumes/similar_to)
3. `src/engine/audit-detectors.ts` — 4 detectors, each returns `AuditFinding[]`
4. `src/engine/audit-feedback.ts` — reads/writes `~/.dearuser/audit-findings.json`
5. `src/tools/audit.ts` — orchestration (scan → graph → detect → feedback → return)
6. `src/index.ts` — register tool
7. `src/types.ts` — add types
8. Test on PVS setup (`dearuser-mcp audit`)

## Notes

- All findings are non-destructive. Audit never modifies user files.
- Keep false-positive rate low — a noisy audit gets ignored.
- First run should find things in Jarl's own PVS setup or the heuristics are wrong.
- Test commitment: every detector has a fixture input + expected output.
