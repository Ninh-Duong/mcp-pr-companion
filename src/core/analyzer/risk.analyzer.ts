import { ParsedFileDiff } from './diff.parser.js';
import { ClassificationResult } from './change.classifier.js';
import path from 'path';

export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface RiskAnalysisResult {
  level: RiskLevel;
  tags: string[];
  evidence: string[];
}

export class RiskAnalyzer {
  static analyze(fileDiff: ParsedFileDiff, classification: ClassificationResult): RiskAnalysisResult {
    const tags: string[] = [];
    const evidence: string[] = [];
    const filepath = fileDiff.newPath || fileDiff.oldPath || '';
    const ext = path.extname(filepath).toLowerCase();
    const basename = path.basename(filepath);

    // Rule 0: Non-functional changes (comment_only, whitespace_only, formatting_only, documentation_only) have no risk
    if (!classification.functionalChange) {
      return {
        level: 'none',
        tags: [],
        evidence: ['No functional changes in code or configuration']
      };
    }

    const addedLines: string[] = [];
    const deletedLines: string[] = [];
    for (const hunk of fileDiff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') addedLines.push(line.content);
        if (line.type === 'delete') deletedLines.push(line.content);
      }
    }
    const allChangedText = [...addedLines, ...deletedLines].join('\n');

    // 1. API Route & Contract Changes (public_api)
    if (basename.includes('Controller') || ext === '.proto') {
      const hasRouteAttr = /\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|Route)\b/i.test(allChangedText);
      const hasPublicActionSignature = /public\s+async\s+Task<[^>]+>\s+\w+\s*\(/i.test(allChangedText) || /public\s+\w+\s+\w+\s*\([^)]*\)/i.test(allChangedText);
      const hasProtoRpc = /rpc\s+\w+\s*\(/i.test(allChangedText);

      if (hasRouteAttr || hasProtoRpc) {
        tags.push('public_api');
        evidence.push('API endpoint route or gRPC RPC method definition modified');
      } else if (hasPublicActionSignature) {
        tags.push('public_api');
        evidence.push('Public Controller action method signature modified');
      }
    }

    // 2. Authentication & Authorization Security (auth_security)
    if (
      /\[Authorize\b/i.test(allChangedText) ||
      /\[AllowAnonymous\]/i.test(allChangedText) ||
      /jwt|token|bearer|claim|permission|rbac|identity/i.test(filepath) ||
      /jwt|token|bearer|claim|permission|rbac|password|hash|encrypt|secret/i.test(allChangedText)
    ) {
      tags.push('auth_security');
      evidence.push('Authentication, authorization, or security sensitive logic modified');
    }

    // 3. Database Schema & Migration (database_schema)
    if (
      classification.kind === 'database_migration' ||
      /migrationBuilder\.(CreateTable|DropTable|AddColumn|DropColumn|AlterColumn)/i.test(allChangedText) ||
      /CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE/i.test(allChangedText)
    ) {
      tags.push('database_schema');
      evidence.push('Database table or column structure altered');
    }

    // 4. Proto Contract (proto_contract)
    if (ext === '.proto') {
      tags.push('proto_contract');
      evidence.push('gRPC protocol buffer contract file modified');
    }

    // 5. Secret / Config / Environment (secret_config)
    if (
      classification.kind === 'configuration' ||
      basename === 'appsettings.json' ||
      basename.endsWith('.env') ||
      /apiKey|ConnectionString|Password|Secret/i.test(allChangedText)
    ) {
      tags.push('secret_config');
      evidence.push('Application configuration or secret property modified');
    }

    // 6. Dependency Version Changes (dependency)
    if (classification.kind === 'dependency_change') {
      tags.push('dependency');
      evidence.push('External dependency manifest or lockfile modified');
    }

    // 7. Concurrency / Transaction Logic (concurrency_transaction)
    if (
      /TransactionScope|BeginTransactionAsync|lock\s*\(|SemaphoreSlim|Monitor\./i.test(allChangedText)
    ) {
      tags.push('concurrency_transaction');
      evidence.push('Database transaction or thread concurrency sync primitive modified');
    }

    // Assign overall Risk Level
    let level: RiskLevel = 'none';
    if (tags.includes('auth_security') || tags.includes('database_schema')) {
      level = 'high';
    } else if (tags.includes('public_api') || tags.includes('secret_config') || tags.includes('concurrency_transaction')) {
      level = 'medium';
    } else if (tags.length > 0) {
      level = 'low';
    } else if (classification.kind === 'functional_logic') {
      level = 'low';
    }

    return {
      level,
      tags,
      evidence
    };
  }
}
