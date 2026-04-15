// Smoke test — run security scan on Jarl's real setup.
import { runSecurity, formatSecurityReport } from './dist/tools/security.js';

const report = runSecurity({ scope: 'global' });

console.log(formatSecurityReport(report));

console.log('\n\n=== RAW COUNTS ===');
console.log('Secrets:', report.secrets.length);
console.log('Injection:', report.injection.length);
console.log('Rule conflicts:', report.ruleConflicts.length);
console.log('Summary:', report.summary);
