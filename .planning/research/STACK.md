# Stack Research

**Domain:** Zero-dependency Node.js local filesystem & process execution gateway (Windows)
**Researched:** 2026-11-02
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js Runtime | >=20.19 LTS (target 20.x/22.x) | Execution runtime | Long-Term Support, native fetch, native test runner, ESM support, standard library security fixes (CVE-2024-27980). |
| `node:http` | Node stdlib | HTTP/1.1 REST Server | Zero dependency. Perfect for low-latency localhost IPC with Tauri frontend. No framework overhead, no node_modules baggage. |
| `node:fs/promises` | Node stdlib | Async filesystem operations | Modern Promise-based API for `readFile`, `writeFile`, `mkdir`, `rm`, `readdir`, `stat`. Non-blocking event loop. |
| `node:child_process` | Node stdlib | Shell command & binary execution | `spawn` with streaming stdout/stderr or `execFile` with argument isolation. Runs headfully under host PowerShell without EDR headless block. |
| `node:path` / `node:path/win32` | Node stdlib | Windows path resolution & traversal guard | Native Windows drive letter, separator, and UNC path handling. Prevents path traversal bugs. |
| `node:stream` & `node:stream/consumers` | Node stdlib | Request body parsing & response streaming | Native stream consumption (`buffer(req)`, `json(req)`), zero-dependency request parsing, efficient chunked responses. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:test` | Node stdlib | Built-in test runner | Unit and integration testing without Jest/Vitest installation. |
| `node:assert/strict` | Node stdlib | Invariant assertions & test assertions | Validating request payloads, route matching, and test assertions. |
| `node:crypto` | Node stdlib | Secure token generation / path hashing | When generating process tracking IDs or checking file integrity (ETag/SHA256). |
| `node:url` | Node stdlib | URL & query string parsing | Native `URL` class (`new URL(req.url, 'http://127.0.0.1')`) for zero-dependency query param parsing. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Node.js `--watch` flag | Live code reloading in dev | Native in Node 20+, replaces `nodemon`. Run: `node --watch server.mjs`. |
| PowerShell 7+ / 5.1 | Host execution shell | The gateway runs headful inside a user PowerShell window to satisfy Windows 11 Enterprise EDR policy. |

## Installation

```bash
# Core: Zero external npm packages required
# Initializing clean package.json:
npm init -y

# Zero npm production dependencies!
# Zero npm dev dependencies!
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `node:http` | Express / Fastify / Hono | Use Fastify/Express only when multi-tier middleware, OpenAPI auto-gen, or plugin ecosystem is mandatory. For single-purpose localhost proxy, 3rd party adds 50+ transitive dependencies and supply chain attack surface. |
| `node:fs/promises` | `fs-extra` | Use `fs-extra` only on legacy Node (<14). Modern Node `fs/promises` natively provides `mkdir(path, { recursive: true })` and `rm(path, { recursive: true, force: true })`. |
| `node:child_process` (`spawn`) | `execa` | Use `execa` for complex cross-platform signal propagation in public CLI libraries. For dedicated Windows-only gateway in PowerShell, stdlib `spawn` handles all requirements with zero overhead. |
| Native `node:test` | Vitest / Jest | Use Vitest in complex frontend UI repos. For a backend gateway with 0 npm dependencies, `node --test` is instant and avoids downloading 50MB+ test runners. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Express / Koa / Fastify | Heavy node_modules footprint, maintenance overhead, supply chain vulnerability surface, slower cold boot. | Native `node:http` request dispatcher. |
| `node:child_process` `exec` with string concatenation | Prone to shell injection vulnerabilities on Windows (`cmd.exe /c`). Dangerous with user input. | `child_process.spawn` or `child_process.execFile` with explicit args array. |
| `fs-extra` | Redundant since Node 16+ stdlib handles recursive `mkdir`, `rm`, `cp`. | `node:fs/promises`. |
| `body-parser` | Unnecessary external dependency; easily replaced by `node:stream/consumers` `json(req)` or `buffer(req)`. | `node:stream/consumers` or native buffer accumulation. |
| Shell execution without `windowsHide: false` / unmanaged shells | The whole point of fs-gw is running commands headfully from the user's active session to bypass headless EDR blocks. Spawning with headless flags can trigger AppLocker/EDR. | Run child processes inheriting standard shell context or via user terminal. |

## Stack Patterns by Variant

**If handling large files (>100MB):**
- Use `node:fs.createReadStream` piped to `res` with chunked transfer encoding (`Transfer-Encoding: chunked`).
- Avoid buffering entire file in memory via `readFile`.

**If handling long-running process execution (e.g. `npm install`, `git clone`):**
- Use Server-Sent Events (SSE) or chunked HTTP stream (`res.write`) piping `child.stdout` and `child.stderr` directly to client.
- Avoid buffering all process output in memory before sending response.

**If resolving paths on Windows:**
- Use `node:path/win32.resolve` or `node:path.resolve` combined with traversal validation (`resolvedPath.startsWith(allowedRoot)` if sandbox required, or absolute check).

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Node.js 20.x LTS | Windows 11 Enterprise | Fully supported. Native `node:test`, `node:stream/consumers`, modern `fs/promises`. |
| Node.js 22.x LTS | Windows 11 Enterprise | Fully supported. Even stricter security defaults and performance improvements. |
| ESM (`"type": "module"`) | Node.js 20+ | Recommended for clean standard imports (`import http from 'node:http'`). |

## Sources

- Node.js Official Documentation (`node:http`, `node:fs`, `node:child_process`, `node:test`)
- Local runtime verification: Node v20.19.5 on Windows 11 Pro 10.0.26200
- CVE-2024-27980 command injection mitigation documentation for Windows `child_process`

---
*Stack research for: File System Gateway (fs-gw)*
*Researched: 2026-11-02*
