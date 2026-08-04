import { ParsedFileDiff } from './diff.parser.js';
import { ChangedSymbol } from '../output/schema/file_change.v4.schema.js';

export class SymbolExtractor {
  static extractSymbols(fileDiff: ParsedFileDiff, isCommentOnly: boolean): ChangedSymbol[] {
    const symbols: ChangedSymbol[] = [];
    const seenNames = new Set<string>();

    const addSymbol = (
      kind: string,
      name: string,
      defaultChange: ChangedSymbol['change'],
      lineNum?: number,
      signatureStr?: string
    ) => {
      if (!name || seenNames.has(`${kind}:${name}`)) return;
      seenNames.add(`${kind}:${name}`);

      const change: ChangedSymbol['change'] = isCommentOnly ? 'comment_near_symbol' : defaultChange;
      const relationship: ChangedSymbol['relationship'] = isCommentOnly ? 'nearest_symbol' : 'changed_symbol';

      symbols.push({
        kind,
        name,
        change,
        relationship,
        confidence: 0.95,
        ...(lineNum !== undefined ? { line: lineNum } : {}),
        ...(signatureStr ? { signature: signatureStr } : {})
      });
    };

    for (const hunk of fileDiff.hunks) {
      let currentLine = hunk.newStart || hunk.oldStart || 1;

      for (const line of hunk.lines) {
        const content = line.content.trim();
        const changeType: ChangedSymbol['change'] =
          line.type === 'add' ? 'added_symbol' : line.type === 'delete' ? 'deleted_symbol' : 'modified_symbol';

        // 1. Controller Action Routes
        const routeMatch = content.match(/\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)\s*\(?"?([^"\)]*)"?\)?\]/i);
        if (routeMatch) {
          const method = routeMatch[1].toUpperCase().replace('HTTP', '');
          const routePath = routeMatch[2] ? `/${routeMatch[2]}` : '/';
          addSymbol('route', `${method} ${routePath}`, changeType, currentLine, content);
        }

        // 2. Constructors
        const constructorMatch = content.match(/public\s+([A-Z]\w+)\s*\(/);
        if (constructorMatch) {
          const className = constructorMatch[1];
          if (!['Task', 'void', 'string', 'int', 'bool', 'var'].includes(className)) {
            addSymbol('constructor', className, changeType, currentLine, content);
          }
        }

        // 3. Classes / Interfaces / Enums
        const classMatch = content.match(/public\s+(?:partial\s+)?(?:class|interface|enum|struct)\s+([A-Z]\w+)/);
        if (classMatch) {
          addSymbol('class', classMatch[1], changeType, currentLine, content);
        }

        // 4. C# / Java / TS Methods
        const methodMatch = content.match(/public\s+(?:async\s+)?(?:Task<[^>]+>|Task|void|[\w<>]+)\s+([A-Z]\w+)\s*\(/);
        if (methodMatch) {
          const methodName = methodMatch[1];
          if (!['Task', 'void', 'string', 'int', 'bool', 'Guid'].includes(methodName)) {
            addSymbol('method', methodName, changeType, currentLine, content);
          }
        }

        // 5. gRPC Proto RPC & Messages
        if (fileDiff.newPath?.endsWith('.proto')) {
          const rpcMatch = content.match(/rpc\s+(\w+)/);
          if (rpcMatch) addSymbol('route', rpcMatch[1], changeType, currentLine, content);

          const msgMatch = content.match(/message\s+(\w+)/);
          if (msgMatch) addSymbol('schema', msgMatch[1], changeType, currentLine, content);
        }

        if (line.type !== 'delete') {
          currentLine++;
        }
      }
    }

    return symbols;
  }
}
