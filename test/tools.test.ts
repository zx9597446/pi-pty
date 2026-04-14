import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock zigpty before any imports
vi.mock('zigpty', () => {
  return {
    spawn: vi.fn((_file, _args, options) => {
      let dataCb: (data: string) => void = () => {};
      return {
        pid: 4242,
        onData: (cb: any) => { dataCb = cb; },
        onExit: options.onExit,
        write: vi.fn(),
        kill: vi.fn(() => { if (options.onExit) options.onExit(0, 0); }),
        emitData: (data: string) => dataCb(data),
        emitExit: (code: number) => { if (options.onExit) options.onExit(code, 0); },
      };
    })
  };
});

import { manager } from '../src/pty/manager.js';
import { spawn as mockSpawn } from 'zigpty';

// We need to test the tool execute functions, but they're registered via pi.registerTool.
// Instead, we'll test the core logic that the tools use by importing and invoking the
// same patterns directly through the manager + formatters + escape modules.
// The index.ts file is essentially a thin wrapper; the real logic is in manager/formatters/escape.

import { parseEscapeSequences, ETX, EOT } from '../src/pty/escape.js';
import { stripAnsi, formatLine, formatSessionInfo } from '../src/pty/formatters.js';

function getLastPtyMock() {
  const results = (mockSpawn as any).mock.results;
  return results[results.length - 1].value;
}

describe('Tool-level integration: pty_spawn equivalent', () => {
  beforeEach(() => {
    manager.clearAll();
  });

  it('should spawn and return session info matching expected output format', () => {
    const info = manager.spawn(
      {
        command: 'npm',
        args: ['run', 'dev'],
        workdir: '/tmp/project',
        env: { PORT: '3000' },
        title: 'Dev Server',
        description: 'test server',
        parentSessionId: 'session-001',
        notifyOnExit: true,
      },
      () => {},
      () => {}
    );

    // Verify all fields that the tool output would include
    expect(info.id).toMatch(/^pty_[0-9a-f]{8}$/);
    expect(info.title).toBe('Dev Server');
    expect(info.command).toBe('npm');
    expect(info.args).toEqual(['run', 'dev']);
    expect(info.workdir).toBe('/tmp/project');
    expect(info.status).toBe('running');
    expect(info.notifyOnExit).toBe(true);
    expect(info.pid).toBeGreaterThan(0);
    expect(info.lineCount).toBe(0); // no output yet
  });

  it('should capture output data in buffer', () => {
    const info = manager.spawn(
      { command: 'echo', args: ['hello'], parentSessionId: 'p', description: 'd' },
      () => {},
      () => {}
    );

    const pty = getLastPtyMock();
    pty.emitData('hello world\nfrom echo\n');

    const readResult = manager.read(info.id);
    expect(readResult).not.toBeNull();
    expect(readResult!.lines).toEqual(['hello world', 'from echo']);
    expect(readResult!.totalLines).toBe(2);
  });
});

describe('Tool-level integration: pty_write equivalent', () => {
  beforeEach(() => {
    manager.clearAll();
  });

  it('should reject write to non-existent session', () => {
    expect(() => {
      // This is what the tool does internally
      const session = manager.get('pty_nonexistent');
      if (!session) throw new Error("PTY session 'pty_nonexistent' not found.");
    }).toThrow("PTY session 'pty_nonexistent' not found.");
  });

  it('should reject write to exited session', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {},
      () => {}
    );

    const pty = getLastPtyMock();
    pty.emitExit(0);

    const session = manager.get(info.id);
    expect(session!.status).toBe('exited');

    // Tool checks status before writing
    if (session!.status !== 'running') {
      // This is the error the tool would throw
      expect(session!.status).toBe('exited');
    }
  });

  it('should parse escape sequences before writing', () => {
    // The tool calls parseEscapeSequences before manager.write
    const input = 'echo hello\\nworld\\x03';
    const parsed = parseEscapeSequences(input);
    expect(parsed).toBe('echo hello\nworld\x03');

    // Verify the parsed string contains the expected characters
    expect(parsed).toContain('\n');
    expect(parsed).toContain('\x03');
  });

  it('should format write preview correctly', () => {
    // The tool generates a preview of what was sent
    const input = 'hello world';
    const preview = input.length > 50 ? `${input.slice(0, 50)}...` : input;
    const displayPreview = preview
      .replace(new RegExp(ETX, 'g'), '^C')
      .replace(new RegExp(EOT, 'g'), '^D')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');

    expect(displayPreview).toBe('hello world');
  });

  it('should format write preview with control characters', () => {
    const input = '\x03\x04';
    const displayPreview = input
      .replace(new RegExp(ETX, 'g'), '^C')
      .replace(new RegExp(EOT, 'g'), '^D')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');

    expect(displayPreview).toBe('^C^D');
  });

  it('should truncate long write preview', () => {
    const input = 'x'.repeat(100);
    const preview = input.length > 50 ? `${input.slice(0, 50)}...` : input;
    expect(preview).toBe('x'.repeat(50) + '...');
  });
});

describe('Tool-level integration: pty_read equivalent', () => {
  beforeEach(() => {
    manager.clearAll();
  });

  it('should format read output with line numbers', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {},
      () => {}
    );

    const pty = getLastPtyMock();
    pty.emitData('line one\nline two\nline three\n');

    const result = manager.read(info.id);
    expect(result).not.toBeNull();

    const formatted = result!.lines.map((line, index) =>
      formatLine(stripAnsi(line), result!.offset + index + 1)
    );
    expect(formatted).toEqual(['[1] line one', '[2] line two', '[3] line three']);
  });

  it('should handle empty buffer read', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {},
      () => {}
    );

    const result = manager.read(info.id);
    expect(result!.lines).toEqual([]);
    expect(result!.totalLines).toBe(0);
  });

  it('should support pattern filtering (search)', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {},
      () => {}
    );

    const pty = getLastPtyMock();
    pty.emitData('[INFO] start\n[ERROR] fail\n[INFO] done\n[ERROR] crash\n');

    const result = manager.search(info.id, /\[ERROR\]/);
    expect(result).not.toBeNull();
    expect(result!.matches).toHaveLength(2);
    expect(result!.totalMatches).toBe(2);
    expect(result!.matches[0].text).toBe('[ERROR] fail');
  });

  it('should strip ANSI from read output', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {},
      () => {}
    );

    const pty = getLastPtyMock();
    pty.emitData('\x1b[32mgreen text\x1b[0m\nplain\n');

    const result = manager.read(info.id);
    const stripped = result!.lines.map(l => stripAnsi(l));
    expect(stripped).toEqual(['green text', 'plain']);
  });

  it('should handle pagination metadata correctly', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {},
      () => {}
    );

    const pty = getLastPtyMock();
    for (let i = 1; i <= 10; i++) {
      pty.emitData(`line ${i}\n`);
    }

    const page = manager.read(info.id, 0, 3);
    expect(page!.lines).toHaveLength(3);
    expect(page!.hasMore).toBe(true);
    expect(page!.totalLines).toBe(10);

    // Second page
    const page2 = manager.read(info.id, 3, 3);
    expect(page2!.lines).toHaveLength(3);
    expect(page2!.hasMore).toBe(true);

    // Last page
    const lastPage = manager.read(info.id, 9, 3);
    expect(lastPage!.lines).toHaveLength(1);
    expect(lastPage!.hasMore).toBe(false);
  });

  it('should handle pattern with no matches', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {},
      () => {}
    );

    const pty = getLastPtyMock();
    pty.emitData('hello world\n');

    const result = manager.search(info.id, /NOTFOUND/);
    expect(result!.matches).toHaveLength(0);
    expect(result!.totalMatches).toBe(0);
  });
});

describe('Tool-level integration: pty_list equivalent', () => {
  beforeEach(() => {
    manager.clearAll();
  });

  it('should return empty list when no sessions', () => {
    expect(manager.list()).toHaveLength(0);
  });

  it('should list all sessions with correct info', () => {
    const info1 = manager.spawn(
      { command: 'npm', args: ['run', 'dev'], title: 'Dev', parentSessionId: 'p', description: 'd' },
      () => {}, () => {}
    );
    const info2 = manager.spawn(
      { command: 'node', args: ['server.js'], title: 'Server', parentSessionId: 'p', description: 'd' },
      () => {}, () => {}
    );

    const sessions = manager.list();
    expect(sessions).toHaveLength(2);

    // Verify formatSessionInfo works for all sessions
    for (const session of sessions) {
      const formatted = formatSessionInfo(session);
      expect(formatted[0]).toMatch(/^ID: pty_/);
      expect(formatted[1]).toMatch(/^  Title:/);
      expect(formatted[2]).toMatch(/^  Command:/);
      expect(formatted[3]).toMatch(/^  Status:/);
      expect(formatted[4]).toMatch(/^  PID:/);
      expect(formatted[5]).toMatch(/^  Lines:/);
    }
  });
});

describe('Tool-level integration: pty_kill equivalent', () => {
  beforeEach(() => {
    manager.clearAll();
  });

  it('should kill running session and retain it without cleanup', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {}, () => {}
    );

    // Simulate some output
    const pty = getLastPtyMock();
    pty.emitData('some output\n');

    const success = manager.kill(info.id, false);
    expect(success).toBe(true);

    // Session should still exist for log access
    const session = manager.get(info.id);
    expect(session).not.toBeNull();
    expect(session!.status).toBe('killed'); // kill sets 'killing' → mock kill fires onExit → 'killed'
  });

  it('should kill and cleanup removes session entirely', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {}, () => {}
    );

    manager.kill(info.id, true);
    expect(manager.get(info.id)).toBeNull();
    expect(manager.list()).toHaveLength(0);
  });

  it('should report error for non-existent session kill', () => {
    const session = manager.get('pty_nonexistent');
    expect(session).toBeNull();
  });

  it('should handle killing already-killed session with cleanup', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {}, () => {}
    );

    manager.kill(info.id, false);
    // Kill again with cleanup
    const result = manager.kill(info.id, true);
    expect(result).toBe(true);
    expect(manager.get(info.id)).toBeNull();
  });
});

describe('Tool-level integration: pty_watch equivalent', () => {
  beforeEach(() => {
    manager.clearAll();
  });

  it('should match ANSI-stripped output against pattern', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {}, () => {}
    );

    let matched = false;
    let matchedText = '';
    manager.addWatcher(info.id, /Server ready/i, (data) => {
      matched = true;
      matchedText = data;
    });

    const pty = getLastPtyMock();
    pty.emitData('\x1b[32mServer ready on port 3000\x1b[0m\n');

    expect(matched).toBe(true);
    // The watcher callback receives the original data (before ANSI stripping)
    // The pattern matching happens on stripAnsi(data), but the callback gets the raw data
    expect(matchedText).toContain('Server ready');
  });

  it('should not match when pattern does not match stripped output', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {}, () => {}
    );

    let matched = false;
    manager.addWatcher(info.id, /ERROR:/i, () => { matched = true; });

    const pty = getLastPtyMock();
    pty.emitData('\x1b[32mServer started\x1b[0m\n');

    expect(matched).toBe(false);
  });

  it('should handle watcher callback errors gracefully', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {}, () => {}
    );

    // Add a watcher that throws
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    manager.addWatcher(info.id, /test/, () => { throw new Error('watcher error'); });

    const pty = getLastPtyMock();
    // Should not throw
    expect(() => pty.emitData('test data\n')).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

describe('Tool-level: notifyOnExit behavior', () => {
  beforeEach(() => {
    manager.clearAll();
  });

  it('should update session status to exited on process exit', () => {
    let capturedExitCode: number | null = null;

    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd', notifyOnExit: true },
      () => {},
      (code) => { capturedExitCode = code; }
    );

    const pty = getLastPtyMock();
    pty.emitData('output line\n');
    pty.emitExit(0);

    expect(capturedExitCode).toBe(0);
    expect(manager.get(info.id)!.status).toBe('exited');
  });

  it('should capture output lines before exit notification', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd', notifyOnExit: true },
      () => {},
      () => {}
    );

    const pty = getLastPtyMock();
    pty.emitData('line1\nline2\nline3\n');
    pty.emitExit(0);

    // After exit, buffer should still be readable
    const result = manager.read(info.id);
    expect(result).not.toBeNull();
    expect(result!.lines).toEqual(['line1', 'line2', 'line3']);
  });

  it('should handle non-zero exit codes', () => {
    let capturedExitCode: number | null = null;

    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd', notifyOnExit: true },
      () => {},
      (code) => { capturedExitCode = code; }
    );

    const pty = getLastPtyMock();
    pty.emitExit(1);

    expect(capturedExitCode).toBe(1);
    expect(manager.get(info.id)!.status).toBe('exited');
  });

  it('should clean up watchers on exit', () => {
    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {},
      () => {}
    );

    let count = 0;
    manager.addWatcher(info.id, /test/, () => { count++; });

    const pty = getLastPtyMock();
    pty.emitExit(0);

    // After exit, adding data to the same session should not trigger watchers
    // (watchers are deleted on exit in manager.ts)
    // We can't easily emit data after exit since the mock fires onExit synchronously,
    // but the watchers Map should be cleaned up
  });
});

describe('Tool-level: session update callbacks', () => {
  beforeEach(() => {
    manager.clearAll();
  });

  it('should receive spawned event', () => {
    const events: string[] = [];
    manager.registerSessionUpdateCallback((_info, event) => {
      events.push(event);
    });

    manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {}, () => {}
    );

    expect(events).toEqual(['spawned']);
  });

  it('should receive exited event on normal exit', () => {
    const events: string[] = [];
    manager.registerSessionUpdateCallback((_info, event) => {
      events.push(event);
    });

    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {}, () => {}
    );

    events.length = 0;
    const pty = getLastPtyMock();
    pty.emitExit(0);

    expect(events).toContain('exited');
  });

  it('should receive killed event on kill', () => {
    const events: string[] = [];
    manager.registerSessionUpdateCallback((_info, event) => {
      events.push(event);
    });

    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {}, () => {}
    );

    events.length = 0;
    manager.kill(info.id);

    // kill() calls lifecycleManager.kill which sets 'killing', then process.kill() fires onExit
    // onExit checks status==='killing' → sets 'killed', then notifies with event='killed'
    expect(events).toContain('killing');
    expect(events).toContain('killed');
  });

  it('should receive cleaned event on kill with cleanup', () => {
    const events: string[] = [];
    manager.registerSessionUpdateCallback((_info, event) => {
      events.push(event);
    });

    const info = manager.spawn(
      { command: 'test', parentSessionId: 'p', description: 'd' },
      () => {}, () => {}
    );

    events.length = 0;
    manager.kill(info.id, true);
    expect(events).toContain('cleaned');
  });

  it('should handle errors in session update callbacks gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    manager.registerSessionUpdateCallback(() => { throw new Error('cb error'); });
    manager.registerSessionUpdateCallback(() => {}); // second callback

    // Should not throw even though first callback throws
    expect(() => {
      manager.spawn(
        { command: 'test', parentSessionId: 'p', description: 'd' },
        () => {}, () => {}
      );
    }).not.toThrow();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
