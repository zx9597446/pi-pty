import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock zigpty
vi.mock('zigpty', () => {
  const mockState: Array<{
    dataCb: ((data: string) => void) | null;
    pty: any;
  }> = [];

  return {
    spawn: vi.fn((_file: string, _args: string[], options: any) => {
      let dataCb: ((data: string) => void) | null = null;
      const mockPty = {
        pid: 7000 + Math.floor(Math.random() * 1000),
        onData: (cb: any) => { dataCb = cb; },
        onExit: options.onExit,
        write: vi.fn(),
        kill: vi.fn(() => { if (options.onExit) options.onExit(0, 0); }),
        emitData: (data: string) => { if (dataCb) dataCb(data); },
        emitExit: (code: number) => { if (options.onExit) options.onExit(code, 0); },
      };
      mockState.push({ dataCb, pty: mockPty });
      return mockPty;
    }),
    __mockState: mockState,
  };
});

// We need to mock the manager singleton since it's shared across tests
// We'll test index.ts by importing it and calling registerTool handlers

import { spawn as mockSpawn } from 'zigpty';
import { manager } from '../src/pty/manager.js';

// Reset manager state between tests
beforeEach(() => {
  manager.clearAll();
});

// Helper to get the last mock pty from zigpty mock
function getLastPty() {
  const results = (mockSpawn as any).mock.results;
  return results[results.length - 1]?.value;
}

// Create a mock pi object that captures registered tools
function createMockPi() {
  const tools: Map<string, any> = new Map();
  const sentMessages: any[] = [];

  return {
    registerTool: (tool: any) => {
      tools.set(tool.name, tool);
    },
    on: (_event: string, _handler: any) => {}, // no-op for tests
    sendMessage: async (msg: any) => {
      sentMessages.push(msg);
    },
    sendMessage_: sentMessages, // expose for assertions
    getTool: (name: string) => tools.get(name),
    getTools: () => tools,
    sentMessages,
  };
}

describe('index.ts tool execute functions', () => {
  let mockPi: ReturnType<typeof createMockPi>;

  beforeEach(() => {
    mockPi = createMockPi();
  });

  // Dynamically import and register tools
  async function registerTools() {
    // Clear and re-register
    const mod = await import('../src/index.js');
    const defaultExport = mod.default;
    defaultExport(mockPi as any);
  }

  describe('pty_spawn execute', () => {
    beforeEach(async () => { await registerTools(); });

    it('should spawn and return correct XML-like format', async () => {
      const tool = mockPi.getTool('pty_spawn')!;
      const result = await tool.execute('tc1', {
        command: 'npm',
        args: ['run', 'dev'],
        workdir: '/tmp/project',
        title: 'Dev Server',
        description: 'test server',
      }, { sessionId: 's1' });

      expect(result.content[0].text).toContain('<pty_spawned>');
      expect(result.content[0].text).toContain('ID: pty_');
      expect(result.content[0].text).toContain('Title: Dev Server');
      expect(result.content[0].text).toContain('Command: npm run dev');
      expect(result.content[0].text).not.toContain('Workdir:');
      expect(result.content[0].text).toContain('PID: ');
      expect(result.content[0].text).toContain('Status: running');
      expect(result.content[0].text).not.toContain('NotifyOnExit:');
      expect(result.content[0].text).toContain('</pty_spawned>');
      expect(result.content[0].text).toContain('<system_reminder>');
      expect(result.content[0].text).toContain('ASYNC:');
      expect(result.content[0].text).toContain('WATCH:');
      expect(result.content[0].text).toContain('READ:');
    });

    it('should include notify instructions when notifyOnExit is true', async () => {
      const tool = mockPi.getTool('pty_spawn')!;
      const result = await tool.execute('tc2', {
        command: 'test',
        description: 'd',
        notifyOnExit: true,
      }, { sessionId: 's1' });

      expect(result.content[0].text).toContain('<system_reminder>');
      expect(result.content[0].text).toContain('Wait for <pty_exited> notification');
    });

    it('should throw on blocked command', async () => {
      const { setPermissionConfig } = await import('../src/pty/permissions.js');
      setPermissionConfig({ blockedCommands: ['rm'] });

      const tool = mockPi.getTool('pty_spawn')!;
      await expect(
        tool.execute('tc3', { command: 'rm', args: ['-rf', '/'], description: 'd' }, { sessionId: 's1' })
      ).rejects.toThrow("'rm' is explicitly blocked");

      setPermissionConfig({});
    });

    it('should throw on blocked workdir', async () => {
      const { setPermissionConfig } = await import('../src/pty/permissions.js');
      setPermissionConfig({ allowedDirectories: ['/tmp'] });

      const tool = mockPi.getTool('pty_spawn')!;
      await expect(
        tool.execute('tc4', { command: 'ls', description: 'd', workdir: '/forbidden' }, { sessionId: 's1' })
      ).rejects.toThrow('not within allowed directories');

      setPermissionConfig({});
    });

    it('should return details with session info', async () => {
      const tool = mockPi.getTool('pty_spawn')!;
      const result = await tool.execute('tc5', {
        command: 'echo',
        args: ['hi'],
        description: 'test',
      }, { sessionId: 's1' });

      expect(result.details).toBeDefined();
      expect(result.details.id).toMatch(/^pty_/);
      expect(result.details.command).toBe('echo');
    });
  });

  describe('pty_write execute', () => {
    beforeEach(async () => { await registerTools(); });

    it('should write data and return confirmation', async () => {
      // First spawn a session
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc1', {
        command: 'bash',
        description: 'test shell',
      }, { sessionId: 's1' });

      const idMatch = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/);
      const id = idMatch![1];

      const writeTool = mockPi.getTool('pty_write')!;
      const result = await writeTool.execute('tc2', {
        id,
        data: 'echo hello\\n',
      });

      // bytes count is args.data.length (original string), not parsed length
      // 'echo hello\\n' = 12 chars
      expect(result.content[0].text).toContain(`Sent 12 bytes to ${id}`);
      expect(result.content[0].text).toContain('echo hello');
    });

    it('should throw for non-existent session', async () => {
      const writeTool = mockPi.getTool('pty_write')!;
      await expect(
        writeTool.execute('tc3', { id: 'pty_fake', data: 'test' })
      ).rejects.toThrow("not found");
    });

    it('should format control characters in preview', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc4', {
        command: 'bash',
        description: 'd',
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      const writeTool = mockPi.getTool('pty_write')!;
      // The preview replaces ETX (char code 3) in args.data with ^C
      // But '\x03' is the literal string \x03 (4 chars), not the control char
      // Only actual control chars in the input get replaced
      const result = await writeTool.execute('tc5', {
        id,
        data: '\x03',  // Actual Ctrl+C character (1 byte)
      });

      expect(result.content[0].text).toContain('^C');
    });
  });

  describe('pty_read execute', () => {
    beforeEach(async () => { await registerTools(); });

    it('should read output with line numbers', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc1', {
        command: 'echo',
        description: 'd',
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      // Simulate output
      const pty = getLastPty();
      pty.emitData('line one\nline two\nline three\n');

      const readTool = mockPi.getTool('pty_read')!;
      const result = await readTool.execute('tc2', { id });

      expect(result.content[0].text).toContain('<pty_output');
      expect(result.content[0].text).toContain('[1] line one');
      expect(result.content[0].text).toContain('[2] line two');
      expect(result.content[0].text).toContain('[3] line three');
      expect(result.content[0].text).toContain('End of buffer');
      expect(result.content[0].text).toContain('</pty_output>');
      expect(result.content[0].text).toContain('<system_reminder>');
      expect(result.content[0].text).toContain('NEXT:');
    });

    it('should handle empty buffer', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc3', {
        command: 'sleep',
        description: 'd',
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      const readTool = mockPi.getTool('pty_read')!;
      const result = await readTool.execute('tc4', { id });

      expect(result.content[0].text).toContain('No output available');
    });

    it('should filter with pattern', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc5', {
        command: 'test',
        description: 'd',
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      const pty = getLastPty();
      pty.emitData('info: ok\nerror: fail\ninfo: done\nerror: crash\n');

      const readTool = mockPi.getTool('pty_read')!;
      const result = await readTool.execute('tc6', {
        id,
        pattern: 'error',
      });

      expect(result.content[0].text).toContain('pattern="error"');
      expect(result.content[0].text).toContain('error: fail');
      expect(result.content[0].text).toContain('error: crash');
      expect(result.content[0].text).toContain('2 matches');
    });

    it('should handle no pattern matches', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc7', {
        command: 'test',
        description: 'd',
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      const pty = getLastPty();
      pty.emitData('hello world\n');

      const readTool = mockPi.getTool('pty_read')!;
      const result = await readTool.execute('tc8', {
        id,
        pattern: 'NOTFOUND',
      });

      expect(result.content[0].text).toContain('No lines matched');
    });

    it('should support pagination', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc9', {
        command: 'test',
        description: 'd',
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      const pty = getLastPty();
      for (let i = 1; i <= 5; i++) pty.emitData(`line ${i}\n`);

      const readTool = mockPi.getTool('pty_read')!;
      const result = await readTool.execute('tc10', { id, offset: 0, limit: 2 });

      expect(result.content[0].text).toContain('[1] line 1');
      expect(result.content[0].text).toContain('[2] line 2');
      expect(result.content[0].text).toContain('Buffer has more lines');
    });

    it('should throw for non-existent session', async () => {
      const readTool = mockPi.getTool('pty_read')!;
      await expect(
        readTool.execute('tc11', { id: 'pty_fake' })
      ).rejects.toThrow("not found");
    });
  });

  describe('pty_list execute', () => {
    beforeEach(async () => { await registerTools(); });

    it('should list no sessions when empty', async () => {
      const tool = mockPi.getTool('pty_list')!;
      const result = await tool.execute('tc1', {});

      expect(result.content[0].text).toContain('No active PTY sessions');
    });

    it('should list all sessions with formatted info', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      await spawnTool.execute('tc2', {
        command: 'npm', args: ['run', 'dev'], title: 'Dev', description: 'd',
      }, { sessionId: 's1' });
      await spawnTool.execute('tc3', {
        command: 'node', args: ['server.js'], title: 'Server', description: 'd',
      }, { sessionId: 's1' });

      const listTool = mockPi.getTool('pty_list')!;
      const result = await listTool.execute('tc4', {});

      expect(result.content[0].text).toContain('Total: 2');
      expect(result.content[0].text).not.toContain('session(s)');
      expect(result.content[0].text).toContain('Dev');
      expect(result.content[0].text).toContain('Server');
    });
  });

  describe('pty_kill execute', () => {
    beforeEach(async () => { await registerTools(); });

    it('should kill session and return formatted output', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc1', {
        command: 'test',
        title: 'Test Session',
        description: 'd',
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      const pty = getLastPty();
      pty.emitData('some output\n');

      const killTool = mockPi.getTool('pty_kill')!;
      const result = await killTool.execute('tc2', { id });

      expect(result.content[0].text).toBe(`<pty_killed id="${id}" cleanup="undefined" />`);
    });

    it('should cleanup session when cleanup is true', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc3', {
        command: 'test',
        description: 'd',
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      const killTool = mockPi.getTool('pty_kill')!;
      const result = await killTool.execute('tc4', { id, cleanup: true });

      expect(result.content[0].text).toBe(`<pty_killed id="${id}" cleanup="true" />`);

      // Verify session is gone
      const listTool = mockPi.getTool('pty_list')!;
      const listResult = await listTool.execute('tc5', {});
      expect(listResult.content[0].text).toContain('No active PTY sessions');
    });

    it('should throw for non-existent session', async () => {
      const killTool = mockPi.getTool('pty_kill')!;
      await expect(
        killTool.execute('tc6', { id: 'pty_fake' })
      ).rejects.toThrow("not found");
    });
  });

  describe('pty_watch execute', () => {
    beforeEach(async () => { await registerTools(); });

    it('should watch for pattern and send message on match', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc1', {
        command: 'test',
        description: 'd',
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      const watchTool = mockPi.getTool('pty_watch')!;
      const watchResult = await watchTool.execute('tc2', {
        id,
        pattern: 'READY',
      });

      expect(watchResult.content[0].text).toBe(`Watching ${id} for "READY"`);

      // Emit matching data
      const pty = getLastPty();
      pty.emitData('Server is READY on port 3000\n');

      // Wait for async notification
      await new Promise(resolve => setTimeout(resolve, 100));

      // The watcher should have sent a message
      expect(mockPi.sentMessages.length).toBeGreaterThanOrEqual(1);
      const lastMsg = mockPi.sentMessages[mockPi.sentMessages.length - 1];
      expect(lastMsg.content[0].text).toContain('<pty_match');
      expect(lastMsg.content[0].text).toContain('READY');
    });

    it('should throw for non-existent session', async () => {
      const watchTool = mockPi.getTool('pty_watch')!;
      await expect(
        watchTool.execute('tc3', { id: 'pty_fake', pattern: 'test' })
      ).rejects.toThrow("not found");
    });
  });

  describe('notifyOnExit full flow', () => {
    beforeEach(async () => { await registerTools(); });

    it('should send pty_exited message on process exit', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc1', {
        command: 'test',
        title: 'Test App',
        description: 'd',
        notifyOnExit: true,
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      const pty = getLastPty();
      pty.emitData('output line\n');
      pty.emitExit(0);

      // Wait for async notification
      await new Promise(resolve => setTimeout(resolve, 100));

      // Find the pty_exited message
      const exitMsg = mockPi.sentMessages.find(
        (m: any) => m.content[0].text.includes('<pty_exited>')
      );
      expect(exitMsg).toBeDefined();
      expect(exitMsg.content[0].text).toContain(`ID: ${id}`);
      expect(exitMsg.content[0].text).toContain('Exit Code: 0');
      expect(exitMsg.content[0].text).toContain('Last line: output line');
    });

    it('should include error hint for non-zero exit', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      await spawnTool.execute('tc2', {
        command: 'test',
        description: 'd',
        notifyOnExit: true,
      }, { sessionId: 's1' });

      const pty = getLastPty();
      pty.emitData('error: something failed\n');
      pty.emitExit(1);

      // Wait for async notification
      await new Promise(resolve => setTimeout(resolve, 100));

      const exitMsg = mockPi.sentMessages.find(
        (m: any) => m.content[0].text.includes('<pty_exited>')
      );
      expect(exitMsg).toBeDefined();
      expect(exitMsg.content[0].text).toContain('Exit Code: 1');
      expect(exitMsg.content[0].text).toContain('DIAGNOSE: Exit code 1 is non-zero');
      expect(exitMsg.content[0].text).toContain('pty_read(pattern=\'Error|Fail|Exception\')');
    });
  });

  describe('pty_read notifyOnExit reminder', () => {
    beforeEach(async () => { await registerTools(); });

    it('should always include navigation hints in system_reminder if session is running', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc1', {
        command: 'test',
        description: 'd',
        notifyOnExit: true,
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      const pty = getLastPty();
      pty.emitData('some output\n');

      const readTool = mockPi.getTool('pty_read')!;
      const result = await readTool.execute('tc2', { id });

      expect(result.content[0].text).toContain('<system_reminder>');
      expect(result.content[0].text).toContain('NEXT:');
      expect(result.content[0].text).toContain('TAIL:');
    });
  });

  describe('pty_read search pagination', () => {
    beforeEach(async () => { await registerTools(); });

    it('should show pagination info when search has more matches', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc1', {
        command: 'test',
        description: 'd',
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      const pty = getLastPty();
      for (let i = 1; i <= 5; i++) pty.emitData(`error ${i}\n`);

      const readTool = mockPi.getTool('pty_read')!;
      const result = await readTool.execute('tc2', {
        id,
        pattern: 'error',
        offset: 0,
        limit: 2,
      });

      expect(result.content[0].text).toContain('matches shown');
      expect(result.content[0].text).toContain('offset=2');
    });
  });

  describe('pty_read ANSI stripping in search', () => {
    beforeEach(async () => { await registerTools(); });

    it('should strip ANSI from search result lines by default', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc1', {
        command: 'test',
        description: 'd',
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      const pty = getLastPty();
      pty.emitData('\x1b[31merror: fail\x1b[0m\n');

      const readTool = mockPi.getTool('pty_read')!;
      const result = await readTool.execute('tc2', {
        id,
        pattern: 'error',
      });

      // ANSI codes should be stripped from output
      expect(result.content[0].text).not.toContain('\x1b[');
      expect(result.content[0].text).toContain('error: fail');
    });

    it('should preserve ANSI when stripAnsi is false', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc3', {
        command: 'test',
        description: 'd',
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      const pty = getLastPty();
      pty.emitData('\x1b[32mok\x1b[0m\n');

      const readTool = mockPi.getTool('pty_read')!;
      const result = await readTool.execute('tc4', {
        id,
        stripAnsi: false,
      });

      expect(result.content[0].text).toContain('\x1b[');
    });
  });

  describe('agent_end cleanup', () => {
    it('should register agent_end handler that clears all sessions', async () => {
      let agentEndHandler: (() => void) | null = null;
      const mockPiWithAgentEnd = {
        registerTool: () => {},
        on: (event: string, handler: any) => {
          if (event === 'agent_end') agentEndHandler = handler;
        },
        sendMessage: async () => {},
      };

      // Spawn a session first
      const spawnTool = mockPi.getTool('pty_spawn');
      if (!spawnTool) {
        // Need to register tools first
        const mod = await import('../src/index.js');
        mod.default(mockPiWithAgentEnd as any);
      }

      // Register tools on real mockPi
      await registerTools();

      // Now check the agent_end handler exists
      // We need to re-import to capture the handler
      const mod = await import('../src/index.js');
      const capturePi = {
        registerTool: () => {},
        on: (event: string, handler: any) => {
          if (event === 'agent_end') agentEndHandler = handler;
        },
        sendMessage: async () => {},
      };
      mod.default(capturePi as any);

      expect(agentEndHandler).toBeDefined();

      // Spawn sessions, then call handler
      const spawnTool2 = mockPi.getTool('pty_spawn')!;
      await spawnTool2.execute('tc1', { command: 'a', description: 'd' }, { sessionId: 's1' });
      await spawnTool2.execute('tc2', { command: 'b', description: 'd' }, { sessionId: 's1' });
      expect(manager.list().length).toBeGreaterThanOrEqual(2);

      // Simulate agent_end
      agentEndHandler!();
      expect(manager.list()).toEqual([]);
    });
  });

  describe('pty_write exited session rejection', () => {
    beforeEach(async () => { await registerTools(); });

    it('should reject write to an exited session', async () => {
      const spawnTool = mockPi.getTool('pty_spawn')!;
      const spawnResult = await spawnTool.execute('tc1', {
        command: 'test',
        description: 'd',
      }, { sessionId: 's1' });

      const id = spawnResult.content[0].text.match(/ID: (pty_[0-9a-f]+)/)![1];

      // Exit the process
      const pty = getLastPty();
      pty.emitExit(0);

      const writeTool = mockPi.getTool('pty_write')!;
      await expect(
        writeTool.execute('tc2', { id, data: 'test' })
      ).rejects.toThrow(`Cannot write to PTY '${id}' (exited).`);
    });
  });
});
