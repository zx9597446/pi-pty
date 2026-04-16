export type PTYStatus = 'running' | 'exited' | 'killing' | 'killed';
export type SessionEvent = 'spawned' | 'killing' | 'exited' | 'killed' | 'cleaned';

export interface PTYSession {
  id: string;
  title: string;
  description?: string;
  command: string;
  args: string[];
  workdir: string;
  env?: Record<string, string>;
  status: PTYStatus;
  exitCode?: number;
  exitSignal?: number | string;
  pid: number;
  createdAt: Date;
  parentSessionId: string;
  parentAgent?: string;
  notifyOnExit: boolean;
  buffer: any; // RingBuffer
  process: any; // IPty
}

export interface PTYSessionInfo {
  id: string;
  title: string;
  description?: string;
  command: string;
  args: string[];
  workdir: string;
  status: PTYStatus;
  notifyOnExit: boolean;
  exitCode?: number;
  exitSignal?: number | string;
  pid: number;
  createdAt: string;
  lineCount: number;
  durationMs?: number;
}

export interface SpawnOptions {
  command: string;
  args?: string[];
  workdir?: string;
  env?: Record<string, string>;
  title?: string;
  description?: string;
  parentSessionId: string;
  parentAgent?: string;
  notifyOnExit?: boolean;
}

export interface ReadResult {
  lines: string[];
  totalLines: number;
  offset: number;
  hasMore: boolean;
}

export interface SearchResult {
  matches: Array<{ lineNumber: number; text: string }>;
  totalMatches: number;
  totalLines: number;
  offset: number;
  hasMore: boolean;
}
