import { DiffParser } from './diff.parser.js';
import { SymbolExtractor } from './symbol.extractor.js';
import { ChangeClassifier } from './change.classifier.js';
import { RiskAnalyzer } from './risk.analyzer.js';

export class ASTExtractor {
  /**
   * Legacy compatibility wrapper: extracts human-readable highlights per file using the new analyzer pipeline.
   */
  static extractHighlights(files: string[], rawDiff: string): Record<string, string[]> {
    const highlightsByFile: Record<string, string[]> = {};
    if (!rawDiff) return highlightsByFile;

    const parsedDiff = DiffParser.parse(rawDiff);

    for (const fileDiff of parsedDiff.files) {
      const fileBasename = fileDiff.newPath ? fileDiff.newPath.split('/').pop()! : '';
      if (!fileBasename) continue;

      const classification = ChangeClassifier.classify(fileDiff);
      const risk = RiskAnalyzer.analyze(fileDiff, classification);
      const symbols = SymbolExtractor.extractSymbols(fileDiff, classification.kind === 'comment_only');

      const highlights: string[] = [];

      // Add evidence from classification & risk
      for (const ev of classification.evidence) {
        highlights.push(ev);
      }
      for (const ev of risk.evidence) {
        if (!highlights.includes(ev)) {
          highlights.push(ev);
        }
      }

      // Add symbols
      for (const sym of symbols) {
        const symDesc = `${sym.kind.toUpperCase()}: ${sym.name} (${sym.change})`;
        if (!highlights.includes(symDesc)) {
          highlights.push(symDesc);
        }
      }

      if (highlights.length > 0) {
        highlightsByFile[fileBasename] = highlights.slice(0, 8);
      }
    }

    return highlightsByFile;
  }
}
