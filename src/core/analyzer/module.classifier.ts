import path from 'path';

export interface CategorizedModule {
  module: string;
  files: string[];
  highlights: string[];
}

export class ModuleClassifier {
  static classify(files: string[], customRules?: Record<string, string[]>): Record<string, string[]> {
    const categories: Record<string, string[]> = {
      'Database & Entity Models': [],
      'APIs & Controllers': [],
      'Services & Business Logic': [],
      'gRPC & External Integrations': [],
      'Infrastructure & Unit Tests': [],
      'Configuration & Environment': []
    };

    for (const filePath of files) {
      const fileName = path.basename(filePath);
      const lowerPath = filePath.toLowerCase();

      if (
        lowerPath.includes('context') ||
        lowerPath.includes('entity') ||
        lowerPath.includes('entities') ||
        lowerPath.includes('models') ||
        lowerPath.endsWith('.sql') ||
        lowerPath.includes('migration')
      ) {
        categories['Database & Entity Models'].push(fileName);
      } else if (
        lowerPath.includes('controller') ||
        lowerPath.includes('routes') ||
        lowerPath.includes('route') ||
        lowerPath.includes('/api/')
      ) {
        categories['APIs & Controllers'].push(fileName);
      } else if (
        lowerPath.includes('proto') ||
        lowerPath.includes('grpc') ||
        lowerPath.includes('client')
      ) {
        categories['gRPC & External Integrations'].push(fileName);
      } else if (
        lowerPath.includes('test') ||
        lowerPath.includes('spec') ||
        lowerPath.includes('extension') ||
        lowerPath.includes('util') ||
        lowerPath.includes('helper')
      ) {
        categories['Infrastructure & Unit Tests'].push(fileName);
      } else if (
        lowerPath.endsWith('.json') ||
        lowerPath.endsWith('.env') ||
        lowerPath.endsWith('.yml') ||
        lowerPath.endsWith('.xml') ||
        lowerPath.includes('config')
      ) {
        categories['Configuration & Environment'].push(fileName);
      } else if (
        lowerPath.includes('service') ||
        lowerPath.includes('usecase') ||
        lowerPath.includes('domain') ||
        lowerPath.endsWith('.cs') ||
        lowerPath.endsWith('.ts') ||
        lowerPath.endsWith('.go')
      ) {
        categories['Services & Business Logic'].push(fileName);
      } else {
        categories['Infrastructure & Unit Tests'].push(fileName);
      }
    }

    // Filter out empty categories
    const result: Record<string, string[]> = {};
    for (const [key, val] of Object.entries(categories)) {
      if (val.length > 0) {
        result[key] = Array.from(new Set(val)); // Deduplicate file basenames
      }
    }

    return result;
  }
}
