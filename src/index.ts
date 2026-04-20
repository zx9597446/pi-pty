import { Type } from '@sinclair/typebox';
import { manager } from './pty/manager.js';
import { formatCommand, formatLine, formatSessionInfo, stripAnsi } from './pty/formatters.js';
import { checkCommandPermission, checkWorkdirPermission } from './pty/permissions.js';
import { parseEscapeSequences, ETX, EOT } from './pty/escape.js';
import type { PTYSessionInfo, ReadResult, SearchResult } from './pty/types.js';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';

/**
 * Check if a command is likely executable.
 * Prevents zigpty from hanging on nonexistent commands.
 */
function isCommandExecutable(command: string): boolean {
  if (!command || command.trim() === '') return false;
  if (/[\\/:]/.test(command)) {
    return existsSync(resolve(command));
  }
  try {
    const checker = process.platform === 'win32' ? 'where.exe' : 'which';
    execSync(`${checker} ${command}`, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Common navigation hints for different PTY states.
 */
const HINTS = {
  SPAWN: [
    `<system_reminder>`,
    `- ASYNC: This process is running in the background. Wait for <pty_exited> notification.`,
    `- WATCH: Call \`pty_watch(pattern='...')\` to react to specific output events.`,
    `- READ: Call \`pty_read()\` to see current logs or initial output.`,
    `- HELP: Call \`pty_help()\` for strategy and best practices.`,
    `</system_reminder>`,
  ].join('\n'),

  READ: (total: number, nextOffset: number, limit: number) => [
    `<system_reminder>`,
    `- NEXT: Use \`offset=${nextOffset}\` and \`limit=${limit}\` to read more.`,
    `- TAIL: Use \`offset=-100\` to read the last 100 lines.`,
    `- SEARCH: Use \`pattern='...'\` to filter these ${total} lines for keywords.`,
    `- PROMPT: If the last line looks like a prompt but has no newline, the process is waiting for \`pty_write\`.`,
    `</system_reminder>`,
  ].join('\n'),

  EMPTY: [
    `<system_reminder>`,
    `- WAIT: If the process just started, output might be delayed.`,
    `- WRITE: If it's an interactive shell, try sending a command via \`pty_write\`.`,
    `- FORCE: Some processes need a newline (\`\\n\`) or Ctrl+C (\`\\x03\`) to flush output.`,
    `</system_reminder>`
  ].join('\n'),

  EXIT: (code: number | null) => [
    `<system_reminder>`,
    code !== 0 
      ? `- DIAGNOSE: Exit code ${code} is non-zero. Use \`pty_read(pattern='Error|Fail|Exception')\` to find the cause.`
      : `- SUCCESS: Process finished successfully.`,
    `- FINAL LOGS: Use \`pty_read()\` to retrieve the final execution state.`,
    `</system_reminder>`,
  ].join('\n'),

  MATCH: (pattern: string) => [
    `<system_reminder>`,
    `- INVESTIGATE: Use \`pty_read(pattern='${pattern}')\` to see historical matches.`,
    `</system_reminder>`,
  ].join('\n')
};

function isSearchResult(result: ReadResult | SearchResult): result is SearchResult {
  return 'matches' in result;
}

function hasData(result: ReadResult | SearchResult): boolean {
  return isSearchResult(result) ? result.matches.length > 0 : result.lines.length > 0;
}

function buildEmptyOutput(openTag: string, pattern: string | undefined, result: ReadResult | SearchResult): string[] {
  if (isSearchResult(result)) {
    return [
      openTag,
      `No lines matched the pattern '${pattern}'.`,
      `Total lines in buffer: ${result.totalLines}`,
      `</pty_output>`,
      '',
      `<system_reminder>`,
      `If you expect this pattern to appear in future output, use \`pty_watch\` to be notified automatically when it arrives.`,
      `</system_reminder>`,
    ];
  }
  return [
    openTag,
    `(No output available - buffer is empty)`,
    `Total lines: ${result.totalLines}`,
    `</pty_output>`,
    '',
    HINTS.EMPTY
  ];
}

function buildDataOutput(openTag: string, result: ReadResult | SearchResult, offset: number, doStrip: boolean): string[] {
  const isSearch = isSearchResult(result);
  const currentOffset = offset < 0 ? Math.max(0, result.totalLines + offset) : offset;
  
  const items = isSearch 
    ? result.matches 
    : result.lines.map((line, i) => ({ lineNumber: currentOffset + i + 1, text: line }));
  
  const formattedLines = items.map(item => formatLine(item.text, item.lineNumber, 2000, doStrip));

  const pagination = isSearch
    ? (result.hasMore 
        ? `(${result.matches.length} of ${result.totalMatches} matches shown.)`
        : `(${result.totalMatches} matches from ${result.totalLines} total lines)`)
    : (result.hasMore
        ? `(Buffer has more lines. Current view ends at line ${currentOffset + result.lines.length})`
        : `(End of buffer - total ${result.totalLines} lines)`);

  return [openTag, ...formattedLines, '', pagination, `</pty_output>`];
}

/** Compile a regex pattern, throwing a descriptive error on failure. */
function compilePattern(pattern: string, ignoreCase: boolean): RegExp {
  try {
    return new RegExp(pattern, ignoreCase ? 'i' : '');
  } catch (e: any) {
    throw new Error(`Invalid regex pattern '${pattern}': ${e.message}`);
  }
}

/** Build the full output text for a read/search result, including hints. */
function formatReadOutput(sessionId: string, sessionStatus: string, pattern: string | undefined, result: ReadResult | SearchResult, offset: number, doStrip: boolean, limit: number): string {
  const openTag = pattern
    ? `<pty_output id="${sessionId}" status="${sessionStatus}" pattern="${pattern}">`
    : `<pty_output id="${sessionId}" status="${sessionStatus}">`;

  const outputLines = hasData(result)
    ? buildDataOutput(openTag, result, offset, doStrip)
    : buildEmptyOutput(openTag, pattern, result);

  let outputText = outputLines.join('\n');

  // Add pagination hints
  const shouldHint = isSearchResult(result)
    ? result.hasMore
    : result.hasMore || sessionStatus === 'running';
  if (shouldHint) {
    const itemCount = isSearchResult(result) ? result.matches.length : result.lines.length;
    const nextOffset = result.offset + itemCount;
    outputText += `\n\n${HINTS.READ(result.totalLines, nextOffset, limit)}`;
  }

  return outputText;
}

function getLastLine(id: string, totalLines: number): string {
  if (totalLines <= 0) return '(no output)';
  try {
    const result = manager.read(id, totalLines - 1, 1);
    return result?.lines[0]?.slice(0, 250) ?? '(no output)';
  } catch {
    return '(no output)';
  }
}

function buildExitMessage(info: PTYSessionInfo, exitCode: number | null): string {
  const totalLines = manager.get(info.id)?.lineCount ?? 0;
  const lastLine = stripAnsi(getLastLine(info.id, totalLines)).trim();
  return [
    `<pty_exited>`,
    `ID: ${info.id}`,
    `Title: ${info.title}`,
    `Command: ${formatCommand(info.command, info.args)}`,
    `Exit Code: ${exitCode}`,
    `Duration: ${info.durationMs ?? 'unknown'}ms`,
    `Lines: ${totalLines}`,
    `Last line: ${lastLine}`,
    `</pty_exited>`,
    HINTS.EXIT(exitCode)
  ].join('\n');
}

// Flag to track if manager has been cleared
let managerCleared = false;

async function handlePtyExit(pi: any, info: PTYSessionInfo, exitCode: number | null, notify: boolean) {
  if (!notify || managerCleared) return;
  
  let message: string;
  try {
    message = buildExitMessage(info, exitCode);
  } catch (err) {
    console.error(`Error building exit message for ${info.id}:`, err);
    return;
  }

  setTimeout(async () => {
    if (managerCleared) return;
    try {
      await pi?.sendMessage?.({
        role: 'assistant',
        content: [{ type: 'text', text: message }]
      });
    } catch (err) {
      console.error(`Failed to send exit message for ${info.id}:`, err);
    }
  }, 50);
}

export default function (pi: any) {
  // pty_spawn tool
  pi.registerTool({
    name: "pty_spawn",
    description: "Create a new PTY session to run a command in the background via shell (sh/cmd).",
    parameters: Type.Object({
      command: Type.String({ description: 'The command/executable to run' }),
      args: Type.Array(Type.String(), { description: 'Arguments to pass to the command', default: [] }),
      workdir: Type.Optional(Type.String({ description: 'Working directory for the PTY session' })),
      env: Type.Optional(Type.Record(Type.String(), Type.String(), { description: 'Additional environment variables' })),
      title: Type.Optional(Type.String({ description: 'Human-readable title for the session' })),
      description: Type.String({ description: 'Describe the intent of this session (5-10 words). This will be shown in pty_list.' }),
      notifyOnExit: Type.Optional(Type.Boolean({ description: 'If true, sends a notification when the process exits (default: true)', default: true })),
      timeoutMs: Type.Optional(Type.Number({ description: 'Optional timeout in milliseconds after which the process is automatically killed.' })),
    }),
    async execute(toolCallId: string, args: any, ctx: any) {
      if (!args.command || !args.command.trim()) {
        throw new Error('pty_spawn: command cannot be empty.');
      }
      if (!isCommandExecutable(args.command)) {
        throw new Error(`pty_spawn: command not found: ${args.command}`);
      }
      checkCommandPermission(args.command, args.args ?? []);
      if (args.workdir) checkWorkdirPermission(args.workdir);

      const info = manager.spawn(
        {
          command: args.command,
          args: args.args,
          workdir: args.workdir,
          env: args.env,
          title: args.title,
          description: args.description,
          parentSessionId: ctx.sessionId,
          notifyOnExit: args.notifyOnExit,
          timeoutMs: args.timeoutMs,
        },
        () => {},
        (exitCode) => {
          setImmediate(() => {
            handlePtyExit(pi, manager.get(info.id) || info, exitCode, !!info.notifyOnExit);
          });
        }
      );

      const currentStatus = manager.get(info.id);
      const isInstantExit = currentStatus && currentStatus.status !== 'running';

      const output = [
        `<pty_spawned>`,
        `ID: ${info.id}`,
        `Title: ${info.title}`,
        `Command: ${formatCommand(info.command, info.args)}`,
        `PID: ${info.pid}`,
        `Status: ${info.status}`,
        isInstantExit ? `Exit Code: ${currentStatus.exitCode}` : '',
        `</pty_spawned>`,
        '',
        isInstantExit ? HINTS.EXIT(currentStatus.exitCode ?? null) : HINTS.SPAWN,
      ].filter(Boolean).join('\n');

      const serializableInfo = {
        id: info.id,
        title: info.title,
        command: info.command,
        args: info.args,
        workdir: info.workdir,
        pid: info.pid,
        status: info.status,
        createdAt: info.createdAt,
        lineCount: info.lineCount,
        durationMs: info.durationMs,
        timeoutMs: info.timeoutMs,
      };

      return {
        content: [{ type: "text", text: output }],
        details: serializableInfo
      };
    },
  });

  // pty_write tool
  pi.registerTool({
    name: "pty_write",
    description: "Write data to PTY stdin. Supports base64 for complex scripts/binary. For Ctrl+C, write \\x03. For termination, use pty_kill.",
    parameters: Type.Object({
      id: Type.String({ description: 'PTY session ID' }),
      data: Type.String({ description: 'Data to send' }),
      isBase64: Type.Optional(Type.Boolean({ description: 'If true, data is treated as base64 encoded string (default: false)', default: false })),
      newline: Type.Optional(Type.Boolean({ description: 'If true, appends a newline character to data (default: false)', default: false })),
    }),
    async execute(toolCallId: string, args: any) {
      const session = manager.get(args.id);
      if (!session) throw new Error(`PTY session '${args.id}' not found.`);
      if (session.status !== 'running') throw new Error(`Cannot write to PTY '${args.id}' (${session.status}).`);

      let rawData: string;
      if (args.isBase64) {
        // Decode base64 and convert to UTF-8 string for PTY
        // This ensures multi-byte characters (e.g., Chinese) are correctly transmitted
        rawData = Buffer.from(args.data, 'base64').toString('utf8');
      } else {
        rawData = args.data;
      }

      // Parse escape sequences ONLY for non-base64 input
      const parsedData = args.isBase64 ? rawData : parseEscapeSequences(rawData);

      // Append newline AFTER escape parsing to avoid double-newline issues
      // e.g. data="hello\\n" + newline=true should become "hello\n", not "hello\n\n"
      let finalData = parsedData;
      if (args.newline) {
        if (!finalData.endsWith('\n') && !finalData.endsWith('\r')) {
          finalData += '\n';
        }
      }

      // Normalize line endings for Windows shells (skip for base64 to preserve binary data)
      if (!args.isBase64 && process.platform === 'win32') {
        finalData = finalData.replace(/\r?\n/g, '\r\n');
      }
      
      const success = manager.write(args.id, finalData);
      if (!success) throw new Error(`Failed to write to PTY '${args.id}'.`);

      // Preview logic (based on actual data sent)
      const preview = finalData.length > 50 ? `${finalData.slice(0, 50)}...` : finalData;
      const displayPreview = preview
        .replace(new RegExp(ETX, 'g'), '^C')
        .replace(new RegExp(EOT, 'g'), '^D')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');

      return {
        content: [{ type: "text", text: `Sent ${finalData.length} bytes to ${args.id}: "${displayPreview}"` }],
        details: { bytesSent: finalData.length }
      };
    },
  });

  // pty_read tool
  pi.registerTool({
    name: "pty_read",
    description: "Read PTY buffer with optional regex filtering. Note: when pattern is used, offset/limit paginate over matches, NOT lines.",
    parameters: Type.Object({
      id: Type.String({ description: 'PTY session ID' }),
      offset: Type.Optional(Type.Number({ description: 'Starting point (0-based, negative for tail). For search, this is the match index.' })),
      limit: Type.Optional(Type.Number({ description: 'Max items to read (default: 500)' })),
      pattern: Type.Optional(Type.String({ description: 'Regex filter. If set, returns matching lines only.' })),
      ignoreCase: Type.Optional(Type.Boolean({ description: 'Default: false' })),
      stripAnsi: Type.Optional(Type.Boolean({ description: 'Default: true', default: true })),
      skipEmpty: Type.Optional(Type.Boolean({ description: 'Skip empty/whitespace-only lines (default: false)' })),
    }),
    async execute(toolCallId: string, args: any) {
      const session = manager.get(args.id);
      if (!session) throw new Error(`PTY session '${args.id}' not found.`);

      const offset = args.offset ?? 0;
      const limit = args.limit ?? 500;
      const doStrip = args.stripAnsi ?? true;
      const doSkipEmpty = args.skipEmpty ?? false;

      const result = args.pattern
        ? manager.search(args.id, compilePattern(args.pattern, args.ignoreCase), offset, limit, doSkipEmpty)
        : manager.read(args.id, offset, limit, doSkipEmpty);

      if (!result) throw new Error(`Failed to read from PTY '${args.id}'.`);

      const outputText = formatReadOutput(args.id, session.status, args.pattern, result, offset, doStrip, limit);
      return { content: [{ type: "text", text: outputText }], details: result };
    },
  });

  // pty_search tool (dedicated search with match-based pagination)
  pi.registerTool({
    name: "pty_search",
    description: "Search PTY buffer for a pattern. offset/limit paginate over matches (not lines).",
    parameters: Type.Object({
      id: Type.String({ description: 'PTY session ID' }),
      pattern: Type.String({ description: 'Regex filter pattern' }),
      offset: Type.Optional(Type.Number({ description: 'Starting match index (0-based, default 0)', default: 0 })),
      limit: Type.Optional(Type.Number({ description: 'Max matches to return (default: 100)', default: 100 })),
      ignoreCase: Type.Optional(Type.Boolean({ description: 'Default: true', default: true })),
      stripAnsi: Type.Optional(Type.Boolean({ description: 'Default: true', default: true })),
    }),
    async execute(toolCallId: string, args: any) {
      const session = manager.get(args.id);
      if (!session) throw new Error(`PTY session '${args.id}' not found.`);

      const offset = args.offset ?? 0;
      const limit = args.limit ?? 100;
      const doStrip = args.stripAnsi ?? true;
      const result = manager.search(args.id, compilePattern(args.pattern, args.ignoreCase), offset, limit);
      if (!result) throw new Error(`Failed to search PTY '${args.id}'.`);

      const outputText = formatReadOutput(args.id, session.status, args.pattern, result, offset, doStrip, limit);
      return { content: [{ type: 'text', text: outputText }], details: result };
    }
  });

  // pty_watch tool
  pi.registerTool({
    name: "pty_watch",
    description: "Watch PTY for a pattern and get notified asynchronously.",
    parameters: Type.Object({
      id: Type.String({ description: 'PTY session ID' }),
      pattern: Type.String({ description: 'Regex pattern to watch' }),
      ignoreCase: Type.Optional(Type.Boolean({ description: 'Case-insensitive matching (default: false)', default: false })),
      persistent: Type.Optional(Type.Boolean({ description: 'Keep watching after match (default: false)' })),
      throttleMs: Type.Optional(Type.Number({ description: 'Throttle notifications (default: 5000)' })),
    }),
    async execute(toolCallId: string, args: any) {
      const session = manager.get(args.id);
      if (!session) throw new Error(`Session '${args.id}' not found.`);
      if (session.status !== 'running') throw new Error(`Session '${args.id}' is not running (status: ${session.status}).`);

      let patternRe: RegExp;
      try {
        patternRe = new RegExp(args.pattern, args.ignoreCase ? 'i' : '');
      } catch (e: any) {
        throw new Error(`Invalid regex pattern '${args.pattern}': ${e.message}`);
      }

      manager.addWatcher(args.id, patternRe, (matchData, count) => {
        const message = [
          `<pty_match id="${args.id}" pattern="${args.pattern}"${count > 1 ? ` count="${count}"` : ''}>`,
          `Match: "${stripAnsi(matchData).trim()}"`,
          `</pty_match>`,
          HINTS.MATCH(args.pattern)
        ].join('\n');
        
        setImmediate(async () => {
          try {
            if (typeof pi?.sendMessage === 'function') {
              await pi.sendMessage({ role: 'assistant', content: [{ type: 'text', text: message }] });
            }
          } catch (err) {
            console.error('Failed to send watch match notification:', err);
          }
        });
      }, args.persistent, args.throttleMs ?? 5000);

      return { content: [{ type: "text", text: `Watching ${args.id} for "${args.pattern}"` }] };
    },
  });

  // pty_list tool
  pi.registerTool({
    name: "pty_list",
    description: "List all PTY sessions.",
    parameters: Type.Object({
      cleanup: Type.Optional(Type.Boolean({ description: 'Remove exited/killed sessions from the list (default: false)' }))
    }),
    async execute(toolCallId: string, args: any) {
      if (args.cleanup) {
        const currentSessions = manager.list();
        for (const s of currentSessions) {
          if (s.status === 'exited' || s.status === 'killed') {
            manager.kill(s.id, true);
          }
        }
      }

      const sessions = manager.list();
      if (sessions.length === 0) return { content: [{ type: "text", text: '<pty_list>\nNo active PTY sessions.\n</pty_list>' }] };

      const lines = ['<pty_list>', ...sessions.flatMap(s => formatSessionInfo(s)), `Total: ${sessions.length}`, '</pty_list>'];
      
      const serializableSessions = sessions.map(s => ({
        id: s.id,
        title: s.title,
        command: s.command,
        args: s.args,
        workdir: s.workdir,
        pid: s.pid,
        status: s.status,
        exitCode: s.exitCode,
        createdAt: s.createdAt,
        lineCount: s.lineCount,
        durationMs: s.durationMs
      }));

      return { content: [{ type: "text", text: lines.join('\n') }], details: serializableSessions };
    },
  });

  // pty_kill tool
  pi.registerTool({
    name: "pty_kill",
    description: "Terminate a PTY and optionally cleanup buffer.",
    parameters: Type.Object({
      id: Type.String({ description: 'PTY session ID' }),
      cleanup: Type.Optional(Type.Boolean({ description: 'Delete session and logs (default: false)' })),
    }),
    async execute(toolCallId: string, args: any) {
      const session = manager.get(args.id);
      if (!session) throw new Error(`PTY session '${args.id}' not found.`);
      if (!manager.kill(args.id, args.cleanup)) throw new Error(`Failed to kill ${args.id}.`);
      return { content: [{ type: "text", text: `<pty_killed id="${args.id}" cleanup="${args.cleanup}" />` }] };
    },
  });

  // pty_help tool// pty_help tool
  pi.registerTool({
    name: "pty_help",
    description: "Get the comprehensive strategy guide for managing PTY sessions.",
    parameters: Type.Object({}),
    async execute(toolCallId: string) {
      const manual = [
        `<pty_manual>`,
        `### STRATEGY: ASYNC-FIRST`,
        `- NEVER POLL: Do not loop sleep + pty_read. Wait for <pty_exited> or <pty_match>.`,
        `- PROMPTS: If a process stalls without newline, it might be waiting for input (pty_write).`,
        ``,
        `### STRATEGY: DATA EXPLORATION`,
        `- HEAD/TAIL: Use offset=0 for start, offset=-100 for tail.`,
        `- FILTER: Massive logs? Use pty_read(pattern='...') to find needles in haystacks.`,
        `- COLORS: Output look messy? Use stripAnsi=true (default) in pty_read. Want colors? Set to false.`,
        ``,
        `### STRATEGY: ROBUST INPUT`,
        `- BASE64: For binary or complex scripts, use pty_write(isBase64=true).`,
        `- NEWLINE: Use newline=true to append \\n to your data. Smart: won't double-newline.`,
        `- SIGNALS: Use pty_write(id='...', data='\\x03') for Ctrl+C. On Windows, use pty_kill(id='...') for reliable termination.`,
        `- UNICODE: Full UTF-8 support is enabled by default.`,
      ];

      if (process.platform === 'win32') {
        manual.push(
          ``,
          `### LIMITATIONS: WINDOWS`,
          `- INPUT: 'set /p' or some password prompts may NOT capture pty_write. Avoid interactive prompt scripts.`,
          `- CTRL+C: On Windows, pty_write \\x03 may not work. Use pty_kill(id='...') for reliable termination.`,
        );
      }

      manual.push(`</pty_manual>`);
      return { content: [{ type: 'text', text: manual.join('\n') }] };
    }
  });

  // Set flag before clearing to prevent pending callbacks from running
  pi.on('agent_end', () => {
    managerCleared = true;
    manager.clearAll();
  });
}
