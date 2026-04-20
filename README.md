# pi-pty

Interactive PTY (Pseudo-Terminal) management extension for [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

Ported from [opencode-pty](https://github.com/shekohex/opencode-pty), now powered by [zigpty](https://github.com/pithings/zigpty) — a lightweight PTY library ~350× smaller than `node-pty`, with no native build tools required.

## Features

- **Background execution** — spawn long-running processes (dev servers, repls, tail -f) without blocking the agent
- **Interactive input** — send keystrokes, escape sequences, and control characters (`\x03` = Ctrl+C, `\x04` = Ctrl+D)
- **Output buffering** — ring buffer with regex filtering, ANSI stripping, and pagination
- **Exit notifications** — automatic `<pty_exited>` messages with exit code, last line, and error hints
- **Pattern watching** — async watch for specific output patterns with `pty_watch` (supports throttling for persistent alerts)
- **Lightweight** — `zigpty` has zero native dependencies, no `node-gyp`, no Python/C++ toolchain

## Installation

### Prerequisites

- [pi-coding-agent](https://github.com/badlogic/pi-mono) installed (`npm install -g @mariozechner/pi-coding-agent`)
- `npm` (for dependency installation)

Install globally for all projects:

```bash
pi install git:github.com/zx9597446/pi-pty
```

## Tools

| Tool          | Description                                            |
| ------------- | ------------------------------------------------------ |
| `pty_spawn`   | Spawn a new PTY session (background process)           |
| `pty_write`   | Write input/keystrokes to a session's stdin            |
| `pty_read`    | Read output buffer with pagination and regex filtering |
| `pty_search` | Search buffer for regex pattern with match pagination |
| `pty_list`    | List all active and exited PTY sessions                |
| `pty_kill`    | Terminate a session, optionally clean up buffer        |

| `pty_watch`   | Async watch for a regex pattern in session output      |
| `pty_help`    | Get the strategy guide for managing PTY sessions       |

### `pty_spawn`

Spawn a new PTY session.

| Parameter      | Type                  | Required | Default        | Description                                      |
| -------------- | --------------------- | -------- | -------------- | ------------------------------------------------ |
| `command`      | string                | ✓        | —              | Executable to run                                |
| `args`         | string[]              |          | `[]`           | Command arguments                                |
| `workdir`      | string                |          | `cwd`          | Working directory                                |
| `env`          | Record<string,string> |          | —              | Extra env vars (merged with `process.env`)       |
| `title`        | string                |          | auto-generated | Human-readable session title                     |
| `description`  | string                | ✓        | —              | 5–10 word description (shown in `pty_list`)        |
| `notifyOnExit` | boolean               |          | `true`         | Send `<pty_exited>` message when process exits   |

### `pty_write`

Write data to a session's stdin. Supports escape sequences and base64 encoding.

| Parameter  | Type    | Default | Description                                   |
| ---------- | ------- | ------- | --------------------------------------------- |
| `id`       | string  | —       | Session ID                                    |
| `data`     | string  | —       | Data to send                                  |
| `isBase64` | boolean | `false` | If true, data is treated as base64 encoded    |

Supported escape sequences:

| Sequence | Meaning                                          |
| -------- | ------------------------------------------------ |
| `\n`     | newline                                          |
| `\r`     | carriage return                                  |
| `\t`     | tab                                              |
| `\\`     | literal backslash                                |
| `\xNN`   | hex byte (e.g. `\x03` = Ctrl+C, `\x04` = Ctrl+D) |
| `\uNNNN` | unicode (e.g. `\u4e2d` = 中)                     |

### `pty_read`

Read the session output buffer.

| Parameter    | Type    | Default | Description                             |
| ------------ | ------- | ------- | --------------------------------------- |
| `offset`     | number  | `0`     | Start line (0-based)                    |
| `limit`      | number  | `500`   | Max lines to read                       |
| `pattern`    | string  | —       | Regex to filter lines                   |
| `ignoreCase` | boolean | `false` | Case-insensitive pattern matching       |
| `stripAnsi`  | boolean | `true`  | Strip ANSI escape sequences from output |
| `skipEmpty`  | boolean | `false` | Skip empty/whitespace-only lines        |

### `pty_list`

List all active and exited PTY sessions.

| Parameter | Type    | Default | Description                                         |
| --------- | ------- | ------- | --------------------------------------------------- |
| `cleanup` | boolean | `false` | Remove exited/killed sessions from the list         |

### `pty_watch`

Watch a session for a regex pattern. Fires `<pty_match>` asynchronously when found.

| Parameter    | Type    | Default | Description                                                                |
| ------------ | ------- | ------- | -------------------------------------------------------------------------- |
| `id`         | string  | —       | Session ID                                                                 |
| `pattern`    | string  | —       | Regex to watch for                                                         |
| `ignoreCase` | boolean | `false` | Case-insensitive matching                                                  |
| `persistent` | boolean | `false` | If true, remains active after a match.                                     |
| `throttleMs` | number  | `5000`  | For persistent watchers, min time between notifications (includes a count). |


Get the strategy guide for managing PTY sessions. No parameters required.

### `pty_kill`

| Parameter | Type    | Default | Description                             |
| --------- | ------- | ------- | --------------------------------------- |
| `id`      | string  | —       | Session ID                              |
| `cleanup` | boolean | `false` | If true, remove session and free buffer |

### Signals

To send **Ctrl+C** (interrupt), write the `\x03` escape sequence:

```
pty_write(id="...", data="\x03")
```

On **Windows**, `\x03` may not reliably stop processes. Use `pty_kill` instead:

```
pty_kill(id="...", cleanup=false)
```

For **graceful or forced termination** on all platforms, use `pty_kill`.

### `pty_search`

Search the buffer for a regex pattern with match-based pagination.

| Parameter    | Type    | Default | Description                                        |
| ------------ | ------- | ------- | -------------------------------------------------- |
| `id`         | string  | —       | Session ID                                         |
| `pattern`    | string  | —       | Regex pattern to search for                        |
| `offset`     | number  | `0`     | Starting match index (0-based)                     |
| `limit`      | number  | `100`   | Max matches to return                               |
| `ignoreCase` | boolean | `true`  | Case-insensitive matching                           |
| `stripAnsi`  | boolean | `true`  | Strip ANSI escape sequences from output             |

## Example Workflow

**User:** "Start the dev server and tell me when it's ready."

1. Agent calls `pty_spawn(command: "npm", args: ["run", "dev"])` → `ID: pty_a1b2c3d4`
2. Agent calls `pty_watch(id: "pty_a1b2c3d4", pattern: "ready on port")`
3. Server ready → agent receives `<pty_match>` notification
4. Server crashes → agent receives `<pty_exited>` with non-zero exit code
5. Agent calls `pty_kill(id: "pty_a1b2c3d4", cleanup: true)` when done

**User:** "Run a Python REPL and execute some code."

1. Agent calls `pty_spawn(command: "python")` → `ID: pty_12345678`
2. Agent calls `pty_write(id: "pty_12345678", data: "print('hello')\n")`
3. Agent calls `pty_read(id: "pty_12345678")` to get output
4. Agent calls `pty_write(id: "pty_12345678", data: "\x04")` to send Ctrl+D and exit

## Environment Variables

| Variable              | Default          | Description                                                                    |
| --------------------- | ---------------- | ------------------------------------------------------------------------------ |
| `PTY_MAX_BUFFER_SIZE` | `1000000` (~1MB) | Max output buffer size in characters. Oldest content is trimmed when exceeded. |

## Known Limitations

### Windows-Specific

- **Interactive Input**: Some commands requiring direct TTY interaction (e.g., `set /p var=` in batch scripts) may not capture input reliably via ConPTY.
- **Ctrl+C**: On Windows, sending `\x03` (Ctrl+C) via `pty_write` may not reliably terminate processes. Use `pty_kill` for reliable termination.
- **Shell Selection**: On Windows, the extension uses `cmd.exe` by default through zigpty. Commands may behave differently across shells (cmd/powershell/git-bash).

### Cross-Platform

- **Buffer Limits**: Large output streams are trimmed to prevent memory issues. Use `pattern` filtering in `pty_read` to find specific content.
- **Timing**: Output may be delayed for very fast commands. For critical synchronization, use `pty_watch` instead of polling.

## Architecture

```
pi-pty/
├── src/
│   ├── index.ts          # Extension entry point (registers 6 tools)
│   └── pty/
│       ├── manager.ts    # PTYManager — orchestrates lifecycle + output + watchers
│       ├── lifecycle.ts  # SessionLifecycleManager — spawn/kill/process management
│       ├── buffer.ts     # RingBuffer — append/read/search/overflow
│       ├── output.ts     # OutputManager — read/write/search abstraction
│       ├── escape.ts     # Escape sequence parser (\n \r \t \xNN \uNNNN)
│       ├── formatters.ts # stripAnsi, formatLine, formatSessionInfo, formatCommand
│       ├── permissions.ts # Command and workdir permission checks
│       └── types.ts      # TypeScript type definitions
├── test/                 # 317+ tests covering unit, integration, and real processes
└── package.json
```

### Dependencies

| Package                                                        | Purpose                                                |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| [`zigpty`](https://github.com/pithings/zigpty)                 | Lightweight PTY process spawning (replaces `node-pty`) |
| [`@sinclair/typebox`](https://github.com/sinclairzx81/typebox) | JSON Schema builder for tool parameter validation      |

### Inherited from opencode-pty

The original architecture (RingBuffer, SessionLifecycleManager, OutputManager, escape sequence parsing, permission checks) is ported from [opencode-pty](https://github.com/shekohex/opencode-pty). Key differences:

- **`node-pty` → `zigpty`**: No native compilation, smaller footprint
- **Full pi extension API**: `notifyOnExit`, `pty_watch`, `<pty_exited>` / `<pty_match>` messages
- **Throttled Watchers**: Persistent patterns now support `throttleMs` and match counts
- **Comprehensive test suite**: 317+ tests covering unit, integration, and real PTY processes

## License

MIT
