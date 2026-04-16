import { describe, it, expect, beforeEach } from 'vitest';
import { RingBuffer } from '../src/pty/buffer.js';

describe('RingBuffer edge cases', () => {
  let buffer: RingBuffer;

  beforeEach(() => {
    buffer = new RingBuffer(100);
  });

  describe('Windows line endings (CRLF)', () => {
    it('should handle \\r\\n line endings', () => {
      buffer.append('line1\r\nline2\r\n');
      expect(buffer.read()).toEqual(['line1', 'line2']);
    });

    it('should handle mixed line endings', () => {
      buffer.append('unix\nwindows\r\nmac\rlegacy\n');
      const lines = buffer.read();
      // \r\n is split by /\r?\n/ → \r could remain at end of 'windows'
      // Actually our regex is /\r?\n/ so:
      // 'unix' | 'windows' | 'mac\rlegacy'
      expect(lines).toEqual(['unix', 'windows', 'mac\rlegacy']);
    });

    it('should handle bare \\r', () => {
      buffer.append('a\rb\nc\n');
      expect(buffer.read()).toEqual(['a\rb', 'c']);
    });
  });

  describe('buffer overflow behavior', () => {
    it('should exactly retain maxSize after overflow', () => {
      const buf = new RingBuffer(10);
      buf.append('0123456789'); // exactly 10
      expect(buf.byteLength).toBe(10);
      buf.append('X'); // triggers overflow
      expect(buf.byteLength).toBe(10);
      expect(buf.readRaw()).toBe('123456789X');
    });

    it('should handle multiple small appends beyond maxSize', () => {
      const buf = new RingBuffer(10);
      for (let i = 0; i < 20; i++) {
        buf.append(String(i));
      }
      // buffer accumulates: '0123456789...' → at each append, if >10, truncates last 10
      // After all appends: '012345678910111213141516171819' → last 10 = '1516171819'
      expect(buf.byteLength).toBe(10);
      expect(buf.readRaw()).toBe('1516171819');
    });

    it('should handle large single append beyond maxSize', () => {
      const buf = new RingBuffer(50);
      buf.append('x'.repeat(200));
      expect(buf.byteLength).toBe(50);
      expect(buf.readRaw()).toBe('x'.repeat(50));
    });
  });

  describe('splitBufferLines edge cases', () => {
    it('should handle trailing newline', () => {
      buffer.append('a\nb\n');
      expect(buffer.read()).toEqual(['a', 'b']);
      expect(buffer.length).toBe(2);
    });

    it('should handle no trailing newline', () => {
      buffer.append('a\nb');
      expect(buffer.read()).toEqual(['a', 'b']);
      expect(buffer.length).toBe(2);
    });

    it('should handle consecutive newlines', () => {
      buffer.append('a\n\nb\n\n');
      // splitLines removes empty trailing, but empty middle lines remain
      const lines = buffer.read();
      expect(lines).toContain('a');
      expect(lines).toContain('b');
    });

    it('should handle single newline', () => {
      buffer.append('\n');
      // '\n' splits to ['', ''] → remove trailing empty → ['']
      expect(buffer.read()).toEqual(['']);
      expect(buffer.length).toBe(1);
    });

    it('should handle only newlines', () => {
      buffer.append('\n\n\n');
      // splits to ['', '', '', ''] → remove trailing empty → ['', '', '']
      expect(buffer.read()).toEqual(['', '', '']);
    });
  });

  describe('read offset/limit edge cases', () => {
    it('negative offset clamped to 0', () => {
      buffer.append('a\nb\n');
      expect(buffer.read(-1)).toEqual(['a', 'b']);
    });

    it('zero limit returns empty', () => {
      buffer.append('a\nb\n');
      expect(buffer.read(0, 0)).toEqual([]);
    });

    it('offset at last line returns empty', () => {
      buffer.append('a\nb\n');
      expect(buffer.read(2)).toEqual([]);
    });

    it('limit beyond available returns only available', () => {
      buffer.append('a\nb\n');
      expect(buffer.read(0, 100)).toEqual(['a', 'b']);
    });

    it('offset exactly at buffer size', () => {
      buffer.append('a\nb\n');
      expect(buffer.read(2)).toEqual([]);
      expect(buffer.read(3)).toEqual([]);
      expect(buffer.read(999)).toEqual([]);
    });
  });

  describe('search edge cases', () => {
    it('should handle regex with global flag correctly (reset lastIndex)', () => {
      buffer.append('aaa\naaa\n');
      const re = /a/g;
      const matches = buffer.search(re);
      expect(matches).toHaveLength(2);
    });

    it('should not match empty lines', () => {
      buffer.append('a\n\nb\n');
      const matches = buffer.search(/x/);
      expect(matches).toHaveLength(0);
    });

    it('should handle pattern matching entire line', () => {
      buffer.append('exact match\nnot this\nexact match too\n');
      const matches = buffer.search(/^exact/);
      expect(matches).toHaveLength(2);
    });

    it('should handle special regex characters', () => {
      buffer.append('file.txt\nfile.doc\n');
      const matches = buffer.search(/\.txt$/);
      expect(matches).toHaveLength(1);
      expect(matches[0].text).toBe('file.txt');
    });
  });

  describe('byteLength and length', () => {
    it('byteLength reflects raw buffer size', () => {
      buffer.append('hello\nworld\n');
      expect(buffer.byteLength).toBe(12);
    });

    it('length reflects line count', () => {
      buffer.append('a\nb\nc\n');
      expect(buffer.length).toBe(3);
    });

    it('both zero on empty buffer', () => {
      expect(buffer.length).toBe(0);
      expect(buffer.byteLength).toBe(0);
    });

    it('byteLength after overflow capped at maxSize', () => {
      const buf = new RingBuffer(10);
      buf.append('0123456789ABCDEF');
      expect(buf.byteLength).toBe(10);
    });
  });
});
