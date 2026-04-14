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
});
