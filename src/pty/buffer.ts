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
    this.buffer += data;
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
    if (!this.isDirty && this.cachedLines) {
      return this.cachedLines;
    }

    const lines: string[] = this.buffer.split(/\r?\n/);
    // Remove empty string at end if buffer doesn't end with newline
    if (lines.length && lines[lines.length - 1] === '') {
      lines.pop();
    }
    
    this.cachedLines = lines;
    this.isDirty = false;
    return lines;
  }

  read(offset: number = 0, limit?: number): string[] {
    if (this.buffer === '') return [];
    const lines = this.splitBufferLines();
    const start = Math.max(0, offset);
    const end = limit !== undefined ? start + limit : lines.length;
    return lines.slice(start, end);
  }

  readRaw(): string {
    return this.buffer;
  }

  search(pattern: RegExp): SearchMatch[] {
    const matches: SearchMatch[] = [];
    const lines: string[] = this.splitBufferLines();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line && pattern.test(line)) {
        pattern.lastIndex = 0;
        matches.push({ lineNumber: i + 1, text: line });
      }
    }
    return matches;
  }

  get length(): number {
    if (this.buffer === '') return 0;
    const lines = this.splitBufferLines();
    return lines.length;
  }

  get byteLength(): number {
    return this.buffer.length;
  }

  flush(): void {
    // No-op in new implementation
  }

  clear(): void {
    this.buffer = '';
  }
}
