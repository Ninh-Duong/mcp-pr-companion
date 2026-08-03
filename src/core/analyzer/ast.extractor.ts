import path from 'path';

export class ASTExtractor {
  static extractHighlights(files: string[], rawDiff: string): Record<string, string[]> {
    const highlightsByFile: Record<string, string[]> = {};

    if (!rawDiff) return highlightsByFile;

    const diffLines = rawDiff.split('\n');
    let currentFileBasename = '';

    for (const line of diffLines) {
      if (line.startsWith('diff --git')) {
        const parts = line.split(' ');
        const fullPath = parts[parts.length - 1].replace(/^b\//, '');
        currentFileBasename = path.basename(fullPath);
        continue;
      }

      if (!currentFileBasename) continue;
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      const content = line.substring(1).trim();

      // 1. EF Migrations & DB Schema changes
      if (currentFileBasename.includes('Migration') || currentFileBasename.includes('Add_Table') || currentFileBasename.includes('Add_Column')) {
        const tableMatch = content.match(/migrationBuilder\.CreateTable\(\s*name:\s*"(\w+)"/i) || content.match(/class\s+(Add_Table_\w+|Add_Column_\w+)/i);
        if (tableMatch) {
          this.addHighlight(highlightsByFile, currentFileBasename, `Migration DB: ${tableMatch[1].replace(/_/g, ' ')}`);
        }
        const colMatch = content.match(/name:\s*"(\w+)",\s*table:\s*"(\w+)"/i);
        if (colMatch) {
          this.addHighlight(highlightsByFile, currentFileBasename, `Bổ sung cột [${colMatch[1]}] vào bảng [${colMatch[2]}]`);
        }
      }

      // 2. EF Model / Entity / DTO Class Definitions
      const classMatch = content.match(/public\s+(?:partial\s+)?class\s+(\w+)/);
      if (classMatch) {
        const className = classMatch[1];
        if (!className.endsWith('Context') && !className.endsWith('Snapshot') && !className.endsWith('Designer')) {
          this.addHighlight(highlightsByFile, currentFileBasename, `Định nghĩa / Cập nhật Class Model/DTO: ${className}`);
        }
      }

      // 3. Controller API Routes & Methods
      if (content.match(/\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)\s*\(?"?([^"\)]*)"?\)?\]/i)) {
        const match = content.match(/\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)\s*\(?"?([^"\)]*)"?\)?\]/i);
        if (match) {
          const httpMethod = match[1].replace('Http', '').toUpperCase();
          const routePath = match[2] || '';
          this.addHighlight(highlightsByFile, currentFileBasename, `API Endpoint: ${httpMethod} ${routePath ? '/' + routePath : ''}`);
        }
      }

      // 4. Controller Action Methods
      const actionMatch = content.match(/public\s+async\s+Task<[^>]+>\s+(\w+)\s*\(/);
      if (actionMatch && currentFileBasename.includes('Controller')) {
        this.addHighlight(highlightsByFile, currentFileBasename, `Thêm / sửa Action Method: ${actionMatch[1]}()`);
      }

      // 5. Service & Business Logic Methods
      const serviceMethodMatch = content.match(/public\s+(?:async\s+)?(?:Task<[^>]+>|Task|\w+)\s+(\w+Async|\w+Service|\w+Repository)\s*\(/);
      if (serviceMethodMatch && (currentFileBasename.includes('Service') || currentFileBasename.includes('Repository'))) {
        this.addHighlight(highlightsByFile, currentFileBasename, `Triển khai xử lý nghiệp vụ: ${serviceMethodMatch[1]}()`);
      }

      // 6. gRPC Proto RPC Methods & Messages
      if (currentFileBasename.endsWith('.proto')) {
        const rpcMatch = content.match(/rpc\s+(\w+)\s*\(\s*(\w+)\s*\)\s*returns\s*\(\s*(\w+)\s*\)/);
        if (rpcMatch) {
          this.addHighlight(highlightsByFile, currentFileBasename, `gRPC RPC Method: rpc ${rpcMatch[1]}(${rpcMatch[2]}) returns (${rpcMatch[3]})`);
        }
        const msgMatch = content.match(/message\s+(\w+)/);
        if (msgMatch) {
          this.addHighlight(highlightsByFile, currentFileBasename, `gRPC Message Schema: ${msgMatch[1]}`);
        }
      }

      // 7. Extensions & Helper Methods
      const extMatch = content.match(/public\s+static\s+\w+\s+(\w+)\s*\(this\s+/);
      if (extMatch) {
        this.addHighlight(highlightsByFile, currentFileBasename, `Thêm mới Extension Helper: ${extMatch[1]}()`);
      }
    }

    return highlightsByFile;
  }

  private static addHighlight(map: Record<string, string[]>, fileBasename: string, text: string): void {
    if (!map[fileBasename]) {
      map[fileBasename] = [];
    }
    if (!map[fileBasename].includes(text) && map[fileBasename].length < 8) {
      map[fileBasename].push(text);
    }
  }
}
