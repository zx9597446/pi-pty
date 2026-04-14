export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

export function formatLine(text: string, lineNumber: number, maxLength: number = 2000): string {
  let displayLine = text;
  if (displayLine.length > maxLength) {
    displayLine = displayLine.substring(0, maxLength) + '... (truncated)';
  }
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
    `  Command: ${session.command} ${session.args.join(' ')}`,
    `  Status: ${session.status}`,
    `  PID: ${session.pid}`,
    `  Lines: ${session.lineCount}`,
    ''
  ];
}
