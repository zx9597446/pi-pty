import { Type } from '@sinclair/typebox';
import { manager } from './pty/manager.js';
import { formatLine, formatSessionInfo, stripAnsi } from './pty/formatters.js';
import { checkCommandPermission, checkWorkdirPermission } from './pty/permissions.js';
import { parseEscapeSequences, ETX, EOT } from './pty/escape.js';

const NOTIFY_ON_EXIT_INSTRUCTIONS = [
  `<system_reminder>`,
  `- ASYNC MODE: Wait for \`<pty_exited>\` message for completion.`,
  `- DO NOT POLL: Never use sleep + \`pty_read\` loops to check status.`,
  `- FOR PATTERNS: Use \`pty_watch\` to wait for specific output (e.g., "Ready", "Error").`,
  `- USE PTY_READ ONLY IF: You need immediate logs, user asks, or exit code is non-zero.`,
  `</system_reminder>`,
].join('\n');

const NOTIFY_ON_EXIT_REMINDER = [
  `<system_reminder>`,
  `- Reminder: This session has \`notifyOnExit=true\`. Wait for \`<pty_exited>\`.`,
  `- Stop Polling: Use \`pty_watch\` for pattern matching or wait for the exit signal.`,
  `</system_reminder>`,
].join('\n');

export default function (pi: any) {
  // pty_spawn tool
  pi.registerTool({
    name: "pty_spawn",
    description: "Create a new PTY session to run a command in the background.",
    parameters: Type.Object({
      command: Type.String({ description: 'The command/executable to run' }),
      args: Type.Array(Type.String(), { description: 'Arguments to pass to the command', default: [] }),
      workdir: Type.Optional(Type.String({ description: 'Working directory for the PTY session' })),
      env: Type.Optional(Type.Record(Type.String(), Type.String(), { description: 'Additional environment variables' })),
      title: Type.Optional(Type.String({ description: 'Human-readable title for the session' })),
      description: Type.String({ description: 'Clear, concise description of what this PTY session is for in 5-10 words' }),
      notifyOnExit: Type.Optional(Type.Boolean({ description: 'If true, sends a notification to the session when the process exits (default: false)' })),
    }),
    async execute(toolCallId: string, args: any, ctx: any) {
      checkCommandPermission(args.command, args.args ?? []);
      if (args.workdir) {
        checkWorkdirPermission(args.workdir);
      }

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
        (data) => {
          // Live output handling can be added here if needed for Web UI
        },
        async (exitCode) => {
          try {
            if (args.notifyOnExit) {
              const readResult = manager.read(info.id);
              const totalLines = readResult?.totalLines ?? 0;
              const lastLineResult = totalLines > 0
                ? manager.read(info.id, totalLines - 1, 1)
                : null;
              const lastLine = lastLineResult?.lines[0]?.slice(0, 250) ?? '(no output)';
              const errorHint = exitCode !== 0
                ? `\n<system_reminder>\n- INVESTIGATE: Non-zero exit detected. Use \`pty_read\` with \`pattern='Error|error|ERR'\` to find root cause.\n</system_reminder>`
                : '';              const message = [
                `<pty_exited>`,
                `ID: ${info.id}`,
                `Title: ${info.title}`,
                `Command: ${info.command} ${info.args.join(' ')}`,
                `Exit Code: ${exitCode}`,
                `Lines: ${totalLines}`,
                `Last line: ${lastLine}`,
                `</pty_exited>${errorHint}`,
              ].join('\n');
              await pi.sendMessage({
                  role: 'assistant',
                  content: [{ type: 'text', text: message }]
              });
            }
          } catch (err) {
            console.error(`Error in pty ${info.id} onExit callback:`, err);
            try {
              await pi.sendMessage({
                role: 'assistant',
                content: [{ type: 'text', text: `<pty_error id="${info.id}">Failed to send exit notification: ${err instanceof Error ? err.message : String(err)}</pty_error>` }]
              });
            } catch (innerErr) {
              console.error('Fatal error in pty error handler:', innerErr);
            }
          }
        }
      );

      const output = [
        `<pty_spawned>`,
        `ID: ${info.id}`,
        `Title: ${info.title}`,
        `Command: ${info.command} ${info.args.join(' ')}`,
        `Workdir: ${info.workdir}`,
        `PID: ${info.pid}`,
        `Status: ${info.status}`,
        `NotifyOnExit: ${info.notifyOnExit}`,
        `</pty_spawned>`,
        '',
        NOTIFY_ON_EXIT_INSTRUCTIONS,
      ].join('\n');

      return {
        content: [{ type: "text", text: output }],
        details: info
      };
    },
  });

  // pty_write tool
  pi.registerTool({
    name: "pty_write",
    description: "Write data (input) to an active PTY session.",
    parameters: Type.Object({
      id: Type.String({ description: 'The PTY session ID (e.g., pty_a1b2c3d4)' }),
      data: Type.String({ description: 'The input data to send to the PTY' }),
    }),
    async execute(toolCallId: string, args: any) {
      const session = manager.get(args.id);
      if (!session) {
        throw new Error(`PTY session '${args.id}' not found.`);
      }

      if (session.status !== 'running') {
        throw new Error(`Cannot write to PTY '${args.id}' - session status is '${session.status}'.`);
      }

      const parsedData = parseEscapeSequences(args.data);
      const success = manager.write(args.id, parsedData);
      if (!success) {
        throw new Error(`Failed to write to PTY '${args.id}'.`);
      }

      const preview = args.data.length > 50 ? `${args.data.slice(0, 50)}...` : args.data;
      const displayPreview = preview
        .replace(new RegExp(ETX, 'g'), '^C')
        .replace(new RegExp(EOT, 'g'), '^D')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
      
      return {
        content: [{ type: "text", text: `Sent ${args.data.length} bytes to ${args.id}: "${displayPreview}"` }],
        details: { bytesSent: args.data.length, preview: displayPreview }
      };
    },
  });

  // pty_read tool
  pi.registerTool({
    name: "pty_read",
    description: "Read the output buffer of a PTY session with optional regex filtering and pagination.",
    parameters: Type.Object({
      id: Type.String({ description: 'The PTY session ID (e.g., pty_a1b2c3d4)' }),
      offset: Type.Optional(Type.Number({ description: 'Line number to start reading from (0-based, defaults to 0).' })),
      limit: Type.Optional(Type.Number({ description: 'Number of lines to read (defaults to 500).' })),
      pattern: Type.Optional(Type.String({ description: 'Regex pattern to filter lines.' })),
      ignoreCase: Type.Optional(Type.Boolean({ description: 'Case-insensitive pattern matching (default: false)' })),
      stripAnsi: Type.Optional(Type.Boolean({ description: 'If true, strips ANSI escape sequences from output (default: true)', default: true })),
    }),
    async execute(toolCallId: string, args: any) {
      const session = manager.get(args.id);
      if (!session) {
        throw new Error(`PTY session '${args.id}' not found.`);
      }

      const offset = args.offset ?? 0;
      const limit = args.limit ?? 500;
      const doStrip = args.stripAnsi ?? true;

      let result;
      if (args.pattern) {
        const regex = new RegExp(args.pattern, args.ignoreCase ? 'i' : '');
        result = manager.search(args.id, regex, offset, limit);
      } else {
        result = manager.read(args.id, offset, limit);
      }

      if (!result) {
        throw new Error(`Failed to read from PTY session '${args.id}'.`);
      }

      let outputLines = [];
      if ('matches' in result) {
        // Search result
        if (result.matches.length === 0) {
          outputLines = [
            `<pty_output id="${args.id}" status="${session.status}" pattern="${args.pattern}">`,
            `No lines matched the pattern '${args.pattern}'.`,
            `Total lines in buffer: ${result.totalLines}`,
            `</pty_output>`,
            '',
            `<system_reminder>`,
            `If you expect this pattern to appear in future output, use \`pty_watch\` to be notified automatically when it arrives.`,
            `</system_reminder>`,
          ];
        } else {
          const formattedLines = result.matches.map(m => {
            const text = doStrip ? stripAnsi(m.text) : m.text;
            return formatLine(text, m.lineNumber);
          });
          const pagination = result.hasMore ? `(${result.matches.length} of ${result.totalMatches} matches shown. Use offset=${offset + result.matches.length} to see more.)` : `(${result.totalMatches} matches from ${result.totalLines} total lines)`;
          outputLines = [
            `<pty_output id="${args.id}" status="${session.status}" pattern="${args.pattern}">`,
            ...formattedLines,
            '',
            pagination,
            `</pty_output>`,
          ];
        }
      } else {
        // Read result
        if (result.lines.length === 0) {
          outputLines = [
            `<pty_output id="${args.id}" status="${session.status}">`,
            `(No output available - buffer is empty)`,
            `Total lines: ${result.totalLines}`,
            `</pty_output>`,
          ];
        } else {
          const formattedLines = result.lines.map((line, index) => {
             const text = doStrip ? stripAnsi(line) : line;
             return formatLine(text, result.offset + index + 1);
          });
          const pagination = result.hasMore ? `(Buffer has more lines. Use offset=${result.offset + result.lines.length} to read beyond line ${result.offset + result.lines.length})` : `(End of buffer - total ${result.totalLines} lines)`;
          outputLines = [
            `<pty_output id="${args.id}" status="${session.status}">`,
            ...formattedLines,
            '',
            pagination,
            `</pty_output>`,
          ];
        }
      }

      let outputText = outputLines.join('\n');
      if (session.notifyOnExit && session.status === 'running') {
        outputText += `\n\n${NOTIFY_ON_EXIT_REMINDER}`;
      }

      return {
        content: [{ type: "text", text: outputText }],
        details: result
      };
    },
  });

  // pty_watch tool
  pi.registerTool({
    name: "pty_watch",
    description: "Watch a PTY session for a specific pattern and notify the agent asynchronously when found.",
    parameters: Type.Object({
      id: Type.String({ description: 'The PTY session ID to watch' }),
      pattern: Type.String({ description: 'Regex pattern to look for' }),
      ignoreCase: Type.Optional(Type.Boolean({ description: 'Case-insensitive matching (default: false)' })),
      persistent: Type.Optional(Type.Boolean({ description: 'If true, the watcher remains active after a match (default: false)' })),
    }),
    async execute(toolCallId: string, args: any) {
      const session = manager.get(args.id);
      if (!session) {
        throw new Error(`PTY session '${args.id}' not found.`);
      }

      if (session.status !== 'running') {
        throw new Error(`Cannot watch PTY '${args.id}' - session status is '${session.status}'.`);
      }

      const regex = new RegExp(args.pattern, args.ignoreCase ? 'i' : '');
      
      manager.addWatcher(args.id, regex, async (matchData) => {
        const cleanMatch = stripAnsi(matchData);
        const message = [
          `<pty_match id="${args.id}" pattern="${args.pattern}">`,
          `Found matching output: "${cleanMatch.trim()}"`,
          `</pty_match>`,
        ].join('\n');
        
        await pi.sendMessage({
            role: 'assistant',
            content: [{ type: 'text', text: message }]
        });
      }, args.persistent);

      const mode = args.persistent ? 'persistent ' : '';
      return {
        content: [{ type: "text", text: `Started watching ${mode}session ${args.id} for pattern: "${args.pattern}"` }],
        details: { id: args.id, pattern: args.pattern, persistent: !!args.persistent }
      };
    },
  });

  // pty_list tool
  pi.registerTool({
    name: "pty_list",
    description: "List all active and inactive PTY sessions.",
    parameters: Type.Object({}),
    async execute() {
      const sessions = manager.list();
      if (sessions.length === 0) {
        return {
          content: [{ type: "text", text: '<pty_list>\nNo active PTY sessions.\n</pty_list>' }],
          details: []
        };
      }

      const lines = ['<pty_list>'];
      for (const session of sessions) {
        lines.push(...formatSessionInfo(session));
      }
      lines.push(`Total: ${sessions.length} session(s)`);
      lines.push('</pty_list>');

      return {
        content: [{ type: "text", text: lines.join('\n') }],
        details: sessions
      };
    },
  });

  // pty_kill tool
  pi.registerTool({
    name: "pty_kill",
    description: "Terminate a PTY session and optionally clean up its buffer.",
    parameters: Type.Object({
      id: Type.String({ description: 'The PTY session ID (e.g., pty_a1b2c3d4)' }),
      cleanup: Type.Optional(Type.Boolean({ description: 'If true, removes the session and frees the buffer (default: false)', default: false })),
    }),
    async execute(toolCallId: string, args: any) {
      const session = manager.get(args.id);
      if (!session) {
        throw new Error(`PTY session '${args.id}' not found.`);
      }

      const wasRunning = session.status === 'running';
      const cleanup = args.cleanup ?? false;
      const success = manager.kill(args.id, cleanup);

      if (!success) {
        throw new Error(`Failed to kill PTY session '${args.id}'.`);
      }

      const action = wasRunning ? 'Killed' : 'Cleaned up';
      const cleanupNote = cleanup ? ' (session removed)' : ' (session retained for log access)';

      const output = [
        `<pty_killed>`,
        `${action}: ${args.id}${cleanupNote}`,
        `Title: ${session.title}`,
        `Command: ${session.command} ${session.args.join(' ')}`,
        `Final line count: ${session.lineCount}`,
        `</pty_killed>`,
      ].join('\n');

      return {
        content: [{ type: "text", text: output }],
        details: { id: args.id, action, cleanup }
      };
    },
  });

  // Cleanup all sessions on agent exit
  pi.on('agent_end', () => {
    manager.clearAll();
  });
}
