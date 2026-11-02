# Architecture Research

**Domain:** Zero-dependency Node.js HTTP Local Gateway (Filesystem & Process Execution)  
**Researched:** 2026-11-02  
**Confidence:** HIGH  

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                 Client (Tauri / React App)                  │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / JSON / SSE / Stream
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                       HTTP Layer                            │
│  ┌────────────────────┐            ┌─────────────────────┐  │
│  │ Host/Origin Guard  │            │  CORS & Options Pre │  │
│  └─────────┬──────────┘            └──────────┬──────────┘  │
│            ▼                                  ▼             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │             Minimal Regex / Map HTTP Router           │  │
│  └─────────────────────────┬─────────────────────────────┘  │
├────────────────────────────┼────────────────────────────────┤
│ Request Middleware         ▼                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Body Buffer / Stream Parser (Content-Length, MaxSize) │  │
│  └─────────────────────────┬─────────────────────────────┘  │
├────────────────────────────┼────────────────────────────────┤
│ Handlers / Dispatcher      ▼                                │
│  ┌────────────────────┐            ┌─────────────────────┐  │
│  │    FS Controller   │            │   Proc Controller   │  │
│  └─────────┬──────────┘            └──────────┬──────────┘  │
├────────────┼──────────────────────────────────┼─────────────┤
│ Core Services (Native Node.js stdlib)         ▼             │
│  ┌─────────▼──────────┐            ┌─────────────────────┐  │
│  │     FS Service     │            │    Process Runner   │  │
│  │ (node:fs/promises) │            │(node:child_process) │  │
│  └─────────┬──────────┘            └──────────┬──────────┘  │
├────────────┼──────────────────────────────────┼─────────────┤
│ Response Formatter & Error Boundary           ▼             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Unified JSON Error / Success Formatter & File Pipe    │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Server Bootstrapper** | Listen on IPv4 `127.0.0.1`, config port, handle `SIGINT`/`SIGTERM` | `node:http.createServer()` bound explicitly to `127.0.0.1` |
| **Security & CORS Guard** | Reject non-local `Host` headers; reply 204 to `OPTIONS`; set permissive local CORS headers | Check `req.headers.host`, inspect `req.socket.remoteAddress`, write CORS headers |
| **HTTP Router** | Match `METHOD + pathname`, route to handler, return 404/405 | Pure function using Map lookup or pattern array, URL parsed via `new URL(req.url, 'http://...')` |
| **Body Parser** | Collect incoming streams for POST/PUT, enforce max byte limit, parse JSON or yield raw stream | Listen to `req.on('data')`, `req.on('end')`, check byte count against limit (prevent DoS) |
| **FS Service** | Abstract file read/write/stat/mkdir/readdir/rm, handle path normalization | Direct `node:fs/promises` calls, `node:fs.createReadStream` for large files |
| **Process Runner Service** | Spawn child command with cwd/env/args, capture stdout/stderr/exitCode, optional streaming output | `node:child_process.spawn()` with buffer collection or NDJSON/SSE streaming |
| **Response & Error Formatter** | Consistent HTTP status code mapping, standardized JSON envelope (`{ ok, data }` or `{ error, code }`) | Helper function `sendJson(res, statusCode, payload)` and `sendError(res, err)` |

## Recommended Project Structure

Zero-dependency native Node.js (ESM, Node 20+ native test runner, no build step).

```
src/
├── config.js               # Env parser, default PORT=4820, HOST=127.0.0.1, limits
├── server.js               # HTTP server init, lifecycle, route dispatch
├── router.js               # Simple route registry (method + path pattern matching)
├── middleware/
│   ├── cors.js             # Local CORS headers & OPTIONS preflight handler
│   ├── security.js         # Host header check, remoteAddress localhost validation
│   └── body.js             # Streaming body aggregator with byte limit
├── services/
│   ├── fs.service.js       # All node:fs operations (read, write, stat, readdir, rm, mkdir)
│   └── proc.service.js     # child_process.spawn wrapper (exec sync/buffered or streamed)
├── routes/
│   ├── health.route.js     # GET /health
│   ├── fs.routes.js        # POST /api/fs/read, /api/fs/write, /api/fs/stat, etc.
│   └── proc.routes.js      # POST /api/proc/exec, POST /api/proc/spawn-stream
└── utils/
    ├── response.js         # sendJson, sendError, pipeStream helpers
    └── errors.js           # AppError class with HTTP status mapping
test/
├── server.test.js          # node:test integration checks
├── fs.service.test.js      # FS operations test
└── proc.service.test.js    # Child process execution test
index.js                    # Entrypoint CLI runner (node src/index.js)
```

### Structure Rationale

- **Flat & modular:** No bundler/transpiler needed. Raw ESM (`import ... from './...js'`).
- **Separation of transport and domain:** Routes only parse/validate HTTP params; `services/` do pure FS and child process calls. Keeps services testable without spinning up HTTP sockets.
- **Utils isolation:** Response formatting and body parsing are shared primitives across both FS and Proc routes.

## Architectural Patterns

### Pattern 1: Pure Table-Driven Router

**What:** Direct path dispatch table without Express/Fastify.  
**When to use:** Small fixed API surface (10-15 endpoints).  
**Trade-offs:** No route regex bloat; exact match is O(1), parameter extraction is dead simple.

**Example:**
```javascript
// src/router.js
export function createRouter() {
  const routes = new Map(); // key: "METHOD /path"

  return {
    add(method, path, handler) {
      routes.set(`${method.toUpperCase()} ${path}`, handler);
    },
    match(req) {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const handler = routes.get(`${req.method} ${url.pathname}`);
      return { handler, pathname: url.pathname, searchParams: url.searchParams };
    }
  };
}
```

### Pattern 2: Bounded Stream Body Collector

**What:** Accumulate request chunks into Buffer, abort early if byte limit exceeded.  
**When to use:** JSON RPC/REST payloads (command specs, small file writes).  
**Trade-offs:** Keeps entire payload in RAM up to limit (e.g. 10MB default). For huge uploads, stream directly to disk.

**Example:**
```javascript
// src/middleware/body.js
export async function readJsonBody(req, maxBytes = 10 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error('Payload Too Large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  return raw ? JSON.parse(raw) : {};
}
```

### Pattern 3: Spawn Wrapper with Direct Stream / Event Chunking

**What:** Run Windows/POSIX command via `spawn` with headful terminal inheritance or piped IO.  
**When to use:** Running `git`, `npm`, build tools, custom CLIs.  
**Trade-offs:** `exec` buffers max 1MB and fails on large outputs. `spawn` with manual stdout/stderr buffering avoids truncation and supports streaming long-running tasks.

**Example:**
```javascript
// src/services/proc.service.js
import { spawn } from 'node:child_process';

export function runProcess({ command, args = [], cwd, env = {}, timeout = 60000 }) {
  return new Promise((resolve, reject) => {
    // On Windows, running batch/cmd utilities often needs shell: true or exact cmd
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
      windowsHide: false // Crucial for headful compliance / avoiding EDR headless block
    });

    const stdout = [];
    const stderr = [];

    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const err = new Error(`Command timed out after ${timeout}ms`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, timeout);

    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdout).toString('utf-8'),
        stderr: Buffer.concat(stderr).toString('utf-8')
      });
    });
  });
}
```

## Data Flow

### Request Flow (JSON FS / Process)

```
[Client (Tauri / React App)]
    │ HTTP POST /api/fs/read { "path": "D:/data.txt" }
    ▼
[server.js]
    │ 1. Validate Loopback RemoteAddress & Host header
    │ 2. Apply CORS Headers
    ▼
[router.js]
    │ Match method + pathname -> routes/fs.routes.js
    ▼
[middleware/body.js]
    │ Read & parse JSON body safely with size limit
    ▼
[fs.service.js]
    │ Calls node:fs/promises.readFile(...)
    ▼
[utils/response.js]
    │ Format { ok: true, data: { content: "...", encoding: "utf-8" } }
    ▼
[Client Response (HTTP 200)]
```

### Process Streaming Data Flow (Long Output / CLI tool)

```
[Client]
    │ HTTP POST /api/proc/stream { "command": "git", "args": ["status"] }
    ▼
[proc.routes.js] -> [proc.service.js: spawn()]
    │ Responds with Content-Type: application/x-ndjson (or text/event-stream)
    ├─ child.stdout 'data' ──> res.write(JSON.stringify({ type: 'stdout', chunk }) + '\n')
    ├─ child.stderr 'data' ──> res.write(JSON.stringify({ type: 'stderr', chunk }) + '\n')
    └─ child 'close' (code) ─> res.end(JSON.stringify({ type: 'close', exitCode: code }) + '\n')
```

## Build Order (Component Dependencies)

To implement the gateway systematically, build components in this exact order:

```
Phase 1: Foundation & HTTP Skeleton
  └─ config.js -> response.js & errors.js -> security.js & cors.js -> router.js -> server.js (/health)

Phase 2: Request Parser & FS Service
  └─ body.js -> fs.service.js -> fs.routes.js (read, write, stat, mkdir, readdir, rm)

Phase 3: Child Process Execution Service
  └─ proc.service.js (buffered spawn) -> proc.routes.js (/api/proc/exec)

Phase 4: Streaming Support (Large Files & Proc IO)
  └─ stream response helper -> fs stream read/write -> proc streaming endpoint (NDJSON/SSE)
```

### Ordering Rationale

1. **Foundation first:** Server lifecycle, loopback security, CORS, and uniform response/error formatting are shared prerequisites for every endpoint. Verification: `GET /health` works.
2. **FS Service before Process Runner:** Filesystem operations are lower risk, stateless, and needed early to verify local path handling on Windows without hanging subprocesses.
3. **Buffered Process Execution:** Implement standard non-streaming `spawn` first. Tests git/npm execution and confirms bypass of EDR headless process blocking.
4. **Streaming enhancements last:** Streaming adds chunking/keep-alive complexity. Layer it on top of validated FS and Proc foundations.

## Anti-Patterns

### Anti-Pattern 1: Using `child_process.exec` instead of `spawn`

**What people do:** Call `exec("git status")` because of simple callback syntax.  
**Why it's wrong:** `exec` buffers output with max 1MB default (`maxBuffer`), crashes on large diffs, exposes command injection vulnerabilities when interpolating raw shell strings, and invokes `/bin/sh` or `cmd.exe` unnecessarily.  
**Do this instead:** Use `spawn(command, args, { shell: false })` with streaming buffer accumulation or parameter array.

### Anti-Pattern 2: Reading Entire Files into RAM with `readFile` for All Requests

**What people do:** `await fs.readFile(bigPath)` regardless of file size.  
**Why it's wrong:** A 1GB log or media file spikes Node process memory, triggers V8 heap limit crash (`ERR_WORKER_OUT_OF_MEMORY`), and blocks event loop.  
**Do this instead:** Expose file streaming endpoint using `node:fs.createReadStream(path).pipe(res)` with proper `Content-Length` and MIME headers.

### Anti-Pattern 3: Binding Server to `0.0.0.0` or Missing Host Header Validation

**What people do:** Listen on default `0.0.0.0` without origin or host check.  
**Why it's wrong:** Exposes file system and terminal execution to the entire local network (LAN) and allows DNS rebinding attacks from malicious web pages opened in browser.  
**Do this instead:** Hard bind to `127.0.0.1`, verify `req.socket.remoteAddress` is `127.0.0.1` or `::ffff:127.0.0.1`, reject mismatching `Host` headers.

## Scaling & Constraints Considerations

| Scale / Scope | Architecture Adjustments |
|---------------|--------------------------|
| **Single Desktop Client** (Tauri app, 1-10 req/s) | Monolithic single-process Node stdlib. Zero external dependencies. In-memory buffering up to 10MB. |
| **Concurrent Process Spawns** (1-5 jobs) | Concurrency semaphore or queue in `proc.service.js` to prevent thread/process starvation on host. |
| **High Output Streams** (>100MB output) | Direct pipe backpressure (`child.stdout.pipe(res)`) instead of accumulating chunks in memory array. |

## Sources

- Node.js Documentation: `node:http` (HTTP server & streaming)
- Node.js Documentation: `node:fs/promises` & `node:fs` (File system operations)
- Node.js Documentation: `node:child_process` (`spawn` vs `exec` semantics, Windows options)
- Project Requirements: `.planning/PROJECT.md` (Node.js stdlib only, Windows 11 Enterprise EDR context)

---
*Architecture research for: File System Gateway (fs-gw)*  
*Researched: 2026-11-02*
