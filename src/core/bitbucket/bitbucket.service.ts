import { ConfigManager } from '../../config/config.manager.js';
import { BitbucketCollector } from './bitbucket.collector.js';
import { PRRegistry } from '../registry/pr.registry.js';
import { CategorizedModule, ModuleClassifier } from '../analyzer/module.classifier.js';
import { ASTExtractor } from '../analyzer/ast.extractor.js';
import { GitParser } from '../git/git.parser.js';
import { Logger } from '../../utils/logger.js';

export interface ParsedBitbucketURL {
  workspace: string;
  repoSlug: string;
  prId: string;
}

export class BitbucketService {
  static parsePRUrl(prUrl: string): ParsedBitbucketURL | null {
    try {
      const parsed = PRRegistry.parseAndValidateUrl(prUrl);
      return {
        workspace: parsed.workspace,
        repoSlug: parsed.repoSlug,
        prId: String(parsed.prId)
      };
    } catch {
      return null;
    }
  }

  static async fetchPRPayload(inputUrl?: string) {
    const baseConfig = ConfigManager.loadBase();
    let prUrl = inputUrl || baseConfig.default_pr_url;

    if (!prUrl && baseConfig.workspace && baseConfig.workspace.includes('bitbucket.org')) {
      prUrl = baseConfig.workspace;
    }

    if (!prUrl) {
      throw new Error('No Bitbucket PR URL provided and no default_pr_url found in configuration.');
    }

    const parsed = this.parsePRUrl(prUrl);
    if (!parsed) {
      throw new Error(`Invalid Bitbucket PR URL format: "${prUrl}". Expected format: https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}`);
    }

    const collector = new BitbucketCollector();
    const rawRev = await collector.collect(parsed.workspace, parsed.repoSlug, parseInt(parsed.prId, 10));

    const prData = rawRev.metadata;
    const title = prData.title || '';
    const sourceBranch = prData.source?.branch?.name || '';
    const targetBranch = prData.destination?.branch?.name || '';
    const author = prData.author?.display_name || prData.author?.username || 'unknown';

    const commitSummary: string[] = (rawRev.commits || [])
      .map((c: any) => (c.message || '').split('\n')[0].trim())
      .filter(Boolean);

    let totalAdditions = 0;
    let totalDeletions = 0;
    const changedFiles: string[] = [];

    for (const item of (rawRev.diffstat || [])) {
      totalAdditions += item.lines_added || 0;
      totalDeletions += item.lines_removed || 0;
      const filePath = item.new?.path || item.old?.path;
      if (filePath) {
        changedFiles.push(filePath);
      }
    }

    const ticketId = GitParser.extractTicketId(sourceBranch, commitSummary, baseConfig.ticket_prefix);
    const prTitle = title || GitParser.generatePRTitle(sourceBranch, ticketId, commitSummary);

    const categorizedFiles = ModuleClassifier.classify(changedFiles, baseConfig.module_rules);
    const fileHighlights = ASTExtractor.extractHighlights(changedFiles, rawRev.rawDiff);

    const changesByModule: CategorizedModule[] = [];

    for (const [moduleName, files] of Object.entries(categorizedFiles)) {
      const highlightsSet = new Set<string>();
      for (const file of files) {
        if (fileHighlights[file]) {
          fileHighlights[file].forEach(h => highlightsSet.add(h));
        }
      }

      const highlights = Array.from(highlightsSet);
      changesByModule.push({
        module: moduleName,
        files,
        highlights
      });
    }

    return {
      pr_info: {
        ticket_id: ticketId,
        title: prTitle,
        source_branch: sourceBranch,
        target_branch: targetBranch,
        author
      },
      commit_summary: commitSummary.length > 0 ? commitSummary : [prTitle],
      diff_stat: {
        total_files_changed: changedFiles.length,
        total_additions: totalAdditions,
        total_deletions: totalDeletions
      },
      changes_by_module: changesByModule
    };
  }
}
