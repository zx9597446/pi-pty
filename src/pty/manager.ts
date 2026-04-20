import { SessionLifecycleManager } from './lifecycle.js';
import { OutputManager } from './output.js';
import type { PTYSession, PTYSessionInfo, ReadResult, SearchResult, SpawnOptions, SessionEvent } from './types.js';
import { stripAnsi } from './formatters.js';

export type RawOutputCallback = (id: string, data: string) => void;
export type SessionUpdateCallback = (info: PTYSessionInfo, event: SessionEvent) => void;

export interface Watcher {
  pattern: RegExp;
  patternStr: string;
  callback: (match: string, count: number) => void;
  persistent?: boolean;
  throttleMs?: number;
  lastNotifyTime?: number;
  pendingCount: number;
  lastMatchData?: string;
  matchBuffer: string[];
  timeout?: NodeJS.Timeout;
}

export class PTYManager {
  private lifecycleManager = new SessionLifecycleManager();
  private outputManager = new OutputManager();
  private rawOutputCallbacks: Set<RawOutputCallback> = new Set();
  private sessionUpdateCallbacks: Set<SessionUpdateCallback> = new Set();
  private watchers: Map<string, Set<Watcher>> = new Map();

  registerRawOutputCallback(callback: RawOutputCallback): void {
    this.rawOutputCallbacks.add(callback);
  }

  removeRawOutputCallback(callback: RawOutputCallback): void {
    this.rawOutputCallbacks.delete(callback);
  }

  registerSessionUpdateCallback(callback: SessionUpdateCallback): void {
    this.sessionUpdateCallbacks.add(callback);
  }

  removeSessionUpdateCallback(callback: SessionUpdateCallback): void {
    this.sessionUpdateCallbacks.delete(callback);
  }

  private notifySessionUpdate(info: PTYSessionInfo, event: SessionEvent): void {
    for (const callback of this.sessionUpdateCallbacks) {
      try {
        callback(info, event);
      } catch (err) {
        console.error('Error in pty session update callback:', err);
      }
    }
  }

  addWatcher(id: string, pattern: RegExp, callback: (match: string, count: number) => void, persistent: boolean = false, throttleMs: number = 0): void {
    if (!this.lifecycleManager.getSession(id)) {
      throw new Error(`PTY session '${id}' not found.`);
    }
    if (!this.watchers.has(id)) {
      this.watchers.set(id, new Set());
    }
    const sessionWatchers = this.watchers.get(id)!;
    const patternStr = pattern.source;

    // Check for duplicate pattern
    for (const watcher of sessionWatchers) {
      if (watcher.patternStr === patternStr) {
        // Update existing watcher with new options
        watcher.callback = callback;
        watcher.persistent = persistent;
        watcher.throttleMs = throttleMs;
        watcher.pattern = pattern;
        return;
      }
    }

    sessionWatchers.add({
      pattern,
      patternStr,
      callback,
      persistent,
      throttleMs,
      pendingCount: 0,
      matchBuffer: []
    });
  }

  private invokeWatcherCallback(watcher: Watcher, data: string, count: number): void {
    try {
      watcher.callback(data, count);
    } catch (err) {
      console.error('Error in pty watcher callback:', err);
    }
  }

  /** Build a summary from the watcher's match buffer, then invoke callback and reset state. */
  private flushWatcher(watcher: Watcher, data: string): void {
    const summary = watcher.matchBuffer.length > 1
      ? `${watcher.matchBuffer[0]} ... ${watcher.matchBuffer[watcher.matchBuffer.length - 1]}`
      : data;
    this.invokeWatcherCallback(watcher, summary, watcher.pendingCount);
    watcher.pendingCount = 0;
    watcher.matchBuffer = [];
    watcher.lastNotifyTime = Date.now();
  }

  private processWatcherMatch(watcher: Watcher, data: string, sessionWatchers: Set<Watcher>): void {
    watcher.lastMatchData = data;
    watcher.pendingCount++;
    watcher.matchBuffer.push(data);
    // Keep buffer reasonable
    if (watcher.matchBuffer.length > 10) {
      watcher.matchBuffer.shift();
    }

    // Non-persistent: fire once and remove
    if (!watcher.persistent) {
      this.invokeWatcherCallback(watcher, data, 1);
      sessionWatchers.delete(watcher);
      return;
    }

    const throttleMs = watcher.throttleMs || 0;

    // No throttling: fire immediately
    if (throttleMs <= 0) {
      this.flushWatcher(watcher, data);
      return;
    }

    // Already waiting for a delayed flush
    if (watcher.timeout) return;

    // Throttled: flush now or schedule
    const timeSinceLast = Date.now() - (watcher.lastNotifyTime || 0);
    if (timeSinceLast >= throttleMs) {
      this.flushWatcher(watcher, data);
    } else {
      watcher.timeout = setTimeout(() => {
        watcher.timeout = undefined;
        if (watcher.pendingCount > 0) {
          this.flushWatcher(watcher, watcher.lastMatchData || '');
        }
      }, throttleMs - timeSinceLast);
    }
  }

  private notifyRawOutput(session: any, data: string): void {
    // Skip all processing if session is being killed or cleaned up
    if (session.status === 'killing' || session.status === 'killed' || session.status === 'exited') {
      return;
    }

    // 1. Notify static callbacks
    for (const callback of this.rawOutputCallbacks) {
      try {
        callback(session.id, data);
      } catch (err) {
        console.error('Error in pty raw output callback:', err);
      }
    }

    // 2. Process watchers
    const sessionWatchers = this.watchers.get(session.id);
    if (sessionWatchers && sessionWatchers.size > 0) {
      const cleanChunk = stripAnsi(data);
      const recentLines = session.buffer.read(Math.max(0, session.buffer.length - 2));
      const cleanRecentLines = recentLines.map((l: string) => stripAnsi(l));

      for (const watcher of Array.from(sessionWatchers)) {
        watcher.pattern.lastIndex = 0;

        // Match against current clean chunk line-by-line first
        const chunkLines = cleanChunk.split(/\r?\n/);
        const chunkMatch = chunkLines.find(line => watcher.pattern.test(line));

        if (chunkMatch !== undefined) {
          this.processWatcherMatch(watcher, chunkMatch, sessionWatchers);
          continue;
        }

        // Check recent buffer lines for cross-chunk matches
        const bufferMatch = cleanRecentLines.find((line: string) => watcher.pattern.test(line));
        if (bufferMatch !== undefined) {
          this.processWatcherMatch(watcher, bufferMatch, sessionWatchers);
        }
      }
    }
  }

  private clearSessionWatchers(id: string): void {
    const sessionWatchers = this.watchers.get(id);
    if (sessionWatchers) {
      for (const w of sessionWatchers) {
        if (w.timeout) clearTimeout(w.timeout);
      }
      this.watchers.delete(id);
    }
  }

  spawn(opts: SpawnOptions, onData: (data: string) => void, onExit: (exitCode: number | null) => void): PTYSessionInfo {
    const info = this.lifecycleManager.spawn(
      opts,
      (session, data) => {
        this.notifyRawOutput(session, data);
        onData(data);
      },
      (session, exitCode) => {
        const event = session.status === 'killed' ? 'killed' as const : 'exited' as const;
        this.notifySessionUpdate(this.lifecycleManager.toInfo(session), event);
        // Delay watcher cleanup to allow pending onData to process first
        setTimeout(() => this.clearSessionWatchers(session.id), 100);
        onExit(exitCode);
      }
    );
    this.notifySessionUpdate(info, 'spawned');
    return info;
  }

  write(id: string, data: string): boolean {
    const session = this.lifecycleManager.getSession(id);
    if (!session || session.status !== 'running') return false;
    return this.outputManager.write(session, data);
  }

  read(id: string, offset: number = 0, limit?: number, skipEmpty?: boolean): ReadResult | null {
    const session = this.lifecycleManager.getSession(id);
    if (!session) return null;
    return this.outputManager.read(session, offset, limit, skipEmpty);
  }

  search(id: string, pattern: RegExp, offset: number = 0, limit?: number, skipEmpty?: boolean): SearchResult | null {
    const session = this.lifecycleManager.getSession(id);
    if (!session) return null;
    return this.outputManager.search(session, pattern, offset, limit, skipEmpty);
  }

  list(): PTYSessionInfo[] {
    return this.lifecycleManager.listSessions().map((s) => this.lifecycleManager.toInfo(s));
  }

  get(id: string): PTYSessionInfo | null {
    const session = this.lifecycleManager.getSession(id);
    if (!session) return null;
    return this.lifecycleManager.toInfo(session);
  }

  kill(id: string, cleanup: boolean = false): boolean {
    const session = this.lifecycleManager.getSession(id);
    if (!session) return false;

    // Always clear watchers on kill to prevent orphaned callbacks
    this.clearSessionWatchers(id);

    const info = this.lifecycleManager.toInfo(session);
    if (session.status === 'running') {
      this.notifySessionUpdate(info, 'killing');
    }
    const success = this.lifecycleManager.kill(id, cleanup);
    if (success && cleanup) {
      this.notifySessionUpdate(info, 'cleaned');
    }
    return success;
  }

  cleanupBySession(parentSessionId: string): void {
    const sessions = this.lifecycleManager.listSessions();
    for (const s of sessions) {
      if (s.parentSessionId === parentSessionId) {
        this.kill(s.id, true);
      }
    }
  }

  clearAll(): void {
    for (const id of Array.from(this.watchers.keys())) {
      this.clearSessionWatchers(id);
    }
    this.rawOutputCallbacks.clear();
    this.sessionUpdateCallbacks.clear();
    this.lifecycleManager.clearAllSessions();
  }
}

export const manager = new PTYManager();
