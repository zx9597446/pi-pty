import { describe, it, expect } from 'vitest';
import { stripAnsi, formatLine, formatSessionInfo } from '../src/pty/formatters.js';

describe('stripAnsi', () => {
  it('should leave plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('should strip basic color codes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('should strip multiple color codes in sequence', () => {
    const input = '\x1b[31mred\x1b[32mgreen\x1b[34mblue\x1b[0m';
    expect(stripAnsi(input)).toBe('redgreenblue');
  });

  it('should strip bold/bright codes', () => {
    expect(stripAnsi('\x1b[1mbold\x1b[0m')).toBe('bold');
  });

  it('should strip underline codes', () => {
    expect(stripAnsi('\x1b[4munderlined\x1b[0m')).toBe('underlined');
  });

  it('should strip 256-color codes', () => {
    expect(stripAnsi('\x1b[38;5;200mcolor\x1b[0m')).toBe('color');
  });

  it('should strip cursor movement codes', () => {
    expect(stripAnsi('\x1b[2J\x1b[Hcleared')).toBe('cleared');
  });

  it('should handle text with no codes in between', () => {
    expect(stripAnsi('before\x1b[31mafter\x1b[0m')).toBe('beforeafter');
  });

  it('should handle empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('should handle string with only ANSI codes', () => {
    expect(stripAnsi('\x1b[0m\x1b[1m\x1b[31m')).toBe('');
  });

  it('should handle multi-line strings with ANSI codes', () => {
    const input = '\x1b[32mLine1\x1b[0m\n\x1b[31mLine2\x1b[0m';
    expect(stripAnsi(input)).toBe('Line1\nLine2');
  });

  it('should strip CSI reset code (ESC [ m)', () => {
    expect(stripAnsi('\x1b[m')).toBe('');
  });

  it('should not strip non-ANSI control chars', () => {
    expect(stripAnsi('hello\x07world')).toBe('hello\x07world');
  });
});

describe('formatLine', () => {
  it('should format a normal line with line number', () => {
    expect(formatLine('hello', 1)).toBe('[1] hello');
    expect(formatLine('world', 42)).toBe('[42] world');
  });

  it('should format line number 0', () => {
    expect(formatLine('start', 0)).toBe('[0] start');
  });

  it('should truncate lines longer than max length', () => {
    const longText = 'a'.repeat(2001);
    const result = formatLine(longText, 1);
    expect(result.startsWith('[1] ')).toBe(true);
    expect(result.endsWith('... (truncated)')).toBe(true);
    expect(result.length).toBe(4 + 2000 + 15); // [1] + 2000 chars + '... (truncated)'
  });

  it('should not truncate lines at exactly max length', () => {
    const exactText = 'a'.repeat(2000);
    const result = formatLine(exactText, 1);
    expect(result.endsWith('... (truncated)')).toBe(false);
  });

  it('should use default max length', () => {
    const result = formatLine('test', 1);
    expect(result).toBe('[1] test');
  });

  it('should accept custom max length', () => {
    const result = formatLine('12345', 1, 3);
    expect(result).toBe('[1] 123... (truncated)');
  });

  it('should handle empty text', () => {
    expect(formatLine('', 1)).toBe('[1] ');
  });
});

describe('formatSessionInfo', () => {
  it('should format session info correctly', () => {
    const session = {
      id: 'pty_abc123',
      title: 'My Session',
      command: 'python',
      args: ['script.py', '--arg'],
      status: 'running',
      pid: 1234,
      lineCount: 42,
    };
    const result = formatSessionInfo(session);
    expect(result).toEqual([
      'ID: pty_abc123',
      '  Title: My Session',
      '  Command: python script.py --arg',
      '  Status: running',
      '  PID: 1234',
      '  Lines: 42',
      ''
    ]);
  });

  it('should handle empty args', () => {
    const session = {
      id: 'pty_test',
      title: 'Test',
      command: 'ls',
      args: [],
      status: 'exited',
      pid: 0,
      lineCount: 0,
    };
    const result = formatSessionInfo(session);
    expect(result[2]).toBe('  Command: ls ');
  });

  it('should include trailing empty string', () => {
    const session = {
      id: 'x',
      title: 't',
      command: 'c',
      args: [],
      status: 'running',
      pid: 1,
      lineCount: 0,
    };
    const result = formatSessionInfo(session);
    expect(result[result.length - 1]).toBe('');
  });
});
