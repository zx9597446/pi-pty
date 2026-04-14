# pi-pty

Interactive PTY (Pseudo-Terminal) management extension for [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

Ported from [opencode-pty](https://github.com/shekohex/opencode-pty), now powered by [zigpty](https://github.com/pithings/zigpty) for a lightweight and zero-dependency experience.

## Features

- **Background Execution**: Spawn long-running processes (like dev servers) without blocking the agent.
- **Interactive Input**: Send keystrokes, escape sequences, and control characters (Ctrl+C, etc.) to PTY sessions.
- **Output Buffering**: Robust internal buffer with regex filtering and pagination support.
- **Exit Notifications**: Optionally receive `<pty_exited>` messages when a process finishes.
- **Lightweight**: Powered by `zigpty`, which is ~350x smaller than `node-pty` and requires no native build tools.

## Installation

1. Create an extensions directory in your project (if it doesn't exist):
   ```bash
   mkdir -p .pi/extensions/
   ```

2. Clone or place this repository into `.pi/extensions/pi-pty`:
   ```bash
   git clone https://github.com/badlogic/pi-pty .pi/extensions/pi-pty
   ```

3. Install dependencies:
   ```bash
   cd .pi/extensions/pi-pty
   npm install
   npm run build
   ```

## Tools Provided

### `pty_spawn`
Spawns a new PTY session.
- `command`: The command to run.
- `args`: Array of arguments.
- `workdir`: Working directory.
- `env`: Additional environment variables (merged with `process.env`).
- `title`: Human-readable title for the session (defaults to `command args`).
- `description`: Clear description of what this session is for (5-10 words).
- `notifyOnExit`: If true, sends a `<pty_exited>` message when the process exits.

### `pty_write`
Writes data to a PTY session's stdin. Supports escape sequences:
- `\n` — newline, `\r` — carriage return, `\t` — tab, `\\` — literal backslash
- `\xNN` — hex escape (e.g., `\x03` for Ctrl+C, `\x04` for Ctrl+D)
- `\uNNNN` — unicode escape (e.g., `\u4e2d` for 中)

### `pty_read`
Reads the output buffer.
- `offset`: Line number to start from (0-based).
- `limit`: Number of lines to read (defaults to 500).
- `pattern`: Regex to filter output.
- `ignoreCase`: Case-insensitive pattern matching (default: false).

### `pty_list`
Lists all active and exited PTY sessions.

### `pty_kill`
Terminates a PTY session.
- `cleanup`: If true, removes the session and buffer from memory.

## Example Usage

**Agent:** "I'll start the dev server in the background."
1. Calls `pty_spawn(command: "npm", args: ["run", "dev"], notifyOnExit: true)` -> Returns `ID: pty_a1b2c3d4`.
2. Later calls `pty_read(id: "pty_a1b2c3d4")` to check logs.
3. When the server is no longer needed, calls `pty_kill(id: "pty_a1b2c3d4", cleanup: true)`.

## Environment Variables

- `PTY_MAX_BUFFER_SIZE`: Maximum buffer size in characters (default: `1000000`, ~1MB). When exceeded, oldest content is trimmed.

## License

ISC
