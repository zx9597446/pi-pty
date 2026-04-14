import { describe, it, expect } from 'vitest';
import { parseEscapeSequences, ETX, EOT } from '../src/pty/escape.js';

describe('parseEscapeSequences edge cases', () => {
  it('should handle \\x00 (null byte)', () => {
    expect(parseEscapeSequences('\\x00')).toBe('\x00');
  });

  it('should handle \\xff (max single byte)', () => {
    expect(parseEscapeSequences('\\xff')).toBe('\xff');
  });

  it('should handle lowercase hex digits', () => {
    expect(parseEscapeSequences('\\xab')).toBe('\xab');
    expect(parseEscapeSequences('\\xcd')).toBe('\xcd');
  });

  it('should handle mixed case hex digits', () => {
    expect(parseEscapeSequences('\\xaB')).toBe('\xaB');
    expect(parseEscapeSequences('\\X4f')).toBe('\\X4f'); // \X is not valid escape
  });

  it('should handle unicode supplementary planes (BMP only, 4 hex digits)', () => {
    expect(parseEscapeSequences('\\u4e2d')).toBe('中');
    expect(parseEscapeSequences('\\u0041')).toBe('A');
    expect(parseEscapeSequences('\\u0000')).toBe('\u0000');
    expect(parseEscapeSequences('\\uffff')).toBe('\uffff');
  });

  it('should not convert invalid \\x (only one hex digit)', () => {
    expect(parseEscapeSequences('\\xa')).toBe('\\xa');
  });

  it('should not convert invalid \\x (no hex digits)', () => {
    expect(parseEscapeSequences('\\x')).toBe('\\x');
  });

  it('should not convert \\x with non-hex characters', () => {
    expect(parseEscapeSequences('\\xgg')).toBe('\\xgg');
  });

  it('should not convert invalid \\u (less than 4 hex digits)', () => {
    expect(parseEscapeSequences('\\u123')).toBe('\\u123');
    expect(parseEscapeSequences('\\u12')).toBe('\\u12');
    expect(parseEscapeSequences('\\u1')).toBe('\\u1');
  });

  it('should not convert \\u with non-hex characters', () => {
    expect(parseEscapeSequences('\\ugggg')).toBe('\\ugggg');
  });

  it('should handle backslash at end of string', () => {
    expect(parseEscapeSequences('test\\')).toBe('test\\');
  });

  it('should handle consecutive escape sequences', () => {
    expect(parseEscapeSequences('\\n\\n\\n')).toBe('\n\n\n');
    expect(parseEscapeSequences('\\x41\\x42\\x43')).toBe('ABC');
  });

  it('should handle escape sequences in the middle of text', () => {
    expect(parseEscapeSequences('start\\nmiddle\\tend')).toBe('start\nmiddle\tend');
  });

  it('should not convert unknown backslash sequences', () => {
    expect(parseEscapeSequences('\\a')).toBe('\\a');
    expect(parseEscapeSequences('\\b')).toBe('\\b');
    expect(parseEscapeSequences('\\f')).toBe('\\f');
    expect(parseEscapeSequences('\\v')).toBe('\\v');
    expect(parseEscapeSequences('\\0')).toBe('\\0');
    expect(parseEscapeSequences('\\z')).toBe('\\z');
  });

  it('should handle literal backslash followed by n', () => {
    expect(parseEscapeSequences('\\\\n')).toBe('\\n'); // \\ → \, n stays literal
  });

  it('should handle hex escape for control characters', () => {
    expect(parseEscapeSequences('\\x03')).toBe('\x03'); // ETX (Ctrl+C)
    expect(parseEscapeSequences('\\x04')).toBe('\x04'); // EOT (Ctrl+D)
    expect(parseEscapeSequences('\\x1b')).toBe('\x1b'); // ESC
    expect(parseEscapeSequences('\\x0d')).toBe('\r');   // CR
    expect(parseEscapeSequences('\\x0a')).toBe('\n');   // LF
  });

  it('should handle long string with many escapes', () => {
    const input = Array(100).fill('\\n').join('');
    const expected = '\n'.repeat(100);
    expect(parseEscapeSequences(input)).toBe(expected);
  });
});

describe('ETX and EOT constants', () => {
  it('ETX is Ctrl+C (char code 3)', () => {
    expect(ETX.charCodeAt(0)).toBe(3);
    expect(ETX).toBe('\x03');
  });

  it('EOT is Ctrl+D (char code 4)', () => {
    expect(EOT.charCodeAt(0)).toBe(4);
    expect(EOT).toBe('\x04');
  });

  it('constants are single characters', () => {
    expect(ETX.length).toBe(1);
    expect(EOT.length).toBe(1);
  });
});
