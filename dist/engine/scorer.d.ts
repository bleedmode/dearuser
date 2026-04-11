import type { CategoryScore, ParseResult, ScanResult } from '../types.js';
type CategoryId = 'roleClarity' | 'communication' | 'autonomyBalance' | 'qualityStandards' | 'memoryHealth' | 'systemMaturity' | 'coverage';
interface ScoringResult {
    categories: Record<CategoryId, CategoryScore>;
    collaborationScore: number;
}
export declare function score(parsed: ParseResult, scan: ScanResult): ScoringResult;
export {};
//# sourceMappingURL=scorer.d.ts.map