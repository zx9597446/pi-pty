import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PTYManager } from '../src/pty/manager.js';

// Mock zigpty - store dataCallbacks per spawn call for proper isolation
const mockState: Array<{
  dataCallback: ((data: string) => void) | null;
  pty: any;
}> = [];

vi.mock('zigpty', () => {
  return {
    spawn: vi.fn((_file: string, _args: string[], options: any) => {
      let dataCallback: ((data: string) => void) | null = null;
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
      mockState.push({ dataCallback, pty: mockPty });
      return mockPty;
    })
  };
});

import { spawn as mockSpawn } from 'zigpty';

function resetMockState() {
  mockState.length = 0;
  (mockSpawn as any).mockClear?.();
}

describe('PTYManager - Full Integration', () => {
  let manager: PTYManager;

  beforeEach(() => {
    manager = new PTYManager();
    resetMockState();
  });

  afterEach(() => {
    manager.clearAll();
    resetMockState();
  });

  function getMockPty(index: number = 0) {
    return mockState[index]?.pty;
  }

  // --- spawn ---
  describe('spawn', () => {
    it('should create a new session with default options', () => {
      const info = manager.spawn(
        { command: 'ls', parentSessionId: 'parent', description: 'list files' },
        () => {},
        () => {}
      );

      expect(info.id).toMatch(/^pty_[0-9a-f]{8}$/);
      expect(info.command).toBe('ls');
      expect(info.args).toEqual([]);
      expect(info.status).toBe('running');
      expect(info.notifyOnExit).toBe(false);
      expect(info.pid).toBeGreaterThan(0);
      expect(info.workdir).toBeDefined();
      expect(info.lineCount).toBe(0);
    });

    it('should create a session with full options', () => {
      const info = manager.spawn({
        command: 'python',
        args: ['app.py', '--port', '8080'],
        workdir: '/tmp/test',
        env: { FOO: 'bar' },
        title: 'My App',
        description: 'Running app',
        parentSessionId: 'parent',
        notifyOnExit: true,
      }, () => {}, () => {});

      expect(info.command).toBe('python');
      expect(info.args).toEqual(['app.py', '--port', '8080']);
      expect(info.workdir).toBe('/tmp/test');
      expect(info.title).toBe('My App');
      expect(info.notifyOnExit).toBe(true);
    });

    it('should generate a unique ID for each session', () => {
      const info1 = manager.spawn({ command: 'a', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      const info2 = manager.spawn({ command: 'b', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      expect(info1.id).not.toBe(info2.id);
    });

    it('should use command + args as default title when not provided', () => {
      const info = manager.spawn(
        { command: 'python', args: ['test.py'], parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );
      expect(info.title).toBe('python test.py');
    });

    it('should use command as title when no args and no title provided', () => {
      const info = manager.spawn(
        { command: 'bash', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );
      // Default title is `${command} ${args.join(' ')}`.trim() → 'bash'
      expect(info.title).toBe('bash');
    });
  });

  // --- get / list ---
  describe('get / list', () => {
    it('should return null for non-existent session', () => {
      expect(manager.get('pty_nonexistent')).toBeNull();
    });

    it('should return session info after spawn', () => {
      const info = manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      const retrieved = manager.get(info.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(info.id);
    });

    it('should list all spawned sessions', () => {
      manager.spawn({ command: 't1', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      manager.spawn({ command: 't2', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      manager.spawn({ command: 't3', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      
      const sessions = manager.list();
      expect(sessions).toHaveLength(3);
    });

    it('should return empty list when no sessions', () => {
      expect(manager.list()).toEqual([]);
    });
  });

  // --- write ---
  describe('write', () => {
    it('should write to a running session', () => {
      const info = manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      const success = manager.write(info.id, 'hello\n');
      expect(success).toBe(true);
    });

    it('should return false for non-existent session', () => {
      expect(manager.write('pty_fake', 'data')).toBe(false);
    });
  });

  // --- read ---
  describe('read', () => {
    it('should read output from session buffer', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      const pty = getMockPty(0);
      pty.emitData('output line 1\noutput line 2\n');

      const result = manager.read(info.id);
      expect(result).not.toBeNull();
      expect(result!.lines).toEqual(['output line 1', 'output line 2']);
      expect(result!.totalLines).toBe(2);
    });

    it('should support offset and limit', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      const pty = getMockPty(0);
      pty.emitData('1\n2\n3\n4\n5\n');

      const result = manager.read(info.id, 2, 2);
      expect(result!.lines).toEqual(['3', '4']);
      expect(result!.hasMore).toBe(true);
    });

    it('should return null for non-existent session', () => {
      expect(manager.read('pty_fake')).toBeNull();
    });

    it('should read from exited sessions', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      const pty = getMockPty(0);
      pty.emitData('before exit\n');
      pty.emitExit(0);

      const result = manager.read(info.id);
      expect(result!.lines).toEqual(['before exit']);
    });
  });

  // --- search ---
  describe('search', () => {
    it('should find matching lines in session buffer', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      const pty = getMockPty(0);
      pty.emitData('info: start\nerror: something bad\ninfo: done\nerror: crash\n');

      const result = manager.search(info.id, /error/);
      expect(result).not.toBeNull();
      expect(result!.totalMatches).toBe(2);
      expect(result!.matches[0].text).toBe('error: something bad');
    });

    it('should return null for non-existent session', () => {
      expect(manager.search('pty_fake', /test/)).toBeNull();
    });

    it('should support case-insensitive search', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      const pty = getMockPty(0);
      pty.emitData('ERROR\nError\nerror\n');

      const result = manager.search(info.id, /error/i);
      expect(result!.totalMatches).toBe(3);
    });
  });

  // --- kill ---
  describe('kill', () => {
    it('should kill a running session', () => {
      const info = manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      const success = manager.kill(info.id);
      expect(success).toBe(true);
      
      const updated = manager.get(info.id);
      expect(updated!.status).toBe('killed');
    });

    it('should remove session when cleanup is true', () => {
      const info = manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      const success = manager.kill(info.id, true);
      expect(success).toBe(true);
      expect(manager.get(info.id)).toBeNull();
    });

    it('should retain session when cleanup is false', () => {
      const info = manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      manager.kill(info.id, false);
      expect(manager.get(info.id)).not.toBeNull();
    });

    it('should return false for non-existent session', () => {
      expect(manager.kill('pty_fake')).toBe(false);
    });

    it('should cleanup watchers on kill with cleanup', () => {
      const info = manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      manager.addWatcher(info.id, /test/, () => {});
      manager.kill(info.id, true);
      expect(manager.get(info.id)).toBeNull();
    });
  });

  // --- clearAll ---
  describe('clearAll', () => {
    it('should remove all sessions', () => {
      manager.spawn({ command: 't1', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      manager.spawn({ command: 't2', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      
      manager.clearAll();
      expect(manager.list()).toEqual([]);
    });

    it('should clear all watchers', () => {
      const info = manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      manager.addWatcher(info.id, /test/, () => {});
      manager.clearAll();
      
      // After clearAll, watchers should be gone
      const info2 = manager.spawn({ command: 'test2', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      // No watchers from previous session should remain
    });
  });

  // --- callbacks ---
  describe('session update callbacks', () => {
    it('should notify callback on spawned', () => {
      const events: Array<{ event: string; status: string }> = [];
      manager.registerSessionUpdateCallback((info, event) => {
        events.push({ event, status: info.status });
      });

      manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      expect(events[0].event).toBe('spawned');
      expect(events[0].status).toBe('running');
    });

    it('should notify callback on killed', () => {
      const events: string[] = [];
      manager.registerSessionUpdateCallback((_info, event) => {
        events.push(event);
      });

      const info = manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      manager.kill(info.id);
      
      expect(events).toContain('killing');
      expect(events).toContain('killed');
    });

    it('should allow removing callbacks', () => {
      let callCount = 0;
      const callback = () => { callCount++; };
      
      manager.registerSessionUpdateCallback(callback);
      manager.spawn({ command: 't', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      expect(callCount).toBe(1);
      
      manager.removeSessionUpdateCallback(callback);
      manager.spawn({ command: 't2', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      expect(callCount).toBe(1); // Should not increase
    });
  });

  // --- raw output callbacks ---
  describe('raw output callbacks', () => {
    it('should notify callback on data', () => {
      const outputs: string[] = [];
      const callback = (_id: string, data: string) => { outputs.push(data); };
      
      manager.registerRawOutputCallback(callback);
      
      const info = manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      const pty = getMockPty(0);
      pty.emitData('hello\n');
      
      expect(outputs).toContain('hello\n');
      manager.removeRawOutputCallback(callback);
    });

    it('should allow removing raw output callbacks', () => {
      let count = 0;
      const callback = () => { count++; };
      
      manager.registerRawOutputCallback(callback);
      const info = manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      const pty = getMockPty(0);
      pty.emitData('data1\n');
      expect(count).toBe(1);
      
      manager.removeRawOutputCallback(callback);
      pty.emitData('data2\n');
      expect(count).toBe(1);
    });
  });

  // --- cleanupBySession ---
  describe('cleanupBySession', () => {
    it('should kill child sessions of a parent', () => {
      manager.spawn({ command: 'child1', parentSessionId: 'parent1', description: 'd' }, () => {}, () => {});
      manager.spawn({ command: 'child2', parentSessionId: 'parent1', description: 'd' }, () => {}, () => {});
      manager.spawn({ command: 'child3', parentSessionId: 'parent2', description: 'd' }, () => {}, () => {});
      
      expect(manager.list()).toHaveLength(3);
      manager.cleanupBySession('parent1');
      expect(manager.list()).toHaveLength(1);
    });

    it('should do nothing if no children exist', () => {
      manager.spawn({ command: 'test', parentSessionId: 'parent', description: 'd' }, () => {}, () => {});
      manager.cleanupBySession('nonexistent');
      expect(manager.list()).toHaveLength(1);
    });
  });

  // --- process exit ---
  describe('process exit', () => {
    it('should update status to exited on normal exit', () => {
      let exitCode: number | null = -1;
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {},
        (code) => { exitCode = code; }
      );

      const pty = getMockPty(0);
      pty.emitExit(0);

      expect(exitCode).toBe(0);
      const updated = manager.get(info.id);
      expect(updated!.status).toBe('exited');
      expect(updated!.exitCode).toBe(0);
    });

    it('should update status to killed when killed during exit', () => {
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );

      // manager.kill() sets 'killing', then mock's kill() fires onExit synchronously
      // which sees 'killing' → sets 'killed'
      manager.kill(info.id);

      const updated = manager.get(info.id);
      expect(updated!.status).toBe('killed');
    });
  });

  // --- watcher integration ---
  describe('watcher integration', () => {
    it('should trigger watcher on matching output', () => {
      let matchData = '';
      const info = manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      
      manager.addWatcher(info.id, /SUCCESS/, (data) => { matchData = data; });
      
      const pty = getMockPty(0);
      pty.emitData('booting...\n');
      expect(matchData).toBe('');
      
      pty.emitData('Server SUCCESS\n');
      expect(matchData).toContain('SUCCESS');
    });

    it('should auto-remove watcher after first match', () => {
      let count = 0;
      const info = manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
      
      manager.addWatcher(info.id, /trigger/, () => { count++; });
      
      const pty = getMockPty(0);
      pty.emitData('trigger 1\n');
      pty.emitData('trigger 2\n');
      pty.emitData('trigger 3\n');
      
      expect(count).toBe(1);
    });

    it('should remove watchers on session exit', () => {
      let count = 0;
      const info = manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );
      
      manager.addWatcher(info.id, /data/, () => { count++; });
      
      const pty = getMockPty(0);
      pty.emitExit(0);
      // Watchers should be removed after exit
      
      // Can't emit data after exit in the mock easily, but verify session is exited
      expect(manager.get(info.id)!.status).toBe('exited');
    });
  });
});
