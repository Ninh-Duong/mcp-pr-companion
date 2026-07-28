import { ConfigLoader } from '../../config/config.loader.js';
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
    if (!prUrl) return null;
    const match = prUrl.match(/bitbucket\.org\/([^\/]+)\/([^\/]+)\/pull-requests\/(\d+)/i);
    if (!match) return null;
    return {
      workspace: match[1],
      repoSlug: match[2],
      prId: match[3]
    };
  }

  static async fetchPRPayload(inputUrl?: string) {
    const config = ConfigLoader.load();
    const bbConfig = config.bitbucket || {};

    // Auto-detect PR URL from parameter OR config
    let prUrl = inputUrl || config.default_pr_url || bbConfig.default_pr_url;
    
    // Smart Fallback: If user pasted a full PR URL into bitbucket.workspace field
    if (!prUrl && bbConfig.workspace && bbConfig.workspace.includes('bitbucket.org')) {
      prUrl = bbConfig.workspace;
    }

    if (!prUrl) {
      throw new Error('No Bitbucket PR URL provided and no default_pr_url found in config.json.');
    }

    Logger.info(`[STEP 1/5] 🌐 Parsing Bitbucket PR URL: ${prUrl}`);

    const parsed = this.parsePRUrl(prUrl);
    if (!parsed) {
      const errMsg = `❌ [URL ERROR] Invalid Bitbucket PR URL format: "${prUrl}".\n👉 Expected format: https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}`;
      Logger.error(errMsg);
      throw new Error(errMsg);
    }

    const workspace = parsed.workspace;
    const repoSlug = parsed.repoSlug;
    const prId = parsed.prId;

    const username = bbConfig.username?.trim();
    const appPassword = bbConfig.app_password?.trim();

    // Check for missing credentials
    if (!username || !appPassword || appPassword.includes('YOUR_BITBUCKET') || username.includes('your_email')) {
      const configErrMsg = [
        '========================================================================',
        '❌ [CONFIG ERROR] Missing or default Bitbucket credentials in config.json!',
        '========================================================================',
        '👉 Please open config.json and fill in your actual Bitbucket credentials:',
        '   {',
        '     "bitbucket": {',
        '       "username": "your_actual_email@company.com",',
        '       "app_password": "YOUR_ACTUAL_APP_PASSWORD"',
        '     }',
        '   }',
        '📌 Required Token Scopes on Bitbucket: pullrequest:read & repository:read',
        '========================================================================'
      ].join('\n');

      Logger.error(configErrMsg);
      throw new Error('Bitbucket credentials (username or app_password) missing or using default placeholders in config.json. Please update config.json.');
    }

    const authHeader = 'Basic ' + Buffer.from(`${username}:${appPassword}`).toString('base64');
    const headers = {
      'Authorization': authHeader,
      'Accept': 'application/json'
    };

    // Step 2: Fetch PR Metadata
    Logger.info(`[STEP 2/5] 📋 Fetching PR Metadata for ${workspace}/${repoSlug} PR #${prId}...`);
    const prRes = await fetch(`https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests/${prId}`, { headers });
    if (!prRes.ok) {
      const errText = await prRes.text();
      const apiErrMsg = `❌ [API ERROR] Bitbucket API returned status ${prRes.status}: ${errText}.\n👉 Please verify your username, app_password token, and repository permissions.`;
      Logger.error(apiErrMsg);
      throw new Error(apiErrMsg);
    }
    const prData: any = await prRes.json();

    const title = prData.title || '';
    const sourceBranch = prData.source?.branch?.name || '';
    const targetBranch = prData.destination?.branch?.name || '';
    const author = prData.author?.display_name || prData.author?.username || username;

    Logger.info(`  ✓ Found PR: "${title}" (${sourceBranch} -> ${targetBranch}) by ${author}`);

    // Step 3: Fetch Commits
    Logger.info(`[STEP 3/5] 📜 Fetching PR Commit History...`);
    const commitsRes = await fetch(`https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/commits`, { headers });
    const commitsData: any = commitsRes.ok ? await commitsRes.json() : { values: [] };
    const commitSummary: string[] = (commitsData.values || [])
      .map((c: any) => (c.message || '').split('\n')[0].trim())
      .filter(Boolean);

    Logger.info(`  ✓ Retrieved ${commitSummary.length} commits`);

    // Step 4: Fetch Diffstat & Raw Diff
    Logger.info(`[STEP 4/5] 📊 Fetching PR Diffstat and Raw Code Diff...`);
    const diffstatRes = await fetch(`https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/diffstat`, { headers });
    const diffstatData: any = diffstatRes.ok ? await diffstatRes.json() : { values: [] };

    let totalAdditions = 0;
    let totalDeletions = 0;
    const changedFiles: string[] = [];

    for (const item of (diffstatData.values || [])) {
      totalAdditions += item.lines_added || 0;
      totalDeletions += item.lines_removed || 0;
      const filePath = item.new?.path || item.old?.path;
      if (filePath) {
        changedFiles.push(filePath);
      }
    }

    const diffRes = await fetch(`https://api.bitbucket.org/2.0/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/diff`, {
      headers: { 'Authorization': authHeader, 'Accept': 'text/plain' }
    });
    const rawDiff = diffRes.ok ? await diffRes.text() : '';

    Logger.info(`  ✓ Found ${changedFiles.length} changed files (+${totalAdditions} / -${totalDeletions} lines)`);

    // Step 5: Classify Modules & Extract AST Highlights
    Logger.info(`[STEP 5/5] 🧩 Classifying changed files into Modules & extracting Code Highlights...`);
    const ticketId = GitParser.extractTicketId(sourceBranch, commitSummary, config.ticket_prefix);
    const prTitle = title || GitParser.generatePRTitle(sourceBranch, ticketId, commitSummary);

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

    Logger.info(`✅ [SUCCESS] Bitbucket PR Payload generated successfully!`);

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
