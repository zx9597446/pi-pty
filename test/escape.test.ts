import { describe, it, expect } from 'vitest';
import { parseEscapeSequences, ETX, EOT } from '../src/pty/escape.js';

describe('parseEscapeSequences', () => {
  it('should leave plain text unchanged', () => {
    expect(parseEscapeSequences('hello world')).toBe('hello world');
  });

  it('should convert \\n to newline', () => {
    expect(parseEscapeSequences('line1\\nline2')).toBe('line1\nline2');
  });

  it('should convert \\r to carriage return', () => {
    expect(parseEscapeSequences('start\\rend')).toBe('start\rend');
  });

  it('should convert \\t to tab', () => {
    expect(parseEscapeSequences('col1\\tcol2')).toBe('col1\tcol2');
  });

  it('should convert \\\\ to single backslash', () => {
    expect(parseEscapeSequences('path\\\\to')).toBe('path\\to');
  });

  it('should convert \\x hex sequences', () => {
    expect(parseEscapeSequences('\\x41\\x42\\x43')).toBe('ABC');
    expect(parseEscapeSequences('\\x0a')).toBe('\n');
    expect(parseEscapeSequences('\\x0d')).toBe('\r');
  });

  it('should convert \\u unicode sequences', () => {
    expect(parseEscapeSequences('\\u0041')).toBe('A');
    expect(parseEscapeSequences('\\u00e9')).toBe('é');
  });

  it('should handle mixed sequences in one string', () => {
    const input = 'Hello\\nWorld\\t!\\x20OK';
    expect(parseEscapeSequences(input)).toBe('Hello\nWorld\t! OK');
  });

  it('should not convert unknown escape sequences', () => {
    expect(parseEscapeSequences('\\z\\q')).toBe('\\z\\q');
  });

  it('should handle empty string', () => {
    expect(parseEscapeSequences('')).toBe('');
  });

  it('should handle only escape sequences', () => {
    expect(parseEscapeSequences('\\n\\r\\t')).toBe('\n\r\t');
  });

  it('should handle consecutive newlines', () => {
    expect(parseEscapeSequences('a\\n\\nb')).toBe('a\n\nb');
  });

  it('should handle uppercase and lowercase hex digits', () => {
    expect(parseEscapeSequences('\\x4f\\x4f')).toBe('OO');
    expect(parseEscapeSequences('\\x4F\\X4F')).toBe('O\\X4F'); // \X is not valid
  });

  it('should not convert incomplete hex sequences', () => {
    expect(parseEscapeSequences('\\x4')).toBe('\\x4');
    expect(parseEscapeSequences('\\x')).toBe('\\x');
  });

  it('should not convert incomplete unicode sequences', () => {
    expect(parseEscapeSequences('\\u004')).toBe('\\u004');
    expect(parseEscapeSequences('\\u')).toBe('\\u');
  });

  it('should not convert invalid hex digits', () => {
    expect(parseEscapeSequences('\\xG1')).toBe('\\xG1');
  });

  it('should handle backslash at end of string', () => {
    expect(parseEscapeSequences('test\\')).toBe('test\\');
  });

  it('should handle nested-like backslashes', () => {
    expect(parseEscapeSequences('\\\\\\n')).toBe('\\\n');
  });
});

describe('ETX and EOT constants', () => {
  it('ETX should be character code 3', () => {
    expect(ETX).toBe(String.fromCharCode(3));
    expect(ETX.length).toBe(1);
  });

  it('EOT should be character code 4', () => {
    expect(EOT).toBe(String.fromCharCode(4));
    expect(EOT.length).toBe(1);
  });
});
