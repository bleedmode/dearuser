// Parser — extracts rules, sections, and learnings from CLAUDE.md content

import type { ParsedRule, ParsedSection, ParseResult, RuleType, ScanResult, FileInfo } from '../types.js';

const PROHIBITION_PATTERNS = [
  /\bnever\b/i, /\bdon'?t\b/i, /\bdo not\b/i, /\baldrig\b/i,
  /\bforbud/i, /\bblocked?\b/i, /\bprohibit/i, /\bikkeg?\b/i,
  /\bmust not\b/i, /\bshall not\b/i,
];

const ASK_FIRST_PATTERNS = [
  /\bask\s*(first|before|user)\b/i, /\bspørg\b/i,
  /\bconfirm\b/i, /\bcheck with\b/i, /\bapproval\b/i,
  /\bgodkend/i, /\btilladelse\b/i,
];

const SUGGEST_PATTERNS = [
  /\bsuggest\b/i, /\bpropose\b/i, /\brecommend\b/i,
  /\bforeslå\b/i, /\bnævn\b/i, /\bimplementér ikke\b/i,
];

const AUTONOMOUS_PATTERNS = [
  /\bdo\s*(it\s*)?yourself\b/i, /\bgør\s*selv\b/i,
  /\bautomatically\b/i, /\bproactively\b/i,
  /\bwithout asking\b/i, /\buden at spørge\b/i,
];

// Canonical CLAUDE.md section IDs
const SECTION_MAP: Record<string, string[]> = {
  'roles': ['roller', 'roles', 'role', 'who does what', 'responsibilities'],
  'autonomy': ['autonomy', 'autonomi', 'gør selv', 'spørg først', 'do yourself', 'ask first', 'permissions'],
  'communication': ['communication', 'kommunikation', 'language', 'tone', 'style', 'sprog'],
  'quality': ['quality', 'kvalitet', 'testing', 'qa', 'definition of done', 'done'],
  'tech_stack': ['tech stack', 'stack', 'teknologi', 'dependencies', 'tools'],
  'architecture': ['architecture', 'arkitektur', 'structure', 'project structure', 'directory'],
  'commands': ['commands', 'kommandoer', 'scripts', 'running', 'build', 'deploy'],
  'learnings': ['learnings', 'lessons', 'failures', 'patterns', 'decisions', 'cross-project'],
  'workflow': ['workflow', 'git', 'branching', 'commits', 'pr', 'deploy flow'],
  'north_star': ['north star', 'goals', 'mål', 'strategy', 'strategi', 'mission'],
};

function classifyRule(text: string, sectionContext: string): RuleType {
  const combined = text + ' ' + sectionContext;

  if (PROHIBITION_PATTERNS.some(p => p.test(combined))) return 'prohibition';
  if (ASK_FIRST_PATTERNS.some(p => p.test(combined))) return 'ask_first';
  if (SUGGEST_PATTERNS.some(p => p.test(combined))) return 'suggest_only';
  if (AUTONOMOUS_PATTERNS.some(p => p.test(combined))) return 'do_autonomously';

  // Default based on section context
  if (/spørg|ask first/i.test(sectionContext)) return 'ask_first';
  if (/foreslå|suggest/i.test(sectionContext)) return 'suggest_only';
  if (/gør selv|do yourself|autonomous/i.test(sectionContext)) return 'do_autonomously';

  return 'do_autonomously'; // default
}

function identifySection(header: string): string {
  const lower = header.toLowerCase();
  for (const [id, keywords] of Object.entries(SECTION_MAP)) {
    if (keywords.some(kw => lower.includes(kw))) return id;
  }
  return 'other';
}

function extractFromMarkdown(content: string, source: string): { rules: ParsedRule[]; sections: ParsedSection[]; learnings: string[] } {
  const rules: ParsedRule[] = [];
  const sections: ParsedSection[] = [];
  const learnings: string[] = [];

  const lines = content.split('\n');
  let currentHeader = '';
  let currentSectionId = '';
  let currentSectionContent: string[] = [];
  let inLearningSection = false;

  for (const line of lines) {
    // Detect headers
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      // Save previous section
      if (currentHeader) {
        sections.push({
          id: currentSectionId,
          header: currentHeader,
          content: currentSectionContent.join('\n').trim(),
          source,
        });
      }

      currentHeader = headerMatch[2].trim();
      currentSectionId = identifySection(currentHeader);
      currentSectionContent = [];
      inLearningSection = currentSectionId === 'learnings';
      continue;
    }

    currentSectionContent.push(line);

    // Extract rules from bullet points
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);
    if (bulletMatch) {
      const text = bulletMatch[1].trim();
      if (text.length > 10 && text.length < 500) {
        rules.push({
          text,
          type: classifyRule(text, currentHeader),
          source,
        });
      }
    }

    // Extract learnings
    if (inLearningSection && bulletMatch) {
      learnings.push(bulletMatch[1].trim());
    }
  }

  // Save last section
  if (currentHeader) {
    sections.push({
      id: currentSectionId,
      header: currentHeader,
      content: currentSectionContent.join('\n').trim(),
      source,
    });
  }

  return { rules, sections, learnings };
}

function countProjects(content: string): number {
  // Look for project tables or lists
  const tableMatches = content.match(/\|[^|]+\|[^|]+\|[^|]+\|/g);
  if (tableMatches) {
    // Count data rows (exclude header and separator)
    const dataRows = tableMatches.filter(row =>
      !row.includes('---') && !row.includes('Projekt') && !row.includes('Project') && !row.includes('Name')
    );
    if (dataRows.length > 1) return dataRows.length;
  }

  // Count project-like references
  const projectPatterns = [
    /\/Users\/[^/]+\/[^/]+\/([^/\s]+)/g,
    /https?:\/\/[^\s]+\.(com|dk|io|app)/g,
  ];

  const projects = new Set<string>();
  for (const pattern of projectPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      projects.add(match[1] || match[0]);
    }
  }

  return Math.max(projects.size, 1);
}

export function parse(scan: ScanResult): ParseResult {
  const allRules: ParsedRule[] = [];
  const allSections: ParsedSection[] = [];
  const allLearnings: string[] = [];

  // Parse global CLAUDE.md
  if (scan.globalClaudeMd) {
    const result = extractFromMarkdown(scan.globalClaudeMd.content, scan.globalClaudeMd.path);
    allRules.push(...result.rules);
    allSections.push(...result.sections);
    allLearnings.push(...result.learnings);
  }

  // Parse project CLAUDE.md
  if (scan.projectClaudeMd) {
    const result = extractFromMarkdown(scan.projectClaudeMd.content, scan.projectClaudeMd.path);
    allRules.push(...result.rules);
    allSections.push(...result.sections);
    allLearnings.push(...result.learnings);
  }

  // Parse memory files for additional learnings
  for (const mem of scan.memoryFiles) {
    if (mem.path.includes('feedback_')) {
      allLearnings.push(mem.content);
    }
  }

  // Count projects from CLAUDE.md content
  const combinedContent = [scan.globalClaudeMd?.content, scan.projectClaudeMd?.content]
    .filter(Boolean).join('\n');
  const projectCount = countProjects(combinedContent);

  return {
    rules: allRules,
    sections: allSections,
    learnings: allLearnings,
    projectCount,
  };
}
