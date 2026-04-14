import { describe, it, expect, vi, beforeEach } from 'vitest';
import { manager } from '../src/pty/manager.js';

// Mock zigpty
vi.mock('zigpty', () => {
  return {
    spawn: vi.fn((file, args, options) => {
      let dataCallback: (data: string) => void;
      let exitCallback: (code: number, signal: number) => void;
      
      // Basic mock implementation
      const mockPty = {
        pid: 1234,
        onData: (cb: any) => { dataCallback = cb; },
        onExit: options.onExit,
        write: vi.fn(),
        kill: vi.fn(() => {
            if (options.onExit) options.onExit(0, 0);
        }),
        // Simulate data emitting for test
        emitData: (data: string) => { if (dataCallback) dataCallback(data); },
        emitExit: (code: number) => { if (options.onExit) options.onExit(code, 0); }
      };
      return mockPty;
    })
  };
});

import { spawn as mockSpawn } from 'zigpty';

describe('PTY Lifecycle & Events', () => {
  beforeEach(() => {
    manager.clearAll();
  });

  it('should notify raw output callbacks', async () => {
    const outputs: string[] = [];
    const callback = (id: string, data: string) => {
      outputs.push(data);
    };

    manager.registerRawOutputCallback(callback);

    const info = manager.spawn(
      { command: 'test', parentSessionId: 'parent', description: 'test' },
      () => {},
      () => {}
    );

    // Retrieve the mock object to simulate data
    // In our mock, spawn returns the object
    const ptyInstance = (mockSpawn as any).mock.results[0].value;
    
    ptyInstance.emitData('hello');
    ptyInstance.emitData(' world');

    expect(outputs).toContain('hello');
    expect(outputs).toContain(' world');
    
    manager.removeRawOutputCallback(callback);
    ptyInstance.emitData('silent');
    expect(outputs).not.toContain('silent');
  });

  it('should handle process exit', async () => {
    let exited = false;
    let exitCode: number | null = null;

    const info = manager.spawn(
      { command: 'test', parentSessionId: 'parent', description: 'test' },
      () => {},
      (code) => {
        exited = true;
        exitCode = code;
      }
    );

    const ptyInstance = (mockSpawn as any).mock.results[1].value;
    ptyInstance.emitExit(0);

    expect(exited).toBe(true);
    expect(exitCode).toBe(0);
    
    const updatedInfo = manager.get(info.id);
    expect(updatedInfo?.status).toBe('exited');
  });

  it('should cleanup sessions', () => {
    manager.spawn({ command: 't1', parentSessionId: 'p1', description: 'd' }, () => {}, () => {});
    manager.spawn({ command: 't2', parentSessionId: 'p2', description: 'd' }, () => {}, () => {});
    
    expect(manager.list()).toHaveLength(2);
    
    manager.cleanupBySession('p1');
    expect(manager.list()).toHaveLength(1);
    expect(manager.list()[0].id).not.toBeUndefined();
  });
});
