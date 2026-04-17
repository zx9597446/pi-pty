export function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ').trim();
}

export function stripAnsi(text: string): string {
  if (!text) return '';
  // Match all ANSI escape sequences
  // CSI sequences: ESC [ followed by params (0x30-0x3f) and final byte (0x40-0x7e)
  // OSC sequences: ESC ] followed by params and content
  //   - OSC with explicit terminator (BEL or ESC \): remove entire sequence
  //   - OSC followed by CSI: remove OSC prefix and content up to CSI (keep text after CSI)
  //   - OSC at end of string without terminator: remove entire OSC sequence
  // Fe sequences: ESC D, M, E, H, F, G, c
  // Mode set: ESC =, ESC >
  
  // Order matters: OSC first (to handle OSC+CSI case), then CSI
  return text
    .replace(/\x1b\]\d*;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC with explicit terminator
    .replace(/\x1b\]\d*;[^\x07\x1b]*(?=\x1b\[)/g, '')     // OSC followed by CSI: keep text after CSI
    .replace(/\x1b\]\d*;[^\x07\x1b]*/g, '')               // OSC without terminator at end
    .replace(/\x1b\[[\x30-\x3f]*[\x40-\x7e]/g, '')        // CSI: ESC [ Pm* Final-byte
    .replace(/\x1b[DMEHFGc]/g, '')                        // Fe sequences
    .replace(/\x1b[=>]/g, '');                           // Mode set
}

export function formatLine(text: string, lineNumber: number, maxLength: number = 2000, shouldStripAnsi: boolean = true): string {
  const cleanText = shouldStripAnsi ? stripAnsi(text) : text;
  const displayLine = cleanText.length > maxLength 
    ? cleanText.substring(0, maxLength) + '... (truncated)' 
    : cleanText;
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
  durationMs?: number;
  createdAt?: string;
}

export function formatSessionInfo(session: SessionInfo): string[] {
  const duration = session.durationMs !== undefined 
    ? (session.durationMs > 1000 ? `${(session.durationMs / 1000).toFixed(1)}s` : `${session.durationMs}ms`)
    : 'unknown';
    
  return [
    `ID: ${session.id}`,
    `  Title: ${session.title}`,
    `  Command: ${formatCommand(session.command, session.args)}`,
    `  Status: ${session.status}`,
    `  PID: ${session.pid}`,
    `  Lines: ${session.lineCount}`,
    `  Duration: ${duration}`,
    `  Started: ${session.createdAt ?? 'unknown'}`,
    ''
  ];
}
