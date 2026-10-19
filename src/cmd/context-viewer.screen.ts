import fs from 'fs';
import path from 'path';
import { select } from '@inquirer/prompts';
import { runtimeSession } from '../core/auth/runtime-session.js';
import { AccessGate } from '../core/auth/access-gate.js';
import { OutputReader } from '../core/output/output.reader.js';

/**
 * Shows decrypted context for PRs already synced into ai-context/. Reached only after login, and
 * it unlocks the repository with a live Bitbucket check first; without access nothing is decrypted.
 * Plaintext is printed to the terminal and kept in memory only.
 */
export class ContextViewerScreen {
  static async render(): Promise<void> {
    const session = runtimeSession.getSession();
    if (!session) return;
    const { workspace, repoSlug } = session.repository;

    try {
      await AccessGate.unlock(workspace, repoSlug);
    } catch (err) {
      console.log(`\n${err instanceof Error ? err.message : String(err)}`);
      await select({ message: 'Press Enter to return:', choices: [{ name: 'Back', value: 'back' }] });
      return;
    }

    const repoDir = path.dirname(OutputReader.getPROutputDir(workspace, repoSlug, 0));
    const prIds = fs.existsSync(repoDir)
      ? fs.readdirSync(repoDir).map(n => /^pr_(\d+)$/.exec(n)?.[1]).filter(Boolean).map(Number).sort((a, b) => b - a)
      : [];
    const prs = prIds
      .map(id => ({ id, manifest: OutputReader.getActiveRevision(workspace, repoSlug, id)?.manifest }))
      .filter(p => p.manifest);

    if (prs.length === 0) {
      console.log(`\nNo synced PRs for ${workspace}/${repoSlug} yet. Use "Generate PR data" first.`);
      await select({ message: 'Press Enter to return:', choices: [{ name: 'Back', value: 'back' }] });
      return;
    }

    while (true) {
      const prId = await select({
        message: `Synced PRs in ${workspace}/${repoSlug}:`,
        choices: [
          ...prs.map(p => ({ name: `#${p.id}  ${p.manifest!.title}`, value: p.id })),
          { name: '⬅️ Back', value: -1 }
        ]
      });
      if (prId === -1) return;
      await this.showPR(workspace, repoSlug, prId);
    }
  }

  private static async showPR(workspace: string, repoSlug: string, prId: number): Promise<void> {
    await AccessGate.unlock(workspace, repoSlug); // re-check if the 60 s unlock expired while browsing
    console.clear();
    console.log(OutputReader.getContextPack(workspace, repoSlug, prId) ?? '(context.md missing: re-sync this PR)');
    const files = OutputReader.getFileIndex(workspace, repoSlug, prId);

    while (true) {
      const fileId = await select({
        message: 'Open a file:',
        choices: [...files.map(f => ({ name: `${f.id}  ${f.path}  (${f.change_kind}, +${f.additions}/-${f.deletions})`, value: f.id })), { name: '⬅️ Back', value: '' }]
      });
      if (!fileId) return;
      await AccessGate.unlock(workspace, repoSlug);
      console.clear();
      console.log(OutputReader.getFileContext(workspace, repoSlug, prId, fileId) ?? '(file missing: re-sync this PR)');
    }
  }
}
