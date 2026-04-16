// Default buffer size in characters (approximately 1MB)
const DEFAULT_MAX_BUFFER_SIZE = parseInt(process.env.PTY_MAX_BUFFER_SIZE || '1000000', 10);

export interface SearchMatch {
  lineNumber: number;
  text: string;
}

export class RingBuffer {
  private buffer: string = '';
  private maxSize: number;
  private cachedLines: string[] | null = null;
  private isDirty: boolean = false;

  constructor(maxSize: number = DEFAULT_MAX_BUFFER_SIZE) {
    this.maxSize = maxSize;
  }

  append(data: string): void {
    if (!data) return;
    
    // Filter only dangerous control characters to avoid binary junk
    // We keep \n (0x0A), \r (0x0D), \t (0x09), and \x1b (0x1B) for ANSI
    // We allow all printable characters including Unicode (CJK, Emoji, etc.)
    // eslint-disable-next-line no-control-regex
    let cleanData = data.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, '');
    
    // Simple progress bar suppression: 
    // If a string contains \r followed by characters but no \n, 
    // it's likely a terminal overwrite. We handle the most common case.
    if (cleanData.includes('\r') && !cleanData.includes('\n')) {
      const parts = cleanData.split('\r');
      // Only keep the last update if multiple \r are in one chunk
      cleanData = '\r' + parts[parts.length - 1];
    }

    this.buffer += cleanData;
    this.isDirty = true;
    
    if (this.buffer.length > this.maxSize) {
      const excess = this.buffer.length - this.maxSize;
      // Find the next newline to ensure we always start with a clean line
      const nextNewline = this.buffer.indexOf('\n', excess);
      if (nextNewline !== -1 && nextNewline < this.buffer.length - 1) {
        this.buffer = this.buffer.slice(nextNewline + 1);
      } else {
        // Fallback to simple slice if no newline found
        this.buffer = this.buffer.slice(-this.maxSize);
      }
    }
  }

  private splitBufferLines(): string[] {
    if (this.isDirty || !this.cachedLines) {
      const lines = this.buffer.split(/\r?\n/);
      // Remove empty string at end if buffer ends with newline
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }
      this.cachedLines = lines;
      this.isDirty = false;
    }
    return this.cachedLines;
  }

  read(offset: number = 0, limit?: number): string[] {
    if (!this.buffer) return [];
    const lines = this.splitBufferLines();
    const start = Math.max(0, offset);
    return lines.slice(start, limit !== undefined ? start + limit : undefined);
  }

  readRaw(): string {
    return this.buffer;
  }

  search(pattern: RegExp): SearchMatch[] {
    const lines = this.splitBufferLines();
    return lines.reduce<SearchMatch[]>((matches, line, index) => {
      pattern.lastIndex = 0;
      if (line && pattern.test(line)) {
        matches.push({ lineNumber: index + 1, text: line });
      }
      return matches;
    }, []);
  }

  get length(): number {
    return this.buffer ? this.splitBufferLines().length : 0;
  }

  get byteLength(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = '';
  }
}
