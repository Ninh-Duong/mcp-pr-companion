export class ASTExtractor {
  static extractHighlights(files: string[], rawDiff: string): Record<string, string[]> {
    const highlightsByModule: Record<string, string[]> = {};

    if (!rawDiff) return highlightsByModule;

    const diffLines = rawDiff.split('\n');
    let currentFile = '';

    for (const line of diffLines) {
      if (line.startsWith('diff --git')) {
        const parts = line.split(' ');
        currentFile = parts[parts.length - 1].replace(/^b\//, '');
      }

      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      const content = line.substring(1).trim();

      // C# / TypeScript / Go class, struct, table additions
      if (content.match(/class\s+(\w+)|table\s+(\w+)|interface\s+(\w+)/i)) {
        const match = content.match(/(?:class|table|interface)\s+(\w+)/i);
        if (match) {
          this.addHighlight(highlightsByModule, currentFile, `Bổ sung / cập nhật cấu trúc: ${match[1]}`);
        }
      }

      // API Endpoints / Controller actions
      if (content.match(/\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)\s*\(?"?([^"\)]*)"?\)?\]/i)) {
        const match = content.match(/\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)\s*\(?"?([^"\)]*)"?\)?\]/i);
        if (match) {
          const method = match[1].replace('Http', '').toUpperCase();
          const route = match[2] || '';
          this.addHighlight(highlightsByModule, currentFile, `Bổ sung API Endpoint: ${method} ${route}`);
        }
      }

      // gRPC service definition
      if (content.match(/rpc\s+(\w+)\s*\(/i)) {
        const match = content.match(/rpc\s+(\w+)\s*\(/i);
        if (match) {
          this.addHighlight(highlightsByModule, currentFile, `Bổ sung gRPC method: rpc ${match[1]}`);
        }
      }
    }

    return highlightsByModule;
  }

  private static addHighlight(map: Record<string, string[]>, file: string, text: string): void {
    if (!map[file]) {
      map[file] = [];
    }
    if (!map[file].includes(text) && map[file].length < 5) {
      map[file].push(text);
    }
  }
}
