import * as path from 'path';

export interface PermissionConfig {
  allowedCommands?: string[];
  blockedCommands?: string[];
  allowedDirectories?: string[];
}

let config: PermissionConfig = {
  // Default: allow all if not configured, or we can be restrictive
};

export function setPermissionConfig(newConfig: PermissionConfig) {
  config = newConfig;
}

export function checkCommandPermission(command: string, args: string[]): void {
  const cmdName = path.basename(command);

  if (config.blockedCommands?.includes(cmdName)) {
    throw new Error(`Command '${cmdName}' is explicitly blocked.`);
  }

  if (config.allowedCommands && !config.allowedCommands.includes(cmdName)) {
    throw new Error(`Command '${cmdName}' is not in the allowed list.`);
  }
}

export function checkWorkdirPermission(workdir: string): void {
  const allowed = config.allowedDirectories;
  if (!allowed || allowed.length === 0) return;

  const absoluteWorkdir = path.resolve(workdir);
  const isAllowed = allowed.some(dir => {
    const relative = path.relative(path.resolve(dir), absoluteWorkdir);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  });

  if (!isAllowed) {
    throw new Error(`Directory '${workdir}' is not within allowed directories.`);
  }
}
