import { ConfigLoader } from '../../config/config.loader.js';
import { CategorizedModule, ModuleClassifier } from '../analyzer/module.classifier.js';
import { ASTExtractor } from '../analyzer/ast.extractor.js';
import { GitExecutor } from '../git/git.executor.js';
import { GitParser } from '../git/git.parser.js';

export interface PRPayloadOptions {
  sourceBranch?: string;
  targetBranch?: string;
  repoPath?: string;
}

export class PayloadBuilder {
  static build(options: PRPayloadOptions = {}) {
    const config = ConfigLoader.load();
    const repoPath = options.repoPath || process.cwd();
    const git = new GitExecutor(repoPath);

    const sourceBranch = options.sourceBranch || git.getCurrentBranch() || 'HEAD';
    const targetBranch = options.targetBranch || config.default_target_branch || 'main';

    const author = git.getAuthorName();
    const commits = git.getCommits(sourceBranch, targetBranch);
    const diffStat = git.getDiffStat(sourceBranch, targetBranch);
    const changedFiles = git.getChangedFiles(sourceBranch, targetBranch);
    const rawDiff = git.getRawDiff(sourceBranch, targetBranch);

    const ticketId = GitParser.extractTicketId(sourceBranch, commits, config.ticket_prefix);
    const title = GitParser.generatePRTitle(sourceBranch, ticketId, commits);

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

    return {
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
}
