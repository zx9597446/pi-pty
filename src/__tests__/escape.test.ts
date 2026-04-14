import { describe, it, expect } from 'vitest';
import { parseEscapeSequences } from '../pty/escape.js';

describe('parseEscapeSequences', () => {
  it('parses \\n', () => {
    expect(parseEscapeSequences('hello\\nworld')).toBe('hello\nworld');
  });

  it('parses \\r', () => {
    expect(parseEscapeSequences('hello\\rworld')).toBe('hello\rworld');
  });

  it('parses \\t', () => {
    expect(parseEscapeSequences('hello\\tworld')).toBe('hello\tworld');
  });

  it('parses \\\\', () => {
    expect(parseEscapeSequences('hello\\\\world')).toBe('hello\\world');
  });

  it('parses \\xNN hex escapes', () => {
    expect(parseEscapeSequences('\\x03')).toBe('\x03');
    expect(parseEscapeSequences('\\x41')).toBe('A');
    expect(parseEscapeSequences('\\x00')).toBe('\x00');
    expect(parseEscapeSequences('\\xff')).toBe('\xff');
  });

  it('parses \\uNNNN unicode escapes', () => {
    expect(parseEscapeSequences('\\u0041')).toBe('A');
    expect(parseEscapeSequences('\\u4e2d')).toBe('中');
    expect(parseEscapeSequences('\\u03A9')).toBe('\u03A9');
  });

  it('keeps invalid escape sequences unchanged', () => {
    expect(parseEscapeSequences('\\x')).toBe('\\x');
    expect(parseEscapeSequences('\\u123')).toBe('\\u123');
    expect(parseEscapeSequences('\\q')).toBe('\\q');
  });

  it('handles mixed escape sequences', () => {
    expect(parseEscapeSequences('a\\nb\\tc\\x41d'))
      .toBe('a\nb\tcAd');
  });

  it('returns unchanged string with no escapes', () => {
    expect(parseEscapeSequences('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(parseEscapeSequences('')).toBe('');
  });
});
