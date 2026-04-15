import { describe, it, expect, beforeEach, vi } from 'vitest';
import { manager } from '../src/pty/manager.js';
import registerTools from '../src/index.js';

describe('PTY Notification Integration', () => {
  let mockPi: any;
  let tools: any = {};

  beforeEach(() => {
    manager.clearAll();
    tools = {};
    mockPi = {
      registerTool: vi.fn((tool) => {
        tools[tool.name] = tool;
      }),
      sendMessage: vi.fn().mockResolvedValue({}),
      on: vi.fn(),
    };
    registerTools(mockPi);
  });

  it('should send <pty_exited> notification on successful exit', async () => {
    const spawnTool = tools['pty_spawn'];
    
    // Use a command that exits quickly
    const result = await spawnTool.execute('call_1', {
      command: 'echo',
      args: ['hello'],
      notifyOnExit: true,
      description: 'test notification'
    }, { sessionId: 'test_session' });

    const ptyId = result.details.id;

    // Wait for the exit notification (it's async in the background)
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (mockPi.sendMessage.mock.calls.length > 0) {
          clearInterval(check);
          resolve(null);
        }
      }, 100);
      // Timeout after 5s
      setTimeout(() => { clearInterval(check); resolve(null); }, 5000);
    });

    expect(mockPi.sendMessage).toHaveBeenCalled();
    const lastCall = mockPi.sendMessage.mock.calls[0][0];
    expect(lastCall.content[0].text).toContain('<pty_exited>');
    expect(lastCall.content[0].text).toContain(`ID: ${ptyId}`);
    expect(lastCall.content[0].text).toContain('Exit Code: 0');
  });

  it('should send <pty_exited> with error hint on failure exit', async () => {
    const spawnTool = tools['pty_spawn'];
    
    // Use a command that exits with error
    const result = await spawnTool.execute('call_2', {
      command: process.platform === 'win32' ? 'cmd.exe' : 'sh',
      args: process.platform === 'win32' ? ['/c', 'exit /b 42'] : ['-c', 'exit 42'],
      notifyOnExit: true,
      description: 'test failure notification'
    }, { sessionId: 'test_session' });

    const ptyId = result.details.id;

    // Wait for the exit notification
    await new Promise(resolve => {
      const check = setInterval(() => {
        // Find the call that contains <pty_exited>
        const hasExited = mockPi.sendMessage.mock.calls.some(call => 
          call[0].content[0].text.includes('<pty_exited>')
        );
        if (hasExited) {
          clearInterval(check);
          resolve(null);
        }
      }, 100);
      setTimeout(() => { clearInterval(check); resolve(null); }, 5000);
    });

    const exitCall = mockPi.sendMessage.mock.calls.find(call => 
      call[0].content[0].text.includes('<pty_exited>')
    )?.[0];

    expect(exitCall).toBeDefined();
    expect(exitCall.content[0].text).toContain('Exit Code: 42');
    expect(exitCall.content[0].text).toContain('Non-zero exit detected');
    expect(exitCall.content[0].text).toContain('Use pty_read with pattern');
  });
});
