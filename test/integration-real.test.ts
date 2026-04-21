import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { manager } from '../src/pty/manager.js';

/**
 * Real PTY integration tests using actual system commands.
 * These tests verify the full lifecycle with real processes.
 */
describe('Real PTY Integration', () => {
  beforeEach(() => {
    manager.clearAll();
  });

  afterEach(() => {
    manager.clearAll();
  });

  describe('pty_spawn + pty_read (real commands)', () => {
    it('should spawn and read output from echo command', () => {
      const info = manager.spawn(
        {
          command: 'echo',
          args: ['Hello', 'PTY'],
          parentSessionId: 'test',
          description: 'echo test',
        },
        () => {},
        () => {}
      );

      expect(info.status).toBe('running');
      expect(info.command).toBe('echo');
      expect(info.pid).toBeGreaterThan(0);
    });

    it('should spawn and read output from node -e command', () => {
      const info = manager.spawn(
        {
          command: process.platform === 'win32' ? 'node.exe' : 'node',
          args: ['-e', 'console.log("node output"); console.log("second line");'],
          parentSessionId: 'test',
          description: 'node test',
        },
        () => {},
        () => {}
      );

      expect(info.status).toBe('running');
      expect(info.command).toMatch(/node/);
    });

    it('should spawn a command with custom workdir', () => {
      const info = manager.spawn(
        {
          command: process.platform === 'win32' ? 'cmd.exe' : 'pwd',
          args: process.platform === 'win32' ? ['/c', 'cd'] : [],
          workdir: process.cwd(),
          parentSessionId: 'test',
          description: 'workdir test',
        },
        () => {},
        () => {}
      );

      expect(info.workdir).toBe(process.cwd());
    });

    it('should spawn a command with custom environment variables', () => {
      const info = manager.spawn(
        {
          command: process.platform === 'win32' ? 'cmd.exe' : 'env',
          args: process.platform === 'win32' ? ['/c', 'echo %MY_TEST_VAR%'] : [],
          env: { MY_TEST_VAR: 'test_value_123' },
          parentSessionId: 'test',
          description: 'env test',
        },
        () => {},
        () => {}
      );

      expect(info.status).toBe('running');
    });
  });

  describe('pty_kill (real commands)', () => {
    it('should kill a long-running process', () => {
      const info = manager.spawn(
        {
          command: process.platform === 'win32' ? 'ping.exe' : 'sleep',
          args: process.platform === 'win32' ? ['-n', '30', '127.0.0.1'] : ['30'],
          parentSessionId: 'test',
          description: 'long running',
        },
        () => {},
        () => {}
      );

      expect(info.status).toBe('running');

      const killResult = manager.kill(info.id);
      expect(killResult).toBe(true);

      // Session should still exist (not cleaned up)
      const session = manager.get(info.id);
      expect(session).not.toBeNull();
      // Status could be 'killing' (process terminating), 'killed' (terminated), or 'exited' (already exited)
      expect(['killing', 'killed', 'exited']).toContain(session!.status);
    });

    it('should kill and cleanup a session', () => {
      const info = manager.spawn(
        {
          command: process.platform === 'win32' ? 'ping.exe' : 'sleep',
          args: process.platform === 'win32' ? ['-n', '30', '127.0.0.1'] : ['30'],
          parentSessionId: 'test',
          description: 'long running',
        },
        () => {},
        () => {}
      );

      manager.kill(info.id, true);
      expect(manager.get(info.id)).toBeNull();
    });
  });

  describe('pty_list (real commands)', () => {
    it('should list spawned sessions', () => {
      manager.spawn(
        { command: 'echo', args: ['1'], parentSessionId: 'test', description: 'd' },
        () => {}, () => {}
      );
      manager.spawn(
        { command: 'echo', args: ['2'], parentSessionId: 'test', description: 'd' },
        () => {}, () => {}
      );

      const sessions = manager.list();
      expect(sessions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('notifyOnExit (real commands)', () => {
    it('should track notifyOnExit flag', () => {
      const info = manager.spawn(
        {
          command: 'echo',
          args: ['test'],
          parentSessionId: 'test',
          description: 'notify test',
          notifyOnExit: true,
        },
        () => {},
        () => {}
      );

      expect(info.notifyOnExit).toBe(true);
    });

    it('should call onExit callback when process exits', (done) => {
      let exitCode: number | null = -1;

      manager.spawn(
        {
          command: 'echo',
          args: ['test'],
          parentSessionId: 'test',
          description: 'exit test',
          notifyOnExit: true,
        },
        () => {},
        (code) => {
          exitCode = code;
          expect(exitCode).toBe(0);
          done();
        }
      );
    });

    it('should report non-zero exit code', (done) => {
      let exitCode: number | null = -1;

      manager.spawn(
        {
          command: process.platform === 'win32' ? 'cmd.exe' : 'sh',
          args: process.platform === 'win32' ? ['/c', 'exit /b 42'] : ['-c', 'exit 42'],
          parentSessionId: 'test',
          description: 'error exit',
        },
        () => {},
        (code) => {
          exitCode = code;
          expect(exitCode).toBe(42);
          done();
        }
      );
    });
  });

  describe('pty_write (real commands)', () => {
    it('should write to an interactive process', async () => {
      // On Windows, use a PowerShell command that reads stdin; on Unix, use cat
      const cmd = process.platform === 'win32' 
        ? 'powershell.exe' 
        : 'cat';
      const args = process.platform === 'win32'
        ? ['-Command', '$input; exit']
        : [];
      
      const info = manager.spawn(
        {
          command: cmd,
          args,
          parentSessionId: 'test',
          description: 'interactive test',
        },
        () => {},
        () => {}
      );

      expect(info.status).toBe('running');

      // Write to the process
      const writeResult = manager.write(info.id, 'hello\n');
      expect(writeResult).toBe(true);

      // Give it a moment to process
      await new Promise(resolve => setTimeout(resolve, 500));
      const readResult = manager.read(info.id);
      expect(readResult).not.toBeNull();
      manager.kill(info.id);
    });

    it('should write ampersand character without escaping', async () => {
      // This test verifies that the & character is NOT escaped to &amp;
      // when passed through manager.write
      // We use cmd.exe and echo to verify the ampersand is preserved
      
      const info = manager.spawn(
        {
          command: 'cmd.exe',
          args: ['/c', 'echo ready && more'],
          parentSessionId: 'test',
          description: 'ampersand test',
        },
        () => {},
        () => {}
      );

      expect(info.status).toBe('running');

      // Give it a moment to process the initial command
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Write data containing ampersand via stdin
      // Using a simple echo command that outputs the ampersand
      const writeResult = manager.write(info.id, 'echo hello & world\n');
      expect(writeResult).toBe(true);

      // Give it a moment to process
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const readResult = manager.read(info.id);
      expect(readResult).not.toBeNull();
      
      // The output should contain the raw ampersand, NOT &amp;
      const output = readResult!.lines.join('\n');
      // Windows cmd may interpret &, so check what was written
      // The key is that & should NOT appear as &amp;
      expect(output).not.toContain('&amp;');
      
      manager.kill(info.id);
    });
  });

  describe('pty_read with search (real commands)', () => {
    it('should search output from multi-line command', async () => {
      const info = manager.spawn(
        {
          command: process.platform === 'win32' ? 'cmd.exe' : 'sh',
          args: process.platform === 'win32'
            ? ['/c', 'echo line1 && echo ERROR: fail && echo line3 && echo ERROR: crash']
            : ['-c', 'echo "line1"; echo "ERROR: fail"; echo "line3"; echo "ERROR: crash"'],
          parentSessionId: 'test',
          description: 'search test',
        },
        () => {},
        () => {}
      );

      // Give process time to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      const result = manager.search(info.id, /ERROR/);
      expect(result).not.toBeNull();
      expect(result!.totalMatches).toBeGreaterThanOrEqual(1);
      manager.kill(info.id);
    });
  });

  describe('cleanupBySession (real commands)', () => {
    it('should clean up child sessions', () => {
      const parent1 = manager.spawn(
        { command: 'echo', args: ['1'], parentSessionId: 'parent1', description: 'd' },
        () => {}, () => {}
      );
      const child1 = manager.spawn(
        { command: 'echo', args: ['2'], parentSessionId: parent1.id, description: 'd' },
        () => {}, () => {}
      );
      const child2 = manager.spawn(
        { command: 'echo', args: ['3'], parentSessionId: parent1.id, description: 'd' },
        () => {}, () => {}
      );

      const beforeCleanup = manager.list().length;
      expect(beforeCleanup).toBeGreaterThanOrEqual(3);

      manager.cleanupBySession(parent1.id);

      const afterCleanup = manager.list().length;
      expect(afterCleanup).toBeLessThan(beforeCleanup);
    });
  });

  describe('clearAll (real commands)', () => {
    it('should terminate all running processes', () => {
      // Spawn multiple long-running processes
      manager.spawn(
        {
          command: process.platform === 'win32' ? 'ping.exe' : 'sleep',
          args: process.platform === 'win32' ? ['-n', '60', '127.0.0.1'] : ['60'],
          parentSessionId: 'test',
          description: 'long 1',
        },
        () => {}, () => {}
      );
      manager.spawn(
        {
          command: process.platform === 'win32' ? 'ping.exe' : 'sleep',
          args: process.platform === 'win32' ? ['-n', '60', '127.0.0.1'] : ['60'],
          parentSessionId: 'test',
          description: 'long 2',
        },
        () => {}, () => {}
      );

      expect(manager.list().length).toBeGreaterThanOrEqual(2);

      manager.clearAll();
      expect(manager.list()).toEqual([]);
    });
  });
});
