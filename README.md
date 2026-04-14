# pi-pty

Interactive PTY (Pseudo-Terminal) management extension for [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

Ported from [opencode-pty](https://github.com/shekohex/opencode-pty), now powered by [zigpty](https://github.com/pithings/zigpty) — a lightweight PTY library ~350× smaller than `node-pty`, with no native build tools required.

## Features

- **Background execution** — spawn long-running processes (dev servers, repls, tail -f) without blocking the agent
- **Interactive input** — send keystrokes, escape sequences, and control characters (`\x03` = Ctrl+C, `\x04` = Ctrl+D)
- **Output buffering** — ring buffer with regex filtering, ANSI stripping, and pagination
- **Exit notifications** — optional `<pty_exited>` messages with exit code, last line, and error hints
- **Pattern watching** — async watch for specific output patterns with `pty_watch`
- **Lightweight** — `zigpty` has zero native dependencies, no `node-gyp`, no Python/C++ toolchain

## Installation

### Prerequisites

- [pi-coding-agent](https://github.com/badlogic/pi-mono) installed (`npm install -g @mariozechner/pi-coding-agent`)
- `npm` (for dependency installation)

### Option 1: Install as a pi package (recommended)

Install globally for all projects:

```bash
pi install git:github.com/zx9597446/pi-pty
```

Or project-local (written to `.pi/settings.json`, shareable with team):

```bash
pi install git:github.com/zx9597446/pi-pty -l
```

Pin to a specific tag or commit:

```bash
pi install git:github.com/zx9597446/pi-pty@v1.0.0
```

> **What happens:** pi clones the repo, runs `npm install` for dependencies, and auto-discovers the extension from the `extensions/` directory. Run `/reload` in pi to activate.

### Option 2: Project-local from source

```bash
# Clone into the project extension directory
git clone https://github.com/zx9597446/pi-pty .pi/extensions/pi-pty

# Install dependencies (zigpty, typebox)
cd .pi/extensions/pi-pty && npm install

# Optional: build to JS (pi can also load .ts directly via jiti)
npm run build
```

### Option 3: Quick try (no install)

```bash
pi -e git:github.com/zx9597446/pi-pty
```

This installs to a temp directory for the current session only.

### Update / Remove

```bash
pi update                        # update all non-pinned packages
pi update git:github.com/zx9597446/pi-pty   # update specific package
pi remove git:github.com/zx9597446/pi-pty   # remove
```

## Tools

| Tool | Description |
|------|-------------|
| `pty_spawn` | Spawn a new PTY session (background process) |
| `pty_write` | Write input/keystrokes to a session's stdin |
| `pty_read` | Read output buffer with pagination and regex filtering |
| `pty_list` | List all active and exited PTY sessions |
| `pty_kill` | Terminate a session, optionally clean up buffer |
| `pty_watch` | Async watch for a regex pattern in session output |

### `pty_spawn`

Spawn a new PTY session.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `command` | string | ✓ | — | Executable to run |
| `args` | string[] | | `[]` | Command arguments |
| `workdir` | string | | `cwd` | Working directory |
| `env` | Record<string,string> | | — | Extra env vars (merged with `process.env`) |
| `title` | string | | auto-generated | Human-readable session title |
| `description` | string | ✓ | — | 5–10 word description of what the session is for |
| `notifyOnExit` | boolean | | `false` | Send `<pty_exited>` message when process exits |

### `pty_write`

Write data to a session's stdin. Supports escape sequences:

| Sequence | Meaning |
|----------|---------|
| `\n` | newline |
| `\r` | carriage return |
| `\t` | tab |
| `\\` | literal backslash |
| `\xNN` | hex byte (e.g. `\x03` = Ctrl+C, `\x04` = Ctrl+D) |
| `\uNNNN` | unicode (e.g. `\u4e2d` = 中) |

### `pty_read`

Read the session output buffer.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `offset` | number | `0` | Start line (0-based) |
| `limit` | number | `500` | Max lines to read |
| `pattern` | string | — | Regex to filter lines |
| `ignoreCase` | boolean | `false` | Case-insensitive pattern matching |
| `stripAnsi` | boolean | `true` | Strip ANSI escape sequences from output |

### `pty_watch`

Watch a session for a regex pattern. Fires `<pty_match>` asynchronously when found (single-shot — removed after first match).

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Session ID |
| `pattern` | string | Regex to watch for |
| `ignoreCase` | boolean | Case-insensitive matching |

### `pty_kill`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `id` | string | — | Session ID |
| `cleanup` | boolean | `false` | If true, remove session and free buffer |

## Example Workflow

**User:** "Start the dev server and tell me when it's ready."

1. Agent calls `pty_spawn(command: "npm", args: ["run", "dev"], notifyOnExit: true)` → `ID: pty_a1b2c3d4`
2. Agent calls `pty_read(id: "pty_a1b2c3d4")` periodically to check logs
3. Server crashes → agent receives `<pty_exited>` with non-zero exit code
4. Agent calls `pty_kill(id: "pty_a1b2c3d4", cleanup: true)` when done

**User:** "Run a Python REPL and execute some code."

1. Agent calls `pty_spawn(command: "python")` → `ID: pty_12345678`
2. Agent calls `pty_write(id: "pty_12345678", data: "print('hello')\n")`
3. Agent calls `pty_read(id: "pty_12345678")` to get output
4. Agent calls `pty_write(id: "pty_12345678", data: "\x04")` to send Ctrl+D and exit

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PTY_MAX_BUFFER_SIZE` | `1000000` (~1MB) | Max output buffer size in characters. Oldest content is trimmed when exceeded. |

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
│       ├── formatters.ts # stripAnsi, formatLine, formatSessionInfo
│       ├── permissions.ts # Command and workdir permission checks
│       └── types.ts      # TypeScript type definitions
├── test/                 # 291 tests across 18 test files
└── package.json
```

### Dependencies

| Package | Purpose |
|---------|---------|
| [`zigpty`](https://github.com/pithings/zigpty) | Lightweight PTY process spawning (replaces `node-pty`) |
| [`@sinclair/typebox`](https://github.com/sinclairzx81/typebox) | JSON Schema builder for tool parameter validation |

### Inherited from opencode-pty

The original architecture (RingBuffer, SessionLifecycleManager, OutputManager, escape sequence parsing, permission checks) is ported from [opencode-pty](https://github.com/shekohex/opencode-pty). Key differences:

- **`node-pty` → `zigpty`**: No native compilation, smaller footprint
- **Full pi extension API**: `notifyOnExit`, `pty_watch`, `<pty_exited>` / `<pty_match>` messages
- **Comprehensive test suite**: 291 tests covering unit, integration, and real PTY processes

## License

ISC
