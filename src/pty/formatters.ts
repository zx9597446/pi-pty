export function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ').trim();
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

export function formatLine(text: string, lineNumber: number, maxLength: number = 2000): string {
  const displayLine = text.length > maxLength 
    ? text.substring(0, maxLength) + '... (truncated)' 
    : text;
  return `[${lineNumber}] ${displayLine}`;
}

export interface SessionInfo {
  id: string;
  title: string;
  command: string;
  args: string[];
  status: string;
  pid: number;
  lineCount: number;
}

export function formatSessionInfo(session: SessionInfo): string[] {
  return [
    `ID: ${session.id}`,
    `  Title: ${session.title}`,
    `  Command: ${formatCommand(session.command, session.args)}`,
    `  Status: ${session.status}`,
    `  PID: ${session.pid}`,
    `  Lines: ${session.lineCount}`,
    ''
  ];
}
