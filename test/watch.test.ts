import { describe, it, expect, vi, beforeEach } from 'vitest';
import { manager } from '../src/pty/manager.js';

// Mock zigpty (using existing mock structure)
vi.mock('zigpty', () => {
  return {
    spawn: vi.fn((file, args, options) => {
      let dataCallback: (data: string) => void;
      const mockPty = {
        pid: 999,
        onData: (cb: any) => { dataCallback = cb; },
        onExit: options.onExit,
        write: vi.fn(),
        kill: vi.fn(),
        emitData: (data: string) => { if (dataCallback) dataCallback(data); }
      };
      return mockPty;
    })
  };
});

import { spawn as mockSpawn } from 'zigpty';

describe('PTY Watcher', () => {
  beforeEach(() => {
    manager.clearAll();
  });

  it('should trigger watcher on matching data', async () => {
    let matchFound = false;
    let matchText = '';

    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {},
      () => {}
    );

    manager.addWatcher(info.id, /READY/i, (data) => {
      matchFound = true;
      matchText = data;
    });

    const ptyInstance = (mockSpawn as any).mock.results[0].value;
    
    ptyInstance.emitData('System booting...\n');
    expect(matchFound).toBe(false);

    ptyInstance.emitData('Server is READY on port 8080\n');
    expect(matchFound).toBe(true);
    expect(matchText).toContain('READY');
  });

  it('should only trigger once and then be removed', async () => {
    let count = 0;
    const info = manager.spawn({ command: 't', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
    
    manager.addWatcher(info.id, /fire/, () => {
      count++;
    });

    const ptyInstance = (mockSpawn as any).mock.results[1].value;
    
    ptyInstance.emitData('fire 1');
    ptyInstance.emitData('fire 2');

    expect(count).toBe(1);
  });

  it('should support multiple different watchers on the same session', async () => {
    let countA = 0;
    let countB = 0;
    const info = manager.spawn({ command: 't', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
    const ptyInstance = (mockSpawn as any).mock.results[(mockSpawn as any).mock.results.length - 1].value;

    manager.addWatcher(info.id, /Apple/, () => { countA++; });
    manager.addWatcher(info.id, /Banana/, () => { countB++; });

    ptyInstance.emitData('Eating an Apple\n');
    expect(countA).toBe(1);
    expect(countB).toBe(0);

    ptyInstance.emitData('Eating a Banana\n');
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });

  it('should trigger multiple watchers if they match the same data', async () => {
    let countA = 0;
    let countB = 0;
    const info = manager.spawn({ command: 't', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
    const ptyInstance = (mockSpawn as any).mock.results[(mockSpawn as any).mock.results.length - 1].value;

    manager.addWatcher(info.id, /Fruit/, () => { countA++; });
    manager.addWatcher(info.id, /Apple/, () => { countB++; });

    ptyInstance.emitData('An Apple is a Fruit\n');
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });

  it('should handle watcher errors without affecting others', async () => {
    let countB = 0;
    const info = manager.spawn({ command: 't', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
    const ptyInstance = (mockSpawn as any).mock.results[(mockSpawn as any).mock.results.length - 1].value;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // First watcher throws
    manager.addWatcher(info.id, /test/, () => { throw new Error('BOOM'); });
    // Second watcher is fine
    manager.addWatcher(info.id, /data/, () => { countB++; });

    ptyInstance.emitData('test data\n');
    
    expect(countB).toBe(1);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error in pty watcher callback'), expect.any(Error));
    
    consoleSpy.mockRestore();
  });
});
