import { describe, it, expect, beforeEach, vi } from 'vitest';
import { manager } from '../src/pty/manager.js';
import { RingBuffer } from '../src/pty/buffer.js';
import registerTools from '../src/index.js';

describe('PTY Edge Cases - pty_read', () => {
  let mockPi: any;
  let tools: any = {};

  beforeEach(async () => {
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

  it('should handle offset exceeding total lines in pty_read', async () => {
    const spawnTool = tools['pty_spawn'];
    const readTool = tools['pty_read'];

    const spawnResult = await spawnTool.execute('c1', {
      command: 'echo',
      args: ['test'],
      description: 'test'
    }, { sessionId: 's1' });
    const id = spawnResult.details.id;

    // Read with offset 100 on a small buffer
    const result = await readTool.execute('c2', {
      id,
      offset: 100
    });

    expect(result.content[0].text).toContain('No output available');
    expect(result.content[0].text).toContain('Total lines: 0'); // Empty initially
  });

  it('should handle buffer overflow and maintain line alignment', () => {
    // Create a very small buffer to trigger overflow easily
    const smallBuffer = new RingBuffer(20); 
    
    smallBuffer.append('line1\n');
    smallBuffer.append('line2\n');
    smallBuffer.append('line3\n');
    
    // Total string: "line1\nline2\nline3\n" (18 chars)
    expect(smallBuffer.length).toBe(3);
    
    // Add one more line to trigger overflow
    smallBuffer.append('line4\n');
    // Total string would be 24 chars, which exceeds 20.
    // The excess is 4. The first newline is at index 5.
    // Our new logic should find that newline and slice at nextNewline + 1.
    // The resulting buffer should start with 'line2\n'
    
    const lines = smallBuffer.read(0);
    expect(lines[0]).toBe('line2'); // No longer 'e1'!
    expect(lines[lines.length - 1]).toBe('line4');
    expect(smallBuffer.length).toBe(3);
  });
});
