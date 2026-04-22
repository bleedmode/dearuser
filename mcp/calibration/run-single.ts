// run-single.mjs — runs the three Dear User scorers against the current $HOME
// and prints a JSON result to stdout. Intended to be spawned by harness.mjs
// with HOME overridden to point at a fixture directory.
//
// Output: { collab, health, security, scanSummary }

import { scan } from '../src/engine/scanner.js';
import { parse } from '../src/engine/parser.js';
import { score as scoreCollab } from '../src/engine/scorer.js';
import { scanArtifacts } from '../src/engine/audit-scanner.js';
import { buildGraph } from '../src/engine/audit-graph.js';
import { runDetectors } from '../src/engine/audit-detectors.js';
import { scoreSystemHealth } from '../src/engine/system-health-scorer.js';
import { scanSecrets } from '../src/engine/secret-scanner.js';
import { detectInjection } from '../src/engine/injection-detector.js';
import { detectRuleConflicts } from '../src/engine/rule-conflict-detector.js';
import { scoreSecurity } from '../src/engine/security-scorer.js';

const scanResult = scan();
const parsed = parse(scanResult);
const collab = scoreCollab(parsed, scanResult);

const artifacts = scanArtifacts();
const graph = buildGraph(artifacts);
const findings = runDetectors(graph);
const health = scoreSystemHealth(findings);

const claudeMdFiles = [scanResult.globalClaudeMd, scanResult.projectClaudeMd].filter(Boolean);
const secrets = scanSecrets(artifacts, claudeMdFiles, scanResult.memoryFiles);
const injections = detectInjection(artifacts);
const conflicts = detectRuleConflicts(parsed.rules, artifacts);
const security = scoreSecurity({
  secrets,
  injection: injections,
  ruleConflicts: conflicts,
  cveFindings: [],
  platformFindings: [],
  platformStatus: [],
});

const result = {
  collab: {
    blended: collab.collaborationScore,
    claudeMdSubScore: collab.claudeMdSubScore,
    substrateEmpty: collab.substrateEmpty,
    intentionalAutonomy: collab.intentionalAutonomy,
    categories: Object.fromEntries(
      Object.entries(collab.categories).map(([k, v]) => [k, v.score]),
    ),
  },
  health: {
    score: health.systemHealthScore,
    findingCount: findings.length,
    findingsByType: findings.reduce((acc, f) => {
      acc[f.type] = (acc[f.type] ?? 0) + 1;
      return acc;
    }, {}),
    categories: Object.fromEntries(
      Object.entries(health.categories).map(([k, v]) => [k, v.score]),
    ),
  },
  security: {
    score: security.securityScore,
    secrets: secrets.length,
    injections: injections.length,
    conflicts: conflicts.length,
    categories: Object.fromEntries(
      Object.entries(security.categories).map(([k, v]) => [k, v.score]),
    ),
  },
  scanSummary: {
    home: process.env.HOME,
    hooksCount: scanResult.hooksCount,
    skillsCount: scanResult.skillsCount,
    scheduledTasksCount: scanResult.scheduledTasksCount,
    commandsCount: scanResult.commandsCount,
    mcpServersCount: scanResult.mcpServersCount,
    memoryFilesCount: scanResult.memoryFiles.length,
    artifactCount: artifacts.length,
  },
};

console.log(JSON.stringify(result, null, 2));
