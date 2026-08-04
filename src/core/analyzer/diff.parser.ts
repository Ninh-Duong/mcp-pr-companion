export interface DiffLine {
  type: 'add' | 'delete' | 'context';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface ParsedFileDiff {
  oldPath: string | null;
  newPath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'binary' | 'submodule';
  isBinary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  headerLines: string[];
}

export interface ParsedDiff {
  files: ParsedFileDiff[];
}

export class DiffParser {
  /**
   * Parses a multi-file unified git diff string into structured file diffs.
   */
  static parse(rawDiff: string): ParsedDiff {
    if (!rawDiff || typeof rawDiff !== 'string') {
      return { files: [] };
    }

    const lines = rawDiff.split(/\r?\n/);
    const files: ParsedFileDiff[] = [];
    let currentFile: ParsedFileDiff | null = null;
    let currentHunk: DiffHunk | null = null;
    let oldLineNum = 0;
    let newLineNum = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect start of a new file diff
      if (line.startsWith('diff --git ')) {
        if (currentFile) {
          if (currentHunk) {
            currentFile.hunks.push(currentHunk);
            currentHunk = null;
          }
          files.push(currentFile);
        }

        const paths = this.parseDiffGitPaths(line);
        currentFile = {
          oldPath: paths.oldPath,
          newPath: paths.newPath,
          status: 'modified',
          isBinary: false,
          additions: 0,
          deletions: 0,
          hunks: [],
          headerLines: [line]
        };
        continue;
      }

      if (!currentFile) {
        // Line before any diff --git header
        continue;
      }

      // Check header directives
      if (!currentHunk && (line.startsWith('new file mode') || line.startsWith('deleted file mode') || line.startsWith('similarity index') || line.startsWith('rename from') || line.startsWith('rename to') || line.startsWith('copy from') || line.startsWith('copy to') || line.startsWith('Binary files'))) {
        currentFile.headerLines.push(line);

        if (line.startsWith('new file mode')) {
          currentFile.status = 'added';
        } else if (line.startsWith('deleted file mode')) {
          currentFile.status = 'deleted';
        } else if (line.startsWith('rename from') || line.startsWith('rename to')) {
          currentFile.status = 'renamed';
        } else if (line.startsWith('copy from') || line.startsWith('copy to')) {
          currentFile.status = 'copied';
        } else if (line.startsWith('Binary files')) {
          currentFile.isBinary = true;
          currentFile.status = 'binary';
        }
        continue;
      }

      if (line.startsWith('--- ')) {
        currentFile.headerLines.push(line);
        const p = line.substring(4).trim();
        if (p === '/dev/null') {
          currentFile.oldPath = null;
          currentFile.status = 'added';
        } else {
          currentFile.oldPath = p.replace(/^a\//, '');
        }
        continue;
      }

      if (line.startsWith('+++ ')) {
        currentFile.headerLines.push(line);
        const p = line.substring(4).trim();
        if (p === '/dev/null') {
          currentFile.newPath = currentFile.oldPath || '';
          currentFile.status = 'deleted';
        } else {
          currentFile.newPath = p.replace(/^b\//, '');
        }
        continue;
      }

      // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@ [optional header]
      if (line.startsWith('@@ ')) {
        if (currentHunk) {
          currentFile.hunks.push(currentHunk);
        }

        const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/);
        if (hunkMatch) {
          const oldStart = parseInt(hunkMatch[1], 10);
          const oldLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
          const newStart = parseInt(hunkMatch[3], 10);
          const newLines = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;

          oldLineNum = oldStart;
          newLineNum = newStart;

          currentHunk = {
            header: line,
            oldStart,
            oldLines,
            newStart,
            newLines,
            lines: []
          };
        }
        continue;
      }

      // Process lines within a hunk
      if (currentHunk) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          const content = line.substring(1);
          currentHunk.lines.push({
            type: 'add',
            newLineNumber: newLineNum++,
            content
          });
          currentFile.additions++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          const content = line.substring(1);
          currentHunk.lines.push({
            type: 'delete',
            oldLineNumber: oldLineNum++,
            content
          });
          currentFile.deletions++;
        } else if (line.startsWith(' ') || line === '') {
          const content = line.startsWith(' ') ? line.substring(1) : line;
          currentHunk.lines.push({
            type: 'context',
            oldLineNumber: oldLineNum++,
            newLineNumber: newLineNum++,
            content
          });
        } else if (line.startsWith('\\ No newline at end of file')) {
          // Ignore no-newline marker
        }
      }
    }

    if (currentFile) {
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
      }
      files.push(currentFile);
    }

    return { files };
  }

  private static parseDiffGitPaths(line: string): { oldPath: string; newPath: string } {
    // Standard format: diff --git a/path/to/file b/path/to/file
    const matchQuoted = line.match(/^diff --git "a\/(.+)" "b\/(.+)"$/);
    if (matchQuoted) {
      return { oldPath: matchQuoted[1], newPath: matchQuoted[2] };
    }

    const rest = line.substring(11).trim(); // Remove 'diff --git '
    const splitIndex = rest.indexOf(' b/');
    if (splitIndex !== -1) {
      const aPath = rest.substring(0, splitIndex).replace(/^a\//, '');
      const bPath = rest.substring(splitIndex + 3);
      return { oldPath: aPath, newPath: bPath };
    }

    return { oldPath: rest, newPath: rest };
  }
}
