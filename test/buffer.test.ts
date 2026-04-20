import { describe, it, expect, beforeEach } from 'vitest';
import { RingBuffer } from '../src/pty/buffer.js';

describe('RingBuffer', () => {
  let buffer: RingBuffer;

  beforeEach(() => {
    // Small max size for testing overflow
    buffer = new RingBuffer(20);
  });

  it('should append and read data', () => {
    buffer.append('hello\nworld\n');
    const lines = buffer.read();
    expect(lines).toEqual(['hello', 'world']);
    expect(buffer.length).toBe(2);
  });

  it('should handle overflow by slicing from start', () => {
    buffer.append('12345678901234567890'); // 20 chars
    buffer.append('ABCDE'); // Should drop 12345
    expect(buffer.readRaw()).toBe('678901234567890ABCDE');
  });

  it('should handle pagination', () => {
    buffer = new RingBuffer(100);
    buffer.append('line1\nline2\nline3\nline4\nline5\n');
    
    const page1 = buffer.read(0, 2);
    expect(page1).toEqual(['line1', 'line2']);
    
    const page2 = buffer.read(2, 2);
    expect(page2).toEqual(['line3', 'line4']);
    
    const page3 = buffer.read(4, 10);
    expect(page3).toEqual(['line5']);
  });

  it('should search with regex', () => {
    buffer = new RingBuffer(100);
    buffer.append('error: fail\nsuccess: ok\nerror: abort\n');
    
    const matches = buffer.search(/error/);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({ lineNumber: 1, text: 'error: fail' });
    expect(matches[1]).toEqual({ lineNumber: 3, text: 'error: abort' });
  });

  it('should clear buffer', () => {
    buffer.append('some data');
    buffer.clear();
    expect(buffer.length).toBe(0);
    expect(buffer.readRaw()).toBe('');
  });

  it('should collapse consecutive newlines to prevent buffer bloat', () => {
    buffer = new RingBuffer(1000);
    // Simulate PTY sending multiple consecutive newlines
    buffer.append('line1\n\n\n\nline2\n');
    
    const lines = buffer.read();
    // Multiple consecutive newlines should be collapsed to single newline
    expect(lines).toEqual(['line1', 'line2']);
    expect(buffer.length).toBe(2);
  });

  it('should preserve single newlines', () => {
    buffer = new RingBuffer(1000);
    buffer.append('line1\nline2\nline3\n');
    
    const lines = buffer.read();
    expect(lines).toEqual(['line1', 'line2', 'line3']);
    expect(buffer.length).toBe(3);
  });
});
