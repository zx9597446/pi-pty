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
  private cachedLineCount: number = 0;

  constructor(maxSize: number = DEFAULT_MAX_BUFFER_SIZE) {
    this.maxSize = maxSize;
  }

  append(data: string): void {
    if (!data) return;
    
    // eslint-disable-next-line no-control-regex
    let cleanData = data.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g, '');
    
    if (cleanData.includes('\r') && !cleanData.includes('\n')) {
      const parts = cleanData.split('\r');
      cleanData = '\r' + parts[parts.length - 1];
    }

    this.buffer += cleanData;
    this.isDirty = true;
    
    if (this.buffer.length > this.maxSize) {
      const excess = this.buffer.length - this.maxSize;
      const nextNewline = this.buffer.indexOf('\n', excess);
      if (nextNewline !== -1 && nextNewline < this.buffer.length - 1) {
        this.buffer = this.buffer.slice(nextNewline + 1);
      } else {
        this.buffer = this.buffer.slice(-this.maxSize);
      }
      this.isDirty = true;
      this.cachedLines = null;
    }
  }

  private splitBufferLines(): string[] {
    if (this.isDirty || !this.cachedLines) {
      const lines = this.buffer.split(/\r?\n/);
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }
      this.cachedLines = lines;
      this.cachedLineCount = lines.length;
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
    const matches: SearchMatch[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      pattern.lastIndex = 0;
      if (line && pattern.test(line)) {
        matches.push({ lineNumber: i + 1, text: line });
      }
    }
    return matches;
  }

  get length(): number {
    if (this.isDirty) {
      this.splitBufferLines();
    }
    return this.cachedLineCount;
  }

  get byteLength(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = '';
    this.cachedLines = null;
    this.cachedLineCount = 0;
    this.isDirty = false;
  }
}
