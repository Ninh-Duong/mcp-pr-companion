import fs from 'fs';
import path from 'path';
import { ConfigLoader } from '../../config/config.loader.js';
import { CategorizedModule, ModuleClassifier } from '../analyzer/module.classifier.js';
import { ASTExtractor } from '../analyzer/ast.extractor.js';
import { GitExecutor } from '../git/git.executor.js';
import { GitParser } from '../git/git.parser.js';
import { BitbucketService } from '../bitbucket/bitbucket.service.js';
import { Logger } from '../../utils/logger.js';
import { StorePathResolver } from '../output/store-path.resolver.js';

export interface PRPayloadOptions {
  prUrl?: string;
  sourceBranch?: string;
  targetBranch?: string;
  repoPath?: string;
}

export class PayloadBuilder {
  static async build(options: PRPayloadOptions = {}) {
    const config = ConfigLoader.load();
    let rawPayloadData: any;
    let identifier = 'local';

    const effectivePrUrl = options.prUrl || config.default_pr_url || config.bitbucket?.default_pr_url || 
      (config.bitbucket?.workspace && config.bitbucket.workspace.includes('bitbucket.org') ? config.bitbucket.workspace : undefined);

    // If a Bitbucket PR URL is provided or configured in config.json
    if (effectivePrUrl && effectivePrUrl.includes('bitbucket.org')) {
      const parsed = BitbucketService.parsePRUrl(effectivePrUrl);
      if (parsed) {
        identifier = `pr_${parsed.prId}`;
      }
      rawPayloadData = await BitbucketService.fetchPRPayload(effectivePrUrl);
      if (rawPayloadData.pr_info?.ticket_id && rawPayloadData.pr_info.ticket_id !== 'N/A') {
        identifier = `${rawPayloadData.pr_info.ticket_id}_pr_${parsed?.prId || 'bb'}`;
      }
    } else {
      // Local Git diff execution
      Logger.info(`[STEP 1/5] 💻 Initializing Local Git Repository analysis...`);
      const repoPath = options.repoPath || process.cwd();
      const git = new GitExecutor(repoPath);

      const sourceBranch = options.sourceBranch || git.getCurrentBranch() || 'HEAD';
      const targetBranch = options.targetBranch || config.default_target_branch || 'main';

      Logger.info(`[STEP 2/5] 🌿 Target branches: ${sourceBranch} -> ${targetBranch}`);
      const author = git.getAuthorName();

      Logger.info(`[STEP 3/5] 📜 Reading local commit log...`);
      const commits = git.getCommits(sourceBranch, targetBranch);

      Logger.info(`[STEP 4/5] 📊 Calculating git diffstat & changed files...`);
      const diffStat = git.getDiffStat(sourceBranch, targetBranch);
      const changedFiles = git.getChangedFiles(sourceBranch, targetBranch);
      const rawDiff = git.getRawDiff(sourceBranch, targetBranch);

      Logger.info(`[STEP 5/5] 🧩 Classifying modules & extracting code highlights...`);
      const ticketId = GitParser.extractTicketId(sourceBranch, commits, config.ticket_prefix);
      const title = GitParser.generatePRTitle(sourceBranch, ticketId, commits);

      if (ticketId !== 'N/A') {
        identifier = ticketId;
      } else {
        const cleanBranch = sourceBranch.replace(/[^a-zA-Z0-9_-]/g, '_');
        identifier = cleanBranch;
      }

      const categorizedFiles = ModuleClassifier.classify(changedFiles, config.module_rules);
      const fileHighlights = ASTExtractor.extractHighlights(changedFiles, rawDiff);

      const changesByModule: CategorizedModule[] = [];

      for (const [moduleName, files] of Object.entries(categorizedFiles)) {
        const highlightsSet = new Set<string>();
        for (const file of files) {
          if (fileHighlights[file]) {
            fileHighlights[file].forEach(h => highlightsSet.add(h));
          }
        }

        let highlights = Array.from(highlightsSet);
        if (highlights.length === 0) {
          highlights = this.generateSmartFallbackHighlights(moduleName, files);
        }

        changesByModule.push({
          module: moduleName,
          files,
          highlights
        });
      }

      rawPayloadData = {
        pr_info: {
          ticket_id: ticketId,
          title,
          source_branch: sourceBranch,
          target_branch: targetBranch,
          author
        },
        commit_summary: commits.length > 0 ? commits : ['Cập nhật nguồn mã nguồn'],
        diff_stat: {
          total_files_changed: diffStat.totalFilesChanged,
          total_additions: diffStat.totalAdditions,
          total_deletions: diffStat.totalDeletions
        },
        changes_by_module: changesByModule
      };
    }

    // Enhance payload with Deployment/Migration Notes & Key Technical Insights
    const enhancedPayload = this.enrichPayloadData(rawPayloadData);

    // Save JSON copy alongside generated AI context artifacts.
    const savedPath = this.savePayloadToFile(enhancedPayload, identifier, config.ai_context.root);
    enhancedPayload._metadata = {
      saved_file_path: savedPath,
      generated_at: new Date().toISOString()
    };

    Logger.info(`✅ [SUCCESS] Rich Payload generated and saved to: ${savedPath}`);
    return enhancedPayload;
  }

  private static generateSmartFallbackHighlights(moduleName: string, files: string[]): string[] {
    const highlights: string[] = [];
    const sampleFiles = files.slice(0, 3).join(', ');

    if (moduleName.includes('Database')) {
      highlights.push(`Cập nhật cấu hình DbContext / Schema Migration liên quan đến: ${sampleFiles}`);
    } else if (moduleName.includes('APIs')) {
      highlights.push(`Thêm mới / Cập nhật Controller và các API Endpoints trong: ${sampleFiles}`);
    } else if (moduleName.includes('Services')) {
      highlights.push(`Triển khai Business Logic, DTO Request/Response và Services: ${sampleFiles}`);
    } else if (moduleName.includes('gRPC')) {
      highlights.push(`Cập nhật Proto schema và gRPC Client/Service integration: ${sampleFiles}`);
    } else if (moduleName.includes('Tests')) {
      highlights.push(`Bổ sung Unit Tests & Helper Extensions trong: ${sampleFiles}`);
    } else {
      highlights.push(`Cập nhật các file cấu hình và tài nguyên: ${sampleFiles}`);
    }

    return highlights;
  }

  private static enrichPayloadData(payload: any): any {
    const allFiles: string[] = [];
    const deploymentNotes: string[] = [];
    const keyComponents: string[] = [];

    (payload.changes_by_module || []).forEach((mod: any) => {
      (mod.files || []).forEach((f: string) => {
        allFiles.push(f);
        if (f.endsWith('.cs') && (f.includes('Migration') || f.includes('Add_Table') || f.includes('Add_Column'))) {
          const migrationName = f.replace('.cs', '');
          if (!deploymentNotes.includes(`Cần chạy EF Database Migration: ${migrationName}`)) {
            deploymentNotes.push(`Cần chạy EF Database Migration: ${migrationName}`);
          }
        }
        if (f.endsWith('.sql')) {
          deploymentNotes.push(`Cần thực thi SQL Migration Script: ${f}`);
        }
        if (f.endsWith('.proto')) {
          deploymentNotes.push(`Có thay đổi contract gRPC Proto (${f}), cần re-generate gRPC Client/Server code.`);
        }
        if (f.includes('appsettings') || f.endsWith('.env')) {
          deploymentNotes.push(`Cấu hình môi trường bị thay đổi ở ${f}, cần kiểm tra App Settings/Env Keys.`);
        }
        if (f.includes('Controller') || f.includes('Service') || f.includes('Repository')) {
          if (keyComponents.length < 10) {
            keyComponents.push(f);
          }
        }
      });
    });

    // Synthesize top technical summary insights
    const summaryInsights: string[] = [];
    (payload.changes_by_module || []).forEach((mod: any) => {
      if (mod.highlights && mod.highlights.length > 0) {
        mod.highlights.forEach((h: string) => {
          if (!h.startsWith('Cập nhật các file') && summaryInsights.length < 8) {
            summaryInsights.push(`[${mod.module}] ${h}`);
          }
        });
      }
    });

    if (summaryInsights.length === 0 && payload.commit_summary && payload.commit_summary.length > 0) {
      payload.commit_summary.slice(0, 5).forEach((c: string) => {
        if (!c.startsWith('Merge branch')) {
          summaryInsights.push(c);
        }
      });
    }

    return {
      pr_info: payload.pr_info,
      commit_summary: payload.commit_summary,
      diff_stat: payload.diff_stat,
      summary_insights: summaryInsights.length > 0 ? summaryInsights : ['Cập nhật và tối ưu hóa tính năng'],
      deployment_and_migration_notes: deploymentNotes.length > 0 ? deploymentNotes : ['Không có yêu cầu migration đặc biệt'],
      key_impacted_components: keyComponents,
      changes_by_module: payload.changes_by_module
    };
  }

  private static savePayloadToFile(payload: any, identifier: string, root?: string): string {
    const payloadDir = path.join(StorePathResolver.resolveRoot(root), 'payloads');
    if (!fs.existsSync(payloadDir)) {
      fs.mkdirSync(payloadDir, { recursive: true });
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
    const fileName = `description_kb_${identifier}_${timestamp}.json`;
    const filePath = path.join(payloadDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    return filePath;
  }
}
