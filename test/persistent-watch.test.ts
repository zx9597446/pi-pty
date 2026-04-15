import { describe, it, expect, vi, beforeEach } from 'vitest';
import { manager } from '../src/pty/manager.js';

// Mock zigpty
vi.mock('zigpty', () => {
  return {
    spawn: vi.fn((file, args, options) => {
      let dataCallback: (data: string) => void;
      return {
        pid: 1234,
        onData: (cb: any) => { dataCallback = cb; },
        onExit: options.onExit,
        write: vi.fn(),
        kill: vi.fn(),
        emitData: (data: string) => { if (dataCallback) dataCallback(data); }
      };
    })
  };
});

import { spawn as mockSpawn } from 'zigpty';

describe('Persistent PTY Watcher', () => {
  beforeEach(() => {
    manager.clearAll();
  });

  it('should trigger multiple times when persistent is true', async () => {
    let triggerCount = 0;
    const info = manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
    const ptyInstance = (mockSpawn as any).mock.results[0].value;

    // We add a persistent watcher (third param is persistent)
    // @ts-ignore: Adding a new argument not yet in types
    manager.addWatcher(info.id, /BING/, () => {
      triggerCount++;
    }, true);

    ptyInstance.emitData('BING 1\n');
    expect(triggerCount).toBe(1);

    ptyInstance.emitData('BING 2\n');
    expect(triggerCount).toBe(2); // Should trigger again
  });

  it('should still be single-shot by default', async () => {
    let triggerCount = 0;
    const info = manager.spawn({ command: 'test', parentSessionId: 'p', description: 'd' }, () => {}, () => {});
    const ptyInstance = (mockSpawn as any).mock.results[1].value;

    manager.addWatcher(info.id, /BONG/, () => {
      triggerCount++;
    });

    ptyInstance.emitData('BONG 1\n');
    expect(triggerCount).toBe(1);

    ptyInstance.emitData('BONG 2\n');
    expect(triggerCount).toBe(1); // Should NOT trigger again
  });
});
