# Pitfalls Research

**Domain:** Local Node.js Filesystem & Process Execution Bridge Server (Windows Host / Tauri Client)
**Researched:** 2026-11-02
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Shell Execution Injection & Windows `cmd.exe` Argument Mangling (CVE-2024-27980 & batch file traps)

**What goes wrong:**
Calling `child_process.exec(cmd)` or `child_process.spawn(cmd, args, { shell: true })` on Windows allows arbitrary command execution via metacharacters (`&`, `|`, `^`, `%`, `"`). Moreover, spawning `.bat` or `.cmd` files without explicit validation lets unquoted spaces or quotes trigger secondary script injection even with `spawn(file, args, { shell: false })`.

**Why it happens:**
Windows lacks a native POSIX `execve` syscall passing raw argument arrays. Everything translates to a single command-line string (`lpCommandLine` via `CreateProcessW`). Node.js quotes arguments, but `cmd.exe` and batch scripts parse `%` expansion and caret escaping rules differently than standard C-runtime rules. Developers default to `exec()` because it feels like a shell terminal.

**How to avoid:**
1. Default to `child_process.spawn(executable, args, { shell: false, windowsVerbatimArguments: false })`. Never use `exec()` for user/client supplied arguments.
2. If running scripts (.bat/.cmd), disallow them or sanitize args against strict alphanumeric allowlists; never pass raw user strings to batch files.
3. Validate executable name against an allowlist or ensure it resolves to an absolute path without shell metacharacters.

**Warning signs:**
- Code imports `child_process.exec` or uses string concatenation for CLI arguments.
- Tests only verify paths without spaces or special characters like `&` or `^`.

**Phase to address:**
Phase 2 (Process Execution Endpoint & Sanitization).

---

### Pitfall 2: Zombie / Orphan Child Processes on Timeout or Client Abort

**What goes wrong:**
When client disconnects or an execution times out, calling `child.kill()` on Windows kills only the top-level parent wrapper (e.g. `cmd.exe` or `git.exe`), leaving child processes (e.g., compile daemons, child git workers, python scripts) running in the background. Server eventually exhausts memory, file locks, or CPU.

**Why it happens:**
On Windows, POSIX signal semantics (`SIGTERM`, `SIGKILL`) do not exist. `child.kill()` translates to `TerminateProcess`. It terminates only the targeted process handle, not the full process tree (unlike POSIX process groups `process.kill(-pid)`).

**How to avoid:**
1. On Windows, use native `taskkill.exe /pid <PID> /T /F` via stdlib `execFile` when killing a spawned process hierarchy on timeout or abort.
2. In Node 20+, track the spawned child's PID and invoke taskkill if `child.killed` or timeout fires.
3. Attach listener to gateway's own `process.on('exit')` and `process.on('SIGINT')` to clean up active children table.

**Warning signs:**
- Task Manager shows dozens of `git.exe`, `node.exe`, or compiler processes long after requests end.
- Server abort logic only calls `child.kill('SIGTERM')`.

**Phase to address:**
Phase 2 (Process Execution Endpoint & Lifecycle Management).

---

### Pitfall 3: Path Traversal & Windows Device Path Bypass (`CON`, `PRN`, Alternate Data Streams, mixed `/` vs `\`)

**What goes wrong:**
Relying on naive prefix checks (e.g. `path.startsWith(allowedDir)`) or basic `../` regex lets clients escape root directories or crash/freeze server using Windows reserved names (`CON`, `NUL`, `AUX`, `COM1-9`, `LPT1-9`) or NTFS Alternate Data Streams (`file.txt:hidden`).

**Why it happens:**
Windows path parsing is tricky:
- `path.resolve` normalizes slashes but does not block DOS device names (opening `fs.open('CON')` hangs the thread).
- Case insensitivity on NTFS (`C:\foo` == `c:\FOO`) breaks case-sensitive string checks.
- 8.3 short names (`PROGRA~1`) bypass naive path prefix filters.

**How to avoid:**
1. Use `path.resolve()` followed by `path.normalize()`.
2. Convert both target path and root boundaries to lowercase before comparing boundaries, or use `path.relative(root, resolved)` checking for `..` or root prefix escape.
3. Use `fs.realpath` where symlinks are involved to check canonical filesystem location.
4. Reject paths matching DOS device regex: `/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i`.
5. Explicitly forbid NTFS stream indicator (`:` after drive letter).

**Warning signs:**
- Path checks using regex like `path.replace(/\.\./g, '')`.
- Server hangs when client reads a file named `con` or `nul`.

**Phase to address:**
Phase 1 (Filesystem Core Endpoints & Path Resolution Helper).

---

### Pitfall 4: Unbounded Memory Buffering in Child Process and File Streaming

**What goes wrong:**
Calling `fs.readFile()` on multi-gigabyte files or buffering infinite stdout/stderr from long-running commands (`git log`, build logs) exhausts V8 heap and crashes gateway with `ERR_STRING_TOO_LONG` or `JavaScript heap out of memory`.

**Why it happens:**
`child_process.exec` has a fixed default `maxBuffer` (1 MB); when exceeded, it kills the process with error. Conversely, accumulating chunks in array `chunks.push(chunk)` without backpressure or limits causes memory explosion.

**How to avoid:**
1. Filesystem: For reads, support streaming via chunked transfer encoding (`res.writeHead(200, ...)` with `fs.createReadStream()`) or range requests.
2. Process execution: Stream stdout/stderr chunks using chunked HTTP transfer or SSE (Server-Sent Events) rather than one massive JSON payload. If batching in single JSON, enforce strict `maxOutputBytes` limit and truncate with a flag `{ truncated: true }`.

**Warning signs:**
- Out of memory crashes when reading large binary assets or database files.
- `maxBuffer exceeded` errors breaking standard CLI commands.

**Phase to address:**
Phase 1 (FS Streaming) & Phase 2 (Process Output Streaming/Chunking).

---

### Pitfall 5: Port Collision & Ghost Process Zombie Locks on Port 4820

**What goes wrong:**
Server fails to start with `EADDRINUSE` if an old server instance is still running in background, or another developer tool binds to the same port. Desktop app cannot connect or talks to stale instance.

**Why it happens:**
Fixed port configuration without fallback, health probe, or PID file coordination. On Windows, orphaned node processes remain if terminal was closed abruptly without clean teardown.

**How to avoid:**
1. Port fallback / detection: Default to 4820; if `EADDRINUSE`, test health endpoint `GET /health` with signature check. If signature matches fs-gw, report active instance. If port occupied by foreign app, fail fast with explicit remediation instructions or support `--port` CLI flag.
2. Write small runtime lockfile in temporary directory (`%TEMP%\fs-gw.port`) containing PID and port so Tauri app can auto-discover actual running port.

**Warning signs:**
- Developer gets `Error: listen EADDRINUSE: address already in use 127.0.0.1:4820` on startup and must manually find PID in Resource Monitor.

**Phase to address:**
Phase 0 / Phase 1 (Server Bootstrap & Configuration).

---

### Pitfall 6: DNS Rebinding & Cross-Origin Weaponization (Binding 127.0.0.1 vs Host Header Injection)

**What goes wrong:**
While server listens on `127.0.0.1`, a malicious website opened in browser on the same machine executes `fetch('http://127.0.0.1:4820/fs/delete')` or uses DNS rebinding (`attacker.com` pointing to `127.0.0.1`) to execute commands or read files.

**Why it happens:**
Developers assume `127.0.0.1` binding provides 100% security against external actors. Browsers can still make HTTP requests to localhost from any origin unless CORS and Host header validation are strictly enforced.

**How to avoid:**
1. Check `Host` header: Reject any request whose `Host` header is not `127.0.0.1:<PORT>` or `localhost:<PORT>`.
2. Strict CORS check: For browser/web origin, only allow `tauri://localhost`, `http://localhost:*` (dev Vite port), or explicit configured app origins. Reject wildcard `*` with credentials or unverified origins.
3. Optional shared secret: Pass a local session token via startup flag or header (`X-FS-GW-Token`) generated on startup and shared via `%TEMP%\fs-gw.token` or CLI arg to prevent unauthorized browser tabs from hitting endpoints.

**Warning signs:**
- Server uses `res.setHeader('Access-Control-Allow-Origin', '*')` without verifying request origin.
- Server ignores `req.headers.host`.

**Phase to address:**
Phase 1 (HTTP Server Infrastructure & Security Middleware).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `child_process.exec` instead of `spawn` | Automatic string parsing, 1-line call | Remote command injection, command quoting bugs, 1MB maxBuffer freeze | Never for user/client input; acceptable only for static hardcoded zero-arg commands |
| Synchronous FS methods (`fs.readFileSync`) | Simpler flow, no async/await | Blocks Node.js event loop; freezes all requests while reading disk | Never in HTTP request handlers |
| Wildcard CORS `Access-Control-Allow-Origin: *` | No CORS configuration headaches | Any random browser tab can read/write local filesystem and run shell commands | Never |
| Killing process with `child.kill()` on Windows | Native API, 1 line of code | Leaves worker child processes running as zombies | Only if process is guaranteed single-binary with no child workers |
| No request body size limits | Simple request body aggregation | Memory DOS via giant POST payload | Never |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Windows CLI binaries (`git.exe`, `npm.cmd`) | Spawning `npm` directly without `.cmd` extension fails with `ENOENT` | Resolve Windows binary extensions: test `.exe`, `.cmd`, `.bat` or use `where.exe` resolution |
| Windows Path Delimiters | Splitting paths on `/` or hardcoding `\` | Always use `node:path` methods (`path.join`, `path.normalize`, `path.sep`) |
| UTF-8 vs OEM/ANSI Code Page in CMD Output | Accented or Vietnamese characters display as gibberish in process stdout | Set `chcp 65001` or pass `{ encoding: 'utf-8' }` and handle BOM or CP1252 fallbacks |
| Tauri App Connection | Hardcoded port in frontend code; breaks on collision | Store port in known temp metadata file (`fs-gw.json`) read by Tauri Rust backend on launch |
| PowerShell Execution Policy | Spawning `.ps1` files directly fails due to `Restricted` policy | Spawn `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <script>` |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Buffering full `readdir` with stats recursively | High latency and huge RAM spikes on large directories (e.g. `node_modules`) | Support shallow listing, pagination, or streaming directory entries (`fs.opendir`) | > 5,000 files in directory |
| Repeated `fs.stat` before every `fs.readFile` | Double disk IO syscalls per file read | Use optimistic read: call `fs.open`/`readFile` directly, handle `ENOENT`/`EISDIR` in catch | > 50 req/sec |
| Storing active process outputs indefinitely in memory | Gateway crashes with OOM during long-running builds | Cap buffer ring to last N MB or stream direct to response socket | > 50 MB terminal output |
| Spawning child process for basic file metadata | High CPU, slow response | Use stdlib `fs.stat` / `fs.lstat`, never shell out to `dir` or `Get-Item` | Immediate (spawn overhead on Windows is 20-50ms) |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Missing Host Header validation | DNS rebinding attack lets external malicious website command gateway | Reject requests with foreign `Host` headers |
| Allowing relative paths without boundary checking | Path traversal (`../../Windows/System32`) | Normalize with `path.resolve` and verify path containment within allowed root or workspace |
| Unsanitized environment variables in `spawn` | Leaking sensitive API keys, PATH hijacking | Explicitly filter or sanitize `env` object passed to child process |
| Writing files directly to target without atomic temp rename | Corrupted partial file if client aborts or crash occurs during write | Write to `<file>.tmp.<uuid>`, then atomic `fs.rename` |
| Permitting execution of arbitrary binaries in PATH | Malicious DLL preloading or Trojan executable invocation | Allowlist binaries or enforce absolute paths verified against known directories |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent crash in background terminal | App appears hung, user has no idea gateway died | Clear formatted error log in PowerShell window; graceful error codes returned to client |
| Cryptic Windows error codes (`EPERM`, `EBUSY`) | User cannot tell why file won't delete or write | Map common Windows errors to clear messages ("File is locked by another program") |
| Hanging process blocks client forever | UI spinner spins infinitely when command prompts for stdin | Pass `stdio: ['ignore', 'pipe', 'pipe']` by default or implement execution timeout (e.g. 60s) |
| Missing startup banner | User cannot tell which port or PID the gateway is running on | Print clear banner: Port, PID, Bound IP, and healthcheck URL on startup |

---

## "Looks Done But Isn't" Checklist

- [ ] **Process Execution:** Often missing child tree kill on Windows — verify killing `npm test` kills underlying node processes via `taskkill /T /F`.
- [ ] **Windows Batch Execution:** Often fails when path has spaces (e.g. `C:\Program Files\my-script.cmd`) — verify invocation with spaces in directory and arguments.
- [ ] **File Operations:** Often missing Windows file locking handling (`EBUSY` when another process has handle open) — verify retry/clean error handling.
- [ ] **Directory Deletion:** Often fails on Windows with `ENOTEMPTY` or `EPERM` due to read-only attribute or open handle — verify `fs.rm(path, { recursive: true, force: true })`.
- [ ] **Encoding:** Often breaks on non-ASCII paths (Vietnamese accents, Japanese, spaces) — verify paths like `D:\Thư mục kiểm tra\tập tin.txt`.
- [ ] **Health Endpoint:** Often missing process metadata — verify `GET /health` returns gateway version, uptime, node version, and memory usage.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Port 4820 blocked by orphaned node instance | LOW | Run `Get-Process node \| Where-Object { ... } \| Stop-Process -Force` or implement auto-increment port fallback with discovery file. |
| Zombie child processes consuming 100% CPU | MEDIUM | Execute `taskkill /F /IM <target_binary>.exe` or reboot PowerShell terminal. Add tree-kill logic to server. |
| Incomplete file write leaves corrupted state | MEDIUM | Clean up `.tmp` files; adopt atomic write pattern (`write tmp -> rename`). |
| DNS rebinding vulnerability exploited | HIGH | Revoke affected local data, immediately enforce Host header check and CORS allowlist. |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Path traversal & DOS device names | Phase 1: Core FS Endpoints | Unit tests attempting traversal (`../`, `CON`, `NUL`, Alternate Data Streams) |
| Host header injection & DNS rebinding | Phase 1: HTTP Infrastructure | Test requests with `Host: evil.com` returning 400 Bad Request |
| Atomic file write failure | Phase 1: Core FS Endpoints | Test crash/abort during write leaves original file intact |
| Command injection & batch file traps | Phase 2: Process Execution | Test command with `&`, `|`, and spaces; verify no secondary execution |
| Windows orphan zombie processes | Phase 2: Process Execution | Spawn long-running process (`ping -t 127.0.0.1`), trigger abort, assert PID not in `tasklist` |
| Process buffer overflow / OOM | Phase 2: Process Execution | Spawn command producing 100MB output, verify memory caps or streaming handling |
| Port collision on startup | Phase 0/1: Bootstrap | Launch two instances; verify second instance handles collision gracefully |

---

## Sources

- Node.js Official Documentation: `child_process` caveats on Windows (`windowsVerbatimArguments`, batch files).
- Node.js Security Advisory CVE-2024-27980 (Command injection via batch files on Windows).
- Microsoft Windows API Documentation: `CreateProcessW` and `TerminateProcess` tree limitations.
- OWASP: Localhost API & DNS Rebinding Security Guidance.

---
*Pitfalls research for: Local Node.js Filesystem & Process Gateway (Windows Host)*
*Researched: 2026-11-02*
