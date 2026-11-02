# Feature Research

**Domain:** Local Filesystem & Process Execution Gateway (Desktop-to-Host Bridge)
**Researched:** 2026-11-02
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features desktop client assumes exist. Missing these = gateway unusable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `GET /health` | Client must verify gateway alive before sending IPC requests | LOW | Returns `{ status: "ok", pid: number, uptime: number }`. Native `node:http`. |
| `POST /fs/read` | Desktop apps need file contents (config, source files, workspace data) | LOW | Support text (utf-8) and binary (base64) encoding flags. Use `node:fs/promises.readFile`. |
| `POST /fs/write` | Desktop apps write files, edits, logs | LOW | Atomic write option or direct write via `node:fs/promises.writeFile`. Requires recursive directory create flag. |
| `POST /fs/stat` | Need file metadata (exists, size, isDirectory, isFile, mtime) | LOW | Use `node:fs/promises.stat`. Handle ENOENT cleanly with `{ exists: false }` instead of 500 error. |
| `POST /fs/list` | File tree & file picker explorer in frontend | LOW | Use `node:fs/promises.readdir` with `withFileTypes: true` to avoid secondary stat calls. |
| `POST /fs/mkdir` | Workspace and folder creation | LOW | `node:fs/promises.mkdir` with `{ recursive: true }`. |
| `POST /fs/delete` | File/folder deletion | LOW | `node:fs/promises.rm` with `{ recursive: true, force: true }`. |
| `POST /exec/run` | Execute commands (git, npm, CLI tools) | MEDIUM | `node:child_process.spawn`. Capture stdout, stderr, exit code. Accept `cmd`, `args`, `cwd`, `env`. |
| CORS Header Handling | Tauri/Vite runs on `tauri://localhost` or `http://localhost:5173` | LOW | Handle `OPTIONS` preflight, return `Access-Control-Allow-Origin: *` (safe on loopback-only). |
| Standardized Error Format | Frontend needs predictable error shapes | LOW | `{ error: string, code: string, details?: any }` with 400/404/403/500 HTTP status. |

### Differentiators (Competitive Advantage)

Features that solve enterprise EDR constraints and bridge limits without bloated external frameworks.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Streaming Exec Output (`GET /exec/stream` or SSE) | Long-running CLI (npm install, git clone) freezes UI without stream | MEDIUM | Server-Sent Events (SSE) or chunked HTTP response via `node:http`. Zero dependencies. |
| Process Cancellation (`POST /exec/kill`) | Client can cancel runaway build or hung process | LOW | Track active child PIDs in memory map. Signal `SIGTERM` / `SIGKILL` (or `taskkill /pid /t /f` on Win32). |
| Command Timeout Control | Prevent hung background commands from exhausting host resources | LOW | `timeout` parameter in exec request. Auto-kill child process after deadline. |
| Path Normalization & Guard | Prevent unintended escapes while allowing Windows drive letters | MEDIUM | Windows path resolution (`C:\...`, UNC paths, relative paths). Resolve with `node:path.resolve`. |
| Chunked File Read/Write | Large binary files (dumps, assets) exceed JSON memory limit | MEDIUM | Stream file chunks via `node:fs.createReadStream` directly to HTTP response. |

### Anti-Features (Commonly Requested, Often Problematic)

Features to deliberately NOT build to keep zero-dependency, low-surface footprint.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Complex Auth / JWT / OAuth | Seems "secure" | Adds crypto dependencies, token rotation bugs, zero benefit on single-user `127.0.0.1` | Bind strictly to `127.0.0.1`. Optional shared secret header if cross-origin browser isolation needed. |
| Native Desktop GUI (Electron/Qt) | User wants UI controls | Defeats core purpose: proxy runs inside headful PowerShell to bypass EDR binary blocks | Console-only output in headful terminal window. |
| Cloud Sync / Remote Gateway | Remote access appeal | Expands attack surface massively; converts local bridge into remote code execution (RCE) vector | Localhost loopback only. Out of scope. |
| WebSocket Protocol Upgrade | Bidirectional comms | Adds WS handshake, ping/pong frames, state management in stdlib | Simple HTTP REST + Server-Sent Events (SSE) uses plain HTTP streaming. |
| npm Dependencies (express, cors, etc.) | Faster initial prototype | Adds supply chain risks, node_modules bloat, breaks zero-dep constraint | Pure Node.js built-ins (`node:http`, `node:fs`, `node:child_process`). |

## Feature Dependencies

```
[GET /health] (Base listener)
    └──requires──> [127.0.0.1 HTTP Server Core]

[CORS Handling]
    └──requires──> [127.0.0.1 HTTP Server Core]

[POST /fs/* (read/write/stat/list/mkdir/delete)]
    └──requires──> [Standardized Error Format]
    └──requires──> [Path Normalization & Guard]

[Chunked File Read/Write]
    └──enhances──> [POST /fs/read]

[POST /exec/run]
    └──requires──> [Standardized Error Format]

[Command Timeout Control]
    └──enhances──> [POST /exec/run]

[POST /exec/kill]
    └──requires──> [POST /exec/run Process Map]

[Streaming Exec Output]
    └──enhances──> [POST /exec/run]

[WebSocket Protocol]
    └──conflicts──> [Pure HTTP REST + SSE Design]
```

### Dependency Notes

- **`POST /fs/*` requires `Path Normalization & Guard`:** Raw input paths from frontend must resolve correctly on Windows (`\\` vs `/`) before calling fs functions.
- **`Command Timeout Control` enhances `POST /exec/run`:** Timeout wraps child process lifecycle, preventing gateway deadlock.
- **`POST /exec/kill` requires process map:** Gateway must map request IDs or generated job IDs to running ChildProcess instances.
- **WebSocket conflicts with REST + SSE design:** Avoid dual-protocol complexity; SSE handles one-way exec streaming natively over HTTP.

## MVP Definition

### Launch With (v1)

Minimum viable product to unblock Tauri `task-management` app on Windows EDR environment.

- [ ] `GET /health` — Tauri client verifies proxy ready before initializing workspace.
- [ ] CORS preflight & headers — Allows browser/webview `fetch` to `127.0.0.1:4820`.
- [ ] Standardized JSON error response handler — Prevents app crash on missing files or permissions.
- [ ] `POST /fs/read` — Read workspace files (text & base64).
- [ ] `POST /fs/write` — Write workspace files with auto parent directory creation.
- [ ] `POST /fs/stat` — Fast file/folder existence and type checking.
- [ ] `POST /fs/list` — Directory listing for workspace explorer.
- [ ] `POST /fs/mkdir` — Recursive directory creation.
- [ ] `POST /fs/delete` — Clean workspace and build artifacts.
- [ ] `POST /exec/run` — Synchronous/buffered command execution with timeout support.

### Add After Validation (v1.x)

Features to add once core workspace interactions work reliably.

- [ ] `GET /exec/stream` (SSE) — Stream CLI stdout/stderr in real time for long tasks (e.g. `git clone`, `npm test`).
- [ ] `POST /exec/kill` — Abort running process by execution ID.
- [ ] `GET /fs/download` & `POST /fs/upload` — Direct streaming endpoints for large binary files without JSON encoding overhead.

### Future Consideration (v2+)

- [ ] Dynamic port allocation with discovery file (write port to `.fs-gw.port` on startup if 4820 busy).
- [ ] Shared secret header (`X-FS-GW-Token`) generated on startup to reject unauthorized browser tabs scanning localhost.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `GET /health` | HIGH | LOW | P1 |
| CORS Preflight | HIGH | LOW | P1 |
| `POST /fs/read` & `write` | HIGH | LOW | P1 |
| `POST /fs/stat` & `list` | HIGH | LOW | P1 |
| `POST /fs/mkdir` & `delete` | HIGH | LOW | P1 |
| `POST /exec/run` | HIGH | MEDIUM | P1 |
| Standard Error Handling | HIGH | LOW | P1 |
| Command Timeout Control | MEDIUM | LOW | P1 |
| `POST /exec/kill` | MEDIUM | LOW | P2 |
| Streaming Exec Output (SSE) | HIGH | MEDIUM | P2 |
| Chunked Large File Streaming | MEDIUM | MEDIUM | P2 |
| Auth Token Verification | LOW | LOW | P3 |
| Dynamic Port File Discovery | MEDIUM | LOW | P3 |

## Competitor Feature Analysis

| Feature | Tauri Native Plugin (fs/shell) | Electron Main IPC | fs-gw Approach |
|---------|--------------------------------|-------------------|----------------|
| Execution Model | Rust child_process in-app | Node.js IPC in main process | Separate headful Node.js HTTP server |
| EDR / AppLocker Bypass | Blocked (headless child spawn blocked) | Blocked (if packaged exe untrusted) | Allowed (runs under user PowerShell session) |
| Protocol | Rust IPC bridge | Electron IPC / contextBridge | Standard HTTP REST (accessible by any frontend fetch) |
| Dependencies | Rust crates, Tauri SDK | Electron runtime (~150MB) | Zero external npm packages, Node.js stdlib only |
| Streaming | Channel events | IPC stream | Server-Sent Events / HTTP chunked transfer |

## Sources

- Node.js Official Documentation (`node:http`, `node:fs/promises`, `node:child_process`)
- Tauri v2 Security & IPC Documentation
- Project context: `.planning/PROJECT.md`

---
*Feature research for: Local Filesystem & Process Execution Gateway*
*Researched: 2026-11-02*
