import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PTYManager } from '../src/pty/manager.js';

// Mock zigpty
vi.mock('zigpty', () => {
  return {
    spawn: vi.fn((_file: string, _args: string[], options: any) => {
      let dataCallback: (data: string) => void;
      const mockPty = {
        pid: 5000 + Math.floor(Math.random() * 5000),
        onData: (cb: (data: string) => void) => { dataCallback = cb; },
        onExit: options.onExit,
        write: vi.fn(),
        kill: vi.fn(() => {
          if (options.onExit) options.onExit(0, 0);
        }),
        emitData: (data: string) => { if (dataCallback) dataCallback(data); },
        emitExit: (code: number) => { if (options.onExit) options.onExit(code, 0); },
      };
      return mockPty;
    })
  };
});

import { spawn as mockSpawn } from 'zigpty';

describe('SessionLifecycleManager deep tests', () => {
  let manager: PTYManager;

  beforeEach(() => {
    manager = new PTYManager();
  });

  function getMockPty(index: number = 0) {
    const results = (mockSpawn as any).mock.results;
    return results[results.length - 1 - index]?.value;
  }

  describe('kill behavior', () => {
    it('should set status to killing then killed when kill is called', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      expect(manager.get(info.id)!.status).toBe('running');

      // Kill triggers mock's kill() which calls onExit(0,0)
      manager.kill(info.id);

      // After mock kill, status should be 'killed' (was 'killing' → 'killed' via onExit)
      const after = manager.get(info.id);
      expect(after!.status).toBe('killed');
    });

    it('should retain session after kill without cleanup', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      const pty = getMockPty();
      pty.emitData('output\n');

      manager.kill(info.id, false);

      // Session still exists
      expect(manager.get(info.id)).not.toBeNull();
      // Buffer is still readable
      const result = manager.read(info.id);
      expect(result!.lines).toEqual(['output']);
    });

    it('should remove session entirely after kill with cleanup', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      manager.kill(info.id, true);

      expect(manager.get(info.id)).toBeNull();
      expect(manager.list()).toHaveLength(0);
    });

    it('should handle kill on already exited session', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      const pty = getMockPty();
      pty.emitExit(42);

      expect(manager.get(info.id)!.status).toBe('exited');
      expect(manager.get(info.id)!.exitCode).toBe(42);

      // Kill should succeed even on exited session
      const result = manager.kill(info.id);
      expect(result).toBe(true);
    });

    it('should handle double kill with cleanup', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      manager.kill(info.id, true);
      expect(manager.get(info.id)).toBeNull();

      // Second kill should return false (session already deleted)
      const result = manager.kill(info.id, true);
      expect(result).toBe(false);
    });
  });

  describe('cleanupBySession', () => {
    it('should only clean up sessions with matching parentSessionId', () => {
      const info1 = manager.spawn(
        { command: 'a', parentSessionId: 'parent-A', description: 'd' },
        () => {}, () => {}
      );
      const info2 = manager.spawn(
        { command: 'b', parentSessionId: 'parent-B', description: 'd' },
        () => {}, () => {}
      );
      const info3 = manager.spawn(
        { command: 'c', parentSessionId: 'parent-A', description: 'd' },
        () => {}, () => {}
      );

      expect(manager.list()).toHaveLength(3);

      manager.cleanupBySession('parent-A');

      const remaining = manager.list();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(info2.id);
    });

    it('should do nothing when no sessions match', () => {
      const info = manager.spawn(
        { command: 'a', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      manager.cleanupBySession('non-existent-parent');
      expect(manager.list()).toHaveLength(1);
    });
  });

  describe('clearAll', () => {
    it('should kill and remove all sessions', () => {
      manager.spawn({ command: 'a', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      manager.spawn({ command: 'b', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      manager.spawn({ command: 'c', parentSessionId: 'p', description: 'd' }, () => {}, () => {});

      expect(manager.list()).toHaveLength(3);

      manager.clearAll();
      expect(manager.list()).toHaveLength(0);
    });

    it('should handle clearAll on empty manager', () => {
      expect(() => manager.clearAll()).not.toThrow();
      expect(manager.list()).toHaveLength(0);
    });
  });

  describe('session info accuracy', () => {
    it('should reflect line count changes as data arrives', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      expect(manager.get(info.id)!.lineCount).toBe(0);

      const pty = getMockPty();
      pty.emitData('line1\nline2\n');

      expect(manager.get(info.id)!.lineCount).toBe(2);

      pty.emitData('line3\n');

      expect(manager.get(info.id)!.lineCount).toBe(3);
    });

    it('should include createdAt as ISO string', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      const retrieved = manager.get(info.id)!;
      expect(retrieved.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include exitCode after process exits', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      const pty = getMockPty();
      pty.emitExit(7);

      expect(manager.get(info.id)!.exitCode).toBe(7);
    });
  });

  describe('write after exit', () => {
    it('should return false when writing to exited session', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      const pty = getMockPty();
      pty.emitExit(0);

      // manager.write should check session status and reject exited sessions
      const result = manager.write(info.id, 'data');
      expect(result).toBe(false);
    });
  });

  describe('multiple sessions', () => {
    it('should isolate buffers between sessions', () => {
      const info1 = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );
      const info2 = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      const pty1 = getMockPty(1);
      const pty2 = getMockPty(0);

      pty1.emitData('session-1-data\n');
      pty2.emitData('session-2-data\n');

      expect(manager.read(info1.id)!.lines).toEqual(['session-1-data']);
      expect(manager.read(info2.id)!.lines).toEqual(['session-2-data']);
    });

    it('should search only within the target session', () => {
      const info1 = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );
      const info2 = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      const pty1 = getMockPty(1);
      const pty2 = getMockPty(0);

      pty1.emitData('error in session 1\n');
      pty2.emitData('info in session 2\n');

      expect(manager.search(info1.id, /error/)!.totalMatches).toBe(1);
      expect(manager.search(info2.id, /error/)!.totalMatches).toBe(0);
    });
  });
});
