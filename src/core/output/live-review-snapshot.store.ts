import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { SecureScope } from '../storage/secure-file.js';
import { copySecureTree, readSecure, writeSecure } from '../storage/secure-file.js';
import {
  LiveReviewCommentV1Schema,
  LiveReviewCompleteSnapshotV1Schema,
  LiveReviewIndexV1Schema,
  LiveReviewPointerV1Schema,
  LiveReviewAttemptV1Schema,
  type LiveReviewAttemptV1,
  type LiveReviewCompleteSnapshotV1
} from './schema/live-review.v1.schema.js';

export class LiveReviewSnapshotStore {
  private static readonly DIRECTORY = 'live-review';

  /** Publishes a complete, sanitized snapshot. Incomplete collections cannot advance the pointer. */
  static publishComplete(prDir: string, scope: SecureScope, input: LiveReviewCompleteSnapshotV1): void {
    // Parsing also enforces a safe snapshot id, matching count and sorted unique comment IDs.
    const snapshot = LiveReviewCompleteSnapshotV1Schema.parse(input);
    if (!snapshot.complete) throw new Error('Only a complete review snapshot can be published.');

    const root = path.join(prDir, this.DIRECTORY);
    const snapshotsDir = path.join(root, 'snapshots');
    const targetDir = path.join(snapshotsDir, snapshot.snapshot_id);
    const stagingDir = path.join(snapshotsDir, `.tmp-${randomUUID()}`);
    fs.mkdirSync(stagingDir, { recursive: true });

    try {
      const index = {
        schema_version: snapshot.schema_version,
        snapshot_id: snapshot.snapshot_id,
        fetched_at: snapshot.fetched_at,
        source_commit: snapshot.source_commit,
        comment_count: snapshot.comment_count,
        complete: snapshot.complete,
        warnings: snapshot.warnings
      };
      const jsonl = snapshot.comments.map(comment => JSON.stringify(comment)).join('\n');
      writeSecure(path.join(stagingDir, 'index.json'), JSON.stringify(index), scope);
      writeSecure(path.join(stagingDir, 'comments.jsonl'), jsonl, scope);

      // Read back and validate the encrypted staged files before they become addressable.
      const stagedIndex = LiveReviewIndexV1Schema.parse(JSON.parse(readSecure(path.join(stagingDir, 'index.json'))));
      const stagedComments = this.parseComments(readSecure(path.join(stagingDir, 'comments.jsonl')));
      this.assertSnapshotMatches(stagedIndex, stagedComments);

      if (fs.existsSync(targetDir)) throw new Error('Review snapshot id already exists.');
      fs.renameSync(stagingDir, targetDir);

      // The current pointer is the commit point and is always written after the immutable snapshot.
      const pointer = LiveReviewPointerV1Schema.parse({ snapshot_id: snapshot.snapshot_id });
      writeSecure(path.join(root, 'current.json'), JSON.stringify(pointer), scope);
    } finally {
      if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  }

  /** Returns the current encrypted snapshot, or undefined if no complete snapshot exists yet. */
  static readCurrent(prDir: string): LiveReviewCompleteSnapshotV1 | undefined {
    return this.readCurrentRoot(path.join(prDir, this.DIRECTORY));
  }

  /** Writes bounded refresh metadata separately from immutable comment snapshots. */
  static recordLastAttempt(prDir: string, scope: SecureScope, input: LiveReviewAttemptV1): void {
    const attempt = LiveReviewAttemptV1Schema.parse(input);
    const root = path.join(prDir, this.DIRECTORY);
    const file = path.join(root, 'last-attempt.json');
    fs.mkdirSync(root, { recursive: true });
    writeSecure(file, JSON.stringify(attempt), scope);
    LiveReviewAttemptV1Schema.parse(JSON.parse(readSecure(file)));
  }

  /** Returns the last encrypted refresh attempt, if present. Corruption fails closed. */
  static readLastAttempt(prDir: string): LiveReviewAttemptV1 | undefined {
    return this.readLastAttemptRoot(path.join(prDir, this.DIRECTORY));
  }

  /** Carries the newest complete encrypted review sidecar when a PR changes status directory. */
  static migrateStatusDirectory(
    sourcePrDir: string,
    targetPrDir: string,
    scope: SecureScope
  ): void {
    const sourceRoot = path.join(sourcePrDir, this.DIRECTORY);
    if (!fs.existsSync(sourceRoot)) return;

    const sourceSnapshot = this.readCurrentRoot(sourceRoot);
    const targetRoot = path.join(targetPrDir, this.DIRECTORY);
    const targetSnapshot = fs.existsSync(targetRoot) ? this.readCurrentRoot(targetRoot) : undefined;
    const sourceAttempt = this.readLastAttemptRoot(sourceRoot);
    const targetAttempt = fs.existsSync(targetRoot) ? this.readLastAttemptRoot(targetRoot) : undefined;
    const sourceWins = Boolean(sourceSnapshot && (!targetSnapshot || Date.parse(sourceSnapshot.fetched_at) > Date.parse(targetSnapshot.fetched_at)));
    const winningSnapshot = sourceWins ? sourceSnapshot : targetSnapshot;
    const winningSnapshotId = winningSnapshot?.snapshot_id ?? null;
    const relevantAttempts = [targetAttempt, sourceAttempt]
      .filter((attempt): attempt is LiveReviewAttemptV1 => Boolean(attempt && attempt.retained_snapshot_id === winningSnapshotId));
    const newestRelevantAttempt = relevantAttempts.reduce<LiveReviewAttemptV1 | undefined>((newest, attempt) => {
      return !newest || Date.parse(attempt.attempted_at) > Date.parse(newest.attempted_at) ? attempt : newest;
    }, undefined);

    if (!sourceWins) {
      this.writeAttempt(targetRoot, newestRelevantAttempt, scope);
      return;
    }

    const stagingRoot = path.join(targetPrDir, `.tmp-live-review-${randomUUID()}`);
    const backupRoot = path.join(targetPrDir, `.tmp-live-review-backup-${randomUUID()}`);
    fs.mkdirSync(targetPrDir, { recursive: true });
    try {
      copySecureTree(sourceRoot, stagingRoot, scope);
      this.writeAttempt(stagingRoot, newestRelevantAttempt, scope);
      const stagedSnapshot = this.readCurrentRoot(stagingRoot);
      const stagedAttempt = this.readLastAttemptRoot(stagingRoot);
      if (!stagedSnapshot || stagedSnapshot.snapshot_id !== sourceSnapshot?.snapshot_id ||
        JSON.stringify(stagedAttempt ?? null) !== JSON.stringify(newestRelevantAttempt ?? null)) {
        throw new Error('Review sidecar migration verification failed.');
      }

      if (fs.existsSync(targetRoot)) fs.renameSync(targetRoot, backupRoot);
      try {
        fs.renameSync(stagingRoot, targetRoot);
      } catch (error) {
        if (!fs.existsSync(targetRoot) && fs.existsSync(backupRoot)) fs.renameSync(backupRoot, targetRoot);
        throw error;
      }
      if (fs.existsSync(backupRoot)) fs.rmSync(backupRoot, { recursive: true, force: true });
    } finally {
      if (fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }

  private static readCurrentRoot(root: string): LiveReviewCompleteSnapshotV1 | undefined {
    const pointerPath = path.join(root, 'current.json');
    if (!fs.existsSync(pointerPath)) return undefined;

    const pointer = LiveReviewPointerV1Schema.parse(JSON.parse(readSecure(pointerPath)));
    const snapshotDir = path.join(root, 'snapshots', pointer.snapshot_id);
    const index = LiveReviewIndexV1Schema.parse(JSON.parse(readSecure(path.join(snapshotDir, 'index.json'))));
    if (index.snapshot_id !== pointer.snapshot_id) throw new Error('Review snapshot pointer does not match its index.');
    const comments = this.parseComments(readSecure(path.join(snapshotDir, 'comments.jsonl')));
    this.assertSnapshotMatches(index, comments);
    if (!index.complete) throw new Error('Current review snapshot is incomplete.');

    return LiveReviewCompleteSnapshotV1Schema.parse({ ...index, comments });
  }

  private static readLastAttemptRoot(root: string): LiveReviewAttemptV1 | undefined {
    const file = path.join(root, 'last-attempt.json');
    if (!fs.existsSync(file)) return undefined;
    return LiveReviewAttemptV1Schema.parse(JSON.parse(readSecure(file)));
  }

  private static writeAttempt(root: string, attempt: LiveReviewAttemptV1 | undefined, scope: SecureScope): void {
    const file = path.join(root, 'last-attempt.json');
    if (!attempt) {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
      return;
    }
    fs.mkdirSync(root, { recursive: true });
    writeSecure(file, JSON.stringify(attempt), scope);
    LiveReviewAttemptV1Schema.parse(JSON.parse(readSecure(file)));
  }

  private static parseComments(jsonl: string) {
    if (jsonl.length === 0) return [];
    return jsonl.split('\n').map((line, index) => {
      try {
        return LiveReviewCommentV1Schema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(`Review snapshot comment record ${index + 1} is invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private static assertSnapshotMatches(
    index: ReturnType<typeof LiveReviewIndexV1Schema.parse>,
    comments: ReturnType<typeof this.parseComments>
  ): void {
    if (!index.complete) throw new Error('Review snapshot is incomplete.');
    if (comments.length !== index.comment_count) throw new Error('Review snapshot comment count does not match its index.');
    for (let position = 1; position < comments.length; position += 1) {
      if (comments[position - 1].id >= comments[position].id) {
        throw new Error('Review snapshot comments are not sorted by unique id.');
      }
    }
  }
}
