import { SessionLifecycleManager } from './lifecycle.js';
import { OutputManager } from './output.js';
import type { PTYSessionInfo, ReadResult, SearchResult, SpawnOptions, SessionEvent } from './types.js';
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
    if (!this.watchers.has(id)) {
      this.watchers.set(id, new Set());
    }
    this.watchers.get(id)!.add({
      pattern,
      patternStr: pattern.source,
      callback,
      persistent,
      throttleMs,
      pendingCount: 0
    });
  }

  removeWatcher(id: string, patternStr: string): boolean {
    const sessionWatchers = this.watchers.get(id);
    if (!sessionWatchers) return false;
    
    let found = false;
    for (const watcher of sessionWatchers) {
      if (watcher.patternStr === patternStr) {
        if (watcher.timeout) {
          clearTimeout(watcher.timeout);
        }
        sessionWatchers.delete(watcher);
        found = true;
      }
    }
    return found;
  }

  private invokeWatcherCallback(watcher: Watcher, data: string, count: number): void {
    try {
      watcher.callback(data, count);
    } catch (err) {
      console.error('Error in pty watcher callback:', err);
    }
  }

  private processWatcherMatch(watcher: Watcher, data: string, sessionWatchers: Set<Watcher>): void {
    watcher.lastMatchData = data;
    watcher.pendingCount++;

    if (!watcher.persistent) {
      this.invokeWatcherCallback(watcher, data, 1);
      sessionWatchers.delete(watcher);
      return;
    }

    const now = Date.now();
    const throttleMs = watcher.throttleMs || 0;

    if (throttleMs <= 0) {
      this.invokeWatcherCallback(watcher, data, 1);
      watcher.pendingCount = 0;
      return;
    }

    if (watcher.timeout) {
      // Timer already running, just accumulating count
      return;
    }

    const timeSinceLast = now - (watcher.lastNotifyTime || 0);
    if (timeSinceLast >= throttleMs) {
      // Enough time has passed, trigger immediately
      this.invokeWatcherCallback(watcher, watcher.lastMatchData!, watcher.pendingCount);
      watcher.pendingCount = 0;
      watcher.lastNotifyTime = now;
    } else {
      // Wait for throttle period
      const delay = throttleMs - timeSinceLast;
      watcher.timeout = setTimeout(() => {
        watcher.timeout = undefined;
        if (watcher.pendingCount > 0 && watcher.lastMatchData) {
          this.invokeWatcherCallback(watcher, watcher.lastMatchData, watcher.pendingCount);
          watcher.pendingCount = 0;
          watcher.lastNotifyTime = Date.now();
        }
      }, delay);
    }
  }

  private notifyRawOutput(id: string, data: string): void {
    // 1. Notify static callbacks
    for (const callback of this.rawOutputCallbacks) {
      try {
        callback(id, data);
      } catch (err) {
        console.error('Error in pty raw output callback:', err);
      }
    }

    // 2. Process watchers
    const sessionWatchers = this.watchers.get(id);
    if (sessionWatchers && sessionWatchers.size > 0) {
      const cleanData = stripAnsi(data);
      for (const watcher of sessionWatchers) {
        watcher.pattern.lastIndex = 0;
        if (watcher.pattern.test(cleanData)) {
          this.processWatcherMatch(watcher, data, sessionWatchers);
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
        this.notifyRawOutput(session.id, data);
        onData(data);
      },
      (session, exitCode) => {
        this.clearSessionWatchers(session.id);
        const event = session.status === 'killed' ? 'killed' as const : 'exited' as const;
        this.notifySessionUpdate(this.lifecycleManager.toInfo(session), event);
        onExit(exitCode);
      }
    );
    this.notifySessionUpdate(info, 'spawned');
    return info;
  }

  write(id: string, data: string): boolean {
    const session = this.lifecycleManager.getSession(id);
    if (!session) return false;
    return this.outputManager.write(session, data);
  }

  read(id: string, offset: number = 0, limit?: number): ReadResult | null {
    const session = this.lifecycleManager.getSession(id);
    if (!session) return null;
    return this.outputManager.read(session, offset, limit);
  }

  search(id: string, pattern: RegExp, offset: number = 0, limit?: number): SearchResult | null {
    const session = this.lifecycleManager.getSession(id);
    if (!session) return null;
    return this.outputManager.search(session, pattern, offset, limit);
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

    if (cleanup) {
      this.clearSessionWatchers(id);
    }

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
    this.lifecycleManager.clearAllSessions();
  }
}

export const manager = new PTYManager();
