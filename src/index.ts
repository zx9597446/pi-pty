import { Type } from '@sinclair/typebox';
import { manager } from './pty/manager.js';
import { formatCommand, formatLine, formatSessionInfo, stripAnsi } from './pty/formatters.js';
import { checkCommandPermission, checkWorkdirPermission } from './pty/permissions.js';
import { parseEscapeSequences, ETX, EOT } from './pty/escape.js';
import type { PTYSessionInfo, ReadResult, SearchResult } from './pty/types.js';

/**
 * Common navigation hints for different PTY states.
 * Standardized to help the LLM navigate without additional prompt overhead.
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
    `- TAIL: Use \`offset=${Math.max(0, total - 100)}\` to read the most recent 100 lines.`,
    `- SEARCH: Use \`pattern='...'\` to filter these ${total} lines for keywords.`,
    `- PROMPT: If the last line ends with '?' or ':', the process might be waiting for input via \`pty_write\`.`,
    `</system_reminder>`,
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
    `- UNWATCH: Use \`pty_unwatch(pattern='${pattern}')\` to stop notifications.`,
    `</system_reminder>`,
  ].join('\n')
};

function isSearchResult(result: ReadResult | SearchResult): result is SearchResult {
  return 'matches' in result;
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
  ];
}

function buildDataOutput(openTag: string, result: ReadResult | SearchResult, offset: number, doStrip: boolean): string[] {
  const isSearch = isSearchResult(result);
  const items = isSearch ? result.matches : result.lines.map((line, i) => ({ lineNumber: result.offset + i + 1, text: line }));
  
  const formattedLines = items.map(item => {
    const text = doStrip ? stripAnsi(item.text) : item.text;
    return formatLine(text, item.lineNumber);
  });

  const pagination = isSearch
    ? (result.hasMore 
        ? `(${result.matches.length} of ${result.totalMatches} matches shown.)`
        : `(${result.totalMatches} matches from ${result.totalLines} total lines)`)
    : (result.hasMore
        ? `(Buffer has more lines. Current view ends at line ${result.offset + result.lines.length})`
        : `(End of buffer - total ${result.totalLines} lines)`);

  return [openTag, ...formattedLines, '', pagination, `</pty_output>`];
}

async function handlePtyExit(pi: any, info: PTYSessionInfo, exitCode: number | null, notify: boolean) {
  if (!notify) return;
  
  try {
    // Basic info from manager (fast memory access)
    const currentSession = manager.get(info.id);
    const totalLines = currentSession?.lineCount ?? 0;
    
    // We try to get the last line, but if buffer access is somehow slow, we use a fallback
    let lastLine = '(no output)';
    try {
      const lastLineResult = totalLines > 0 ? manager.read(info.id, totalLines - 1, 1) : null;
      lastLine = lastLineResult?.lines[0]?.slice(0, 250) ?? '(no output)';
    } catch {
      // Fallback if read fails or is too slow
    }
    
    const message = [
      `<pty_exited>`,
      `ID: ${info.id}`,
      `Title: ${info.title}`,
      `Command: ${formatCommand(info.command, info.args)}`,
      `Exit Code: ${exitCode}`,
      `Duration: ${info.durationMs ?? 'unknown'}ms`,
      `Lines: ${totalLines}`,
      `Last line: ${stripAnsi(lastLine).trim()}`,
      `</pty_exited>`,
      HINTS.EXIT(exitCode)
    ].join('\n');

    // Fire and forget, or at least don't let it hang the whole process
    setTimeout(async () => {
      try {
        if (typeof pi?.sendMessage === 'function') {
          await pi.sendMessage({
            role: 'assistant',
            content: [{ type: 'text', text: message }]
          });
        }
      } catch (err) {
        console.error(`Failed to send exit message for ${info.id}:`, err);
      }
    }, 50);
  } catch (err) {
    console.error(`Error in pty ${info.id} onExit callback:`, err);
  }
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
    }),
    async execute(toolCallId: string, args: any, ctx: any) {
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
        },
        () => {},
        (exitCode) => {
          // Defer to next tick to ensure 'info' is assigned and current tool execution finishes
          setImmediate(() => {
            handlePtyExit(pi, manager.get(info.id) || info, exitCode, !!info.notifyOnExit);
          });
        }
      );

      // Check if process exited immediately (sync check)
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
        isInstantExit ? HINTS.EXIT(currentStatus.exitCode) : HINTS.SPAWN,
      ].filter(Boolean).join('\n');

      // Return only serializable fields in details
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
        durationMs: info.durationMs
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
    description: "Write data to PTY stdin. Supports base64 for complex scripts/binary.",
    parameters: Type.Object({
      id: Type.String({ description: 'PTY session ID' }),
      data: Type.String({ description: 'Data to send' }),
      isBase64: Type.Optional(Type.Boolean({ description: 'If true, data is treated as base64 encoded string', default: false })),
    }),
    async execute(toolCallId: string, args: any) {
      const session = manager.get(args.id);
      if (!session) throw new Error(`PTY session '${args.id}' not found.`);
      if (session.status !== 'running') throw new Error(`Cannot write to PTY '${args.id}' (${session.status}).`);

      let rawData = args.isBase64 ? Buffer.from(args.data, 'base64').toString() : args.data;
      const parsedData = parseEscapeSequences(rawData);
      
      const success = manager.write(args.id, parsedData);
      if (!success) throw new Error(`Failed to write to PTY '${args.id}'.`);

      const preview = rawData.length > 50 ? `${rawData.slice(0, 50)}...` : rawData;
      const displayPreview = preview
        .replace(new RegExp(ETX, 'g'), '^C')
        .replace(new RegExp(EOT, 'g'), '^D')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
      
      return {
        content: [{ type: "text", text: `Sent ${rawData.length} bytes to ${args.id}: "${displayPreview}"` }],
        details: { bytesSent: rawData.length }
      };
    },
  });

  // pty_read tool
  pi.registerTool({
    name: "pty_read",
    description: "Read PTY buffer with regex filtering and pagination.",
    parameters: Type.Object({
      id: Type.String({ description: 'PTY session ID' }),
      offset: Type.Optional(Type.Number({ description: 'Starting line (0-based)' })),
      limit: Type.Optional(Type.Number({ description: 'Max lines to read (default: 500)' })),
      pattern: Type.Optional(Type.String({ description: 'Regex filter' })),
      ignoreCase: Type.Optional(Type.Boolean({ description: 'Default: false' })),
      stripAnsi: Type.Optional(Type.Boolean({ description: 'Default: true', default: true })),
    }),
    async execute(toolCallId: string, args: any) {
      const session = manager.get(args.id);
      if (!session) throw new Error(`PTY session '${args.id}' not found.`);

      const offset = args.offset ?? 0;
      const limit = args.limit ?? 500;
      const doStrip = args.stripAnsi ?? true;

      const result = !!args.pattern
        ? manager.search(args.id, new RegExp(args.pattern, args.ignoreCase ? 'i' : ''), offset, limit)
        : manager.read(args.id, offset, limit);

      if (!result) throw new Error(`Failed to read from PTY '${args.id}'.`);

      const openTag = isSearchResult(result)
        ? `<pty_output id="${args.id}" status="${session.status}" pattern="${args.pattern}">`
        : `<pty_output id="${args.id}" status="${session.status}">`;

      const hasData = isSearchResult(result) ? result.matches.length > 0 : result.lines.length > 0;
      const outputLines = hasData 
        ? buildDataOutput(openTag, result, offset, doStrip)
        : buildEmptyOutput(openTag, args.pattern, result);

      let outputText = outputLines.join('\n');
      if (session.status === 'running') {
        const nextOffset = offset + (isSearchResult(result) ? result.matches.length : result.lines.length);
        outputText += `\n\n${HINTS.READ(result.totalLines, nextOffset, limit)}`;
      }

      return { content: [{ type: "text", text: outputText }], details: result };
    },
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
      if (!session || session.status !== 'running') throw new Error(`Active session '${args.id}' not found.`);

      manager.addWatcher(args.id, new RegExp(args.pattern, args.ignoreCase ? 'i' : ''), (matchData, count) => {
        const message = [
          `<pty_match id="${args.id}" pattern="${args.pattern}"${count > 1 ? ` count="${count}"` : ''}>`,
          `Match: "${stripAnsi(matchData).trim()}"`,
          `</pty_match>`,
          HINTS.MATCH(args.pattern)
        ].join('\n');
        
        setImmediate(async () => {
          try {
            await pi.sendMessage({ role: 'assistant', content: [{ type: 'text', text: message }] });
          } catch (err) {
            console.error('Failed to send watch match notification:', err);
          }
        });
      }, args.persistent, args.throttleMs ?? 5000);

      return { content: [{ type: "text", text: `Watching ${args.id} for "${args.pattern}"` }] };
    },
  });

  // pty_unwatch tool
  pi.registerTool({
    name: "pty_unwatch",
    description: "Stop watching a pattern.",
    parameters: Type.Object({
      id: Type.String({ description: 'PTY session ID' }),
      pattern: Type.String({ description: 'Regex used in pty_watch' }),
    }),
    async execute(toolCallId: string, args: any) {
      if (!manager.removeWatcher(args.id, args.pattern)) throw new Error(`Watcher not found.`);
      return { content: [{ type: "text", text: `Stopped watching "${args.pattern}" on ${args.id}` }] };
    },
  });

  // pty_list tool
pi.registerTool({
    name: "pty_list",
    description: "List all PTY sessions.",
    parameters: Type.Object({}),
    async execute() {
      const sessions = manager.list();
      if (sessions.length === 0) return { content: [{ type: "text", text: '<pty_list>\nNo active PTY sessions.\n</pty_list>' }] };

      const lines = ['<pty_list>', ...sessions.flatMap(s => formatSessionInfo(s)), `Total: ${sessions.length}`, '</pty_list>'];
      
      // Clean sessions for serialization
      const serializableSessions = sessions.map(s => ({
        id: s.id,
        title: s.title,
        command: s.command,
        args: s.args,
        workdir: s.workdir,
        pid: s.pid,
        status: s.status,
        exitCode: s.exitCode,
        exitSignal: s.exitSignal,
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

  // pty_help tool
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
        `- HEAD/TAIL: Use offset=0 for start, offset=TOTAL-100 for end.`,
        `- FILTER: Massive logs? Use pty_read(pattern='...') to find needles in haystacks.`,
        ``,
        `### STRATEGY: ROBUST INPUT`,
        `- BASE64: For scripts or complex strings, use pty_write(isBase64=true) to avoid shell escape hell.`,
        `- SIGNALS: Send \x03 for Ctrl+C, \x04 for Ctrl+D.`,
        `</pty_manual>`
      ].join('\n');
      return { content: [{ type: "text", text: manual }] };
    }
  });

  pi.on('agent_end', () => manager.clearAll());
}
