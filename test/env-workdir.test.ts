import { describe, it, expect, beforeEach } from 'vitest';
import { PTYManager } from '../src/pty/manager.js';
import path from 'path';
import fs from 'fs';

describe('PTY env and workdir parameters', () => {
  let manager: PTYManager;

  beforeEach(() => {
    manager = new PTYManager();
  });

  it('should respect custom workdir', async () => {
    const tmpDir = path.join(process.cwd(), 'test-tmp-dir');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    try {
      const info = manager.spawn({
        command: process.platform === 'win32' ? 'cmd' : 'sh',
        args: process.platform === 'win32' ? ['/c', 'cd'] : ['-c', 'pwd'],
        workdir: tmpDir,
        description: 'test workdir'
      });

      // Wait for exit and check buffer
      await new Promise(r => setTimeout(r, 1000));
      const read = manager.read(info.id);
      const output = read.lines.join('\n');
      
      // On Windows 'cd' output might have different casing/slashes, but it should contain the dir name
      expect(output.toLowerCase()).toContain('test-tmp-dir');
    } finally {
      if (fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir);
      manager.clearAll();
    }
  });

  it('should respect custom environment variables', async () => {
    const testVal = `val_${Math.random()}`;
    const info = manager.spawn({
      command: process.platform === 'win32' ? 'cmd' : 'sh',
      args: process.platform === 'win32' ? ['/c', 'echo %MY_TEST_VAR%'] : ['-c', 'echo $MY_TEST_VAR'],
      env: { MY_TEST_VAR: testVal },
      description: 'test env'
    });

    await new Promise(r => setTimeout(r, 1000));
    const read = manager.read(info.id);
    const output = read.lines.join('\n').trim();
    
    expect(output).toContain(testVal);
    manager.clearAll();
  });
});
