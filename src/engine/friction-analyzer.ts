// Friction Analyzer — extracts friction patterns from feedback memories and prohibition rules

import type { FrictionPattern, FrictionTheme, ParseResult, ScanResult } from '../types.js';

interface ThemePattern {
  theme: FrictionTheme;
  title: string;
  description: string;
  patterns: RegExp[];
}

const THEME_PATTERNS: ThemePattern[] = [
  {
    theme: 'scope_creep',
    title: 'Scope Creep',
    description: 'The agent changes things it wasn\'t asked to touch — rewriting prompts, redesigning assets, refactoring working code',
    patterns: [
      /beyond.?scope/i, /only.?what.?asked/i, /don'?t.?change/i,
      /ændr.?ikke/i, /ud.?over.?opgaven/i, /wasn'?t.?asked/i,
      /not.?requested/i, /redesign/i, /refactor.?without/i,
      /scope/i, /beyond/i,
    ],
  },
  {
    theme: 'communication',
    title: 'Lost in Translation',
    description: 'Mismatched communication style — wrong language, too technical, too verbose, or missing the user\'s preferred tone',
    patterns: [
      /jargon/i, /technical.?language/i, /dansk/i, /danish/i,
      /business.?analog/i, /not.?technical/i, /plain.?language/i,
      /verbose/i, /too.?long/i, /kort/i, /concise/i,
      /communication/i, /language/i, /tone/i,
    ],
  },
  {
    theme: 'quality',
    title: 'Quality Gaps',
    description: 'Code breaks, tests fail, builds break, or the agent ships without verifying',
    patterns: [
      /build.?fail/i, /test.?fail/i, /broke/i, /broken/i,
      /bug/i, /error/i, /crash/i, /didn'?t.?work/i,
      /quality/i, /verification/i, /check.?before/i,
    ],
  },
  {
    theme: 'autonomy',
    title: 'Autonomy Mismatch',
    description: 'The agent acts when it should ask, or asks when it should act — wrong calibration of independence',
    patterns: [
      /ask.?first/i, /without.?asking/i, /spørg/i,
      /permission/i, /approval/i, /godkend/i,
      /autonomy/i, /independent/i, /proactive/i,
    ],
  },
  {
    theme: 'tooling',
    title: 'Manual Workarounds',
    description: 'Suggesting one-off fixes instead of systematic solutions — doing things manually when they should be automated',
    patterns: [
      /automat/i, /manual/i, /workaround/i, /one.?off/i,
      /system/i, /repeat/i, /next.?time/i, /100%.?selv/i,
      /cli/i, /api/i, /dashboard/i,
    ],
  },
  {
    theme: 'process',
    title: 'Process Friction',
    description: 'Workflow issues — wrong deploy flow, skipped steps, incorrect assumptions about process',
    patterns: [
      /workflow/i, /deploy/i, /process/i, /flow/i,
      /step/i, /protocol/i, /procedure/i, /checklist/i,
      /forgot/i, /missed/i, /skipped/i,
    ],
  },
];

export function analyzeFriction(parsed: ParseResult, scan: ScanResult): FrictionPattern[] {
  const themeCounts: Record<FrictionTheme, { count: number; evidence: string[] }> = {
    scope_creep: { count: 0, evidence: [] },
    communication: { count: 0, evidence: [] },
    quality: { count: 0, evidence: [] },
    autonomy: { count: 0, evidence: [] },
    tooling: { count: 0, evidence: [] },
    process: { count: 0, evidence: [] },
  };

  // Score from prohibition rules
  for (const rule of parsed.rules.filter(r => r.type === 'prohibition')) {
    for (const tp of THEME_PATTERNS) {
      const matches = tp.patterns.filter(p => p.test(rule.text));
      if (matches.length > 0) {
        themeCounts[tp.theme].count += matches.length;
        if (themeCounts[tp.theme].evidence.length < 3) {
          themeCounts[tp.theme].evidence.push(rule.text.slice(0, 100));
        }
      }
    }
  }

  // Score from feedback memory files
  for (const mem of scan.memoryFiles.filter(m => m.path.includes('feedback_'))) {
    for (const tp of THEME_PATTERNS) {
      const matches = tp.patterns.filter(p => p.test(mem.content));
      if (matches.length > 0) {
        themeCounts[tp.theme].count += matches.length;

        // Extract a concise evidence snippet
        const nameMatch = mem.content.match(/^name:\s*(.+)/m);
        if (nameMatch && themeCounts[tp.theme].evidence.length < 3) {
          themeCounts[tp.theme].evidence.push(nameMatch[1].trim());
        }
      }
    }
  }

  // Rank and return top friction patterns (only those with evidence)
  const ranked = Object.entries(themeCounts)
    .filter(([, data]) => data.count > 0)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5);

  return ranked.map(([theme, data], index) => {
    const tp = THEME_PATTERNS.find(t => t.theme === theme)!;
    return {
      rank: index + 1,
      title: tp.title,
      description: tp.description,
      evidence: data.evidence,
      theme: theme as FrictionTheme,
    };
  });
}
