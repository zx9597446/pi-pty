import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../pty/buffer.js';

describe('RingBuffer', () => {
  describe('append + read', () => {
    it('stores and retrieves lines', () => {
      const buf = new RingBuffer();
      buf.append('hello\nworld\n');
      expect(buf.read()).toEqual(['hello', 'world']);
    });

    it('handles empty buffer', () => {
      const buf = new RingBuffer();
      expect(buf.read()).toEqual([]);
      expect(buf.length).toBe(0);
      expect(buf.byteLength).toBe(0);
    });

    it('handles single line without trailing newline', () => {
      const buf = new RingBuffer();
      buf.append('hello');
      expect(buf.read()).toEqual(['hello']);
    });

    it('handles data appended in chunks', () => {
      const buf = new RingBuffer();
      buf.append('line1\n');
      buf.append('line2\nline3\n');
      expect(buf.read()).toEqual(['line1', 'line2', 'line3']);
    });
  });

  describe('overflow truncation', () => {
    it('truncates to maxSize keeping newest data', () => {
      const buf = new RingBuffer(10);
      buf.append('abcdefghij'); // exactly 10 chars
      expect(buf.byteLength).toBe(10);
      buf.append('X'); // pushes past limit
      expect(buf.byteLength).toBe(10);
      expect(buf.readRaw()).toBe('bcdefghijX');
    });

    it('works with multiline data at boundary', () => {
      const buf = new RingBuffer(15);
      buf.append('aaaaa\nbbbbb\n'); // 11 chars + 1 = 12
      buf.append('ccccc\n');        // total 18, truncates to 15
      const raw = buf.readRaw();
      expect(raw.length).toBe(15);
    });
  });

  describe('search', () => {
    it('finds matching lines with regex', () => {
      const buf = new RingBuffer();
      buf.append('line1\nerror: foo\nline3\nerror: bar\n');
      const matches = buf.search(/error/);
      expect(matches).toEqual([
        { lineNumber: 2, text: 'error: foo' },
        { lineNumber: 4, text: 'error: bar' },
      ]);
    });

    it('returns empty array for no matches', () => {
      const buf = new RingBuffer();
      buf.append('line1\nline2\n');
      expect(buf.search(/error/)).toEqual([]);
    });

    it('works with global flag without skipping matches', () => {
      const buf = new RingBuffer();
      buf.append('aaa\naaa\naaa\n');
      const re = /a/g;
      const matches = buf.search(re);
      expect(matches).toHaveLength(3);
    });

    it('skips empty lines', () => {
      const buf = new RingBuffer();
      buf.append('hello\n\nworld\n');
      expect(buf.search(/$/)).toEqual([
        { lineNumber: 1, text: 'hello' },
        { lineNumber: 3, text: 'world' },
      ]);
    });
  });

  describe('pagination (offset/limit)', () => {
    it('reads with offset', () => {
      const buf = new RingBuffer();
      buf.append('a\nb\nc\nd\n');
      expect(buf.read(2)).toEqual(['c', 'd']);
    });

    it('reads with limit', () => {
      const buf = new RingBuffer();
      buf.append('a\nb\nc\nd\n');
      expect(buf.read(0, 2)).toEqual(['a', 'b']);
    });

    it('reads with both offset and limit', () => {
      const buf = new RingBuffer();
      buf.append('a\nb\nc\nd\n');
      expect(buf.read(1, 2)).toEqual(['b', 'c']);
    });

    it('clamps offset to valid range', () => {
      const buf = new RingBuffer();
      buf.append('a\nb\n');
      expect(buf.read(100)).toEqual([]);
    });
  });

  describe('clear', () => {
    it('empties the buffer', () => {
      const buf = new RingBuffer();
      buf.append('hello\nworld\n');
      buf.clear();
      expect(buf.read()).toEqual([]);
      expect(buf.byteLength).toBe(0);
    });
  });

  describe('readRaw', () => {
    it('returns raw buffer contents', () => {
      const buf = new RingBuffer();
      buf.append('hello\nworld');
      expect(buf.readRaw()).toBe('hello\nworld');
    });
  });
});
