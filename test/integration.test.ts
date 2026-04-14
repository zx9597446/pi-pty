import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { PTYManager } from '../src/pty/manager.js';
import { stripAnsi } from '../src/pty/formatters.js';
import type { PTYSessionInfo } from '../src/pty/types.js';

/**
 * Real PTY integration tests using actual zigpty ConPTY on Windows.
 * These tests spawn real processes and verify end-to-end behavior.
 */
describe('Real PTY integration (zigpty)', () => {
  let manager: PTYManager;

  beforeAll(() => {
    manager = new PTYManager();
  });

  afterAll(() => {
    manager.clearAll();
  });

  afterEach(() => {
    // Clean up any leftover sessions
    manager.clearAll();
  });

  function waitForCondition(
    fn: () => boolean,
    timeoutMs: number = 5000,
    intervalMs: number = 50
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (fn()) { resolve(); return; }
      const timer = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
      const check = setInterval(() => {
        if (fn()) { clearTimeout(timer); clearInterval(check); resolve(); }
      }, intervalMs);
    });
  }

  describe('spawn + read basic output', () => {
    it('should capture output from cmd /c echo', async () => {
      const onData = vi.fn();
      let exitCode: number | null = null;

      const info = manager.spawn(
        {
          command: 'cmd',
          args: ['/c', 'echo', 'hello world'],
          parentSessionId: 'integration-test',
          description: 'echo test',
        },
        onData,
        (code) => { exitCode = code; }
      );

      expect(info.id).toMatch(/^pty_/);
      expect(info.status).toBe('running');
      expect(info.pid).toBeGreaterThan(0);

      // Wait for process to exit
      await waitForCondition(() => exitCode !== null, 5000);

      expect(exitCode).toBe(0);

      // Read buffer
      const result = manager.read(info.id);
      expect(result).not.toBeNull();
      expect(result!.totalLines).toBeGreaterThan(0);

      // Find the line with our output (after ANSI stripping)
      const allText = result!.lines.map(l => stripAnsi(l)).join('\n');
      expect(allText).toContain('hello world');
    });

    it('should capture multi-line output', async () => {
      let exitCode: number | null = null;

      const info = manager.spawn(
        {
          command: 'cmd',
          args: ['/c', 'echo', 'line1', '&&', 'echo', 'line2', '&&', 'echo', 'line3'],
          parentSessionId: 'integration-test',
          description: 'multi-line test',
        },
        () => {},
        (code) => { exitCode = code; }
      );

      await waitForCondition(() => exitCode !== null, 5000);

      const result = manager.read(info.id);
      const allText = result!.lines.map(l => stripAnsi(l)).join('\n');
      expect(allText).toContain('line1');
      expect(allText).toContain('line2');
      expect(allText).toContain('line3');
    });

    it('should report correct exit code for non-zero exit', async () => {
      let exitCode: number | null = null;

      const info = manager.spawn(
        {
          command: 'cmd',
          args: ['/c', 'exit', '42'],
          parentSessionId: 'integration-test',
          description: 'exit code test',
        },
        () => {},
        (code) => { exitCode = code; }
      );

      await waitForCondition(() => exitCode !== null, 5000);
      expect(exitCode).toBe(42);

      const session = manager.get(info.id);
      expect(session!.exitCode).toBe(42);
      expect(session!.status).toBe('exited');
    });
  });

  describe('write + read interactive session', () => {
    it('should write input and read response', async () => {
      let exitCode: number | null = null;

      const info = manager.spawn(
        {
          command: 'cmd',
          args: [],
          parentSessionId: 'integration-test',
          description: 'interactive cmd',
        },
        () => {},
        (code) => { exitCode = code; }
      );

      // Wait for cmd prompt to appear
      await waitForCondition(() => {
        const result = manager.read(info.id);
        return result!.totalLines > 0;
      }, 3000);

      // Send a command
      manager.write(info.id, 'echo from_input\r\n');

      // Wait for output
      await waitForCondition(() => {
        const result = manager.read(info.id);
        const text = result!.lines.map(l => stripAnsi(l)).join('\n');
        return text.includes('from_input');
      }, 3000);

      // Clean up
      manager.write(info.id, 'exit\r\n');
      await waitForCondition(() => exitCode !== null, 3000);
    });
  });

  describe('kill', () => {
    it('should terminate a long-running process', async () => {
      let exitCode: number | null = null;

      const info = manager.spawn(
        {
          command: 'cmd',
          args: [],
          parentSessionId: 'integration-test',
          description: 'long running',
        },
        () => {},
        (code) => { exitCode = code; }
      );

      await waitForCondition(() => manager.get(info.id)!.status === 'running', 2000);

      manager.kill(info.id);

      await waitForCondition(() => exitCode !== null, 3000);

      const session = manager.get(info.id);
      expect(session!.status).toBe('killed');
    });

    it('should kill with cleanup and remove session', async () => {
      const info = manager.spawn(
        {
          command: 'cmd',
          args: [],
          parentSessionId: 'integration-test',
          description: 'cleanup test',
        },
        () => {},
        () => {}
      );

      await waitForCondition(() => manager.get(info.id)!.status === 'running', 2000);

      manager.kill(info.id, true);

      // Give time for async exit
      await new Promise(r => setTimeout(r, 500));

      expect(manager.get(info.id)).toBeNull();
    });
  });

  describe('list', () => {
    it('should list active sessions', async () => {
      const info = manager.spawn(
        { command: 'cmd', args: [], parentSessionId: 'p', description: 'list test' },
        () => {}, () => {}
      );

      await waitForCondition(() => manager.get(info.id)!.status === 'running', 2000);

      const sessions = manager.list();
      expect(sessions.length).toBeGreaterThanOrEqual(1);

      const found = sessions.find(s => s.id === info.id);
      expect(found).toBeDefined();
      expect(found!.command).toBe('cmd');
    });
  });

  describe('search with real output', () => {
    it('should find matching lines in real PTY output', async () => {
      let exitCode: number | null = null;

      const info = manager.spawn(
        {
          command: 'cmd',
          args: ['/c', 'echo', 'ERROR: something', '&&', 'echo', 'INFO: ok', '&&', 'echo', 'ERROR: another'],
          parentSessionId: 'integration-test',
          description: 'search test',
        },
        () => {},
        (code) => { exitCode = code; }
      );

      await waitForCondition(() => exitCode !== null, 5000);

      const result = manager.search(info.id, /ERROR/);
      expect(result).not.toBeNull();
      expect(result!.totalMatches).toBeGreaterThanOrEqual(1);

      // Verify matched text (after stripping ANSI)
      const matchedTexts = result!.matches.map(m => stripAnsi(m.text));
      expect(matchedTexts.some(t => t.includes('ERROR'))).toBe(true);
    });
  });

  describe('watcher with real output', () => {
    it('should trigger watcher on real PTY output', async () => {
      let exitCode: number | null = null;
      let matched = false;

      const info = manager.spawn(
        {
          command: 'cmd',
          args: ['/c', 'echo', 'MARKER_FOUND', '&&', 'echo', 'done'],
          parentSessionId: 'integration-test',
          description: 'watcher test',
        },
        () => {},
        (code) => { exitCode = code; }
      );

      manager.addWatcher(info.id, /MARKER_FOUND/, (data) => {
        matched = stripAnsi(data).includes('MARKER_FOUND');
      });

      await waitForCondition(() => exitCode !== null, 5000);

      expect(matched).toBe(true);
    });
  });

  describe('buffer behavior with real output', () => {
    it('should accumulate output over time', async () => {
      let exitCode: number | null = null;

      const info = manager.spawn(
        {
          command: 'cmd',
          args: ['/c', 'echo', 'a', '&&', 'echo', 'b', '&&', 'echo', 'c', '&&', 'echo', 'd', '&&', 'echo', 'e'],
          parentSessionId: 'integration-test',
          description: 'buffer test',
        },
        () => {},
        (code) => { exitCode = code; }
      );

      await waitForCondition(() => exitCode !== null, 5000);

      const result = manager.read(info.id);
      const text = result!.lines.map(l => stripAnsi(l)).join('\n');
      expect(text).toContain('a');
      expect(text).toContain('b');
      expect(text).toContain('c');
      expect(text).toContain('d');
      expect(text).toContain('e');
    });

    it('should handle Windows line endings in real output', async () => {
      let exitCode: number | null = null;

      const info = manager.spawn(
        {
          command: 'cmd',
          args: ['/c', 'echo', 'crlf_test'],
          parentSessionId: 'integration-test',
          description: 'crlf test',
        },
        () => {},
        (code) => { exitCode = code; }
      );

      await waitForCondition(() => exitCode !== null, 5000);

      const result = manager.read(info.id);
      const text = result!.lines.map(l => stripAnsi(l)).join('\n');
      expect(text).toContain('crlf_test');
    });
  });

  describe('session info accuracy', () => {
    it('should update lineCount as output arrives', async () => {
      const info = manager.spawn(
        {
          command: 'cmd',
          args: ['/c', 'echo', 'hello'],
          parentSessionId: 'integration-test',
          description: 'info test',
        },
        () => {},
        () => {}
      );

      // Initially may have 0 lines (cmd header)
      const initial = manager.get(info.id)!;

      // Wait for output
      await waitForCondition(() => {
        const s = manager.get(info.id);
        return s!.lineCount > 0;
      }, 5000);

      const after = manager.get(info.id)!;
      expect(after.lineCount).toBeGreaterThanOrEqual(initial.lineCount);
    });

    it('should report running status while process is active', async () => {
      const info = manager.spawn(
        {
          command: 'cmd',
          parentSessionId: 'integration-test',
          description: 'status test',
        },
        () => {},
        () => {}
      );

      // cmd without /c stays interactive — give it a moment to start
      await new Promise(r => setTimeout(r, 300));

      const session = manager.get(info.id);
      expect(session!.status).toBe('running');

      manager.kill(info.id, true);
    });
  });
});
