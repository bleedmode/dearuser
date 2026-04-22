// ../research/calibration/2026-04-22-claude-md-corpus-v2/score-corpus.ts
import { readFileSync as readFileSync2, writeFileSync, appendFileSync, existsSync as existsSync2 } from "node:fs";
import { join as join2 } from "node:path";

// src/engine/parser.ts
var PROHIBITION_PATTERNS = [
  /\bnever\b/i,
  /\bdon'?t\b/i,
  /\bdo not\b/i,
  /\baldrig\b/i,
  /\bforbud/i,
  /\bblocked?\b/i,
  /\bprohibit/i,
  /\bikkeg?\b/i,
  /\bmust not\b/i,
  /\bshall not\b/i
];
var ASK_FIRST_PATTERNS = [
  /\bask\s*(first|before|user)\b/i,
  /\bspørg\b/i,
  /\bconfirm\b/i,
  /\bcheck with\b/i,
  /\bapproval\b/i,
  /\bgodkend/i,
  /\btilladelse\b/i
];
var SUGGEST_PATTERNS = [
  /\bsuggest\b/i,
  /\bpropose\b/i,
  /\brecommend\b/i,
  /\bforeslå\b/i,
  /\bnævn\b/i,
  /\bimplementér ikke\b/i
];
var AUTONOMOUS_PATTERNS = [
  /\bdo\s*(it\s*)?yourself\b/i,
  /\bgør\s*selv\b/i,
  /\bautomatically\b/i,
  /\bproactively\b/i,
  /\bwithout asking\b/i,
  /\buden at spørge\b/i
];
var SECTION_MAP = {
  "roles": ["roller", "roles", "role", "who does what", "responsibilities"],
  "autonomy": ["autonomy", "autonomi", "g\xF8r selv", "sp\xF8rg f\xF8rst", "do yourself", "ask first", "permissions"],
  "communication": ["communication", "kommunikation", "language", "tone", "style", "sprog"],
  "quality": ["quality", "kvalitet", "testing", "qa", "definition of done", "done"],
  "tech_stack": ["tech stack", "stack", "teknologi", "dependencies", "tools"],
  "architecture": ["architecture", "arkitektur", "structure", "project structure", "directory"],
  "commands": ["commands", "kommandoer", "scripts", "running", "build", "deploy"],
  "learnings": ["learnings", "lessons", "failures", "patterns", "decisions", "cross-project"],
  "workflow": ["workflow", "git", "branching", "commits", "pr", "deploy flow"],
  "north_star": ["north star", "goals", "m\xE5l", "strategy", "strategi", "mission"]
};
function classifyRule(text, sectionContext) {
  const combined = text + " " + sectionContext;
  if (PROHIBITION_PATTERNS.some((p) => p.test(combined))) return "prohibition";
  if (ASK_FIRST_PATTERNS.some((p) => p.test(combined))) return "ask_first";
  if (SUGGEST_PATTERNS.some((p) => p.test(combined))) return "suggest_only";
  if (AUTONOMOUS_PATTERNS.some((p) => p.test(combined))) return "do_autonomously";
  if (/spørg|ask first/i.test(sectionContext)) return "ask_first";
  if (/foreslå|suggest/i.test(sectionContext)) return "suggest_only";
  if (/gør selv|do yourself|autonomous/i.test(sectionContext)) return "do_autonomously";
  return "do_autonomously";
}
function identifySection(header) {
  const lower = header.toLowerCase();
  for (const [id, keywords] of Object.entries(SECTION_MAP)) {
    if (keywords.some((kw) => lower.includes(kw))) return id;
  }
  return "other";
}
function extractFromMarkdown(content, source) {
  const rules = [];
  const sections = [];
  const learnings = [];
  const lines = content.split("\n");
  let currentHeader = "";
  let currentSectionId = "";
  let currentSectionContent = [];
  let inLearningSection = false;
  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      if (currentHeader) {
        sections.push({
          id: currentSectionId,
          header: currentHeader,
          content: currentSectionContent.join("\n").trim(),
          source
        });
      }
      currentHeader = headerMatch[2].trim();
      currentSectionId = identifySection(currentHeader);
      currentSectionContent = [];
      inLearningSection = currentSectionId === "learnings";
      continue;
    }
    currentSectionContent.push(line);
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)/);
    if (bulletMatch) {
      const text = bulletMatch[1].trim();
      if (text.length > 10 && text.length < 500) {
        rules.push({
          text,
          type: classifyRule(text, currentHeader),
          source
        });
      }
    }
    if (inLearningSection && bulletMatch) {
      learnings.push(bulletMatch[1].trim());
    }
  }
  if (currentHeader) {
    sections.push({
      id: currentSectionId,
      header: currentHeader,
      content: currentSectionContent.join("\n").trim(),
      source
    });
  }
  return { rules, sections, learnings };
}
function countProjects(content) {
  const tableMatches = content.match(/\|[^|]+\|[^|]+\|[^|]+\|/g);
  if (tableMatches) {
    const dataRows = tableMatches.filter(
      (row) => !row.includes("---") && !row.includes("Projekt") && !row.includes("Project") && !row.includes("Name")
    );
    if (dataRows.length > 1) return dataRows.length;
  }
  const projectPatterns = [
    /\/Users\/[^/]+\/[^/]+\/([^/\s]+)/g,
    /https?:\/\/[^\s]+\.(com|dk|io|app)/g
  ];
  const projects = /* @__PURE__ */ new Set();
  for (const pattern of projectPatterns) {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      projects.add(match[1] || match[0]);
    }
  }
  return Math.max(projects.size, 1);
}
function parse(scan) {
  const allRules = [];
  const allSections = [];
  const allLearnings = [];
  if (scan.globalClaudeMd) {
    const result = extractFromMarkdown(scan.globalClaudeMd.content, scan.globalClaudeMd.path);
    allRules.push(...result.rules);
    allSections.push(...result.sections);
    allLearnings.push(...result.learnings);
  }
  if (scan.projectClaudeMd) {
    const result = extractFromMarkdown(scan.projectClaudeMd.content, scan.projectClaudeMd.path);
    allRules.push(...result.rules);
    allSections.push(...result.sections);
    allLearnings.push(...result.learnings);
  }
  for (const mem of scan.memoryFiles) {
    if (mem.path.includes("feedback_")) {
      allLearnings.push(mem.content);
    }
  }
  const combinedContent = [scan.globalClaudeMd?.content, scan.projectClaudeMd?.content].filter(Boolean).join("\n");
  const projectCount = countProjects(combinedContent);
  return {
    rules: allRules,
    sections: allSections,
    learnings: allLearnings,
    projectCount
  };
}

// src/engine/scorer.ts
var WEIGHTS = {
  roleClarity: 0.15,
  communication: 0.1,
  autonomyBalance: 0.2,
  qualityStandards: 0.15,
  memoryHealth: 0.15,
  systemMaturity: 0.15,
  coverage: 0.1
};
function scoreRoleClarity(parsed) {
  const present = [];
  const missing = [];
  const hasRolesSection = parsed.sections.some((s) => s.id === "roles");
  if (hasRolesSection) present.push("Roles section exists");
  else missing.push("No roles section \u2014 agent doesn't know who does what");
  const hasSpecificRoles = parsed.rules.some(
    (r) => /\b(ceo|executor|product.?owner|tech.?lead|pair.?programmer)\b/i.test(r.text)
  );
  if (hasSpecificRoles) present.push("Specific role definitions (not generic)");
  else missing.push('Roles are generic or missing \u2014 "you are an agent" is not enough');
  const hasScopeRules = parsed.rules.some(
    (r) => /beyond.?scope|only.?what|ændr.?ikke|ud.?over|don'?t.?change|never.?modify/i.test(r.text)
  );
  if (hasScopeRules) present.push("Scope boundaries defined");
  else missing.push("No scope boundaries \u2014 agent may change things you didn't ask for (top friction source)");
  const hasAskFirstExamples = parsed.rules.some(
    (r) => r.type === "ask_first" && r.text.length > 20
  );
  if (hasAskFirstExamples) present.push("Ask-first rules with specific examples");
  else missing.push("No specific ask-first examples \u2014 agent doesn't know your boundaries");
  const allText = parsed.rules.map((r) => r.text).join("\n") + "\n" + parsed.sections.map((s) => s.content).join("\n");
  const hasSkillLevel = /\b(non.?technical|can'?t.?code|vibe.?cod|senior|junior|beginner|expert|novice)\b/i.test(allText);
  const hasRoleSignal = /\b(ceo|founder|cto|product.?owner|product.?manager|designer|engineer|developer|entrepreneur|indie.?hacker|tech.?lead|team.?lead|meta.?agent|executor)\b/i.test(allText);
  if (hasSkillLevel || hasRoleSignal) {
    present.push("User skill level / role indicated");
  } else {
    missing.push("Agent doesn't know your technical level or role \u2014 may over/under explain");
  }
  const score2 = Math.round(present.length / (present.length + missing.length) * 100);
  return { score: score2, weight: WEIGHTS.roleClarity, signalsPresent: present, signalsMissing: missing };
}
function scoreCommunication(parsed) {
  const present = [];
  const missing = [];
  const text = parsed.rules.map((r) => r.text).join(" ") + parsed.sections.map((s) => s.content).join(" ");
  if (/\b(dansk|danish|english|spanish|language|sprog|respond in|svar på)\b/i.test(text)) present.push("Language preference set");
  else missing.push("No language preference \u2014 agent defaults to English");
  if (/\b(short|concise|brief|kort|klart|terse|verbose|detailed)\b/i.test(text)) present.push("Verbosity preference set");
  else missing.push("No verbosity preference \u2014 agent guesses how much to say");
  if (/\b(jargon|technical|analogi|business.?language|non.?technical|plain)\b/i.test(text)) present.push("Tone/style guidance");
  else missing.push("No tone guidance \u2014 agent may use jargon you don't understand");
  if (/\b(unsure|uncertain|don'?t.?know|usikker|confidence)\b/i.test(text)) present.push("Uncertainty handling defined");
  else missing.push("No guidance on uncertainty \u2014 agent will guess confidently instead of asking");
  if (/\b(correct|feedback|mistake|fejl|rettelse)\b/i.test(text)) present.push("Feedback mechanism defined");
  else missing.push("No feedback guidance \u2014 agent doesn't know how you prefer to correct it");
  const score2 = Math.round(present.length / (present.length + missing.length) * 100);
  return { score: score2, weight: WEIGHTS.communication, signalsPresent: present, signalsMissing: missing };
}
function scoreAutonomyBalance(parsed) {
  const present = [];
  const missing = [];
  const doRules = parsed.rules.filter((r) => r.type === "do_autonomously").length;
  const askRules = parsed.rules.filter((r) => r.type === "ask_first").length;
  const suggestRules = parsed.rules.filter((r) => r.type === "suggest_only").length;
  const prohibitions = parsed.rules.filter((r) => r.type === "prohibition").length;
  const total = parsed.rules.length;
  const intentionalAutonomy = doRules >= 3 && parsed.sections.some(
    (s) => /gør.*selv|do.*yourself|do.*autonom|without.*asking|uden.*at.*spørge/i.test(s.header || "")
  );
  if (doRules > 0) present.push(`${doRules} autonomous rules`);
  else missing.push("No autonomous action rules \u2014 agent asks about everything");
  if (askRules > 0) present.push(`${askRules} ask-first rules`);
  else missing.push("No ask-first rules \u2014 agent guesses what needs approval");
  if (intentionalAutonomy) {
    present.push("Explicit autonomous-operation section \u2014 high autonomy is by design, not accidental");
    if (suggestRules === 0) {
      present.push("Suggest-only tier skipped (intentional \u2014 user prefers action over discussion)");
    }
  } else {
    if (suggestRules > 0) present.push(`${suggestRules} suggest-only rules`);
    else missing.push("No suggest-only rules \u2014 agent may implement things it should only mention");
  }
  let balanceScore = 30;
  if (total > 0) {
    if (intentionalAutonomy) {
      if (doRules > 0 && askRules > 0) balanceScore += 25;
      if (prohibitions >= 3) balanceScore += 10;
    } else {
      const hasAllTiers = doRules > 0 && askRules > 0 && suggestRules > 0;
      if (hasAllTiers) {
        balanceScore += 25;
      } else {
        const hasMeaningfulBalance = doRules >= 3 && askRules >= 1 && prohibitions >= 1;
        if (hasMeaningfulBalance) {
          balanceScore += 15;
          present.push("Meaningful autonomy balance (has ask, prohibit, and do-rules) \u2014 starter three-tier pattern");
        }
      }
    }
    const prohibitionRatio = prohibitions / total;
    if (prohibitionRatio >= 0.15 && prohibitionRatio <= 0.35) {
      balanceScore += 20;
      present.push("Healthy prohibition ratio (15-35%)");
    } else if (prohibitionRatio > 0.5) {
      balanceScore -= 10;
      missing.push("Over 50% of rules are prohibitions \u2014 may be over-restrictive");
    } else if (prohibitionRatio < 0.1 && total > 5) {
      missing.push("Very few prohibitions \u2014 agent has few guardrails");
    }
    const vagueRules = parsed.rules.filter((r) => r.text.length < 20).length;
    if (vagueRules > total * 0.3) {
      missing.push(`${vagueRules} rules are very short (<20 chars) \u2014 may be too vague to follow`);
      balanceScore -= 10;
    } else {
      present.push("Rules are specific enough to follow");
      balanceScore += 5;
    }
  } else {
    missing.push("No rules defined at all \u2014 agent operates with zero guidance");
  }
  const score2 = Math.min(100, Math.max(0, balanceScore));
  return { score: score2, weight: WEIGHTS.autonomyBalance, signalsPresent: present, signalsMissing: missing, intentionalAutonomy };
}
function scoreQualityStandards(parsed, scan) {
  const present = [];
  const missing = [];
  const text = parsed.sections.map((s) => s.content).join(" ") + parsed.rules.map((r) => r.text).join(" ");
  if (scan.hooksCount > 0) present.push(`${scan.hooksCount} hooks configured`);
  else missing.push("No hooks \u2014 no automated quality gates. Agent can ship broken code unchecked.");
  if (/\b(test|jest|vitest|pytest|spec|tdd)\b/i.test(text)) present.push("Testing strategy mentioned");
  else missing.push("No testing strategy \u2014 bugs reach production");
  if (/\b(build|compile|tsc|eslint|lint)\b/i.test(text)) present.push("Build/lint verification");
  else missing.push("No build verification \u2014 agent doesn't know if code compiles");
  if (/\b(done|kvalitet|quality|definition.?of.?done|complete|deploy)\b/i.test(text)) present.push("Definition of done exists");
  else missing.push('No definition of done \u2014 "done" is ambiguous');
  const hasDestructiveProtection = parsed.rules.some(
    (r) => /rm -rf|force.?push|terraform.?destroy|drop.?table|destructive/i.test(r.text)
  );
  if (hasDestructiveProtection) present.push("Destructive command protection");
  else missing.push("No destructive command protection \u2014 rm -rf, force push, terraform destroy are unblocked");
  const hasFileProtection = parsed.rules.some(
    (r) => /\.env|secret|credential|password|api.?key|protected.?file/i.test(r.text)
  );
  if (hasFileProtection) present.push("Sensitive file protection");
  else missing.push("No sensitive file protection \u2014 .env and credentials are unguarded");
  const score2 = Math.round(present.length / (present.length + missing.length) * 100);
  return { score: score2, weight: WEIGHTS.qualityStandards, signalsPresent: present, signalsMissing: missing };
}
function scoreMemoryHealth(parsed, scan) {
  const present = [];
  const missing = [];
  const memCount = scan.memoryFiles.length;
  const feedbackCount = scan.memoryFiles.filter((m) => m.path.includes("feedback_")).length;
  if (memCount > 5) present.push(`${memCount} memory files \u2014 good breadth`);
  else if (memCount > 0) present.push(`${memCount} memory files \u2014 but could be more comprehensive`);
  else missing.push("No memory files \u2014 agent forgets everything between sessions");
  if (feedbackCount > 3) present.push(`${feedbackCount} feedback memories \u2014 strong learning loop`);
  else if (feedbackCount > 0) present.push(`${feedbackCount} feedback memories \u2014 learning loop started`);
  else missing.push("No feedback memories \u2014 corrections are lost between sessions");
  if (parsed.learnings.length > 0) present.push(`${parsed.learnings.length} learnings documented`);
  else missing.push("No learnings section \u2014 past mistakes aren't documented");
  const recentMemories = scan.memoryFiles.filter((m) => {
    if (!m.lastModified) return false;
    const daysSince = (Date.now() - m.lastModified.getTime()) / (1e3 * 60 * 60 * 24);
    return daysSince < 14;
  });
  if (recentMemories.length > 0) present.push(`${recentMemories.length} memories updated in last 2 weeks`);
  else if (memCount > 0) missing.push("No recently updated memories \u2014 knowledge may be stale");
  const hasUserProfile = scan.memoryFiles.some((m) => m.path.includes("user_"));
  if (hasUserProfile) present.push("User profile in memory");
  else missing.push("No user profile \u2014 agent doesn't know who you are between sessions");
  const score2 = Math.round(present.length / (present.length + missing.length) * 100);
  return { score: score2, weight: WEIGHTS.memoryHealth, signalsPresent: present, signalsMissing: missing };
}
function scoreSystemMaturity(scan) {
  const present = [];
  const missing = [];
  if (scan.hooksCount > 0) present.push(`${scan.hooksCount} hooks`);
  else missing.push("No hooks \u2014 manual quality gates only");
  if (scan.skillsCount > 0) present.push(`${scan.skillsCount} skills`);
  else missing.push("No skills \u2014 no reusable workflows packaged");
  if (scan.scheduledTasksCount > 0) present.push(`${scan.scheduledTasksCount} scheduled tasks`);
  else missing.push("No scheduled tasks \u2014 no automation running");
  if (scan.commandsCount > 0) present.push(`${scan.commandsCount} commands`);
  else missing.push("No custom commands");
  if (scan.mcpServersCount > 1) present.push(`${scan.mcpServersCount} MCP servers`);
  else if (scan.mcpServersCount === 1) present.push("1 MCP server \u2014 consider adding more for your use case");
  else missing.push("No MCP servers \u2014 missing tool integrations");
  const totalArtifacts = scan.hooksCount + scan.skillsCount + scan.scheduledTasksCount + scan.commandsCount + scan.mcpServersCount;
  const hasAllTiers = scan.hooksCount > 0 && scan.skillsCount > 0 && scan.scheduledTasksCount > 0 && scan.commandsCount > 0 && scan.mcpServersCount > 0;
  let score2;
  if (totalArtifacts === 0) score2 = 5;
  else if (totalArtifacts <= 2) score2 = 20;
  else if (totalArtifacts <= 5) score2 = 40;
  else if (totalArtifacts <= 10) score2 = 60;
  else if (totalArtifacts <= 15) score2 = 75;
  else if (totalArtifacts <= 20) score2 = 90;
  else score2 = hasAllTiers ? 100 : 90;
  if (score2 >= 95 && !hasAllTiers) score2 = 90;
  return { score: score2, weight: WEIGHTS.systemMaturity, signalsPresent: present, signalsMissing: missing };
}
function scoreCoverage(parsed) {
  const present = [];
  const missing = [];
  const canonicalSections = [
    { id: "roles", label: "Roles & responsibilities" },
    { id: "autonomy", label: "Autonomy levels (do/ask/suggest)" },
    { id: "communication", label: "Communication style" },
    { id: "quality", label: "Quality standards & definition of done" },
    { id: "tech_stack", label: "Tech stack" },
    { id: "architecture", label: "Project architecture" },
    { id: "commands", label: "Build/test/deploy commands" },
    { id: "learnings", label: "Learnings & known issues" },
    { id: "workflow", label: "Git/deploy workflow" },
    { id: "north_star", label: "Goals / north star" }
  ];
  const foundIds = new Set(parsed.sections.map((s) => s.id));
  for (const section of canonicalSections) {
    if (foundIds.has(section.id)) present.push(section.label);
    else missing.push(`${section.label} \u2014 not documented`);
  }
  const score2 = Math.round(present.length / canonicalSections.length * 100);
  return { score: score2, weight: WEIGHTS.coverage, signalsPresent: present, signalsMissing: missing };
}
function score(parsed, scan, session) {
  const categories = {
    roleClarity: scoreRoleClarity(parsed),
    communication: scoreCommunication(parsed),
    autonomyBalance: scoreAutonomyBalance(parsed),
    qualityStandards: scoreQualityStandards(parsed, scan),
    memoryHealth: scoreMemoryHealth(parsed, scan),
    systemMaturity: scoreSystemMaturity(scan),
    coverage: scoreCoverage(parsed)
  };
  const autonomyResult = categories.autonomyBalance;
  if (session) {
    if (session.corrections.negationCount > 5) {
      const penalty = autonomyResult.intentionalAutonomy ? 5 : 15;
      categories.autonomyBalance.score = Math.max(0, categories.autonomyBalance.score - penalty);
      categories.autonomyBalance.signalsMissing.push(
        autonomyResult.intentionalAutonomy ? `${session.corrections.negationCount} correction signals \u2014 refinement friction (autonomy is intentional, so these are course-corrections, not overreach)` : `${session.corrections.negationCount} correction signals in recent prompts \u2014 friction is high`
      );
    }
    if (session.promptPatterns.totalPrompts > 10 && session.promptPatterns.shortPrompts > session.promptPatterns.totalPrompts * 0.5) {
      categories.communication.score = Math.max(0, categories.communication.score - 10);
      categories.communication.signalsMissing.push(
        `${Math.round(session.promptPatterns.shortPrompts / session.promptPatterns.totalPrompts * 100)}% of prompts are very short \u2014 may need prompting guidance`
      );
    }
    if (session.promptPatterns.clearCommands > 3) {
      categories.systemMaturity.score = Math.max(0, categories.systemMaturity.score - 10);
      categories.systemMaturity.signalsMissing.push(
        `${session.promptPatterns.clearCommands} /clear commands \u2014 frequent context resets suggest session management issues`
      );
    }
  }
  const collaborationScore = Math.round(
    Object.values(categories).reduce((sum, cat) => sum + cat.score * cat.weight, 0)
  );
  const pureCategories = ["roleClarity", "communication", "autonomyBalance", "coverage"];
  const pureWeightSum = pureCategories.reduce((s, id) => s + WEIGHTS[id], 0);
  const claudeMdSubScore = Math.round(
    pureCategories.reduce((sum, id) => sum + categories[id].score * (WEIGHTS[id] / pureWeightSum), 0)
  );
  const substrateEmpty = scan.memoryFiles.length === 0 && scan.hooksCount === 0 && scan.skillsCount === 0;
  return {
    categories,
    collaborationScore,
    claudeMdSubScore,
    substrateEmpty,
    intentionalAutonomy: !!autonomyResult.intentionalAutonomy
  };
}

// src/engine/lint-checks.ts
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve, dirname, basename, join } from "path";
import { homedir } from "os";

// src/engine/semantic-conflict-detector.ts
import { createHash } from "crypto";
var POSITIVE_MARKERS = [
  /\balways\b/i,
  /\bmust\b/i,
  /\brequired?\b/i,
  /\bprefer\b/i,
  /\baltid\b/i,
  /\bskal\b/i,
  /\bforetræk/i
];
var NEGATIVE_MARKERS = [
  /\bnever\b/i,
  /\bdon'?t\b/i,
  /\bdo not\b/i,
  /\bavoid\b/i,
  /\bforbidden\b/i,
  /\baldrig\b/i,
  /\bundgå\b/i,
  /\bmå ikke\b/i
];
var NUANCE_MARKERS = [
  /\bunless\b/i,
  /\bexcept\b/i,
  /\bonly if\b/i,
  /\bonly when\b/i,
  /\bexcept when\b/i,
  /\bmedmindre\b/i,
  /\bundtagen\b/i,
  /\bkun hvis\b/i,
  /\bkun når\b/i
];
function polarityOf(text) {
  let posIdx = Infinity;
  let negIdx = Infinity;
  for (const p of POSITIVE_MARKERS) {
    const m = text.match(p);
    if (m && m.index !== void 0 && m.index < posIdx) posIdx = m.index;
  }
  for (const p of NEGATIVE_MARKERS) {
    const m = text.match(p);
    if (m && m.index !== void 0 && m.index < negIdx) negIdx = m.index;
  }
  if (posIdx === Infinity && negIdx === Infinity) return "neutral";
  if (posIdx < negIdx) return "positive";
  if (negIdx < posIdx) return "negative";
  return "neutral";
}
function hasNuanceEscape(text) {
  return NUANCE_MARKERS.some((p) => p.test(text));
}
var STOP = /* @__PURE__ */ new Set([
  // English
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "be",
  "to",
  "of",
  "and",
  "or",
  "in",
  "on",
  "for",
  "with",
  "not",
  "do",
  "don",
  "t",
  "it",
  "you",
  "your",
  "this",
  "that",
  "always",
  "never",
  "must",
  "should",
  "would",
  "could",
  "avoid",
  "prefer",
  "required",
  "forbidden",
  "unless",
  "except",
  "only",
  "if",
  "when",
  "all",
  "any",
  "some",
  "but",
  "so",
  "no",
  "yes",
  // Danish
  "altid",
  "aldrig",
  "skal",
  "ikke",
  "m\xE5",
  "m\xE5_ikke",
  "kun",
  "hvis",
  "n\xE5r",
  "med",
  "uden",
  "og",
  "eller",
  "fra",
  "til",
  "af",
  "det",
  "den",
  "de",
  "en",
  "et",
  "er",
  "var",
  "har",
  "have",
  "b\xF8r",
  "kan",
  "vil",
  "skal",
  "medmindre",
  "undtagen",
  "foretr\xE6k",
  "undg\xE5"
]);
function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9æøå ]/g, " ").replace(/\s+/g, " ").trim();
}
function topicWords(text) {
  return new Set(
    normalize(text).split(" ").filter((w) => w.length > 2 && !STOP.has(w))
  );
}
function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  return intersection / (a.size + b.size - intersection);
}
function findRuleLine(content, ruleText) {
  const key = ruleText.trim().slice(0, 40).toLowerCase();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(key)) return i + 1;
  }
  return void 0;
}
function findSectionForLine(content, line) {
  if (!line) return null;
  const lines = content.split("\n");
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const m = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (m) return m[2].trim();
  }
  return null;
}
function stableHash(ruleA, ruleB) {
  const pair = [normalize(ruleA).slice(0, 120), normalize(ruleB).slice(0, 120)].sort();
  return createHash("sha256").update(`semantic-conflict|${pair.join("|")}`).digest("hex").slice(0, 16);
}
function trunc(s, n = 80) {
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
}
var DEFAULTS = {
  // Jaccard is a soft signal — two rules with opposite polarity about the
  // same core action (e.g. "force push") routinely score 0.10–0.20 in the
  // wild because one side carries caveats the other doesn't. The hard
  // floor is the anchor-overlap gate (≥2 shared non-stop anchors) which
  // does the heavy lifting on precision; jaccard is a cheap sanity check.
  minSimilarity: 0.1,
  crossFileMinSimilarity: 0.2,
  maxFindings: 5
};
function anchorWords(text) {
  const words = normalize(text).split(" ").filter((w) => w.length > 3 && !STOP.has(w));
  return new Set(words);
}
function sharedCount(a, b) {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}
function detectSemanticConflicts(parsed, filesByPath, options = {}, idFactory) {
  const opts = { ...DEFAULTS, ...options };
  const enriched = [];
  for (const rule of parsed.rules) {
    const topics = topicWords(rule.text);
    if (topics.size < 3) continue;
    const polarity = polarityOf(rule.text);
    if (polarity === "neutral") continue;
    const content = filesByPath.get(rule.source) ?? "";
    const line = findRuleLine(content, rule.text);
    const section = findSectionForLine(content, line);
    enriched.push({
      rule,
      polarity,
      topics,
      anchors: anchorWords(rule.text),
      section,
      line,
      normalized: normalize(rule.text),
      escape: hasNuanceEscape(rule.text)
    });
  }
  const findings = [];
  const seenHashes = /* @__PURE__ */ new Set();
  for (let i = 0; i < enriched.length; i++) {
    for (let j = i + 1; j < enriched.length; j++) {
      const a = enriched[i];
      const b = enriched[j];
      if (a.polarity === b.polarity) continue;
      if (a.normalized === b.normalized) continue;
      if (a.normalized.length > 30 && b.normalized.includes(a.normalized.slice(0, 30))) continue;
      if (b.normalized.length > 30 && a.normalized.includes(b.normalized.slice(0, 30))) continue;
      if (a.escape || b.escape) continue;
      const sameFile = a.rule.source === b.rule.source;
      const sameSection = Boolean(
        sameFile && a.section && b.section && a.section === b.section
      );
      const similarity = jaccard(a.topics, b.topics);
      const shared = sharedCount(a.anchors, b.anchors);
      const threshold = sameFile ? opts.minSimilarity : opts.crossFileMinSimilarity;
      const requiredAnchors = sameFile ? 2 : 3;
      if (similarity < threshold) continue;
      if (shared < requiredAnchors) continue;
      const hash = stableHash(a.rule.text, b.rule.text);
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);
      const locationA = a.line ? `${a.rule.source}:${a.line}` : a.rule.source;
      const locationB = b.line ? `${b.rule.source}:${b.line}` : b.rule.source;
      const why = explainConflict(a, b, sameSection);
      findings.push({
        id: idFactory ? idFactory("semantic_rule_conflict") : `lint-semantic_rule_conflict-${hash}`,
        check: "semantic_rule_conflict",
        severity: "nice_to_have",
        title: "To regler kan modsige hinanden",
        description: `Disse to regler lyder som om de tr\xE6kker i hver sin retning om det samme emne. Den ene siger "g\xF8r X", den anden siger "lad v\xE6re med X" \u2014 agenten ved ikke hvilken der vinder. ` + why,
        file: a.rule.source,
        line: a.line,
        excerpt: `"${trunc(a.rule.text, 60)}" (${locationA})  \u2194  "${trunc(b.rule.text, 60)}" (${locationB})`,
        fix: `Tjek om reglerne faktisk modsiger hinanden. Hvis ja: skriv dem sammen som \xE9n regel, eller tilf\xF8j "medmindre\u2026" / "unless\u2026" s\xE5 agenten forst\xE5r hvorn\xE5r hver regel g\xE6lder. Hvis nej: det er falsk alarm \u2014 du kan ignorere denne.`
      });
      if (findings.length >= opts.maxFindings) return findings;
    }
  }
  return findings;
}
function explainConflict(a, b, sameSection) {
  const posRule = a.polarity === "positive" ? a : b;
  const negRule = a.polarity === "negative" ? a : b;
  const shared = [...a.topics].filter((w) => b.topics.has(w)).slice(0, 3);
  const location = sameSection ? `i samme sektion` : a.rule.source === b.rule.source ? `i samme fil` : `i hver sin fil`;
  const topicsStr = shared.length > 0 ? ` (omkring: ${shared.join(", ")})` : "";
  return `Den ene regel siger "${posRule.polarity === "positive" ? "altid / skal" : "aldrig / m\xE5 ikke"}", den anden siger det modsatte${topicsStr} \u2014 og de st\xE5r ${location}.`;
}

// src/engine/over-specification-detector.ts
import { createHash as createHash2 } from "crypto";
var LINE_REF = /\b(?:line|linje|linjen|line number)\s+\d{1,4}\b/i;
var MULTI_FLAG_CMD = /`[^`]*(?:\s-{1,2}[A-Za-z][\w-]*(?:[= ][^`\s-]+)?){3,}[^`]*`/;
var DEEP_PATH = /[\w.-]+\/[\w.-]+\/[\w.-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|rb|php|cs|swift|kt|scala|sql|sh|yml|yaml|json|toml)\b/;
var URL_STRIP = /https?:\/\/\S+/g;
var VERSION_PIN = /\b(?:[A-Z][A-Za-z.+-]{1,20})\s+(?:v\d+(?:\.\d+){0,2}\b|\d+\.\d+(?:\.\d+)?\b)/;
var VERSION_PIN_BARE = /\b(?:React|Node|Python|Ruby|Go|Java|SDK|Expo|Vue|Angular|Svelte|Next|Nuxt|Rails|Django|Flask|TypeScript|JavaScript|Deno|Bun|Rust|Kotlin|Swift|PHP|Laravel)\s+v?\d{1,3}\b/i;
var FUNC_SIG_ARROW = /`?\b[a-zA-Z_$][\w$]*\s*\([^)]{0,200}\)\s*(?:=>|->)\s*[A-Za-z_$][\w$<>\[\],. |&?]*`?/;
var FUNC_SIG_TYPED_PARAM = /`?\b[a-zA-Z_$][\w$]*\s*\([^)]*\b[a-zA-Z_$][\w$]*\s*:\s*(?:string|number|boolean|void|any|unknown|null|undefined|[A-Z][\w$<>\[\],.|&?]*)[^)]*\)/;
var CODE_EXT_RE = /\.(ts|tsx|js|jsx|py|rs|go|java|rb|php|cs|swift|kt|scala|sql|sh)$/i;
function normalizeRule(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
}
function stableHash2(text) {
  return createHash2("sha256").update(`over-specification|${normalizeRule(text)}`).digest("hex").slice(0, 16);
}
function isAcronymList(signatureCandidate) {
  const parenMatch = signatureCandidate.match(/\(([^)]+)\)/);
  if (!parenMatch) return false;
  const body = parenMatch[1];
  const tokens = body.split(/[,\s]+/).filter(Boolean);
  const allCaps = tokens.filter((t) => /^[A-Z]{2,}[A-Z0-9:.-]*$/.test(t));
  if (body.includes(",") && allCaps.length >= 2) return true;
  return false;
}
function trunc2(s, n = 90) {
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
}
function findRuleLine2(content, ruleText) {
  const key = ruleText.trim().slice(0, 40).toLowerCase();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(key)) return i + 1;
  }
  return void 0;
}
function hasVerbatimBlock(content, line) {
  if (!line) return false;
  const lines = content.split("\n");
  const end = Math.min(lines.length, line + 10);
  let inBlock = false;
  let bodyLines = 0;
  for (let i = line; i < end; i++) {
    const t = lines[i] ?? "";
    if (/^\s*```/.test(t)) {
      if (inBlock) {
        if (bodyLines >= 3) return true;
        return false;
      }
      inBlock = true;
      bodyLines = 0;
      continue;
    }
    if (inBlock && t.trim().length > 0) bodyLines++;
  }
  return false;
}
function scanRuleForSignals(ruleText, content, line) {
  const signals = [];
  const matches = {};
  const lineMatch = ruleText.match(LINE_REF);
  if (lineMatch) {
    signals.push("line_ref");
    matches.line_ref = lineMatch[0];
  }
  const cmdMatch = ruleText.match(MULTI_FLAG_CMD);
  if (cmdMatch) {
    signals.push("multi_flag_cmd");
    matches.multi_flag_cmd = cmdMatch[0];
  }
  const stripped = ruleText.replace(URL_STRIP, " ");
  const pathMatch = stripped.match(DEEP_PATH);
  if (pathMatch && CODE_EXT_RE.test(pathMatch[0])) {
    signals.push("deep_path");
    matches.deep_path = pathMatch[0];
  }
  const versionMatch = ruleText.match(VERSION_PIN) ?? ruleText.match(VERSION_PIN_BARE);
  if (versionMatch) {
    signals.push("version_pin");
    matches.version_pin = versionMatch[0];
  }
  const funcMatch = ruleText.match(FUNC_SIG_ARROW) ?? ruleText.match(FUNC_SIG_TYPED_PARAM);
  if (funcMatch && !isAcronymList(funcMatch[0])) {
    signals.push("func_sig");
    matches.func_sig = funcMatch[0];
  }
  if (hasVerbatimBlock(content, line)) {
    signals.push("verbatim_block");
    matches.verbatim_block = "(multi-line code block)";
  }
  return { signals, matches };
}
var DEFAULTS2 = {
  minSignals: 2,
  maxFindings: 10
};
var SIGNAL_LABELS = {
  line_ref: "henvisning til et specifikt linjenummer",
  multi_flag_cmd: "kommando med 3+ flag",
  deep_path: "dyb fil-sti med kode-extension",
  version_pin: "h\xE5rdt pinned versionsnummer",
  func_sig: "funktions-signatur med typer",
  verbatim_block: "verbatim multi-line kodeblok"
};
function detectOverSpecification(parsed, filesByPath, options = {}, idFactory) {
  const opts = { ...DEFAULTS2, ...options };
  const findings = [];
  const seenHashes = /* @__PURE__ */ new Set();
  for (const rule of parsed.rules) {
    const content = filesByPath.get(rule.source) ?? "";
    const line = findRuleLine2(content, rule.text);
    const { signals, matches } = scanRuleForSignals(rule.text, content, line);
    if (signals.length < opts.minSignals) continue;
    const hash = stableHash2(rule.text);
    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);
    const why = explainWhy(signals, matches);
    const suggestion = buildSuggestion(rule.text, signals);
    findings.push({
      id: idFactory ? idFactory("over_specified") : `lint-over_specified-${hash}`,
      check: "over_specified",
      severity: "nice_to_have",
      title: "Regel er for detaljeret til CLAUDE.md",
      description: `Denne regel binder sig til meget specifikke implementerings-detaljer. N\xE5r koden, versionen eller kommandoen \xE6ndrer sig, bliver reglen forkert \u2014 og de rigtige regler drukner i st\xF8j. ${why}`,
      file: rule.source,
      line,
      excerpt: trunc2(rule.text, 120),
      fix: `Skriv reglen om som intention, ikke implementation. ${suggestion} Detaljerne h\xF8rer hjemme i kode-kommentarer eller docs \u2014 ikke i CLAUDE.md.`
    });
    if (findings.length >= opts.maxFindings) return findings;
  }
  return findings;
}
function explainWhy(signals, matches) {
  const bits = signals.slice(0, 3).map((s) => {
    const match = matches[s];
    const label = SIGNAL_LABELS[s];
    if (match && s !== "verbatim_block") return `${label} ("${trunc2(match, 40)}")`;
    return label;
  });
  return `Fangede: ${bits.join(" + ")}.`;
}
function buildSuggestion(ruleText, signals) {
  const lower = ruleText.toLowerCase();
  if (signals.includes("version_pin")) {
    return `Fx: "Brug en moderne version af [v\xE6rkt\xF8jet]" i stedet for at pinne et pr\xE6cist versionsnummer.`;
  }
  if (signals.includes("line_ref")) {
    return `Fx: "N\xE5r du redigerer [modul], husk at [intention]" i stedet for at pege p\xE5 linje NN.`;
  }
  if (signals.includes("multi_flag_cmd")) {
    return `Fx: "K\xF8r tests f\xF8r du committer" i stedet for at l\xE5se kommandoen med alle flag.`;
  }
  if (signals.includes("deep_path")) {
    return `Fx: "N\xE5r du r\xF8rer [komponent], tjek [invariant]" i stedet for at pege p\xE5 en dyb fil-sti.`;
  }
  if (signals.includes("func_sig")) {
    return `Fx: "Denne funktion returnerer [form\xE5l]" i stedet for at duplikere signaturen.`;
  }
  if (lower.length > 120) {
    return `Klip detaljerne ud og efterlad kun intentionen.`;
  }
  return `Behold intentionen, fjern implementation.`;
}

// src/engine/lint-checks.ts
function extractHooksFromSettings(settingsFiles) {
  const hooks = [];
  for (const sf of settingsFiles) {
    try {
      const json = JSON.parse(sf.content);
      const hooksObj = json?.hooks;
      if (!hooksObj || typeof hooksObj !== "object") continue;
      for (const [event, entries] of Object.entries(hooksObj)) {
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
          const hookList = entry?.hooks;
          if (!Array.isArray(hookList)) continue;
          for (const h of hookList) {
            if (h?.type === "command" && typeof h.command === "string") {
              hooks.push({
                event,
                matcher: entry.matcher || void 0,
                command: h.command,
                timeout: h.timeout || void 0,
                source: sf.path
              });
            }
          }
        }
      }
    } catch {
    }
  }
  return hooks;
}
function discoverSkills() {
  const skills = [];
  const skillsDir = join(homedir(), ".claude", "skills");
  try {
    if (!existsSync(skillsDir)) return skills;
    for (const entry of readdirSync(skillsDir)) {
      const skillMd = join(skillsDir, entry, "SKILL.md");
      if (!existsSync(skillMd)) continue;
      const content = readFileSync(skillMd, "utf-8");
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let fmName;
      let fmDesc;
      if (fmMatch) {
        const nameMatch = fmMatch[1].match(/^name:\s*(.+)/m);
        const descMatch = fmMatch[1].match(/^description:\s*(.+)/m);
        fmName = nameMatch?.[1]?.trim();
        fmDesc = descMatch?.[1]?.trim();
      }
      skills.push({
        name: entry,
        path: skillMd,
        content,
        hasFrontmatter: !!fmMatch,
        frontmatterName: fmName,
        frontmatterDescription: fmDesc
      });
    }
  } catch {
  }
  return skills;
}
var GENERIC_FILLER_PHRASES = [
  "be helpful",
  "be accurate",
  "be concise",
  "be thorough",
  "write clean code",
  "write good code",
  "follow best practices",
  "be professional",
  "be efficient",
  "be careful",
  "use common sense",
  "think step by step",
  "think carefully",
  "you are a helpful assistant",
  "you are an expert",
  "always produce high-quality",
  "ensure correctness",
  "pay attention to detail",
  "be thoughtful",
  "write maintainable code",
  "write readable code",
  "provide clear explanations",
  "be responsive",
  "v\xE6r hj\xE6lpsom",
  "v\xE6r grundig",
  "v\xE6r pr\xE6cis",
  "skriv god kode"
];
var WEAK_IMPERATIVE_PATTERNS = [
  /\btry to\b/i,
  /\bshould\b/i,
  /\bconsider\b/i,
  /\bif possible\b/i,
  /\bwhen possible\b/i,
  /\bideally\b/i,
  /\bpreferably\b/i,
  /\bit would be nice\b/i,
  /\bmaybe\b/i,
  /\bperhaps\b/i,
  /\bmight want to\b/i,
  /\bprøv at\b/i,
  /\bbør\b/i,
  /\bevt\.?\b/i,
  /\bhvis muligt\b/i,
  /\boverve?j\b/i
];
var WEAK_IMPERATIVE_EXCEPTIONS = [
  /should be evaluated/i,
  /should be assessed/i,
  /shouldn't\b/i,
  /should not\b/i
  // these are prohibitions, not weak
];
var CRITICAL_MARKERS = [
  /\bnever\b/i,
  /\balways\b/i,
  /\bcritical\b/i,
  /\bimportant\b/i,
  /\bmust\b/i,
  /\brequired\b/i,
  /\bmandatory\b/i,
  /\baldrig\b/i,
  /\baltid\b/i,
  /\bkritisk\b/i,
  /\bvigtig/i,
  /\bskal\b/i
];
var COMPRESSIBLE_PADDING = [
  "always remember to",
  "make sure to",
  "please ensure that",
  "it is important to",
  "you should always",
  "be sure to",
  "remember that you",
  "keep in mind that",
  "note that you should",
  "it is essential to",
  "it is crucial to",
  "please make sure",
  "husk altid at",
  "s\xF8rg for at",
  "det er vigtigt at",
  "v\xE6r sikker p\xE5 at",
  "husk at du skal"
];
var MENTAL_NOTE_PATTERNS = [
  /\bremember to\b/i,
  /\bkeep in mind\b/i,
  /\bdon't forget to\b/i,
  /\bbear in mind\b/i,
  /\bnote that\b/i,
  /\btake note\b/i,
  /\bhusk at\b/i,
  /\bglem ikke at\b/i,
  /\bhav in mente\b/i
];
var DANGEROUS_HOOK_COMMANDS = [
  /\brm\s+(-\w*r\w*f|--force)\b/,
  /\brm\s+-\w*f\w*r\b/,
  /\bcurl\b.*\|\s*\b(sh|bash|zsh)\b/,
  /\bwget\b.*\|\s*\b(sh|bash)\b/,
  /\bchmod\s+777\b/,
  /\bchmod\s+-R\s+777\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+push\s+-f\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bsudo\s+rm\b/,
  /\bdd\s+if=.*of=\/dev\b/,
  /\b>\s*\/dev\/sd[a-z]\b/
];
var LINTER_CONFIG_PATTERNS = [
  /\b(2|4)[\s-]space (indent|tab)/i,
  /\buse (single|double) quotes\b/i,
  /\bsemicolons? (at end|required|always)\b/i,
  /\bmax (line )?length.?\d+/i,
  /\btrailing comma/i,
  /\btabs? (vs |over |instead of )spaces/i
];
var VAGUE_SKILL_NAMES = [
  "helper",
  "utils",
  "utility",
  "tool",
  "misc",
  "general",
  "common",
  "base",
  "main",
  "default",
  "test"
];
var findingCounter = 0;
function makeId(check) {
  return `lint-${check}-${++findingCounter}`;
}
function finding(check, severity, title, description, file, excerpt, line, fix) {
  return { id: makeId(check), check, severity, title, description, file, line, excerpt, fix };
}
function indexedLines(content) {
  return content.split("\n").map((text, i) => ({ line: i + 1, text }));
}
function trunc3(s, n = 80) {
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s;
}
function normalize2(text) {
  return text.toLowerCase().replace(/[^a-z0-9æøå ]/g, "").replace(/\s+/g, " ").trim();
}
function topicWords2(text) {
  const stop = /* @__PURE__ */ new Set(["the", "a", "an", "is", "are", "was", "be", "to", "of", "and", "or", "in", "on", "for", "with", "not", "do", "don", "t", "it", "you", "your", "this", "that"]);
  return new Set(normalize2(text).split(" ").filter((w) => w.length > 2 && !stop.has(w)));
}
function jaccard2(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  return intersection / (a.size + b.size - intersection);
}
function checkGenericFiller(content, file) {
  const results = [];
  for (const { line, text } of indexedLines(content)) {
    const lower = text.toLowerCase();
    for (const phrase of GENERIC_FILLER_PHRASES) {
      if (lower.includes(phrase)) {
        results.push(finding(
          "generic_filler",
          "recommended",
          `Generic filler: "${phrase}"`,
          `The model already knows to "${phrase}". This wastes context tokens without changing behavior.`,
          file,
          trunc3(text),
          line,
          `Remove or replace with a specific, actionable instruction.`
        ));
        break;
      }
    }
  }
  return results;
}
function checkWeakImperatives(content, file) {
  const results = [];
  for (const { line, text } of indexedLines(content)) {
    if (!/^\s*[-*]\s+/.test(text)) continue;
    for (const pattern of WEAK_IMPERATIVE_PATTERNS) {
      if (pattern.test(text)) {
        if (WEAK_IMPERATIVE_EXCEPTIONS.some((ex) => ex.test(text))) continue;
        const match = text.match(pattern);
        results.push(finding(
          "weak_imperative",
          "nice_to_have",
          `Weak imperative: "${match?.[0] || "should"}"`,
          `Hedging language weakens instructions. The model treats "should" as optional. Use direct imperatives.`,
          file,
          trunc3(text),
          line,
          `Replace with a direct imperative: "Do X" instead of "Try to X".`
        ));
        break;
      }
    }
  }
  return results;
}
function checkNegativeOnly(content, file) {
  const results = [];
  const lines = indexedLines(content);
  const negP = [/\bdon'?t\b/i, /\bdo not\b/i, /\bnever\b/i, /\bavoid\b/i, /\blad vær/i, /\bikke\b/i, /\baldrig\b/i, /\bundgå\b/i];
  const posP = [/\binstead\b/i, /\brather\b/i, /\buse\b/i, /\bprefer\b/i, /→/, /—.*(?:brug|use|do|prefer|kør|åbn|tjek|verificér|flag|tilføj|vis|lav|gør|nævn|skriv|sæt)/i, /\bkør\b/i, /\båbn\b/i, /\btjek\b/i, /\bverificér\b/i, /\bflag\b/i, /\btilføj\b/i, /\bvis\b/i, /\blav\b/i, /\bgør\b/i, /\bnævn\b/i, /\bskriv\b/i, /\bsæt\b/i, /\bimplementér\b/i, /\bbare (?:gå i gang|gør det)\b/i];
  for (const { line, text } of lines) {
    if (!/^\s*[-*]\s+/.test(text)) continue;
    if (/^\s*[-*]\s+\*\*\w+.*:\*\*/.test(text)) continue;
    if (!negP.some((p) => p.test(text))) continue;
    if (posP.some((p) => p.test(text))) continue;
    const nextLine = lines.find((l) => l.line === line + 1);
    if (nextLine && posP.some((p) => p.test(nextLine.text))) continue;
    results.push(finding(
      "negative_only",
      "nice_to_have",
      "Negative-only rule",
      `Rules that only say "don't" without an alternative leave the model guessing what to do instead.`,
      file,
      trunc3(text),
      line,
      `Add what TO do: "Don't X \u2014 instead, do Y."`
    ));
  }
  return results.slice(0, 5);
}
function checkAmbiguousRules(parsed) {
  const results = [];
  for (const rule of parsed.rules) {
    if (rule.text.length < 15) {
      results.push(finding(
        "ambiguous_rule",
        "nice_to_have",
        "Rule too short to be actionable",
        `"${rule.text}" \u2014 at ${rule.text.length} characters, this is too vague for the agent to follow consistently.`,
        rule.source,
        rule.text,
        void 0,
        `Expand with specific context: when does this apply? What exactly should happen?`
      ));
    }
  }
  return results.slice(0, 5);
}
function checkMissingRationale(content, file) {
  const results = [];
  const lines = indexedLines(content);
  const strongP = [/\bnever\b/i, /\balways\b/i, /\bmust\b/i, /\baldrig\b/i, /\baltid\b/i, /\bskal\b/i];
  const rationaleP = [/\bbecause\b/i, /\bsince\b/i, /\bwhy\b/i, /\breason\b/i, /\bfordi\b/i, /\bgrund/i, /\bda\b/i, /—/, /\(.*\)/];
  let count = 0;
  for (const { line, text } of lines) {
    if (!/^\s*[-*]\s+/.test(text)) continue;
    if (count >= 3) break;
    if (!strongP.some((p) => p.test(text))) continue;
    if (rationaleP.some((p) => p.test(text))) continue;
    const nextLine = lines.find((l) => l.line === line + 1);
    if (nextLine && rationaleP.some((p) => p.test(nextLine.text))) continue;
    if (text.length > 120) continue;
    results.push(finding(
      "missing_rationale",
      "nice_to_have",
      "Rule without rationale",
      `Strong rules ("never", "always", "must") work better when the agent understands WHY. This helps it judge edge cases correctly.`,
      file,
      trunc3(text),
      line,
      `Add a brief reason: "Never X \u2014 because Y" or "Always X (reason: Y)".`
    ));
    count++;
  }
  return results;
}
function checkBuriedCriticalRules(content, file) {
  const lines = indexedLines(content);
  const totalLines = lines.length;
  if (totalLines < 100) return [];
  const results = [];
  const middleStart = Math.floor(totalLines * 0.3);
  const middleEnd = Math.floor(totalLines * 0.7);
  for (const { line, text } of lines) {
    if (line < middleStart || line > middleEnd) continue;
    if (!/^\s*[-*]\s+/.test(text)) continue;
    if (CRITICAL_MARKERS.some((p) => p.test(text))) {
      results.push(finding(
        "buried_critical_rule",
        "recommended",
        "Critical rule buried in middle",
        `Line ${line}/${totalLines}: LLMs pay less attention to content in the middle of long documents. Move critical rules to the top or bottom.`,
        file,
        trunc3(text),
        line,
        `Move to the top 30% or bottom 30% of the file.`
      ));
    }
  }
  return results.slice(0, 3);
}
function checkDuplicateRules(parsed) {
  const results = [];
  const seen = /* @__PURE__ */ new Map();
  for (const rule of parsed.rules) {
    const norm = normalize2(rule.text);
    if (norm.length < 15) continue;
    for (const [existingNorm] of seen) {
      if (norm === existingNorm || norm.length > 30 && existingNorm.includes(norm.slice(0, 30))) {
        results.push(finding(
          "duplicate_rule",
          "recommended",
          "Duplicate rule",
          `This rule appears twice \u2014 wastes context and can confuse the agent if wording differs slightly.`,
          rule.source,
          trunc3(rule.text),
          void 0,
          `Remove the duplicate. Keep the more specific version.`
        ));
        break;
      }
    }
    seen.set(norm, { text: rule.text, source: rule.source });
  }
  return results.slice(0, 5);
}
function checkRuleContradictions(parsed) {
  const results = [];
  const positiveRules = [];
  const negativeRules = [];
  const negMarkers = [/\bnever\b/i, /\bdon'?t\b/i, /\bdo not\b/i, /\bavoid\b/i, /\baldrig\b/i, /\bundgå\b/i];
  const posMarkers = [/\balways\b/i, /\bmust\b/i, /\baltid\b/i, /\bskal\b/i];
  for (const rule of parsed.rules) {
    const topics = topicWords2(rule.text);
    if (topics.size < 2) continue;
    const isNeg = negMarkers.some((p) => p.test(rule.text));
    const isPos = posMarkers.some((p) => p.test(rule.text));
    if (isNeg) negativeRules.push({ text: rule.text, source: rule.source, topics });
    if (isPos) positiveRules.push({ text: rule.text, source: rule.source, topics });
  }
  for (const neg of negativeRules) {
    for (const pos of positiveRules) {
      if (neg.text === pos.text) continue;
      const sim = jaccard2(neg.topics, pos.topics);
      if (sim >= 0.5) {
        results.push(finding(
          "rule_contradiction",
          "recommended",
          "Possible rule contradiction",
          `These rules may conflict \u2014 one says "always/must" and the other says "never/don't" about similar topics. The agent may be confused about which to follow.`,
          neg.source,
          `"${trunc3(neg.text, 40)}" vs "${trunc3(pos.text, 40)}"`,
          void 0,
          `Reconcile: make them complementary or remove one.`
        ));
      }
    }
  }
  return results.slice(0, 3);
}
function checkEscapeHatchMissing(content, file) {
  const results = [];
  const absoluteP = [/\bnever\b/i, /\balways\b/i, /\baldrig\b/i, /\baltid\b/i];
  const escapeP = [/\bunless\b/i, /\bexcept\b/i, /\bmedmindre\b/i, /\bundtagen\b/i, /\bif.*explicitly/i, /\bwhen.*ask/i];
  let count = 0;
  for (const { line, text } of indexedLines(content)) {
    if (count >= 3) break;
    if (!/^\s*[-*]\s+/.test(text)) continue;
    if (!absoluteP.some((p) => p.test(text))) continue;
    if (escapeP.some((p) => p.test(text))) continue;
    if (text.length < 30) continue;
    results.push(finding(
      "escape_hatch_missing",
      "nice_to_have",
      "Absolute rule without escape hatch",
      `NEVER/ALWAYS rules without an escape clause can trap the agent when the user explicitly wants an exception.`,
      file,
      trunc3(text),
      line,
      `Add "unless explicitly asked" or "except when..." to give the agent a way out.`
    ));
    count++;
  }
  return results;
}
function checkCompoundInstructions(content, file) {
  const results = [];
  const conjunctions = /\b(and then|and also|, and\b|, then\b|; also\b|; then\b|og derefter|og også|, og\b|; dernæst)/gi;
  for (const { line, text } of indexedLines(content)) {
    if (!/^\s*[-*]\s+/.test(text)) continue;
    const matches = text.match(conjunctions);
    if (matches && matches.length >= 2) {
      results.push(finding(
        "compound_instruction",
        "nice_to_have",
        "Compound instruction (multiple clauses)",
        `This rule chains ${matches.length + 1} actions in one bullet. Multi-step rules are easy to partially follow \u2014 the agent may do the first step and forget the rest.`,
        file,
        trunc3(text),
        line,
        `Split into separate bullet points \u2014 one action per rule.`
      ));
    }
  }
  return results.slice(0, 3);
}
function checkNakedConditionals(content, file) {
  const results = [];
  const lines = indexedLines(content);
  const ifPattern = /^\s*[-*]\s+(?:if|when|hvis|når)\b/i;
  const elsePattern = /\b(otherwise|else|if not|ellers|alternativt)\b/i;
  for (const { line, text } of lines) {
    if (!ifPattern.test(text)) continue;
    if (elsePattern.test(text)) continue;
    const nextLine = lines.find((l) => l.line === line + 1);
    if (nextLine && elsePattern.test(nextLine.text)) continue;
    results.push(finding(
      "naked_conditional",
      "nice_to_have",
      "Conditional without else clause",
      `"If X, do Y" \u2014 but what should the agent do when X is NOT true? Without an else clause, the agent guesses.`,
      file,
      trunc3(text),
      line,
      `Add what happens otherwise: "If X, do Y. Otherwise, do Z."`
    ));
  }
  return results.slice(0, 3);
}
function checkMentalNotes(content, file) {
  const results = [];
  for (const { line, text } of indexedLines(content)) {
    for (const pattern of MENTAL_NOTE_PATTERNS) {
      if (pattern.test(text)) {
        const match = text.match(pattern);
        results.push(finding(
          "mental_note",
          "recommended",
          `Mental note: "${match?.[0]}"`,
          `LLMs don't have persistent memory within a conversation. "Remember to X" doesn't work \u2014 make it a direct instruction: "Do X when Y."`,
          file,
          trunc3(text),
          line,
          `Rewrite as a conditional action: "When Y happens, do X."`
        ));
        break;
      }
    }
  }
  return results.slice(0, 3);
}
function checkAmbiguousPronouns(content, file) {
  const results = [];
  const pronounStart = /^\s*[-*]\s+(it |this |that |these |those |den |det |disse |de )/i;
  for (const { line, text } of indexedLines(content)) {
    if (!pronounStart.test(text)) continue;
    if (/["'`]/.test(text.slice(0, 30))) continue;
    results.push(finding(
      "ambiguous_pronoun",
      "nice_to_have",
      "Rule starts with ambiguous pronoun",
      `Starting a rule with "it/this/that" requires the reader to look backwards for context. Name the subject explicitly.`,
      file,
      trunc3(text),
      line,
      `Replace the pronoun with the actual subject: "The build must..." instead of "It must..."`
    ));
  }
  return results.slice(0, 3);
}
function checkCompressiblePadding(content, file) {
  const results = [];
  for (const { line, text } of indexedLines(content)) {
    const lower = text.toLowerCase();
    for (const phrase of COMPRESSIBLE_PADDING) {
      if (lower.includes(phrase)) {
        results.push(finding(
          "compressible_padding",
          "nice_to_have",
          `Compressible padding: "${phrase}"`,
          `"${phrase}" adds words before the real instruction without changing its meaning. Tokens are limited \u2014 get to the point.`,
          file,
          trunc3(text),
          line,
          `Remove the padding. "Make sure to run tests" \u2192 "Run tests."`
        ));
        break;
      }
    }
  }
  return results.slice(0, 5);
}
function checkFileTooLong(content, file) {
  const lineCount = content.split("\n").length;
  if (lineCount <= 500) return [];
  return [finding(
    "file_too_long",
    lineCount > 800 ? "critical" : "recommended",
    `CLAUDE.md is ${lineCount} lines`,
    `Long files cause important rules to get lost (the "lost in the middle" effect). Most effective setups are under 200 lines.`,
    file,
    `${lineCount} lines total`,
    void 0,
    `Move project-specific details to project CLAUDE.md files. Move reference data to memory files.`
  )];
}
function checkLongSections(content, file) {
  const results = [];
  const lines = content.split("\n");
  let sectionStart = 0, sectionHeader = "", linesSinceHeader = 0, hasSubHeader = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^#{3,}\s+/.test(lines[i])) {
      hasSubHeader = true;
      continue;
    }
    const headerMatch = lines[i].match(/^(#{1,2})\s+(.+)/);
    if (headerMatch) {
      if (linesSinceHeader > 50 && !hasSubHeader && sectionHeader) {
        results.push(finding(
          "long_section_no_headers",
          "nice_to_have",
          `Long section without sub-headers: "${trunc3(sectionHeader, 40)}"`,
          `${linesSinceHeader} lines without structure. Break into sub-sections for better comprehension.`,
          file,
          `"${trunc3(sectionHeader, 40)}" \u2014 ${linesSinceHeader} lines`,
          sectionStart + 1,
          `Add ### sub-headers to break up the content.`
        ));
      }
      sectionStart = i;
      sectionHeader = headerMatch[2];
      linesSinceHeader = 0;
      hasSubHeader = false;
    } else {
      linesSinceHeader++;
    }
  }
  if (linesSinceHeader > 50 && !hasSubHeader && sectionHeader) {
    results.push(finding(
      "long_section_no_headers",
      "nice_to_have",
      `Long section without sub-headers: "${trunc3(sectionHeader, 40)}"`,
      `${linesSinceHeader} lines without structure.`,
      file,
      `"${trunc3(sectionHeader, 40)}" \u2014 ${linesSinceHeader} lines`,
      sectionStart + 1,
      `Add ### sub-headers to break up the content.`
    ));
  }
  return results.slice(0, 3);
}
var CONVENTION_SECTION_TITLES = /^(overview|introduction|getting started|project overview|table of contents|toc|contents|index)$/i;
function checkEmptySections(content, file) {
  const results = [];
  const lines = content.split("\n");
  let inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trim())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const headerMatch = lines[i].match(/^(#{1,3})\s+(.+)/);
    if (!headerMatch) continue;
    const sectionTitle = headerMatch[2].trim();
    let j = i + 1, hasContent = false, innerCodeBlock = false;
    while (j < lines.length) {
      if (/^```/.test(lines[j].trim())) innerCodeBlock = !innerCodeBlock;
      const trimmed = lines[j].trim();
      if (trimmed === "") {
        j++;
        continue;
      }
      if (!innerCodeBlock && /^#{1,3}\s+/.test(trimmed)) break;
      hasContent = true;
      break;
    }
    if (!hasContent) {
      if (CONVENTION_SECTION_TITLES.test(sectionTitle)) continue;
      results.push(finding(
        "empty_section",
        "nice_to_have",
        `Empty section: "${headerMatch[2]}"`,
        `Section has a header but no content. Either fill it or remove the placeholder.`,
        file,
        lines[i],
        i + 1,
        `Add content or remove the empty section.`
      ));
    }
  }
  return results;
}
function checkRedundantStackInfo(content, file, scanRoots) {
  const results = [];
  let hasPkgJson = false;
  for (const root of scanRoots) {
    try {
      if (existsSync(resolve(root, "package.json"))) hasPkgJson = true;
    } catch {
    }
  }
  if (!hasPkgJson) return results;
  const patterns = [
    /we use (react|next\.?js|vue|angular|svelte|express|fastify|node)/i,
    /our (tech )?stack (is|includes)/i,
    /built with (react|next\.?js|vue|angular|typescript|node)/i,
    /vi bruger (react|next\.?js|vue|angular|svelte|express|node)/i,
    /bygget med (react|next\.?js|vue|angular|typescript|node)/i
  ];
  for (const { line, text } of indexedLines(content)) {
    for (const p of patterns) {
      if (p.test(text)) {
        results.push(finding(
          "redundant_stack_info",
          "nice_to_have",
          "Redundant stack info",
          `This is inferrable from package.json. The agent can read your dependencies directly.`,
          file,
          trunc3(text),
          line,
          `Remove \u2014 the agent reads package.json. Only document stack choices that aren't obvious from code.`
        ));
        break;
      }
    }
  }
  return results.slice(0, 3);
}
function checkReadmeOverlap(content, file, scanRoots) {
  let readmeContent = null;
  for (const root of scanRoots) {
    for (const name of ["README.md", "readme.md", "Readme.md"]) {
      const p = resolve(root, name);
      try {
        if (existsSync(p)) {
          readmeContent = readFileSync(p, "utf-8");
          break;
        }
      } catch {
      }
    }
    if (readmeContent) break;
  }
  if (!readmeContent) return [];
  const claudeLines = new Set(content.split("\n").map((l) => l.trim()).filter((l) => l.length > 20));
  const readmeLines = new Set(readmeContent.split("\n").map((l) => l.trim()).filter((l) => l.length > 20));
  if (claudeLines.size === 0) return [];
  let overlap = 0;
  for (const line of claudeLines) if (readmeLines.has(line)) overlap++;
  const ratio = overlap / claudeLines.size;
  if (ratio >= 0.3) {
    return [finding(
      "readme_overlap",
      "recommended",
      `${Math.round(ratio * 100)}% overlap with README.md`,
      `${overlap} of ${claudeLines.size} non-trivial lines in CLAUDE.md also appear in README.md. This wastes context \u2014 the agent can read README.md directly.`,
      file,
      `${overlap} overlapping lines`,
      void 0,
      `Remove duplicated content. Reference README.md instead of copying from it.`
    )];
  }
  return [];
}
function checkUnclosedCodeBlocks(content, file) {
  const fenceMarkers = content.split("\n").filter((l) => /^```/.test(l.trim()));
  if (fenceMarkers.length % 2 !== 0) {
    return [finding(
      "unclosed_code_block",
      "recommended",
      "Unclosed code block",
      `Found ${fenceMarkers.length} fence markers (\`\`\`) \u2014 odd number means one is unclosed. Everything after the unclosed block may be misinterpreted as code.`,
      file,
      `${fenceMarkers.length} fence markers`,
      void 0,
      `Find and close the unclosed code block.`
    )];
  }
  return [];
}
function checkSectionBalance(parsed) {
  if (parsed.rules.length < 10) return [];
  const byType = { do_autonomously: 0, ask_first: 0, suggest_only: 0, prohibition: 0 };
  for (const rule of parsed.rules) byType[rule.type] = (byType[rule.type] || 0) + 1;
  const total = parsed.rules.length;
  const results = [];
  for (const [type, count] of Object.entries(byType)) {
    if (count / total > 0.6) {
      results.push(finding(
        "section_balance",
        "recommended",
        `Rule imbalance: ${Math.round(count / total * 100)}% are ${type.replace(/_/g, " ")}`,
        `${count} of ${total} rules are ${type.replace(/_/g, " ")}. A balanced setup needs a mix of do/ask/suggest/prohibit rules.`,
        "CLAUDE.md",
        `${count}/${total} rules = ${type}`,
        void 0,
        `Add rules for the under-represented categories.`
      ));
    }
    if (count === 0 && total > 15 && type !== "suggest_only") {
      results.push(finding(
        "section_balance",
        "nice_to_have",
        `No ${type.replace(/_/g, " ")} rules defined`,
        `Your setup has ${total} rules but none in the "${type.replace(/_/g, " ")}" category. This creates blind spots.`,
        "CLAUDE.md",
        `0/${total} rules for ${type}`,
        void 0,
        `Add at least a few rules for ${type.replace(/_/g, " ")}.`
      ));
    }
  }
  return results.slice(0, 2);
}
function checkMissingUpdateDate(content, file) {
  const datePatterns = [
    /\b20\d{2}[-/]\d{2}[-/]\d{2}\b/,
    // 2026-04-16
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+20\d{2}\b/i,
    /\bv\d+\.\d+/i,
    // v1.0
    /\bupdated?\b.*\b20\d{2}\b/i,
    /\blast (?:updated|modified|changed)\b/i
  ];
  if (datePatterns.some((p) => p.test(content))) return [];
  if (content.split("\n").length < 30) return [];
  return [finding(
    "missing_update_date",
    "nice_to_have",
    "No update date or version",
    `CLAUDE.md has no date or version indicator. Over time, it's hard to tell if instructions are current or stale.`,
    file,
    "No date/version pattern found",
    void 0,
    `Add a comment like "# Last updated: 2026-04-16" at the top.`
  )];
}
function checkPrioritySignalMissing(content, file) {
  const results = [];
  const sections = [];
  const lines = content.split("\n");
  let current = null;
  const priorityP = [/\b(first|most important|priority|top|critical|highest)\b/i, /\b(først|vigtigst|priorit)\b/i, /\b[1-3]\.\s/];
  for (let i = 0; i < lines.length; i++) {
    const headerMatch = lines[i].match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      if (current) sections.push(current);
      current = { header: headerMatch[2], line: i + 1, bulletCount: 0, hasPriority: false };
    } else if (current) {
      if (/^\s*[-*]\s+/.test(lines[i])) current.bulletCount++;
      if (priorityP.some((p) => p.test(lines[i]))) current.hasPriority = true;
    }
  }
  if (current) sections.push(current);
  for (const s of sections) {
    if (s.bulletCount >= 8 && !s.hasPriority) {
      results.push(finding(
        "priority_signal_missing",
        "nice_to_have",
        `Section "${trunc3(s.header, 30)}" has ${s.bulletCount} rules without priority`,
        `When a section has many rules without ordering, the agent treats them all as equally important. Mark the most critical ones.`,
        file,
        `${s.bulletCount} bullets, no priority signal`,
        s.line,
        `Add "Most important:" at the top, or number the top 3 rules.`
      ));
    }
  }
  return results.slice(0, 2);
}
function checkBrokenFileRefs(content, file) {
  const results = [];
  const seen = /* @__PURE__ */ new Set();
  const pathPattern = /(?:^|[\s`"'(])(\/(Users|home|opt|var|etc)[^\s`"')]+)/g;
  for (const { line, text } of indexedLines(content)) {
    for (const match of text.matchAll(pathPattern)) {
      const refPath = match[1];
      if (seen.has(refPath)) continue;
      seen.add(refPath);
      if (/^https?:/.test(refPath) || refPath.includes("*") || refPath.includes("{")) continue;
      if (!existsSync(refPath)) {
        results.push(finding(
          "broken_file_ref",
          "recommended",
          "Broken file reference",
          `Path "${trunc3(refPath, 60)}" does not exist. The agent will waste time looking for it.`,
          file,
          trunc3(text),
          line,
          `Remove or update the path.`
        ));
      }
    }
  }
  return results.slice(0, 10);
}
function checkBrokenMarkdownLinks(content, file) {
  const results = [];
  const fileDir = dirname(file);
  for (const { line, text } of indexedLines(content)) {
    for (const match of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
      const [, linkText, linkTarget] = match;
      if (/^(https?:|mailto:|#)/.test(linkTarget)) continue;
      if (!existsSync(resolve(fileDir, linkTarget))) {
        results.push(finding(
          "broken_markdown_link",
          "recommended",
          `Broken link: [${trunc3(linkText, 30)}]`,
          `Link target "${linkTarget}" does not exist relative to ${file}.`,
          file,
          trunc3(text),
          line,
          `Update the link target or remove the link.`
        ));
      }
    }
  }
  return results.slice(0, 10);
}
function checkHardcodedPaths(content, file) {
  const results = [];
  const seenUsers = /* @__PURE__ */ new Set();
  for (const { line, text } of indexedLines(content)) {
    for (const match of text.matchAll(/\/Users\/\w+|\/home\/\w+|C:\\Users\\\w+/g)) {
      if (seenUsers.has(match[0])) continue;
      seenUsers.add(match[0]);
      results.push(finding(
        "hardcoded_user_path",
        "nice_to_have",
        `Hardcoded user path: ${match[0]}`,
        `Platform-specific paths break when shared across machines. Use ~ or relative paths.`,
        file,
        trunc3(text),
        line,
        `Replace with ~ or $HOME.`
      ));
    }
  }
  return results.slice(0, 1);
}
function checkStaleToolRefs(content, file, installedServers) {
  const results = [];
  const seen = /* @__PURE__ */ new Set();
  for (const { line, text } of indexedLines(content)) {
    for (const match of text.matchAll(/mcp__(\w+)__/g)) {
      const server = match[1].toLowerCase();
      if (seen.has(server)) continue;
      seen.add(server);
      if (!installedServers.includes(server)) {
        results.push(finding(
          "stale_tool_ref",
          "recommended",
          `Stale MCP reference: ${server}`,
          `CLAUDE.md references MCP server "${server}" but it's not installed. The agent may try to use tools that don't exist.`,
          file,
          trunc3(text),
          line,
          `Install the server or remove the reference.`
        ));
      }
    }
  }
  return results;
}
function checkStaleToolRefReverse(allContent, installedServers) {
  const results = [];
  for (const server of installedServers) {
    if (allContent.includes(`mcp__${server}__`) || allContent.includes(server)) continue;
    results.push(finding(
      "stale_tool_ref_reverse",
      "nice_to_have",
      `Installed MCP server never referenced: ${server}`,
      `Server "${server}" is installed but not mentioned in CLAUDE.md. The agent may not know when to use it.`,
      "MCP config",
      server,
      void 0,
      `Add a note in CLAUDE.md about when to use ${server}, or uninstall if unused.`
    ));
  }
  return results.slice(0, 5);
}
function checkDeadCommandRefs(content, file) {
  const results = [];
  const cmdPattern = /`((?:\.\/|~\/|\/)[^\s`]+(?:\s[^\s`]*)?)`/g;
  for (const { line, text } of indexedLines(content)) {
    for (const match of text.matchAll(cmdPattern)) {
      const cmd = match[1].split(/\s/)[0];
      const expanded = cmd.replace(/^~/, homedir());
      if (expanded.includes("*") || expanded.includes("{")) continue;
      try {
        if (!existsSync(expanded)) {
          results.push(finding(
            "dead_command_ref",
            "recommended",
            `Referenced command may not exist: ${trunc3(cmd, 40)}`,
            `CLAUDE.md references "${cmd}" but the file doesn't exist. The agent will fail when trying to run it.`,
            file,
            trunc3(text),
            line,
            `Update the path or remove the reference.`
          ));
        }
      } catch {
      }
    }
  }
  return results.slice(0, 5);
}
function checkWrongAbstraction(content, file) {
  const results = [];
  for (const { line, text } of indexedLines(content)) {
    if (!/^\s*[-*]\s+/.test(text)) continue;
    for (const pattern of LINTER_CONFIG_PATTERNS) {
      if (pattern.test(text)) {
        results.push(finding(
          "wrong_abstraction",
          "nice_to_have",
          "Style rule belongs in a formatter config",
          `This formatting rule is better enforced by a tool (Prettier, ESLint, etc.) than by an instruction. The agent may not follow it consistently.`,
          file,
          trunc3(text),
          line,
          `Move to .prettierrc / .eslintrc. Code formatting rules in CLAUDE.md waste context and are unreliable.`
        ));
        break;
      }
    }
  }
  return results.slice(0, 3);
}
function checkMemoryStale(memoryFiles) {
  const results = [];
  const now = Date.now();
  const ninetyDays = 90 * 24 * 60 * 60 * 1e3;
  for (const mf of memoryFiles) {
    if (basename(mf.path) === "MEMORY.md") continue;
    if (!mf.lastModified) continue;
    const age = now - new Date(mf.lastModified).getTime();
    if (age > ninetyDays) {
      const days = Math.round(age / (24 * 60 * 60 * 1e3));
      results.push(finding(
        "memory_stale",
        "nice_to_have",
        `Stale memory: ${basename(mf.path)} (${days} days old)`,
        `This memory file hasn't been updated in ${days} days. Old memories may contain outdated information that misleads the agent.`,
        mf.path,
        trunc3(mf.content.split("\n")[0] || "", 60),
        void 0,
        `Review and update, or remove if no longer relevant.`
      ));
    }
  }
  return results.slice(0, 5);
}
function checkMemoryOrphan(memoryFiles) {
  const results = [];
  const indexFile = memoryFiles.find((f) => basename(f.path) === "MEMORY.md");
  if (!indexFile) return [];
  const indexContent = indexFile.content.toLowerCase();
  for (const mf of memoryFiles) {
    const name = basename(mf.path);
    if (name === "MEMORY.md") continue;
    if (!indexContent.includes(name.toLowerCase())) {
      results.push(finding(
        "memory_orphan",
        "nice_to_have",
        `Memory not indexed: ${name}`,
        `This memory file exists but isn't listed in MEMORY.md. The agent may not find it when loading context.`,
        mf.path,
        trunc3(mf.content.split("\n")[0] || "", 60),
        void 0,
        `Add an entry in MEMORY.md: "- [Title](${name}) \u2014 one-line description"`
      ));
    }
  }
  return results.slice(0, 5);
}
function checkMemoryIndexOrphan(memoryFiles) {
  const results = [];
  const indexFile = memoryFiles.find((f) => basename(f.path) === "MEMORY.md");
  if (!indexFile) return [];
  const indexDir = dirname(indexFile.path);
  for (const match of indexFile.content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    const [, linkText, linkTarget] = match;
    if (/^https?:/.test(linkTarget)) continue;
    const resolved = resolve(indexDir, linkTarget);
    if (!existsSync(resolved)) {
      results.push(finding(
        "memory_index_orphan",
        "recommended",
        `Dead memory link: [${trunc3(linkText, 30)}]`,
        `MEMORY.md references "${linkTarget}" but the file doesn't exist. This is a broken pointer in your memory index.`,
        indexFile.path,
        trunc3(`[${linkText}](${linkTarget})`),
        void 0,
        `Remove the entry from MEMORY.md or restore the file.`
      ));
    }
  }
  return results.slice(0, 5);
}
function checkMemoryTooLarge(memoryFiles) {
  const results = [];
  for (const mf of memoryFiles) {
    if (basename(mf.path) === "MEMORY.md") continue;
    if (mf.size > 5120) {
      results.push(finding(
        "memory_too_large",
        "nice_to_have",
        `Large memory file: ${basename(mf.path)} (${Math.round(mf.size / 1024)}KB)`,
        `Memory files should be concise (under 5KB). Large files waste context and may contain data better suited for a database.`,
        mf.path,
        `${Math.round(mf.size / 1024)}KB`,
        void 0,
        `Split into smaller, focused memories \u2014 or move structured data to a database/JSONL file.`
      ));
    }
  }
  return results.slice(0, 3);
}
function checkMemoryDuplicate(memoryFiles) {
  const results = [];
  const memories = memoryFiles.filter((f) => basename(f.path) !== "MEMORY.md" && f.content.length > 50);
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const aWords = topicWords2(memories[i].content);
      const bWords = topicWords2(memories[j].content);
      const sim = jaccard2(aWords, bWords);
      if (sim >= 0.6) {
        results.push(finding(
          "memory_duplicate",
          "recommended",
          `Possible duplicate memories`,
          `"${basename(memories[i].path)}" and "${basename(memories[j].path)}" have ${Math.round(sim * 100)}% topic overlap. Duplicates waste context.`,
          memories[i].path,
          `${basename(memories[i].path)} \u2194 ${basename(memories[j].path)} (${Math.round(sim * 100)}% similar)`,
          void 0,
          `Merge into one file and remove the duplicate.`
        ));
      }
    }
  }
  return results.slice(0, 3);
}
function checkMemoryMissingFrontmatter(memoryFiles) {
  const results = [];
  for (const mf of memoryFiles) {
    if (basename(mf.path) === "MEMORY.md") continue;
    const fmMatch = mf.content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      results.push(finding(
        "memory_missing_frontmatter",
        "nice_to_have",
        `Memory without frontmatter: ${basename(mf.path)}`,
        `Memory files need frontmatter (name, type, description) so the system knows when to load them.`,
        mf.path,
        trunc3(mf.content.split("\n")[0] || "", 60),
        void 0,
        `Add frontmatter: ---\\nname: ...\\ntype: feedback|user|project|reference\\ndescription: ...\\n---`
      ));
    } else {
      const fm = fmMatch[1];
      const missing = [];
      if (!/^name:/m.test(fm)) missing.push("name");
      if (!/^type:/m.test(fm)) missing.push("type");
      if (!/^description:/m.test(fm)) missing.push("description");
      if (missing.length > 0) {
        results.push(finding(
          "memory_missing_frontmatter",
          "nice_to_have",
          `Memory frontmatter incomplete: ${basename(mf.path)}`,
          `Missing fields: ${missing.join(", ")}. Complete frontmatter helps the system decide when this memory is relevant.`,
          mf.path,
          `Missing: ${missing.join(", ")}`,
          void 0,
          `Add the missing fields to the frontmatter block.`
        ));
      }
    }
  }
  return results.slice(0, 5);
}
function checkHookDangerousCommands(hooks) {
  const results = [];
  for (const hook of hooks) {
    for (const pattern of DANGEROUS_HOOK_COMMANDS) {
      if (pattern.test(hook.command)) {
        results.push(finding(
          "hook_dangerous_command",
          "critical",
          `Dangerous command in hook: ${hook.event}`,
          `Hook runs "${trunc3(hook.command, 50)}" which matches a dangerous pattern. This could cause data loss if triggered unexpectedly.`,
          hook.source,
          trunc3(hook.command, 60),
          void 0,
          `Add safeguards (confirmation, --dry-run) or remove the hook.`
        ));
        break;
      }
    }
  }
  return results.slice(0, 5);
}
function checkHookMissingCondition(hooks) {
  const results = [];
  for (const hook of hooks) {
    if (!hook.matcher) {
      results.push(finding(
        "hook_missing_condition",
        "nice_to_have",
        `Hook without matcher: ${hook.event}`,
        `This hook fires on every ${hook.event} event with no filter. If the command is expensive, it slows down every operation.`,
        hook.source,
        trunc3(hook.command, 60),
        void 0,
        `Add a "matcher" to limit when this hook runs.`
      ));
    }
  }
  return results.slice(0, 3);
}
function checkHookUnquotedVariable(hooks) {
  const results = [];
  const unquotedVar = /(?<!")(\$(?:ARGUMENTS|INPUT|FILE_PATH|TOOL_NAME))(?!")/;
  for (const hook of hooks) {
    const match = hook.command.match(unquotedVar);
    if (match) {
      const idx = hook.command.indexOf(match[1]);
      const before = hook.command.slice(0, idx);
      const quoteCount = (before.match(/"/g) || []).length;
      if (quoteCount % 2 === 0) {
        results.push(finding(
          "hook_unquoted_variable",
          "recommended",
          `Unquoted variable in hook: ${match[1]}`,
          `${match[1]} is not quoted. If it contains spaces or special characters, the shell will split it \u2014 which is a potential injection vector.`,
          hook.source,
          trunc3(hook.command, 60),
          void 0,
          `Wrap in double quotes: "${match[1]}"`
        ));
      }
    }
  }
  return results.slice(0, 3);
}
function checkHookNoTimeout(hooks) {
  const results = [];
  for (const hook of hooks) {
    if (!hook.timeout) {
      const slowPatterns = [/\bcurl\b/, /\bwget\b/, /\bnpm\b/, /\bgit\b/, /\bfetch\b/, /\bhttp/];
      if (slowPatterns.some((p) => p.test(hook.command))) {
        results.push(finding(
          "hook_no_timeout",
          "nice_to_have",
          `Hook without timeout: ${hook.event}`,
          `This hook runs a network/build command without a timeout. If the command hangs, it blocks the entire session.`,
          hook.source,
          trunc3(hook.command, 60),
          void 0,
          `Add "timeout" (in milliseconds) to the hook config.`
        ));
      }
    }
  }
  return results.slice(0, 3);
}
function checkHookStaleToolRef(hooks, installedServers) {
  const results = [];
  for (const hook of hooks) {
    for (const match of hook.command.matchAll(/mcp__(\w+)__/g)) {
      const server = match[1].toLowerCase();
      if (!installedServers.includes(server)) {
        results.push(finding(
          "hook_stale_tool_ref",
          "recommended",
          `Hook references uninstalled MCP server: ${server}`,
          `Hook in ${hook.event} calls mcp__${server}__ but that server isn't installed. The hook will fail silently.`,
          hook.source,
          trunc3(hook.command, 60),
          void 0,
          `Install the MCP server or update the hook command.`
        ));
      }
    }
  }
  return results.slice(0, 3);
}
function checkSkillMissingFrontmatter(skills) {
  const results = [];
  for (const skill of skills) {
    if (!skill.hasFrontmatter) {
      results.push(finding(
        "skill_missing_frontmatter",
        "recommended",
        `Skill without frontmatter: ${skill.name}`,
        `SKILL.md needs frontmatter (name, description) for Claude Code to discover and describe the skill correctly.`,
        skill.path,
        trunc3(skill.content.split("\n")[0] || "", 60),
        void 0,
        `Add frontmatter: ---\\nname: ${skill.name}\\ndescription: ...\\n---`
      ));
    } else if (!skill.frontmatterName || !skill.frontmatterDescription) {
      const missing = [!skill.frontmatterName && "name", !skill.frontmatterDescription && "description"].filter(Boolean);
      results.push(finding(
        "skill_missing_frontmatter",
        "nice_to_have",
        `Skill frontmatter incomplete: ${skill.name}`,
        `Missing: ${missing.join(", ")}. Incomplete frontmatter affects skill discovery and routing.`,
        skill.path,
        `Missing: ${missing.join(", ")}`,
        void 0,
        `Add the missing fields to the frontmatter block.`
      ));
    }
  }
  return results.slice(0, 5);
}
function checkSkillVagueName(skills) {
  const results = [];
  for (const skill of skills) {
    if (VAGUE_SKILL_NAMES.includes(skill.name.toLowerCase())) {
      results.push(finding(
        "skill_vague_name",
        "recommended",
        `Vague skill name: "${skill.name}"`,
        `Generic names make it hard for the agent to route tasks to the right skill. Use a specific, descriptive name.`,
        skill.path,
        skill.name,
        void 0,
        `Rename to describe what the skill does: "deploy-frontend" instead of "helper".`
      ));
    }
  }
  return results;
}
function checkSkillPromptTooShort(skills) {
  const results = [];
  for (const skill of skills) {
    const body = skill.content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    if (body.length < 100 && body.length > 0) {
      results.push(finding(
        "skill_prompt_too_short",
        "nice_to_have",
        `Skill prompt very short: ${skill.name} (${body.length} chars)`,
        `A ${body.length}-character prompt is unlikely to provide enough context for the agent to execute the skill well.`,
        skill.path,
        trunc3(body, 60),
        void 0,
        `Add more detail: what should the skill do step by step? What are the constraints?`
      ));
    }
  }
  return results.slice(0, 3);
}
function checkSkillUnrestrictedBash(skills) {
  const results = [];
  const unrestrictedPattern = /(?:allowed_?[Tt]ools|allowedTools)\s*[=:]\s*\[?\s*["']?Bash["']?\s*[\],]/;
  for (const skill of skills) {
    if (unrestrictedPattern.test(skill.content)) {
      results.push(finding(
        "skill_unrestricted_bash",
        "recommended",
        `Skill has unrestricted Bash access: ${skill.name}`,
        `Plain "Bash" in allowedTools lets the skill run any command. Scope it: "Bash(git:*)" or "Bash(npm:*)".`,
        skill.path,
        'allowedTools: ["Bash"]',
        void 0,
        `Replace with scoped access: "Bash(git:*, npm:*)" \u2014 only the commands the skill needs.`
      ));
    }
  }
  return results;
}
function checkSkillDangerousNameNoGuard(skills) {
  const results = [];
  const dangerousPatterns = [/^delete/i, /^remove/i, /^drop/i, /^deploy/i, /^push/i, /^publish/i, /^release/i];
  const safetySignals = [/confirm/i, /--dry-run/i, /are you sure/i, /double.?check/i, /verify/i, /preview/i];
  for (const skill of skills) {
    if (!dangerousPatterns.some((p) => p.test(skill.name))) continue;
    if (safetySignals.some((p) => p.test(skill.content))) continue;
    results.push(finding(
      "skill_dangerous_name_no_guard",
      "recommended",
      `Dangerous skill without safety: ${skill.name}`,
      `Skills named "${skill.name}" should include a confirmation step or dry-run option to prevent accidental execution.`,
      skill.path,
      skill.name,
      void 0,
      `Add a confirmation step: "Before executing, list what will be affected and ask for confirmation."`
    ));
  }
  return results;
}
function checkMissingVerification(parsed, content) {
  const verifyP = [/\btest\b/i, /\bbuild\b/i, /\bverif/i, /\blint\b/i, /\bci\b/i, /\btjek\b/i, /\bbyg\b/i];
  if (verifyP.some((p) => p.test(content))) return [];
  if (parsed.sections.length < 3) return [];
  return [finding(
    "missing_verification",
    "recommended",
    "No verification or testing instructions",
    `CLAUDE.md doesn't mention testing, building, or verification. Without this, the agent ships code without quality checks.`,
    "CLAUDE.md",
    "No test/build/verify/lint keywords found",
    void 0,
    `Add a Quality section: "Build must pass. Run tests before committing. Verify changes work."`
  )];
}
function checkMissingErrorHandling(content) {
  const errorP = [/\berror\b/i, /\bfail/i, /\bfallback\b/i, /\brollback\b/i, /\brecov/i, /\bfejl/i, /\bfald tilbage\b/i];
  if (errorP.some((p) => p.test(content))) return [];
  if (content.split("\n").length < 30) return [];
  return [finding(
    "missing_error_handling",
    "nice_to_have",
    "No error handling instructions",
    `CLAUDE.md doesn't mention what to do when things go wrong. Without this, the agent makes its own judgment calls on errors.`,
    "CLAUDE.md",
    "No error/fail/fallback/rollback keywords",
    void 0,
    `Add guidance: "If a build fails, fix the error before continuing. If blocked, ask the user."`
  )];
}
function checkMissingHandoffProtocol(content, parsed) {
  const handoffP = [/\bsession\b/i, /\bhandoff\b/i, /\bhand.?over\b/i, /\bresume\b/i, /\bcontext\b/i, /\bsession.?start/i, /\blearn\b/i, /\bmemory\b/i];
  if (handoffP.some((p) => p.test(content))) return [];
  if (parsed.sections.length < 4) return [];
  return [finding(
    "missing_handoff_protocol",
    "nice_to_have",
    "No session handoff protocol",
    `CLAUDE.md doesn't describe how to preserve context between sessions. Without this, each new session starts from zero.`,
    "CLAUDE.md",
    "No session/handoff/resume/memory keywords",
    void 0,
    `Add: "At session end, save learnings to memory. At session start, check git status and recent changes."`
  )];
}
function checkCognitiveBlueprint(parsed) {
  const checks = [
    { name: "Identity", patterns: [/role/i, /who/i, /roller/i, /hvem/i], present: false },
    { name: "Goals", patterns: [/goal/i, /north star/i, /mål/i, /objective/i], present: false },
    { name: "Constraints", patterns: [/autonomy/i, /ask first/i, /never/i, /prohibition/i, /grænse/i], present: false },
    { name: "Memory", patterns: [/memory/i, /learn/i, /remember/i, /hukommelse/i], present: false },
    { name: "Planning", patterns: [/workflow/i, /process/i, /protocol/i, /plan/i], present: false },
    { name: "Validation", patterns: [/quality/i, /test/i, /verify/i, /build/i, /kvalitet/i], present: false }
  ];
  const allContent = parsed.sections.map((s) => s.header + " " + s.content).join(" ");
  for (const check of checks) {
    if (check.patterns.some((p) => p.test(allContent))) check.present = true;
  }
  const present = checks.filter((c) => c.present).length;
  const missing = checks.filter((c) => !c.present).map((c) => c.name);
  if (present >= 4) return [];
  return [finding(
    "cognitive_blueprint_gap",
    present <= 2 ? "recommended" : "nice_to_have",
    `Cognitive blueprint: ${present}/6 elements (missing: ${missing.join(", ")})`,
    `A complete agent setup covers 6 areas: Identity, Goals, Constraints, Memory, Planning, and Validation. Yours has ${present}. Missing elements create blind spots.`,
    "CLAUDE.md",
    `Present: ${present}/6 \u2014 missing: ${missing.join(", ")}`,
    void 0,
    `Add sections for: ${missing.join(", ")}.`
  )];
}
var TOTAL_CHECKS = 52;
function lintClaudeMd(scanResult, parsed) {
  findingCounter = 0;
  const allFindings = [];
  const files = [];
  if (scanResult.globalClaudeMd) files.push({ content: scanResult.globalClaudeMd.content, path: scanResult.globalClaudeMd.path });
  if (scanResult.projectClaudeMd) files.push({ content: scanResult.projectClaudeMd.content, path: scanResult.projectClaudeMd.path });
  const hooks = extractHooksFromSettings(scanResult.settingsFiles);
  const skills = discoverSkills();
  const allContent = files.map((f) => f.content).join("\n");
  for (const { content, path } of files) {
    allFindings.push(
      ...checkGenericFiller(content, path),
      ...checkWeakImperatives(content, path),
      ...checkNegativeOnly(content, path),
      ...checkMissingRationale(content, path),
      ...checkBuriedCriticalRules(content, path),
      ...checkEscapeHatchMissing(content, path),
      ...checkCompoundInstructions(content, path),
      ...checkNakedConditionals(content, path),
      ...checkMentalNotes(content, path),
      ...checkAmbiguousPronouns(content, path),
      ...checkCompressiblePadding(content, path)
    );
  }
  allFindings.push(
    ...checkDuplicateRules(parsed),
    ...checkAmbiguousRules(parsed),
    ...checkRuleContradictions(parsed),
    ...detectSemanticConflicts(
      parsed,
      new Map(files.map((f) => [f.path, f.content])),
      {},
      makeId
    ),
    ...detectOverSpecification(
      parsed,
      new Map(files.map((f) => [f.path, f.content])),
      {},
      makeId
    )
  );
  for (const { content, path } of files) {
    allFindings.push(
      ...checkFileTooLong(content, path),
      ...checkLongSections(content, path),
      ...checkEmptySections(content, path),
      ...checkRedundantStackInfo(content, path, scanResult.scanRoots),
      ...checkReadmeOverlap(content, path, scanResult.scanRoots),
      ...checkUnclosedCodeBlocks(content, path),
      ...checkMissingUpdateDate(content, path),
      ...checkPrioritySignalMissing(content, path)
    );
  }
  allFindings.push(...checkSectionBalance(parsed));
  for (const { content, path } of files) {
    allFindings.push(
      ...checkBrokenFileRefs(content, path),
      ...checkBrokenMarkdownLinks(content, path),
      ...checkHardcodedPaths(content, path),
      ...checkStaleToolRefs(content, path, scanResult.installedServers),
      ...checkDeadCommandRefs(content, path),
      ...checkWrongAbstraction(content, path)
    );
  }
  allFindings.push(...checkStaleToolRefReverse(allContent, scanResult.installedServers));
  allFindings.push(
    ...checkMemoryStale(scanResult.memoryFiles),
    ...checkMemoryOrphan(scanResult.memoryFiles),
    ...checkMemoryIndexOrphan(scanResult.memoryFiles),
    ...checkMemoryTooLarge(scanResult.memoryFiles),
    ...checkMemoryDuplicate(scanResult.memoryFiles),
    ...checkMemoryMissingFrontmatter(scanResult.memoryFiles)
  );
  allFindings.push(
    ...checkHookDangerousCommands(hooks),
    ...checkHookMissingCondition(hooks),
    ...checkHookUnquotedVariable(hooks),
    ...checkHookNoTimeout(hooks),
    ...checkHookStaleToolRef(hooks, scanResult.installedServers)
  );
  allFindings.push(
    ...checkSkillMissingFrontmatter(skills),
    ...checkSkillVagueName(skills),
    ...checkSkillPromptTooShort(skills),
    ...checkSkillUnrestrictedBash(skills),
    ...checkSkillDangerousNameNoGuard(skills)
  );
  allFindings.push(
    ...checkMissingVerification(parsed, allContent),
    ...checkMissingErrorHandling(allContent),
    ...checkMissingHandoffProtocol(allContent, parsed),
    ...checkCognitiveBlueprint(parsed)
  );
  const severityOrder = { critical: 0, recommended: 1, nice_to_have: 2 };
  allFindings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const summary = {
    totalChecks: TOTAL_CHECKS,
    totalFindings: allFindings.length,
    bySeverity: {
      critical: allFindings.filter((f) => f.severity === "critical").length,
      recommended: allFindings.filter((f) => f.severity === "recommended").length,
      nice_to_have: allFindings.filter((f) => f.severity === "nice_to_have").length
    },
    byCheck: {}
  };
  for (const f of allFindings) {
    summary.byCheck[f.check] = (summary.byCheck[f.check] || 0) + 1;
  }
  return { findings: allFindings, summary };
}

// ../research/calibration/2026-04-22-claude-md-corpus-v2/score-corpus.ts
function buildMinimalScan(repo, claudeMdContent) {
  const fileInfo = {
    path: `synthetic://${repo}/CLAUDE.md`,
    content: claudeMdContent,
    size: claudeMdContent.length,
    lastModified: /* @__PURE__ */ new Date()
  };
  return {
    scope: "global",
    scanRoots: [`synthetic://${repo}/`],
    globalClaudeMd: fileInfo,
    projectClaudeMd: null,
    memoryFiles: [],
    settingsFiles: [],
    hooksCount: 0,
    skillsCount: 0,
    scheduledTasksCount: 0,
    commandsCount: 0,
    mcpServersCount: 0,
    installedServers: [],
    competingFormats: { cursorrules: false, agentsMd: false, copilotInstructions: false },
    projectsObserved: 0
  };
}
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}
function histogram(sorted, bins) {
  const h = {};
  for (let i = 0; i < bins.length - 1; i += 1) {
    const label = `${bins[i]}-${bins[i + 1] - 1}`;
    h[label] = sorted.filter((v) => v >= bins[i] && v < bins[i + 1]).length;
  }
  return h;
}
function stdev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sqs = values.map((v) => (v - mean) ** 2);
  return Math.sqrt(sqs.reduce((a, b) => a + b, 0) / (values.length - 1));
}
async function main() {
  const HERE = import.meta.dirname ?? __dirname;
  const DATA_DIR = join2(HERE, "data");
  const RAW_DIR = join2(DATA_DIR, "raw");
  const MANIFEST = join2(DATA_DIR, "manifest.jsonl");
  const OUT_SCORES = join2(DATA_DIR, "scores.jsonl");
  const OUT_SUMMARY = join2(DATA_DIR, "summary.json");
  if (!existsSync2(MANIFEST)) {
    console.error(`manifest.jsonl missing \u2014 run fetch.mjs first`);
    process.exit(1);
  }
  const manifest = [];
  for (const line of readFileSync2(MANIFEST, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      manifest.push(JSON.parse(line));
    } catch {
    }
  }
  console.log(`Scoring ${manifest.length} files...`);
  const done = /* @__PURE__ */ new Set();
  if (existsSync2(OUT_SCORES)) {
    for (const line of readFileSync2(OUT_SCORES, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        done.add(r.repo);
      } catch {
      }
    }
    console.log(`scores.jsonl has ${done.size} rows \u2014 resuming`);
  } else {
    writeFileSync(OUT_SCORES, "");
  }
  const rows = [];
  for (const entry of manifest) {
    if (done.has(entry.repo)) continue;
    let content;
    try {
      content = readFileSync2(join2(RAW_DIR, entry.file), "utf-8");
    } catch {
      continue;
    }
    const scan = buildMinimalScan(entry.repo, content);
    const parsed = parse(scan);
    const scoringResult = score(parsed, scan);
    const lintResult = lintClaudeMd(scan, parsed);
    const byCheck = {};
    for (const f of lintResult.findings) {
      byCheck[f.check] = (byCheck[f.check] || 0) + 1;
    }
    const pureCategories = ["roleClarity", "communication", "autonomyBalance", "coverage"];
    const pureWeights = { roleClarity: 0.15, communication: 0.1, autonomyBalance: 0.2, coverage: 0.1 };
    const pureWeightSum = pureCategories.reduce((s, k) => s + pureWeights[k], 0);
    const signalSensitiveScore = Math.round(
      pureCategories.reduce(
        (s, k) => s + scoringResult.categories[k].score * pureWeights[k] / pureWeightSum,
        0
      )
    );
    const trimmed = content.trim();
    const isEmpty = trimmed.length < 20;
    const agentsMdRedirect = /AGENTS\.md/i.test(trimmed) && trimmed.length < 500;
    const row = {
      idx: entry.idx,
      repo: entry.repo,
      stars: entry.stars,
      language: entry.language,
      size: entry.size,
      sizeBucket: entry.sizeBucket,
      starsBucket: entry.starsBucket,
      collabScore: scoringResult.collaborationScore,
      categories: {
        roleClarity: scoringResult.categories.roleClarity.score,
        communication: scoringResult.categories.communication.score,
        autonomyBalance: scoringResult.categories.autonomyBalance.score,
        qualityStandards: scoringResult.categories.qualityStandards.score,
        memoryHealth: scoringResult.categories.memoryHealth.score,
        systemMaturity: scoringResult.categories.systemMaturity.score,
        coverage: scoringResult.categories.coverage.score
      },
      signalSensitiveScore,
      rules: {
        total: parsed.rules.length,
        doRules: parsed.rules.filter((r) => r.type === "do_autonomously").length,
        askRules: parsed.rules.filter((r) => r.type === "ask_first").length,
        suggestRules: parsed.rules.filter((r) => r.type === "suggest_only").length,
        prohibitions: parsed.rules.filter((r) => r.type === "prohibition").length
      },
      sections: parsed.sections.map((s) => s.id).filter((s) => s !== "other"),
      lint: {
        total: lintResult.summary.totalFindings,
        critical: lintResult.summary.bySeverity.critical,
        recommended: lintResult.summary.bySeverity.recommended,
        nice: lintResult.summary.bySeverity.nice_to_have,
        byCheck
      },
      intentionalAutonomy: scoringResult.intentionalAutonomy,
      isRedirect: agentsMdRedirect,
      isEmpty
    };
    rows.push(row);
    appendFileSync(OUT_SCORES, JSON.stringify(row) + "\n");
    if (rows.length % 100 === 0) {
      console.log(`  scored ${rows.length} files...`);
    }
  }
  const allRows = [];
  for (const line of readFileSync2(OUT_SCORES, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      allRows.push(JSON.parse(line));
    } catch {
    }
  }
  console.log(`Total rows in scores.jsonl: ${allRows.length}`);
  const collab = allRows.map((r) => r.collabScore).sort((a, b) => a - b);
  const pure = allRows.map((r) => r.signalSensitiveScore).sort((a, b) => a - b);
  const bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 101];
  function distStats(sorted) {
    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length * 10) / 10,
      stdev: Math.round(stdev(sorted) * 10) / 10,
      p10: percentile(sorted, 0.1),
      p25: percentile(sorted, 0.25),
      median: percentile(sorted, 0.5),
      p75: percentile(sorted, 0.75),
      p90: percentile(sorted, 0.9),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      histogram: histogram(sorted, bins)
    };
  }
  function breakdown(keyFn, metric) {
    const groups = /* @__PURE__ */ new Map();
    for (const r of allRows) {
      const k = keyFn(r);
      const arr = groups.get(k) ?? [];
      arr.push(metric(r));
      groups.set(k, arr);
    }
    const out = {};
    for (const [k, arr] of groups) {
      arr.sort((a, b) => a - b);
      out[k] = {
        n: arr.length,
        min: arr[0],
        max: arr[arr.length - 1],
        mean: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10,
        median: percentile(arr, 0.5)
      };
    }
    return out;
  }
  const summary = {
    corpusSize: allRows.length,
    collab: distStats(collab),
    pure: distStats(pure),
    categoriesMean: {
      roleClarity: Math.round(allRows.reduce((s, r) => s + r.categories.roleClarity, 0) / allRows.length),
      communication: Math.round(allRows.reduce((s, r) => s + r.categories.communication, 0) / allRows.length),
      autonomyBalance: Math.round(allRows.reduce((s, r) => s + r.categories.autonomyBalance, 0) / allRows.length),
      qualityStandards: Math.round(allRows.reduce((s, r) => s + r.categories.qualityStandards, 0) / allRows.length),
      memoryHealth: Math.round(allRows.reduce((s, r) => s + r.categories.memoryHealth, 0) / allRows.length),
      systemMaturity: Math.round(allRows.reduce((s, r) => s + r.categories.systemMaturity, 0) / allRows.length),
      coverage: Math.round(allRows.reduce((s, r) => s + r.categories.coverage, 0) / allRows.length)
    },
    lintTotals: (() => {
      const allChecks = {};
      for (const r of allRows) {
        for (const [k, v] of Object.entries(r.lint.byCheck)) {
          allChecks[k] = (allChecks[k] || 0) + v;
        }
      }
      return allChecks;
    })(),
    lintBySeverity: {
      critical: allRows.reduce((s, r) => s + r.lint.critical, 0),
      recommended: allRows.reduce((s, r) => s + r.lint.recommended, 0),
      nice: allRows.reduce((s, r) => s + r.lint.nice, 0)
    },
    lintMean: Math.round(allRows.reduce((s, r) => s + r.lint.total, 0) / allRows.length),
    intentionalAutonomyCount: allRows.filter((r) => r.intentionalAutonomy).length,
    redirects: allRows.filter((r) => r.isRedirect).length,
    empty: allRows.filter((r) => r.isEmpty).length,
    byStars: {
      collab: breakdown((r) => r.starsBucket, (r) => r.collabScore),
      pure: breakdown((r) => r.starsBucket, (r) => r.signalSensitiveScore)
    },
    bySize: {
      collab: breakdown((r) => r.sizeBucket, (r) => r.collabScore),
      pure: breakdown((r) => r.sizeBucket, (r) => r.signalSensitiveScore)
    },
    byLanguage: (() => {
      const counts = /* @__PURE__ */ new Map();
      for (const r of allRows) {
        const k = r.language ?? "unknown";
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([lang]) => lang);
      const topSet = new Set(top);
      return breakdown(
        (r) => topSet.has(r.language ?? "unknown") ? r.language ?? "unknown" : "other",
        (r) => r.collabScore
      );
    })(),
    lowest5: [...allRows].sort((a, b) => a.collabScore - b.collabScore).slice(0, 5).map((r) => ({
      idx: r.idx,
      repo: r.repo,
      collab: r.collabScore,
      pure: r.signalSensitiveScore,
      size: r.size,
      stars: r.stars
    })),
    highest5: [...allRows].sort((a, b) => b.collabScore - a.collabScore).slice(0, 5).map((r) => ({
      idx: r.idx,
      repo: r.repo,
      collab: r.collabScore,
      pure: r.signalSensitiveScore,
      size: r.size,
      stars: r.stars
    })),
    highestPure5: [...allRows].sort((a, b) => b.signalSensitiveScore - a.signalSensitiveScore).slice(0, 5).map((r) => ({
      idx: r.idx,
      repo: r.repo,
      collab: r.collabScore,
      pure: r.signalSensitiveScore,
      size: r.size,
      stars: r.stars
    }))
  };
  writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2));
  console.log(`
Summary: data/summary.json`);
  console.log(`Collab: mean=${summary.collab.mean} median=${summary.collab.median} p90=${summary.collab.p90} p99=${summary.collab.p99}`);
  console.log(`Pure:   mean=${summary.pure.mean} median=${summary.pure.median} p90=${summary.pure.p90} p99=${summary.pure.p99}`);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
