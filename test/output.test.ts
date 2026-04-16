import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutputManager } from '../src/pty/output.js';
import type { PTYSession } from '../src/pty/types.js';
import { RingBuffer } from '../src/pty/buffer.js';

function createMockSession(status: string = 'running'): PTYSession {
  const buffer = new RingBuffer();
  return {
    id: 'pty_test',
    title: 'Test Session',
    command: 'echo',
    args: ['hello'],
    workdir: '/tmp',
    status: status as any,
    pid: 1234,
    createdAt: new Date(),
    parentSessionId: 'parent',
    notifyOnExit: false,
    buffer,
    process: {
      write: vi.fn(),
      kill: vi.fn(),
    },
  };
}

describe('OutputManager', () => {
  let outputManager: OutputManager;

  beforeEach(() => {
    outputManager = new OutputManager();
  });

  describe('write', () => {
    it('should write data to the process', () => {
      const session = createMockSession();
      const success = outputManager.write(session, 'ls\n');
      expect(success).toBe(true);
      expect((session.process as any).write).toHaveBeenCalledWith('ls\n');
    });

    it('should return false if process.write throws', () => {
      const session = createMockSession();
      (session.process as any).write = vi.fn(() => { throw new Error('fail'); });
      const success = outputManager.write(session, 'data');
      expect(success).toBe(false);
    });

    it('should return true when process is null', () => {
      const session = createMockSession();
      session.process = null as any;
      const success = outputManager.write(session, 'data');
      expect(success).toBe(true);
    });

    it('should write to exited process for tests', () => {
      const session = createMockSession('exited');
      const success = outputManager.write(session, 'input');
      expect(success).toBe(true);
    });
  });

  describe('read', () => {
    it('should return empty result for empty buffer', () => {
      const session = createMockSession();
      const result = outputManager.read(session);
      expect(result).toEqual({
        lines: [],
        totalLines: 0,
        offset: 0,
        hasMore: false,
      });
    });

    it('should read all lines from buffer', () => {
      const session = createMockSession();
      session.buffer.append('line1\nline2\nline3\n');
      const result = outputManager.read(session);
      expect(result).toEqual({
        lines: ['line1', 'line2', 'line3'],
        totalLines: 3,
        offset: 0,
        hasMore: false,
      });
    });

    it('should respect offset', () => {
      const session = createMockSession();
      session.buffer.append('a\nb\nc\nd\n');
      const result = outputManager.read(session, 2);
      expect(result.lines).toEqual(['c', 'd']);
      expect(result.totalLines).toBe(4);
      expect(result.offset).toBe(2);
    });

    it('should respect limit', () => {
      const session = createMockSession();
      session.buffer.append('a\nb\nc\nd\n');
      const result = outputManager.read(session, 0, 2);
      expect(result.lines).toEqual(['a', 'b']);
      expect(result.hasMore).toBe(true);
    });

    it('should set hasMore correctly', () => {
      const session = createMockSession();
      session.buffer.append('1\n2\n3\n');
      
      const partial = outputManager.read(session, 0, 2);
      expect(partial.hasMore).toBe(true);
      
      const full = outputManager.read(session, 0, 10);
      expect(full.hasMore).toBe(false);
    });

    it('should handle offset beyond buffer length', () => {
      const session = createMockSession();
      session.buffer.append('a\nb\n');
      const result = outputManager.read(session, 100, 10);
      expect(result.lines).toEqual([]);
      expect(result.totalLines).toBe(2);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('search', () => {
    it('should find matching lines', () => {
      const session = createMockSession();
      session.buffer.append('info: start\nerror: fail\ninfo: done\nerror: abort\n');
      const result = outputManager.search(session, /error/);
      expect(result.totalMatches).toBe(2);
      expect(result.matches).toEqual([
        { lineNumber: 2, text: 'error: fail' },
        { lineNumber: 4, text: 'error: abort' },
      ]);
    });

    it('should return empty matches for no match', () => {
      const session = createMockSession();
      session.buffer.append('line1\nline2\n');
      const result = outputManager.search(session, /notfound/);
      expect(result.totalMatches).toBe(0);
      expect(result.matches).toEqual([]);
    });

    it('should support pagination with offset', () => {
      const session = createMockSession();
      session.buffer.append('err1\nok\nerr2\nok\nerr3\n');
      const result = outputManager.search(session, /err/, 1, 1);
      expect(result.totalMatches).toBe(3);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].text).toBe('err2');
      expect(result.hasMore).toBe(true);
    });

    it('should support limit on search results', () => {
      const session = createMockSession();
      session.buffer.append('err1\nerr2\nerr3\nerr4\nerr5\n');
      const result = outputManager.search(session, /err/, 0, 2);
      expect(result.matches).toHaveLength(2);
      expect(result.totalMatches).toBe(5);
      expect(result.hasMore).toBe(true);
    });

    it('should handle regex with case insensitive flag', () => {
      const session = createMockSession();
      session.buffer.append('ERROR\nerror\nError\n');
      const result = outputManager.search(session, /error/i);
      expect(result.totalMatches).toBe(3);
    });

    it('should handle search on empty buffer', () => {
      const session = createMockSession();
      const result = outputManager.search(session, /test/);
      expect(result.totalMatches).toBe(0);
      expect(result.totalLines).toBe(0);
    });

    it('should handle search with no limit (return all)', () => {
      const session = createMockSession();
      session.buffer.append('a1\nb2\nc3\nd4\n');
      const result = outputManager.search(session, /\d/, 0);
      expect(result.matches).toHaveLength(4);
      expect(result.hasMore).toBe(false);
    });
  });
});
