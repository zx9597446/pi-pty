import type { PTYSession, ReadResult, SearchResult } from './types.js';
import type { SearchMatch } from './buffer.js';

export class OutputManager {
  write(session: PTYSession, data: string): boolean {
    try {
      session.process?.write(data);
      return true;
    } catch {
      return false;
    }
  }

  read(session: PTYSession, offset: number = 0, limit?: number, skipEmpty?: boolean): ReadResult {
    const allLines = session.buffer.read(0, undefined);
    const totalLines = allLines.length;
    
    // Filter empty lines if requested
    const filteredLines = skipEmpty ? allLines.filter((line: string) => line.trim().length > 0) : allLines;
    const filteredTotal = filteredLines.length;
    
    // Apply offset and limit on filtered lines
    const actualOffset = offset < 0 ? Math.max(0, filteredTotal + offset) : offset;
    const lines = filteredLines.slice(actualOffset, limit !== undefined ? actualOffset + limit : undefined);
    const hasMore = actualOffset + lines.length < filteredTotal;
    
    return { lines, totalLines: filteredTotal, offset: actualOffset, hasMore };
  }

  search(session: PTYSession, pattern: RegExp, offset: number = 0, limit?: number, skipEmpty?: boolean): SearchResult {
    let allMatches: SearchMatch[] = session.buffer.search(pattern);
    
    // Filter empty lines if requested
    if (skipEmpty) {
      allMatches = allMatches.filter((match: SearchMatch) => match.text.trim().length > 0);
    }
    
    const totalMatches = allMatches.length;
    const totalLines = skipEmpty ? allMatches.length : session.buffer.length;
    const paginatedMatches =
      limit !== undefined ? allMatches.slice(offset, offset + limit) : allMatches.slice(offset);
    const hasMore = offset + paginatedMatches.length < totalMatches;
    return { matches: paginatedMatches, totalMatches, totalLines, offset, hasMore };
  }
}
