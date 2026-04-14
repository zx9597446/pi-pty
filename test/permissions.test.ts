import { describe, it, expect, beforeEach } from 'vitest';
import { checkCommandPermission, checkWorkdirPermission, setPermissionConfig } from '../src/pty/permissions.js';

describe('Permissions', () => {
  beforeEach(() => {
    setPermissionConfig({});
  });

  it('should allow any command by default', () => {
    expect(() => checkCommandPermission('ls', [])).not.toThrow();
  });

  it('should block commands in blocked list', () => {
    setPermissionConfig({ blockedCommands: ['rm', 'format'] });
    expect(() => checkCommandPermission('ls', [])).not.toThrow();
    expect(() => checkCommandPermission('rm', ['-rf', '/'])).toThrow("Command 'rm' is explicitly blocked.");
    expect(() => checkCommandPermission('/bin/rm', [])).toThrow("Command 'rm' is explicitly blocked.");
  });

  it('should allow only commands in allowed list', () => {
    setPermissionConfig({ allowedCommands: ['python', 'node'] });
    expect(() => checkCommandPermission('python', [])).not.toThrow();
    expect(() => checkCommandPermission('ls', [])).toThrow("Command 'ls' is not in the allowed list.");
  });

  it('should allow subdirectories of allowed directories', () => {
    setPermissionConfig({ allowedDirectories: ['/tmp/workspace'] });
    // Note: resolve depends on OS, but we can test logic
    // Using current dir for portable test
    const currentDir = process.cwd();
    setPermissionConfig({ allowedDirectories: [currentDir] });
    
    expect(() => checkWorkdirPermission(currentDir)).not.toThrow();
    expect(() => checkWorkdirPermission('.')).not.toThrow();
    expect(() => checkWorkdirPermission('src')).not.toThrow();
  });

  it('should block directories outside allowed list', () => {
    setPermissionConfig({ allowedDirectories: [process.cwd()] });
    expect(() => checkWorkdirPermission('/')).toThrow("is not within allowed directories");
  });
});
