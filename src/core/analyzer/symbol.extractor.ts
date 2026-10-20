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
      signatureStr?: string,
      containing = false
    ) => {
      if (!name || seenNames.has(`${kind}:${name}`)) return;
      seenNames.add(`${kind}:${name}`);

      const change: ChangedSymbol['change'] = isCommentOnly ? 'comment_near_symbol' : defaultChange;
      const relationship: ChangedSymbol['relationship'] = containing ? 'containing_symbol' : isCommentOnly ? 'nearest_symbol' : 'changed_symbol';

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

      // git writes the enclosing function/class/namespace after the second "@@".
      const scope = hunk.header.replace(/^@@[^@]*@@\s*/, '').trim().slice(0, 120);
      if (scope && scope !== '@@') addSymbol('scope', scope, 'modified_symbol', hunk.newStart || undefined, undefined, true);

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
        const constructorMatch = content.match(/\b(?:public|private|protected|internal)\s+([A-Z]\w+)\s*\(/);
        if (constructorMatch) {
          const className = constructorMatch[1];
          if (!['Task', 'void', 'string', 'int', 'bool', 'var'].includes(className)) {
            addSymbol('constructor', className, changeType, currentLine, content);
          }
        }

        // 3. Classes / Interfaces / Enums
        const classMatch = content.match(/\b(?:public|private|protected|internal)\s+(?:(?:static|sealed|abstract|partial)\s+)*(?:class|interface|enum|struct|record)\s+([A-Z]\w+)/);
        if (classMatch) {
          addSymbol('class', classMatch[1], changeType, currentLine, content);
        }

        // 4. C# / Java / TS Methods
        const methodMatch = content.match(/\b(?:public|private|protected|internal)\s+(?:(?:static|async|override|virtual|abstract|sealed|new)\s+)*(?:Task<[^>]+>|Task|void|[\w<>\[\]?]+)\s+([A-Z]\w+)\s*\(/);
        if (methodMatch) {
          const methodName = methodMatch[1];
          if (!['Task', 'void', 'string', 'int', 'bool', 'Guid'].includes(methodName)) {
            addSymbol('method', methodName, changeType, currentLine, content);
          }
        }

        // 5. SQL objects: CREATE / ALTER [OR ALTER] [UNIQUE] [NON]CLUSTERED <type> [schema].[name]
        const sqlMatch = content.match(/\b(?:CREATE|ALTER)\s+(?:OR\s+ALTER\s+)?(?:UNIQUE\s+)?(?:(?:NON)?CLUSTERED\s+)?(TABLE|VIEW|PROCEDURE|PROC|FUNCTION|TRIGGER|INDEX)\s+([\[\]\w.]+)/i);
        if (sqlMatch) {
          const type = sqlMatch[1].toLowerCase() === 'proc' ? 'procedure' : sqlMatch[1].toLowerCase();
          addSymbol(`sql_${type}`, sqlMatch[2].replace(/[\[\]]/g, ''), changeType, currentLine, content);
        }

        // 6. gRPC Proto RPC & Messages
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
