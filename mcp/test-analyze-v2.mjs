// Smoke test — run extended analyze and print the sections that are new in week 2.
import { runAnalysis } from './dist/tools/analyze.js';

const report = runAnalysis('/Users/karlomacmini/clawd/dearuser', {
  scope: 'global',
  includeGit: true,
});

console.log('=== Git Summary ===');
if (report.git) {
  console.log(`Scanned: ${report.git.totalScanned} repos`);
  console.log(`Active (7d): ${report.git.active}, Stale (60d+): ${report.git.stale}`);
  console.log(`Revert signals: ${report.git.reposWithRevertSignals}, Uncommitted piles: ${report.git.reposWithUncommittedPile}`);
  console.log('\nTop active:');
  for (const r of report.git.topActive) {
    console.log(`  ${r.name}: ${r.commits7d} commits last 7d, ${r.commits30d} last 30d`);
  }
}

console.log('\n=== Proactive Recommendations ===');
const proactiveKeywords = [
  'Wrap', 'stale project', '/clear', 'fix again', 'uncommitted', 'structured storage',
];
for (const r of report.recommendations) {
  if (proactiveKeywords.some(k => r.title.includes(k))) {
    console.log(`\n[${r.priority}] ${r.title}`);
    console.log(`  ${r.description.slice(0, 180)}${r.description.length > 180 ? '...' : ''}`);
    if (r.evidence.length > 0) {
      console.log('  Evidence:');
      for (const ev of r.evidence.slice(0, 2)) {
        console.log(`    - ${ev.source}: ${ev.excerpt.slice(0, 100)}`);
      }
    }
  }
}

console.log('\n=== Summary ===');
console.log(`Total recommendations: ${report.recommendations.length}`);
console.log(`  Agent-facing: ${report.recommendations.filter(r => r.audience === 'agent' || r.audience === 'both').length}`);
console.log(`  User-facing: ${report.recommendations.filter(r => r.audience === 'user' || r.audience === 'both').length}`);
console.log(`Collaboration score: ${report.collaborationScore}/100`);
