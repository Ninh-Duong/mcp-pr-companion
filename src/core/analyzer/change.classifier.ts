import { ParsedFileDiff } from './diff.parser.js';
import path from 'path';

export type ChangeKind =
  | 'comment_only'
  | 'whitespace_only'
  | 'formatting_only'
  | 'test_only'
  | 'documentation_only'
  | 'generated_only'
  | 'functional_logic'
  | 'api_contract'
  | 'database_migration'
  | 'configuration'
  | 'dependency_change'
  | 'mixed'
  | 'unknown';

export interface ClassificationResult {
  kind: ChangeKind;
  functionalChange: boolean;
  confidence: number;
  evidence: string[];
}

export class ChangeClassifier {
  static classify(fileDiff: ParsedFileDiff): ClassificationResult {
    const evidence: string[] = [];
    const filepath = fileDiff.newPath || fileDiff.oldPath || '';
    const ext = path.extname(filepath).toLowerCase();
    const basename = path.basename(filepath);

    if (fileDiff.isBinary) {
      return {
        kind: 'unknown',
        functionalChange: true,
        confidence: 0.9,
        evidence: ['Binary file modification']
      };
    }

    if (fileDiff.additions === 0 && fileDiff.deletions === 0) {
      if (fileDiff.status === 'renamed' || fileDiff.status === 'copied') {
        return {
          kind: 'formatting_only',
          functionalChange: false,
          confidence: 1.0,
          evidence: [`File ${fileDiff.status} with 0 line changes`]
        };
      }
      return {
        kind: 'whitespace_only',
        functionalChange: false,
        confidence: 1.0,
        evidence: ['Zero line changes in diff']
      };
    }

    // 1. Generated Code Detection
    if (
      basename.endsWith('.designer.cs') ||
      basename.endsWith('.g.cs') ||
      basename.endsWith('.generated.cs') ||
      filepath.includes('/generated/') ||
      filepath.includes('\\generated\\') ||
      filepath.endsWith('.min.js') ||
      filepath.endsWith('.min.css')
    ) {
      return {
        kind: 'generated_only',
        functionalChange: true,
        confidence: 0.95,
        evidence: ['Auto-generated code or minified asset detected by filename pattern']
      };
    }

    // 2. Documentation Detection
    if (ext === '.md' || ext === '.txt' || ext === '.rst' || basename === 'LICENSE' || basename === 'CHANGELOG.md') {
      return {
        kind: 'documentation_only',
        functionalChange: false,
        confidence: 1.0,
        evidence: ['Documentation file modified']
      };
    }

    // 3. Configuration & Dependency Files
    if (
      basename === 'package.json' ||
      basename === 'package-lock.json' ||
      basename === 'yarn.lock' ||
      basename === 'pnpm-lock.yaml' ||
      basename.endsWith('.csproj') ||
      basename.endsWith('.props') ||
      basename.endsWith('.targets')
    ) {
      const isDepLock = basename.includes('lock') || basename === 'package.json';
      return {
        kind: isDepLock ? 'dependency_change' : 'configuration',
        functionalChange: true,
        confidence: 0.95,
        evidence: [`Project configuration or dependency manifest modified: ${basename}`]
      };
    }

    if (ext === '.json' || ext === '.yaml' || ext === '.yml' || ext === '.env' || ext === '.config' || ext === '.ini') {
      return {
        kind: 'configuration',
        functionalChange: true,
        confidence: 0.9,
        evidence: [`Configuration file modified: ${ext}`]
      };
    }

    // 4. Database Migration Detection
    if (
      filepath.includes('/Migrations/') ||
      filepath.includes('\\Migrations\\') ||
      basename.includes('Add_Table') ||
      basename.includes('Add_Column') ||
      (ext === '.sql' && (filepath.includes('/migrations/') || filepath.includes('/schema/')))
    ) {
      return {
        kind: 'database_migration',
        functionalChange: true,
        confidence: 0.95,
        evidence: ['Database migration script or entity framework migration class modified']
      };
    }

    // 5. Test File Detection
    const isTestFile =
      filepath.includes('/tests/') ||
      filepath.includes('\\tests\\') ||
      filepath.includes('/test/') ||
      filepath.includes('\\test\\') ||
      basename.endsWith('Test.cs') ||
      basename.endsWith('Tests.cs') ||
      basename.endsWith('.test.ts') ||
      basename.endsWith('.spec.ts') ||
      basename.endsWith('_test.go');

    // Inspect line changes for comment-only / whitespace-only analysis
    const addedLines: string[] = [];
    const deletedLines: string[] = [];

    for (const hunk of fileDiff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') addedLines.push(line.content);
        if (line.type === 'delete') deletedLines.push(line.content);
      }
    }

    const isAllWhitespace =
      addedLines.every(l => l.trim() === '') &&
      deletedLines.every(l => l.trim() === '');

    if (isAllWhitespace) {
      return {
        kind: 'whitespace_only',
        functionalChange: false,
        confidence: 1.0,
        evidence: ['All added and deleted lines contain only whitespace']
      };
    }

    // Language-aware comment check
    const isCommentLine = (line: string): boolean => {
      const trimmed = line.trim();
      if (!trimmed) return true; // empty line

      if (['.cs', '.ts', '.js', '.java', '.go', '.cpp', '.c', '.h', '.swift', '.kt'].includes(ext)) {
        return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.endsWith('*/');
      }
      if (['.py', '.sh', '.yaml', '.yml', '.rb', '.tf', '.toml', '.ps1'].includes(ext)) {
        return trimmed.startsWith('#');
      }
      if (ext === '.sql') {
        return trimmed.startsWith('--') || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
      }
      if (['.html', '.xml', '.svg', '.razor'].includes(ext)) {
        return trimmed.startsWith('<!--') || trimmed.startsWith('-->');
      }
      return false;
    };

    const allAddedAreComments = addedLines.every(isCommentLine);
    const allDeletedAreComments = deletedLines.every(isCommentLine);

    if (allAddedAreComments && allDeletedAreComments) {
      return {
        kind: isTestFile ? 'test_only' : 'comment_only',
        functionalChange: false,
        confidence: 1.0,
        evidence: [
          isTestFile ? 'Only comment changes in test file' : 'Only comment and whitespace lines changed'
        ]
      };
    }

    // 6. Test File with Functional Changes
    if (isTestFile) {
      return {
        kind: 'test_only',
        functionalChange: false,
        confidence: 0.95,
        evidence: ['Test code modified']
      };
    }

    // 7. gRPC Proto API Contract
    if (ext === '.proto') {
      return {
        kind: 'api_contract',
        functionalChange: true,
        confidence: 0.95,
        evidence: ['gRPC protocol buffer schema modified']
      };
    }

    // Default to functional_logic with evidence
    return {
      kind: 'functional_logic',
      functionalChange: true,
      confidence: 0.85,
      evidence: ['Functional code modifications present']
    };
  }
}
