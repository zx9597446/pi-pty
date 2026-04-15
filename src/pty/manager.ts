import { SessionLifecycleManager } from './lifecycle.js';
import { OutputManager } from './output.js';
import type { PTYSessionInfo, ReadResult, SearchResult, SpawnOptions, SessionEvent } from './types.js';
import { stripAnsi } from './formatters.js';

export type RawOutputCallback = (id: string, data: string) => void;
export type SessionUpdateCallback = (info: PTYSessionInfo, event: SessionEvent) => void;

export interface Watcher {
  pattern: RegExp;
  callback: (match: string) => void;
  persistent?: boolean;
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

  addWatcher(id: string, pattern: RegExp, callback: (match: string) => void, persistent: boolean = false): void {
    if (!this.watchers.has(id)) {
      this.watchers.set(id, new Set());
    }
    this.watchers.get(id)!.add({ pattern, callback, persistent });
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
        if (watcher.pattern.test(cleanData)) {
          try {
            watcher.callback(data);
          } catch (err) {
            console.error('Error in pty watcher callback:', err);
          }
          
          if (!watcher.persistent) {
            sessionWatchers.delete(watcher);
          }
        }
      }
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
        // Cleanup watchers on exit
        this.watchers.delete(session.id);
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
    if (cleanup) this.watchers.delete(id);
    const session = this.lifecycleManager.getSession(id);
    if (session && session.status === 'running') {
      this.notifySessionUpdate(this.lifecycleManager.toInfo(session), 'killing');
    }
    const info = session ? this.lifecycleManager.toInfo(session) : null;
    const success = this.lifecycleManager.kill(id, cleanup);
    if (success && cleanup && info) {
      this.notifySessionUpdate(info, 'cleaned');
    }
    return success;
  }

  cleanupBySession(parentSessionId: string): void {
    this.lifecycleManager.cleanupBySession(parentSessionId);
  }

  clearAll(): void {
    this.watchers.clear();
    this.lifecycleManager.clearAllSessions();
  }
}

export const manager = new PTYManager();
