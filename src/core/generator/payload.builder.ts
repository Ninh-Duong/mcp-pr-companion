import fs from 'fs';
import path from 'path';
import { ConfigLoader } from '../../config/config.loader.js';
import { CategorizedModule, ModuleClassifier } from '../analyzer/module.classifier.js';
import { ASTExtractor } from '../analyzer/ast.extractor.js';
import { GitExecutor } from '../git/git.executor.js';
import { GitParser } from '../git/git.parser.js';
import { BitbucketService } from '../bitbucket/bitbucket.service.js';
import { Logger } from '../../utils/logger.js';

export interface PRPayloadOptions {
  prUrl?: string;
  sourceBranch?: string;
  targetBranch?: string;
  repoPath?: string;
}

export class PayloadBuilder {
  static async build(options: PRPayloadOptions = {}) {
    let payload: any;
    let identifier = 'local';

    // If a Bitbucket PR URL is provided, fetch via Bitbucket API
    if (options.prUrl && options.prUrl.includes('bitbucket.org')) {
      const parsed = BitbucketService.parsePRUrl(options.prUrl);
      if (parsed) {
        identifier = `pr_${parsed.prId}`;
      }
      payload = await BitbucketService.fetchPRPayload(options.prUrl);
      if (payload.pr_info?.ticket_id && payload.pr_info.ticket_id !== 'N/A') {
        identifier = `${payload.pr_info.ticket_id}_pr_${parsed?.prId || 'bb'}`;
      }
    } else {
      // Otherwise, fall back to local Git diff execution
      Logger.info(`[STEP 1/5] 💻 Initializing Local Git Repository analysis...`);
      const config = ConfigLoader.load();
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

        const highlights = Array.from(highlightsSet);
        if (highlights.length === 0) {
          highlights.push(`Cập nhật và tối ưu hóa các file thuộc module ${moduleName}`);
        }

        changesByModule.push({
          module: moduleName,
          files,
          highlights
        });
      }

      payload = {
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

    // Save JSON output copy to ./output/ folder with timestamp
    const savedPath = this.savePayloadToFile(payload, identifier);
    payload._metadata = {
      saved_file_path: savedPath,
      generated_at: new Date().toISOString()
    };

    Logger.info(`✅ [SUCCESS] Payload generated and saved to: ${savedPath}`);
    return payload;
  }

  private static savePayloadToFile(payload: any, identifier: string): string {
    const outputDir = path.resolve(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0]; // e.g. 20260728_181235
    const fileName = `description_kb_${identifier}_${timestamp}.json`;
    const filePath = path.join(outputDir, fileName);

    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    return filePath;
  }
}
