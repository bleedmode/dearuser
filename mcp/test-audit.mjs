// Smoke test — run audit on Jarl's real PVS setup and dump the report.
import { runAudit, formatAuditReport } from './dist/tools/audit.js';

const report = runAudit({ scope: 'global', focus: 'all' });

console.log(formatAuditReport(report));
console.log('\n\n====== RAW GRAPH ======');
console.log('Nodes:', report.graph.nodeCount);
console.log('Edges:', report.graph.edgeCount);
console.log('By type:', report.graph.byType);
console.log('Closure rate:', report.graph.closureRate);
console.log('Findings:', report.findings.length);
