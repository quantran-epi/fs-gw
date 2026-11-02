# Phase 3: Process Execution & Streaming - Research

**Researched:** 2026-11-02  
**Domain:** Node.js stdlib child process management (`node:child_process.spawn`), Windows process tree termination (`taskkill.exe`), Server-Sent Events (SSE) output streaming, zero-dependency PID registry & lifecycle management  
**Confidence:** HIGH  

## Executive Summary

Phase 3 implements the Process Execution & Streaming capability for `fs-gw` (`File System Gateway`). It allows the desktop client (Tauri/Vite) to execute CLI commands and binaries (such as `git`, `node`, compiler scripts) locally on Windows within the user's headful session, bypassing EDR/Trellix headless spawn blocks, preventing command injection attacks, terminating entire process trees cleanly without leaving orphan zombie processes, and streaming real-time stdout/stderr output without memory exhaustion or event loop blocking.

All functionality adheres strictly to project constraints: 100% Node.js standard library (`node:child_process`, `node:http`, `node:crypto`), zero npm dependencies, bounded memory consumption, strict parameter array invocation (`shell: false` default), and unified error/envelope handling.

**Primary recommendation:** Build a dedicated `ProcessRegistry` service (`src/services/process-registry.js`) that manages active child processes, handles timeout tracking, terminates entire Windows process hierarchies via `taskkill.exe /pid <PID> /T /F` (with synchronous `spawnSync` on process exit), and powers both buffered JSON execution (`POST /exec/run`) and backpressured Server-Sent Events streaming (`GET /exec/stream` and `POST /exec/stream`).

## Project Constraints (from CLAUDE.md)

- **Runtime:** Node.js >=20.19 LTS (verified local runtime: `v20.19.5` on `win32`).
- **Dependencies:** Node.js stdlib only. Zero third-party npm packages.
- **Security:** Gateway only listens on `127.0.0.1` (loopback IPv4). Host header validation for DNS rebinding protection enforced by gateway middleware.
- **Process Spawn Policy:** Headful user session context (`windowsHide: false`), no unmanaged headless shells that trigger EDR/Trellix rules.
- **Execution Mechanism:** Parameter array semantics (`shell: false` default). Strict prevention of shell string concatenation to mitigate CVE-2024-27980 and Windows batch file traps.
- **Testing:** Native `node:test` and `node:assert/strict` with zero external test runners.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXEC-01 | Endpoint `POST /exec/run` executes command/binary using `node:child_process.spawn` with args array, optional `cwd`, `env`, `timeout`. Returns `exitCode`, captured `stdout`, captured `stderr`. | `child_process.spawn(command, args, options)` capturing stdio chunks in bounded memory buffers, returning structured JSON response `{ exitCode, stdout, stderr, pid, timedOut }`. |
| EXEC-02 | Safe execution mechanism with `shell: false` default, avoiding command injection (CVE-2024-27980, Windows cmd.exe/batch file traps). | Strict argument array validation (reject string command lines), default `shell: false`, path sanitization for `cwd`, input validation for `command` and `env`. Node 20.12.2+ patch throws `EINVAL` on raw batch files without shell; provide safe wrapper semantics. |
| EXEC-03 | Endpoint `POST /exec/kill` aborts process and its entire Windows process tree via `taskkill.exe /pid <PID> /T /F`. | `child_process.spawn('taskkill', ['/pid', String(pid), '/T', '/F'])`. Correctly handles process exit codes (0 = terminated, 128 = already dead/not found). |
| EXEC-04 | Active PID registry to track running processes, handle timeout abortion, and auto-cleanup on gateway shutdown / process exit. | In-memory `ProcessRegistry` Map tracking child PID, start time, and timeout timers. Registers `process.on('exit')` with synchronous `spawnSync('taskkill', ...)` and `process.on('SIGINT'/'SIGTERM')` for zero orphan leak. |
| EXEC-05 | Streaming endpoint `GET /exec/stream` (or SSE/chunked transfer) transmits real-time stdout/stderr chunks and exit code for long-running processes without blocking event loop or memory explosion. | Server-Sent Events (`text/event-stream`) supporting `GET /exec/stream` (searchParams for `EventSource`) and `POST /exec/stream` (JSON body) with stream backpressure (`child.stdout.pause()` on full socket buffer). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Process Spawning & stdio Buffering | API / Backend (`src/services/exec.service.js`) | `node:child_process` | Manages native process lifecycle, argument passing, output collection, and timeout promises. |
| Process Hierarchy Termination | API / Backend (`src/services/process-registry.js`) | OS (`taskkill.exe`) | On Windows, `child.kill()` fails to kill spawned child processes (git workers, compilers). `taskkill /T /F` kills the entire tree. |
| PID Tracking & Shutdown Cleanup | API / Backend (`src/services/process-registry.js`) | Process Lifecycle (`process.on`) | In-memory registry tracks active processes, clears timers on exit, and runs synchronous kill hooks on gateway shutdown. |
| Real-time Output Streaming | API / Backend (`src/routes/exec.route.js`) | Browser / Client (`EventSource`) | Server-Sent Events (SSE) format emits real-time `stdout`, `stderr`, and `exit` events with backpressure control. |
| Input Validation & Shell Guard | API / Backend (`src/utils/exec-validation.js`) | Router (`src/router.js`) | Validates `command`, `args`, `cwd`, and `env` before touching `child_process.spawn` to prevent command injection and event loop crashes. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:child_process` | stdlib (Node 20+) | Process execution (`spawn`, `spawnSync`) | Native process spawning with full stream control and argument array isolation. [VERIFIED: nodejs.org] |
| `node:http` | stdlib (Node 20+) | HTTP server & SSE streaming | Chunked transfer encoding and persistent SSE connection handling without external dependencies. [VERIFIED: nodejs.org] |
| `node:crypto` | stdlib (Node 20+) | Execution tracking IDs | Native `crypto.randomUUID()` generates collision-free execution tokens. [VERIFIED: nodejs.org] |
| `node:test` | stdlib (Node 20+) | Test runner | Zero-dependency integration testing of process execution and abort mechanisms. [VERIFIED: nodejs.org] |
| `node:assert/strict` | stdlib (Node 20+) | Test assertions | Invariant verification and response payload assertions. [VERIFIED: nodejs.org] |

### Supporting (Zero Dependency)
| Utility | Location | Purpose | When to Use |
|---------|----------|---------|-------------|
| `ProcessRegistry` | `src/services/process-registry.js` | Process tracking, timeout handling, tree termination | In `runProcess`, `streamProcess`, `POST /exec/kill`, and gateway shutdown hooks. |
| `execService` | `src/services/exec.service.js` | Buffered and streaming process execution engine | In `POST /exec/run` and `GET/POST /exec/stream`. |
| `validateExecInput` | `src/utils/exec-validation.js` | Input sanitization for command, args, cwd, env | Every exec endpoint before calling `spawn`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Stdlib `spawn` | `execa` npm | External dependency; adds 15+ packages. `node:child_process.spawn` natively provides all required controls on Node 20+. |
| `taskkill.exe /pid <PID> /T /F` | `tree-kill` npm | External npm package. On Windows, `tree-kill` simply shells out to `taskkill.exe` anyway. Using `spawn('taskkill')` directly is zero-dependency and faster. |
| Server-Sent Events (SSE) | WebSockets (`ws` npm) | WebSockets require external library or heavy custom HTTP upgrade parser. SSE operates over standard HTTP/1.1 chunked transport, natively supported by browser `EventSource`. |
| Stdlib `spawnSync('taskkill')` | POSIX `process.kill(-pid)` | Process groups (`-pid`) do not exist on Windows and throw `EINVAL`. `taskkill.exe` is the official Windows solution. |

## Package Legitimacy Audit

*Notice: This phase installs 0 external npm packages. Node.js stdlib only.*

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| None (stdlib only) | N/A | N/A | N/A | Node.js core | N/A | Approved |

## Architecture Patterns

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                      Client (Tauri / Vite App)                         │
└──────────────┬──────────────────────────────────────────┬──────────────┘
               │ POST /exec/run                           │ GET or POST /exec/stream
               ▼                                          ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     Router (src/router.js)                             │
└──────────────┬──────────────────────────────────────────┬──────────────┘
               │                                          │
               ▼                                          ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Validation Layer (src/utils/exec-validation.js)          │
│               - command: string, no null bytes                         │
│               - args: array of strings                                 │
│               - cwd: sanitized via sanitizePath                        │
│               - shell: false (default)                                 │
└──────────────┬──────────────────────────────────────────┬──────────────┘
               │                                          │
               ▼                                          ▼
┌────────────────────────────────────────────────────────────────────────┐
│             Process Registry (src/services/process-registry.js)        │
│             - Active PID Map (id -> { pid, child, timer })            │
│             - Timeout watchdog (auto taskkill on expiry)               │
│             - Shutdown cleanup hooks (SIGINT, SIGTERM, exit)           │
└──────────────┬──────────────────────────────────────────┬──────────────┘
               │                                          │
        node:child_process.spawn                   node:child_process.spawn
               │                                          │
               ▼                                          ▼
┌───────────────────────────────┐          ┌─────────────────────────────┐
│    Buffered Exec Collector    │          │      SSE Event Streamer     │
│  - Captures stdout/stderr     │          │  - writes 'event: stdout'   │
│  - maxBuffer limit (10MB)     │          │  - writes 'event: stderr'   │
│  - Resolves on child 'close'  │          │  - writes 'event: exit'     │
│                               │          │  - backpressure on socket   │
└──────────────┬────────────────┘          └──────────────┬──────────────┘
               │                                          │
               ▼                                          ▼
┌───────────────────────────────┐          ┌─────────────────────────────┐
│ HTTP 200 JSON Envelope        │          │ HTTP 200 text/event-stream  │
│ { ok: true, data: { ... } }   │          │ Real-time chunked stream    │
└───────────────────────────────┘          └─────────────────────────────┘
```

### Recommended Project Structure
```
src/
├── services/
│   ├── process-registry.js    # In-memory PID tracking, timeout watchdogs, taskkill tree abort
│   └── exec.service.js        # runProcess (buffered) & streamProcess (SSE) wrappers
├── routes/
│   └── exec.route.js          # POST /exec/run, POST /exec/kill, GET/POST /exec/stream
└── utils/
    └── exec-validation.js     # Parameter array validation, command & env sanitization
test/
└── exec.test.js               # Comprehensive unit & integration tests for execution & tree kill
```

---

### Pattern 1: Safe Process Spawning & CVE-2024-27980 Mitigation
**What:** Spawning child processes using parameter arrays with `shell: false` default, protecting against command injection and batch file traps on Windows.  
**When to use:** In all process execution endpoints (`POST /exec/run`, `GET/POST /exec/stream`).  
**Details:**
1. **Never concatenate commands into a shell string:** Do not use `cmd.exe /c ${userInput}`.
2. **Strict Array Arguments:** Ensure `args` is always `Array.isArray(args)`.
3. **CVE-2024-27980 on Windows:** Node.js 20.12.2+ throws synchronous `EINVAL` when spawning `.bat` or `.cmd` files without `shell: true` because Windows `CreateProcessW` cannot parse batch files without `cmd.exe`.
   - If a binary is an executable (`git`, `node`, `powershell`, `.exe`), `shell: false` executes directly without `cmd.exe`.
   - If a caller explicitly specifies `shell: true`, or executes batch scripts (`.cmd`, `.bat` like `npm.cmd`), we must validate that `args` contains no dangerous shell injection characters (`&`, `|`, `<`, `>`, `^`, `%`) or explicitly launch via `cmd.exe /d /s /c` with controlled escaping.

```javascript
// src/utils/exec-validation.js
import { AppError } from './errors.js';
import { sanitizePath } from './path.js';

export function validateExecInput(body) {
  if (!body || typeof body !== 'object') {
    throw new AppError('Request body must be a JSON object', 400, 'ERR_INVALID_BODY');
  }

  const { command, args = [], cwd, env = {}, timeout = 60000, shell = false } = body;

  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new AppError('Field "command" must be a non-empty string', 400, 'ERR_INVALID_COMMAND');
  }

  // Reject null bytes or ASCII control chars in command
  if (/[\x00-\x1F]/.test(command)) {
    throw new AppError('Field "command" contains illegal control characters', 400, 'ERR_INVALID_COMMAND');
  }

  if (!Array.isArray(args) || !args.every(a => typeof a === 'string' || typeof a === 'number')) {
    throw new AppError('Field "args" must be an array of strings/numbers', 400, 'ERR_INVALID_ARGS');
  }

  let sanitizedCwd = undefined;
  if (cwd !== undefined && cwd !== null) {
    if (typeof cwd !== 'string' || cwd.trim().length === 0) {
      throw new AppError('Field "cwd" must be a valid directory path', 400, 'ERR_INVALID_CWD');
    }
    sanitizedCwd = sanitizePath(cwd);
  }

  if (typeof env !== 'object' || Array.isArray(env) || env === null) {
    throw new AppError('Field "env" must be an object of key-value pairs', 400, 'ERR_INVALID_ENV');
  }

  const parsedTimeout = Number(timeout);
  if (isNaN(parsedTimeout) || parsedTimeout < 0 || parsedTimeout > 600000) {
    throw new AppError('Field "timeout" must be a number between 0 and 600000ms', 400, 'ERR_INVALID_TIMEOUT');
  }

  return {
    command: command.trim(),
    args: args.map(String),
    cwd: sanitizedCwd,
    env,
    timeout: parsedTimeout,
    shell: Boolean(shell)
  };
}
```

---

### Pattern 2: Windows Process Tree Termination via `taskkill.exe`
**What:** Aborting the full process hierarchy on Windows using `taskkill.exe /pid <PID> /T /F`.  
**When to use:** On execution timeout, on `POST /exec/kill`, when client disconnects from streaming endpoint, and during gateway server shutdown.  
**Why:** Calling `child.kill()` on Windows invokes `TerminateProcess` on the top-level parent only. Child worker processes remain running in the background. `taskkill.exe /pid <PID> /T /F` forces termination of the process and all child processes spawned by it.

```javascript
// src/services/process-registry.js
import { spawn, spawnSync } from 'node:child_process';

export function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid || typeof pid !== 'number') {
      return resolve({ success: false, code: -1, message: 'Invalid PID' });
    }

    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
    let stderr = '';

    killer.stderr.on('data', chunk => { stderr += chunk.toString(); });

    killer.on('close', (code) => {
      // 0 = Success, 128 = Process not found / already dead
      if (code === 0 || code === 128) {
        resolve({ success: true, code, message: code === 128 ? 'Process already dead' : 'Terminated' });
      } else {
        resolve({ success: false, code, message: stderr.trim() });
      }
    });

    killer.on('error', (err) => {
      resolve({ success: false, code: -1, message: err.message });
    });
  });
}

export function killProcessTreeSync(pid) {
  if (!pid || typeof pid !== 'number') return;
  try {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  } catch {
    // Ignore errors during exit cleanup
  }
}
```

---

### Pattern 3: Active PID Registry & Gateway Lifecycle Auto-Cleanup
**What:** Central registry tracking active child processes, scheduling timeout aborts, and running cleanup routines on gateway termination.  
**When to use:** Throughout the gateway process lifecycle.

```javascript
// src/services/process-registry.js
import { randomUUID } from 'node:crypto';

class ProcessRegistry {
  constructor() {
    this.active = new Map(); // id -> { id, pid, child, timer, command, startTime }
    this._setupExitHooks();
  }

  register(child, metadata = {}) {
    const id = randomUUID();
    const pid = child.pid;
    let timer = null;

    if (metadata.timeout > 0) {
      timer = setTimeout(async () => {
        const entry = this.active.get(id);
        if (entry) {
          entry.timedOut = true;
          await killProcessTree(pid);
        }
      }, metadata.timeout);
      timer.unref?.();
    }

    const entry = {
      id,
      pid,
      child,
      timer,
      timedOut: false,
      command: metadata.command,
      startTime: Date.now()
    };

    this.active.set(id, entry);

    child.on('close', () => {
      this.unregister(id);
    });

    return entry;
  }

  unregister(id) {
    const entry = this.active.get(id);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      this.active.delete(id);
    }
  }

  get(idOrPid) {
    if (typeof idOrPid === 'number') {
      for (const entry of this.active.values()) {
        if (entry.pid === idOrPid) return entry;
      }
      return null;
    }
    return this.active.get(idOrPid) || null;
  }

  async kill(idOrPid) {
    const entry = this.get(idOrPid);
    if (!entry) {
      // If not in registry, still attempt taskkill if numeric PID was provided
      if (typeof idOrPid === 'number') {
        return await killProcessTree(idOrPid);
      }
      return { success: false, code: 404, message: 'Process not found in registry' };
    }
    const result = await killProcessTree(entry.pid);
    this.unregister(entry.id);
    return result;
  }

  killAllSync() {
    for (const entry of this.active.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      killProcessTreeSync(entry.pid);
    }
    this.active.clear();
  }

  _setupExitHooks() {
    const cleanup = () => {
      this.killAllSync();
    };

    process.once('exit', cleanup);
    process.once('SIGINT', () => {
      cleanup();
      process.exit(130);
    });
    process.once('SIGTERM', () => {
      cleanup();
      process.exit(143);
    });
  }
}

export const registry = new ProcessRegistry();
```

---

### Pattern 4: Real-Time Server-Sent Events (SSE) Streaming with Backpressure
**What:** Streaming stdout/stderr chunks and exit code over `text/event-stream` without memory spikes or event loop lockups.  
**When to use:** In `GET /exec/stream` and `POST /exec/stream`.

```javascript
// src/services/exec.service.js
export function streamProcessExecution({ command, args, cwd, env, timeout, shell }, req, res) {
  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.socket?.setNoDelay(true);

  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    shell,
    windowsHide: false // Mandatory for headful EDR compliance
  });

  const entry = registry.register(child, { command, timeout });

  const sendEvent = (event, data) => {
    if (res.writableEnded) return;
    const ok = res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // Native backpressure: pause stdout if client socket buffer is full
    if (!ok && child.stdout && !child.stdout.isPaused()) {
      child.stdout.pause();
      res.once('drain', () => {
        if (!child.killed) child.stdout.resume();
      });
    }
  };

  sendEvent('start', { id: entry.id, pid: child.pid });

  child.stdout.on('data', chunk => {
    sendEvent('stdout', { chunk: chunk.toString('utf-8') });
  });

  child.stderr.on('data', chunk => {
    sendEvent('stderr', { chunk: chunk.toString('utf-8') });
  });

  child.on('error', err => {
    sendEvent('error', { error: err.message, code: err.code });
  });

  child.on('close', (code, signal) => {
    sendEvent('exit', {
      exitCode: code,
      signal,
      timedOut: entry.timedOut
    });
    res.end();
  });

  // Client abort detection: kill process tree if user closes browser/cancels stream
  req.on('close', () => {
    if (!child.killed && entry) {
      killProcessTree(child.pid);
    }
  });
}
```

---

### Anti-Patterns to Avoid

- **Using `child_process.exec`:** Combines `cmd.exe` string concatenation, has 1MB default buffer limit, causes shell injection. Always use `spawn` with argument array.
- **Calling `child.kill('SIGTERM')` on Windows:** POSIX signals do not propagate down the process tree on Windows. Top-level process dies, leaving worker subprocesses running indefinitely. Always use `taskkill /pid <PID> /T /F`.
- **Spawning with `windowsHide: true`:** EDR policies (Trellix) block background headless spawns from unmanaged binaries. Keep `windowsHide: false` or inherit user terminal session context.
- **Unbounded in-memory stdout accumulator:** Buffering infinite output without limits causes `heap out of memory` on long builds. For buffered `run`, enforce a strict `maxBuffer` (10MB default) and truncate or error out. For streaming, stream chunks immediately over SSE.
- **Ignoring client disconnect on streaming routes:** Leaving child processes running after the client closes the HTTP connection leaks CPU and memory. Always listen for `req.on('close')` and invoke `taskkill`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process Tree Killing | Custom recursive `wmic` or `Get-CimInstance` script | `taskkill.exe /pid <PID> /T /F` | Built into Windows (`System32\taskkill.exe`), fast, native C binary, terminates nested child processes reliably. |
| Streaming Protocol | Custom WebSocket upgrade parser | Server-Sent Events (`text/event-stream`) | Operates natively over standard HTTP/1.1 chunked transfer; supported natively by browser `EventSource` with zero dependencies. |
| Temporary Process IDs | Custom integer counter | `node:crypto.randomUUID()` | Built into Node.js stdlib, crypto-secure, eliminates collisions across concurrent executions. |
| Parameter Escaping for Shell | Custom regex escaping quotes and carets | Avoid shell execution entirely (`shell: false`) | Shell escaping on Windows has dozens of edge cases (`cmd.exe` vs PowerShell vs `CreateProcessW`). Parameter arrays bypass shell escaping entirely. |

## Common Pitfalls

### Pitfall 1: Spawning `.cmd` / `.bat` on Node >= 20.12.2 throws `EINVAL`
**What goes wrong:** Calling `spawn('npm', ['install'])` or `spawn('npm.cmd', ['install'], { shell: false })` throws synchronous `spawn EINVAL`.  
**Why it happens:** Due to CVE-2024-27980, Node.js disallows spawning `.bat` and `.cmd` files with `shell: false` because Windows `CreateProcessW` cannot launch them without `cmd.exe`.  
**How to avoid:**
1. For standard binaries (`git`, `node`, `python`, `powershell`, `cargo`), `shell: false` works without issue.
2. For commands that resolve to `.cmd` (like `npm`), caller should pass `shell: true` or specify `cmd.exe` with `['/d', '/s', '/c', 'npm', ...]` and sanitized arguments.
3. Handle synchronous `spawn` exceptions gracefully inside a try-catch block so the server doesn't crash on `EINVAL`.

### Pitfall 2: `taskkill` returning code 128 treated as 500 error
**What goes wrong:** Client calls `POST /exec/kill`, but the process already exited milliseconds prior. `taskkill` returns exit code 128 ("The process with PID ... not found"), and server reports an internal error.  
**Why it happens:** Race condition between process natural exit and abort call.  
**How to avoid:** Treat `taskkill` exit code 128 as success (`{ ok: true, data: { killed: false, message: 'Process already terminated' } }`).

### Pitfall 3: Event loop hang during synchronous exit hook
**What goes wrong:** Using asynchronous `spawn('taskkill', ...)` inside `process.on('exit')` fails because Node event loop does not run async callbacks during `exit`.  
**Why it happens:** Node.js `exit` handler only supports synchronous operations.  
**How to avoid:** Use `spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'])` inside `process.on('exit')`.

### Pitfall 4: Backpressure buildup in stdout pipe
**What goes wrong:** Child process emits 50MB of compiler output in 1 second. Fast child + slow HTTP socket causes unbounded memory buffering in Node.js socket queue.  
**Why it happens:** Not listening to `res.write()` return value.  
**How to avoid:** When `res.write()` returns `false`, call `child.stdout.pause()`. Resume child stdout only when `res` emits `'drain'`.

## Code Examples

### 1. Buffered Process Run Handler (`POST /exec/run`)
```javascript
// src/services/exec.service.js
import { spawn } from 'node:child_process';
import { registry } from './process-registry.js';
import { AppError } from '../utils/errors.js';

export function runProcess({ command, args, cwd, env, timeout, shell, maxBuffer = 10 * 1024 * 1024 }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        shell,
        windowsHide: false
      });
    } catch (err) {
      return reject(new AppError(`Failed to spawn process: ${err.message}`, 400, err.code || 'ERR_SPAWN_FAILED'));
    }

    const entry = registry.register(child, { command, timeout });

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let truncated = false;

    child.stdout?.on('data', chunk => {
      if (stdoutSize + chunk.length <= maxBuffer) {
        stdoutChunks.push(chunk);
        stdoutSize += chunk.length;
      } else {
        truncated = true;
      }
    });

    child.stderr?.on('data', chunk => {
      if (stderrSize + chunk.length <= maxBuffer) {
        stderrChunks.push(chunk);
        stderrSize += chunk.length;
      } else {
        truncated = true;
      }
    });

    child.on('error', err => {
      reject(new AppError(`Process error: ${err.message}`, 500, err.code || 'ERR_PROCESS_ERROR'));
    });

    child.on('close', (code, signal) => {
      resolve({
        id: entry.id,
        pid: child.pid,
        exitCode: code,
        signal,
        timedOut: entry.timedOut,
        truncated,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8')
      });
    });
  });
}
```

### 2. Process Termination Endpoint (`POST /exec/kill`)
```javascript
// src/routes/exec.route.js
router.register('POST', '/exec/kill', async (req, res) => {
  const body = await readJsonBody(req);
  const target = body.pid ? Number(body.pid) : body.id;

  if (!target) {
    throw new AppError('Either "pid" (number) or "id" (string) must be provided', 400, 'ERR_INVALID_TARGET');
  }

  const result = await registry.kill(target);
  sendJson(res, 200, result);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `child_process.exec("cmd")` | `child_process.spawn(cmd, [args], { shell: false })` | Node 12+ / 20+ best practice | Eliminates shell injection vulnerability. |
| `child.kill('SIGKILL')` on Windows | `taskkill.exe /pid <PID> /T /F` | Windows standard | Kills full child process tree without leaving orphan compiler/git workers. |
| In-memory full output buffering | Server-Sent Events (SSE) with `stdout.pause()` on backpressure | Node HTTP standard | Prevents V8 heap crashes and event loop starvation on heavy terminal tasks. |
| Asynchronous exit listeners | Synchronous `spawnSync('taskkill')` on process exit | Node process model | Ensures cleanup is executed before OS reclaims parent node process. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `taskkill.exe` is available in standard Windows `System32` PATH on Windows 11 Enterprise | Architecture / Patterns | Low. Verified available at `/c/WINDOWS/system32/taskkill` on host. |
| A2 | Desktop frontend supports Server-Sent Events (`text/event-stream`) via `EventSource` or `fetch` ReadableStream | Patterns | Low. Standard in modern WebViews (Tauri 2 / WebView2). |

## Open Questions

1. **How should execution of Windows `.cmd` files like `npm.cmd` be handled when `shell: false` throws `EINVAL`?**
   - *What we know:* Node.js 20.12.2+ security patch for CVE-2024-27980 throws `EINVAL` when spawning batch files with `shell: false`.
   - *Recommendation:* Support optional `shell: true` flag in the request payload. If `shell: true` is requested, validate that arguments do not contain shell operators (`&`, `|`, `^`, `%`) unless explicitly expected, or recommend callers execute `cmd.exe` directly with argument array `['/d', '/s', '/c', 'npm', ...]`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Execution Runtime | ✓ | v20.19.5 | — |
| `node:child_process` | Process spawning | ✓ | Node stdlib | — |
| `taskkill.exe` | Process tree kill (EXEC-03, EXEC-04) | ✓ | Windows 11 System32 | — |
| `node:http` | REST and SSE streaming (EXEC-05) | ✓ | Node stdlib | — |
| `git.exe` | CLI execution testing | ✓ | 2.52.0.windows.1 | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Out of scope for loopback MVP (binding restricted to `127.0.0.1`). |
| V3 Session Management | no | Stateless REST / SSE. |
| V4 Access Control | yes | Loopback restriction + Host header DNS rebinding validation. |
| V5 Input Validation | yes | `validateExecInput`: array arguments only, control char check, path sanitization for `cwd`. |
| V6 Cryptography | yes | `node:crypto.randomUUID()` for unguessable process execution IDs. |

### Known Threat Patterns for Process Execution on Windows

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell Metacharacter Injection (`& calc.exe`, `| whoami`) | Tampering / Elevation of Privilege | Use `child_process.spawn` with parameter array and `shell: false` default. Avoid string concatenation. |
| CVE-2024-27980 (Windows Batch File Injection) | Elevation of Privilege | Node 20.12.2+ builtin `EINVAL` guard; strict sanitization of batch arguments. |
| Process Starvation / Fork Bomb | Denial of Service | Active PID registry with timeout watchdog and `taskkill /T /F` process tree termination. |
| Buffer Overflow / Memory Exhaustion | Denial of Service | `maxBuffer` cap (10MB) for buffered execution; stream backpressure (`pause()`/`resume()`) for SSE. |
| DNS Rebinding to execute CLI | Elevation of Privilege | Gateway Host header check (`127.0.0.1`, `localhost`) rejects unauthorized web origins. |

## Sources

### Primary (HIGH confidence)
- Node.js Official Documentation: `node:child_process` (`spawn`, `spawnSync`, options).
- Node.js Security Advisory CVE-2024-27980: Windows command line argument injection mitigations.
- Microsoft Documentation: Windows `taskkill.exe` command-line reference (`/pid`, `/T`, `/F`).
- Local Runtime Probe: Node `v20.19.5` on Windows 11 (`win32`).

### Secondary (MEDIUM confidence)
- MDN Web Docs: Server-Sent Events (SSE) format and browser `EventSource` protocol.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Node.js stdlib only (`child_process`, `http`, `crypto`), verified on local runtime.
- Architecture: HIGH - Registry + `taskkill /T /F` + SSE streaming verified against Windows process model.
- Pitfalls: HIGH - Node 20 CVE-2024-27980 `EINVAL` behavior and tree kill constraints tested and documented.

**Research date:** 2026-11-02  
**Valid until:** 2026-12-02
