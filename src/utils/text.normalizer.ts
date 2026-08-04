export interface NormalizationResult {
  text: string;
  isNormalized: boolean;
}

export class TextNormalizer {
  /**
   * Normalizes title or description text while preserving code blocks and valid Markdown.
   * Removes unnecessary LaTeX math escapes like \( and \) when they are not valid math syntax.
   */
  static normalize(input: string): NormalizationResult {
    if (!input) {
      return { text: '', isNormalized: false };
    }

    let modified = false;

    // Tokenize text into code blocks / inline code vs normal text
    // Fenced code blocks ```...``` or inline code `...`
    const tokenRegex = /(```[\s\S]*?```|`[^`]+`)/g;
    const parts: string[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(input)) !== null) {
      // Normal text before code snippet
      if (match.index > lastIndex) {
        const plainText = input.substring(lastIndex, match.index);
        const cleaned = this.cleanPlainText(plainText);
        if (cleaned !== plainText) modified = true;
        parts.push(cleaned);
      }
      // Code snippet preserved verbatim
      parts.push(match[0]);
      lastIndex = tokenRegex.lastIndex;
    }

    // Trailing normal text
    if (lastIndex < input.length) {
      const plainText = input.substring(lastIndex);
      const cleaned = this.cleanPlainText(plainText);
      if (cleaned !== plainText) modified = true;
      parts.push(cleaned);
    }

    const result = parts.join('');
    return {
      text: result,
      isNormalized: modified
    };
  }

  private static cleanPlainText(text: string): string {
    // Strip redundant \( and \) when they are escaped parentheses rather than math expressions
    // E.g. "thêm mới (CRC)" vs "\(CRC\)"
    let cleaned = text.replace(/\\([()])/g, '$1');
    // Normalize repeated newlines
    cleaned = cleaned.replace(/\r\n/g, '\n');
    return cleaned;
  }
}
