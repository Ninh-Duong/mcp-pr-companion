export type Language = 'vi' | 'en' | 'bilingual';

export class I18n {
  static getStructureHighlight(name: string, lang: Language = 'vi'): string {
    switch (lang) {
      case 'en':
        return `Added / updated structure: ${name}`;
      case 'bilingual':
        return `Added / updated structure (Bổ sung / cập nhật cấu trúc): ${name}`;
      case 'vi':
      default:
        return `Bổ sung / cập nhật cấu trúc: ${name}`;
    }
  }

  static getApiEndpointHighlight(method: string, route: string, lang: Language = 'vi'): string {
    const routeSuffix = route ? ` ${route}` : '';
    switch (lang) {
      case 'en':
        return `Added API Endpoint: ${method}${routeSuffix}`;
      case 'bilingual':
        return `Added API Endpoint (Bổ sung API Endpoint): ${method}${routeSuffix}`;
      case 'vi':
      default:
        return `Bổ sung API Endpoint: ${method}${routeSuffix}`;
    }
  }

  static getGrpcHighlight(methodName: string, lang: Language = 'vi'): string {
    switch (lang) {
      case 'en':
        return `Added gRPC method: rpc ${methodName}`;
      case 'bilingual':
        return `Added gRPC method (Bổ sung gRPC method): rpc ${methodName}`;
      case 'vi':
      default:
        return `Bổ sung gRPC method: rpc ${methodName}`;
    }
  }

  static getModuleFallbackHighlight(moduleName: string, lang: Language = 'vi'): string {
    switch (lang) {
      case 'en':
        return `Updated and optimized files in module ${moduleName}`;
      case 'bilingual':
        return `Updated and optimized files in module ${moduleName} / Cập nhật và tối ưu hóa các file thuộc module ${moduleName}`;
      case 'vi':
      default:
        return `Cập nhật và tối ưu hóa các file thuộc module ${moduleName}`;
    }
  }

  static getCommitSummaryFallback(lang: Language = 'vi'): string {
    switch (lang) {
      case 'en':
        return 'Updated source code';
      case 'bilingual':
        return 'Updated source code / Cập nhật nguồn mã nguồn';
      case 'vi':
      default:
        return 'Cập nhật nguồn mã nguồn';
    }
  }
}
