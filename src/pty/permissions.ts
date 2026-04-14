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
  if (!config.allowedDirectories) return;

  const absoluteWorkdir = path.resolve(workdir);
  const isAllowed = config.allowedDirectories.some(allowedDir => {
    const absoluteAllowed = path.resolve(allowedDir);
    const relative = path.relative(absoluteAllowed, absoluteWorkdir);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });

  if (!isAllowed) {
    throw new Error(`Directory '${workdir}' is not within allowed directories.`);
  }
}
