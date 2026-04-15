# Dear User — Onboard Tool Design (Week 3)

## Purpose

`onboard` is a conversational dialog tool that:
1. Learns about the user (role, goals, current stack, pains)
2. Teaches them key concepts (code/chat/schedule/OS, substrate choices)
3. Produces a tailored setup plan with concrete next steps

Target audience: non-technical professionals (CEOs, lawyers, knowledge workers) AND technical power-users who want to be walked through a structured setup.

## State management in a stateless protocol

MCP tool calls are stateless. We pass state as an opaque base64-encoded JSON blob between calls. The agent (Claude) orchestrates the dialog — `onboard` just returns the next question and an updated state blob.

```typescript
interface OnboardState {
  version: 1;
  role: 'coder' | 'occasional' | 'non_coder' | null;
  goals: string | null;         // free-text
  stack: string[];              // parsed from answer
  pains: string | null;         // free-text
  substrateDescription: string | null; // free-text
  decidedSubstrate: string | null;     // filled at substrate step
  answers: Record<string, string>;     // raw history for auditability
}
```

## Flow (7 steps)

| Step | Purpose | Output (to agent) | Next |
|---|---|---|---|
| `intro` | Welcome + role | Question: "Which best describes you?" + 3 options | `role` |
| `role` | Goals | Teaching: what AI can do for their role. Question: single most important use. | `goals` |
| `goals` | Stack inventory | Question: "What tools do you already use?" (Claude/ChatGPT/Cursor/MCP/none) | `stack` |
| `stack` | Pain points | Question: "What's most frustrating about working with AI today?" | `pains` |
| `pains` | Substrate intro | Teaching: 4 places data can live (chat, memory, docs, DB). Question: "What data are you accumulating?" | `substrate` |
| `substrate` | Classify + recommend | Call substrate-advisor on the description. Return recommendation + rationale. | `plan` |
| `plan` | Tailored setup | Produce CLAUDE.md template + skill list + hook list + next-3-steps | done |

Each step returns `{ question, teaching?, options?, state (updated), nextStep, done }`.

## Teaching content (core of v1)

The agent presents this to the user when relevant. Concise, not lectures.

### Role step → teach: Four ways to use AI
- **Chat**: tactical help, one-off questions
- **Code**: building things (Claude Code, Cursor, etc.)
- **Schedule**: recurring automations
- **OS**: your own AI stack with memory and context

(Which makes sense depends on role — we tailor.)

### Pains step → teach: Four substrates
- **Rules** (CLAUDE.md): how the agent should behave — read every session
- **Memory** (memory/*.md): lessons, feedback, narrative learnings
- **Documents** (Notion/Google Docs): formatted content humans also read
- **Database** (SQLite/Supabase): structured, queryable, grows over time

### Substrate step → classify
Based on the description, recommend one of these 5 substrates:

| Pattern | Recommended substrate |
|---|---|
| Rules, preferences, "always do X" | CLAUDE.md |
| Feedback, learnings, lessons, narrative | memory file |
| Structured lists (tasks, bugs, contacts, sources) | SQLite / Supabase |
| Documents with formatting (proposals, contracts) | Notion / Google Docs |
| Time-series (daily logs, run results, events) | JSONL append-only file |

## Plan step — what "done" looks like

Returns a concrete setup plan with:
1. **CLAUDE.md template** filled in with the user's role + goals + substrate decision
2. **Skill recommendations** (3-5 based on persona/role)
3. **Hook recommendations** (1-3 based on safety/build needs)
4. **Next 3 steps** — ordered, concrete, achievable in an afternoon

## Tool signature

```typescript
server.tool(
  'onboard',
  'Conversational setup — learns about you, teaches core concepts, produces a tailored plan. Start with step="intro". The agent should present each returned question to the user, collect the answer, and call this tool again with step=<nextStep>, answer=<user-answer>, state=<state-from-last-call>.',
  {
    step: z.string().optional().describe('Current step. Omit to start from intro.'),
    answer: z.string().optional().describe('User answer from the previous step. Required for all steps after intro.'),
    state: z.string().optional().describe('Opaque state blob from last call. Pass back unchanged.'),
  },
);
```

## Files

- `src/engine/substrate-advisor.ts` — classification logic (keyword + pattern match; returns substrate + rationale)
- `src/tools/onboard.ts` — flow state machine, step handlers, plan generator
- `src/templates/setup-templates.ts` — CLAUDE.md templates + skill suggestions per role
- Wire up in `src/index.ts`

## Scope — v1 limits

- No persistence across sessions (caller holds state via the opaque blob)
- No multi-language detection yet; dialog in English with Danish support hardcoded via Jarl's CLAUDE.md signal
- No branching beyond role — one linear flow tailored by the final plan step
- No external validation (Supabase account check, etc.) — recommendations are informational

Build order: substrate-advisor → onboard → templates → register.
