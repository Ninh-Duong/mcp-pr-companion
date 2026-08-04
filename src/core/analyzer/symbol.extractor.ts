import { ParsedFileDiff } from './diff.parser.js';

export interface ChangedSymbol {
  kind: 'class' | 'constructor' | 'method' | 'property' | 'route' | 'schema' | 'unknown';
  name: string;
  change: 'added_symbol' | 'modified_symbol' | 'deleted_symbol' | 'comment_near_symbol';
}

export class SymbolExtractor {
  static extractSymbols(fileDiff: ParsedFileDiff, isCommentOnly: boolean): ChangedSymbol[] {
    const symbols: ChangedSymbol[] = [];
    const seenNames = new Set<string>();

    const addSymbol = (kind: ChangedSymbol['kind'], name: string, defaultChange: ChangedSymbol['change']) => {
      if (!name || seenNames.has(`${kind}:${name}`)) return;
      seenNames.add(`${kind}:${name}`);

      symbols.push({
        kind,
        name,
        change: isCommentOnly ? 'comment_near_symbol' : defaultChange
      });
    };

    for (const hunk of fileDiff.hunks) {
      for (const line of hunk.lines) {
        const content = line.content.trim();
        const changeType: ChangedSymbol['change'] =
          line.type === 'add' ? 'added_symbol' : line.type === 'delete' ? 'deleted_symbol' : 'modified_symbol';

        // 1. Controller Action Routes
        const routeMatch = content.match(/\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)\s*\(?"?([^"\)]*)"?\)?\]/i);
        if (routeMatch) {
          const method = routeMatch[1].toUpperCase().replace('HTTP', '');
          const routePath = routeMatch[2] ? `/${routeMatch[2]}` : '/';
          addSymbol('route', `${method} ${routePath}`, changeType);
        }

        // 2. Constructors
        const constructorMatch = content.match(/public\s+([A-Z]\w+)\s*\(/);
        if (constructorMatch) {
          const className = constructorMatch[1];
          // Filter out standard keywords
          if (!['Task', 'void', 'string', 'int', 'bool', 'var'].includes(className)) {
            addSymbol('constructor', className, changeType);
          }
        }

        // 3. Classes / Interfaces / Enums
        const classMatch = content.match(/public\s+(?:partial\s+)?(?:class|interface|enum|struct)\s+([A-Z]\w+)/);
        if (classMatch) {
          addSymbol('class', classMatch[1], changeType);
        }

        // 4. C# / Java / TS Methods
        const methodMatch = content.match(/public\s+(?:async\s+)?(?:Task<[^>]+>|Task|void|[\w<>]+)\s+([A-Z]\w+)\s*\(/);
        if (methodMatch) {
          const methodName = methodMatch[1];
          if (!['Task', 'void', 'string', 'int', 'bool', 'Guid'].includes(methodName)) {
            addSymbol('method', methodName, changeType);
          }
        }

        // 5. gRPC Proto RPC & Messages
        if (fileDiff.newPath?.endsWith('.proto')) {
          const rpcMatch = content.match(/rpc\s+(\w+)/);
          if (rpcMatch) addSymbol('route', rpcMatch[1], changeType);

          const msgMatch = content.match(/message\s+(\w+)/);
          if (msgMatch) addSymbol('schema', msgMatch[1], changeType);
        }
      }
    }

    return symbols;
  }
}
