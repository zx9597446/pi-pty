import type { PTYSession, ReadResult, SearchResult } from './types.js';

export class OutputManager {
  write(session: PTYSession, data: string): boolean {
    try {
      session.process?.write(data);
      return true;
    } catch {
      return false;
    }
  }

  read(session: PTYSession, offset: number = 0, limit?: number): ReadResult {
    const totalLines = session.buffer.length;
    const actualOffset = offset < 0 ? Math.max(0, totalLines + offset) : offset;
    const lines = session.buffer.read(offset, limit);
    const hasMore = actualOffset + lines.length < totalLines;
    return { lines, totalLines, offset: actualOffset, hasMore };
  }

  search(session: PTYSession, pattern: RegExp, offset: number = 0, limit?: number): SearchResult {
    const allMatches = session.buffer.search(pattern);
    const totalMatches = allMatches.length;
    const totalLines = session.buffer.length;
    const paginatedMatches =
      limit !== undefined ? allMatches.slice(offset, offset + limit) : allMatches.slice(offset);
    const hasMore = offset + paginatedMatches.length < totalMatches;
    return { matches: paginatedMatches, totalMatches, totalLines, offset, hasMore };
  }
}
