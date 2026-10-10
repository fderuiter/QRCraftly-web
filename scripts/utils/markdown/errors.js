/**
 * Thrown for Markdown the in-house parser does not support, so a doc that needs more syntax
 * fails loudly instead of rendering differently.
 */
export class MarkdownSyntaxError extends Error {
  /**
   * @param {string} what What is unsupported.
   * @param {string | undefined} file File the source came from.
   * @param {number} line 1-based line number in that file.
   */
  constructor(what, file, line) {
    super(`${file || '<markdown>'}:${line}: ${what}`);
    this.name = 'MarkdownSyntaxError';
    this.file = file;
    this.line = line;
  }
}
