import { describe, it, expect, beforeEach } from 'vitest';
import { checkCommandPermission, checkWorkdirPermission, setPermissionConfig } from '../src/pty/permissions.js';
import * as path from 'path';

describe('Permissions edge cases', () => {
  beforeEach(() => {
    setPermissionConfig({});
  });

  describe('command permissions', () => {
    it('should extract basename from full path', () => {
      setPermissionConfig({ blockedCommands: ['rm'] });
      expect(() => checkCommandPermission('/usr/bin/rm', ['-rf', '/'])).toThrow("'rm' is explicitly blocked");
      expect(() => checkCommandPermission('C:\\Windows\\System32\\cmd.exe', [])).not.toThrow();
    });

    it('should handle blocked commands with empty args', () => {
      setPermissionConfig({ blockedCommands: ['rm'] });
      expect(() => checkCommandPermission('rm', [])).toThrow("'rm' is explicitly blocked");
    });

    it('should allow all commands when neither list is configured', () => {
      expect(() => checkCommandPermission('anything', [])).not.toThrow();
      expect(() => checkCommandPermission('rm', ['-rf', '/'])).not.toThrow();
    });

    it('should only check blocked list when only blocked is configured', () => {
      setPermissionConfig({ blockedCommands: ['rm'] });
      expect(() => checkCommandPermission('python', ['script.py'])).not.toThrow();
    });

    it('should check allowed list when both are configured', () => {
      setPermissionConfig({
        blockedCommands: ['rm'],
        allowedCommands: ['python', 'node'],
      });
      // 'rm' is blocked first, so it throws blocked error
      expect(() => checkCommandPermission('rm', [])).toThrow("'rm' is explicitly blocked");
      // 'python' is in allowed list
      expect(() => checkCommandPermission('python', [])).not.toThrow();
      // 'git' is not in allowed list
      expect(() => checkCommandPermission('git', ['status'])).toThrow("'git' is not in the allowed list");
    });

    it('should handle Windows-style paths for basename extraction', () => {
      setPermissionConfig({ blockedCommands: ['cmd.exe'] });
      // path.basename('C:\\Windows\\System32\\cmd.exe') returns 'cmd.exe'
      expect(() => checkCommandPermission('C:\\Windows\\System32\\cmd.exe', [])).toThrow("'cmd.exe' is explicitly blocked");
    });

    it('should handle command with ./ prefix', () => {
      setPermissionConfig({ allowedCommands: ['node'] });
      // path.basename('./node') = 'node'
      expect(() => checkCommandPermission('./node', ['server.js'])).not.toThrow();
    });

    it('should handle command with no args', () => {
      setPermissionConfig({ allowedCommands: ['ls'] });
      expect(() => checkCommandPermission('ls', [])).not.toThrow();
    });
  });

  describe('workdir permissions', () => {
    it('should allow any directory when not configured', () => {
      expect(() => checkWorkdirPermission('/')).not.toThrow();
      expect(() => checkWorkdirPermission('/tmp/anything')).not.toThrow();
    });

    it('should allow exact match of allowed directory', () => {
      const cwd = process.cwd();
      setPermissionConfig({ allowedDirectories: [cwd] });
      expect(() => checkWorkdirPermission(cwd)).not.toThrow();
    });

    it('should allow subdirectory of allowed directory', () => {
      const cwd = process.cwd();
      setPermissionConfig({ allowedDirectories: [cwd] });
      expect(() => checkWorkdirPermission(path.join(cwd, 'src'))).not.toThrow();
      expect(() => checkWorkdirPermission(path.join(cwd, 'src', 'pty'))).not.toThrow();
    });

    it('should block parent directory of allowed directory', () => {
      const cwd = process.cwd();
      setPermissionConfig({ allowedDirectories: [path.join(cwd, 'src')] });
      expect(() => checkWorkdirPermission(cwd)).toThrow();
    });

    it('should block sibling directories', () => {
      const cwd = process.cwd();
      const parent = path.dirname(cwd);
      setPermissionConfig({ allowedDirectories: [cwd] });
      // Sibling directory
      const sibling = path.join(parent, 'sibling');
      expect(() => checkWorkdirPermission(sibling)).toThrow();
    });

    it('should handle multiple allowed directories', () => {
      const cwd = process.cwd();
      setPermissionConfig({ allowedDirectories: [cwd, '/tmp'] });
      expect(() => checkWorkdirPermission(cwd)).not.toThrow();
      expect(() => checkWorkdirPermission('/tmp')).not.toThrow();
    });

    it('should block root when not in allowed list', () => {
      setPermissionConfig({ allowedDirectories: ['/tmp/workspace'] });
      expect(() => checkWorkdirPermission('/')).toThrow();
    });

    it('should handle relative path resolution', () => {
      const cwd = process.cwd();
      setPermissionConfig({ allowedDirectories: [cwd] });
      // Relative path inside cwd
      expect(() => checkWorkdirPermission('.')).not.toThrow();
    });
  });
});
