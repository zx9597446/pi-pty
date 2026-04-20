import { spawn, type IPty } from 'zigpty';
import { RingBuffer } from './buffer.js';
import { formatCommand } from './formatters.js';
import type { PTYSession, PTYSessionInfo, SpawnOptions } from './types.js';
import * as crypto from 'crypto';
import { StringDecoder } from 'string_decoder';

const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 40;
const SESSION_ID_BYTE_LENGTH = 4;

function generateId(): string {
  return `pty_${crypto.randomBytes(SESSION_ID_BYTE_LENGTH).toString('hex')}`;
}

export class SessionLifecycleManager {
  private sessions = new Map<string, PTYSession>();
  private sessionTimers = new Map<string, NodeJS.Timeout>();

  private createSessionObject(opts: SpawnOptions): PTYSession {
    const id = generateId();
    const args = opts.args ?? [];
    const workdir = opts.workdir ?? process.cwd();
    const title = opts.title ?? (formatCommand(opts.command, args) || `Terminal ${id.slice(-4)}`);

    return {
      ...opts,
      id,
      title,
      args,
      workdir,
      status: 'running',
      pid: 0,
      createdAt: new Date(),
      notifyOnExit: opts.notifyOnExit ?? true,
      buffer: new RingBuffer(),
      process: null,
      decoder: new StringDecoder('utf8'),
    };
  }

  private spawnProcess(
    session: PTYSession,
    onData: (session: PTYSession, data: string) => void,
    onExit: (session: PTYSession, exitCode: number | null) => void
  ): void {
    const env = { ...process.env, ...session.env } as Record<string, string>;
    
    session.process = spawn(session.command, session.args, {
      cols: DEFAULT_TERMINAL_COLS,
      rows: DEFAULT_TERMINAL_ROWS,
      cwd: session.workdir,
      env,
      onExit: (exitCode: number, signal?: number) => {
        // Clear timeout if process exits naturally
        const timer = this.sessionTimers.get(session.id);
        if (timer) {
          clearTimeout(timer);
          this.sessionTimers.delete(session.id);
        }

        session.status = session.status === 'killing' ? 'killed' : 'exited';
        session.exitCode = exitCode;
        session.exitSignal = signal;
        session.exitedAt = new Date();
        onExit(session, exitCode);
      }
    });

    // Store incomplete UTF-8 sequences for proper handling across data chunks
    let incompleteChunk: Buffer | null = null;
    
    session.process.onData((data: string | Buffer) => {
      let strData: string;
      if (Buffer.isBuffer(data)) {
        // Combine with any incomplete chunk from previous data
        const combined = incompleteChunk 
          ? Buffer.concat([incompleteChunk, data])
          : data;
        incompleteChunk = null;
        
        strData = combined.toString('utf8');
        
        // Check if the result ends with an incomplete surrogate pair
        const lastChar = strData.charCodeAt(strData.length - 1);
        if (lastChar >= 0xD800 && lastChar <= 0xDBFF) {
          // High surrogate at end - this emoji is incomplete, save it for next chunk
          const lastCodePoint = strData.codePointAt(strData.length - 1);
          if (lastCodePoint !== undefined && lastCodePoint > 0xFFFF) {
            // It's a surrogate pair, find the bytes for the incomplete character
            const charStr = strData[strData.length - 1];
            // Save the high surrogate as a buffer to prepend to next data
            incompleteChunk = Buffer.from(charStr, 'utf8');
            strData = strData.slice(0, -1);
          }
        }
      } else {
        strData = data;
      }
      session.buffer.append(strData);
      onData(session, strData);
    });

    session.pid = session.process.pid;
  }

  spawn(
    opts: SpawnOptions,
    onData: (session: PTYSession, data: string) => void,
    onExit: (session: PTYSession, exitCode: number | null) => void
  ): PTYSessionInfo {
    const session = this.createSessionObject(opts);
    this.spawnProcess(session, onData, onExit);
    this.sessions.set(session.id, session);

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      const timer = setTimeout(() => {
        console.log(`PTY session ${session.id} timed out after ${opts.timeoutMs}ms. Killing...`);
        this.kill(session.id, false);
      }, opts.timeoutMs);
      this.sessionTimers.set(session.id, timer);
    }

    return this.toInfo(session);
  }

  kill(id: string, cleanup: boolean = false): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;

    // Clear timeout if explicitly killed
    const timer = this.sessionTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.sessionTimers.delete(id);
    }

    if (session.status === 'running') {
      session.status = 'killing';
      try { 
        session.process?.kill(); 
      } catch (e) { 
        console.error('Failed to kill PTY process:', e);
      }
    }

    if (cleanup) {
      // Properly close the PTY before cleanup
      try {
        session.process?.close();
      } catch (e) {
        // Ignore close errors - process may have already exited
      }
      session.buffer.clear();
      session.process = null;
      this.sessions.delete(id);
    }
    return true;
  }

  clearAllSessions(): void {
    for (const id of this.sessions.keys()) {
      this.kill(id, true);
    }
  }

  cleanupBySession(parentSessionId: string): void {
    for (const [id, session] of this.sessions) {
      if (session.parentSessionId === parentSessionId) {
        this.kill(id, true);
      }
    }
  }

  getSession = (id: string) => this.sessions.get(id) || null;

  listSessions = () => Array.from(this.sessions.values());

  toInfo(session: PTYSession): PTYSessionInfo {
    const { createdAt, exitCode, exitedAt, buffer, ...rest } = session;
    const durationMs = session.exitedAt
      ? session.exitedAt.getTime() - createdAt.getTime()
      : Date.now() - createdAt.getTime();

    return {
      ...rest,
      status: session.status,
      exitCode,
      createdAt: createdAt.toISOString(),
      lineCount: buffer.length,
      durationMs,
    };
  }
}
