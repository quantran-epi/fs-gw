# Phase 1: Core Gateway & Security - Research

**Researched:** 2026-11-02
**Domain:** Node.js native HTTP server, loopback binding, DNS rebinding mitigation, CORS, JSON envelope, zero-dependency architecture
**Confidence:** HIGH

## Summary

Phase 1 establishes the foundational communication conduit for `fs-gw` (`File System Gateway`). The gateway runs as a headful Node.js process inside a PowerShell terminal on Windows 11 Enterprise to bypass headless binary blocking policies imposed by Trellix EDR.

All functionality in Phase 1 relies strictly on the Node.js standard library (`node:http`, `node:url`, `node:stream/consumers`, `node:test`, `node:assert/strict`). Zero third-party npm packages are required or permitted. The core deliverables are:
1. HTTP server bound exclusively to `127.0.0.1` on port 4820 (configurable via `FS_GW_PORT` / `--port`).
2. Strict `Host` header guard rejecting non-loopback hosts (HTTP 403 Forbidden) to defeat DNS rebinding attacks.
3. CORS handler accommodating desktop frontend origins (`tauri://localhost`, `http://localhost:*`, `http://127.0.0.1:*`) with full `OPTIONS` preflight support (HTTP 204).
4. Standardized JSON response envelope (`{ ok: true, data: ... }` and `{ ok: false, error: string, code: string }`).
5. Bounded JSON body parser enforcing a 10MB limit with graceful handling of malformed payloads (HTTP 400 Bad Request).
6. Healthcheck endpoint `GET /health` returning status, uptime, platform, and Node version.

**Primary recommendation:** Build a lightweight, table-driven dispatcher over `node:http.createServer()` using pure functional middlewares for host validation, CORS, and body aggregation. Keep all code in native ESM with zero build steps.

## Project Constraints (from CLAUDE.md)

- **Runtime:** Node.js >=20.19 LTS (verified local: `v20.19.5` on `win32`).
- **Dependencies:** Node.js stdlib only. Zero npm dependencies (`node_modules` must remain empty or non-existent).
- **Network Interface:** Listen strictly on `127.0.0.1` (IPv4 loopback). Explicitly reject or never bind `0.0.0.0` or external network interfaces.
- **Port:** Default fixed port `4820`, configurable via environment variable or CLI argument.
- **Execution Mode:** Server runs headful inside user PowerShell terminal session.
- **Testing:** Native `node:test` and `node:assert/strict` with zero external test runners.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORE-01 | Gateway server starts on pure Node.js stdlib (`node:http`), binds loopback `127.0.0.1:4820`, 0 npm dependencies. | Native `http.createServer().listen(port, '127.0.0.1')` provides deterministic loopback isolation. |
| CORE-02 | Endpoint `GET /health` returns server health payload (`status: "ok"`, uptime, platform, node version). | Stdlib `process.uptime()`, `process.platform`, `process.version` supply required metadata. |
| CORE-03 | CORS preflight handles all methods (GET, POST, OPTIONS) and necessary headers for Vite / Tauri frontend. | Handling `OPTIONS` with HTTP 204 and setting `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`. |
| CORE-04 | Protect loopback against DNS rebinding attacks by validating strict `Host` header (`127.0.0.1`, `localhost`). | Early middleware inspects `req.headers.host`; rejects foreign hostnames (e.g., `evil.com`) with HTTP 403 Forbidden. |
| CORE-05 | Bounded JSON body parser (max 10MB) with syntax error handling and standardized response envelope (`{ ok, data, error, code }`). | `node:stream/consumers` or chunk buffer collector enforcing 10MB ceiling, wrapping errors in uniform schema. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Port Binding & Lifecycle | API / Backend (`node:http`) | — | Server must exclusively bind `127.0.0.1` to prevent LAN exposure. |
| DNS Rebinding Guard | API / Backend (Security Guard) | — | Must execute before any routing or parsing to drop malicious browser requests. |
| CORS Preflight (`OPTIONS`) | API / Backend (CORS Handler) | Browser / Client | Server dictates allowed local origins and HTTP methods for Tauri / Vite. |
| Request Body Parsing & Limits | API / Backend (Stream Consumer) | — | Server enforces 10MB memory protection before handing payload to business logic. |
| Uniform Response Formatting | API / Backend (Response Utility) | Client (Consumer) | Eliminates inconsistent error shapes across all endpoints. |
| Healthcheck Probe | API / Backend (Diagnostic Route) | Desktop App (Polling) | Desktop client polls `GET /health` to verify gateway readiness on app startup. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:http` | stdlib (Node 20+) | HTTP/1.1 Server & Client handling | Built-in, zero dependencies, minimal overhead, low-latency loopback IPC. [VERIFIED: nodejs.org] |
| `node:url` | stdlib (Node 20+) | URL parsing and query string handling | Standard WHATWG URL API integrated into Node runtime. [VERIFIED: nodejs.org] |
| `node:stream/consumers` | stdlib (Node 20+) | Stream parsing (`buffer`, `json`, `text`) | Native utility for consuming readable streams cleanly. [VERIFIED: nodejs.org] |
| `node:test` | stdlib (Node 20+) | Automated test runner | Instant execution via `node --test`, eliminates Jest/Vitest installation. [VERIFIED: nodejs.org] |
| `node:assert/strict` | stdlib (Node 20+) | Assertion library | Native assertion module with deep strict equality checking. [VERIFIED: nodejs.org] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:process` | stdlib | Process metadata & signal handling | Uptime, platform identification, `SIGINT`/`SIGTERM` graceful shutdown. [VERIFIED: nodejs.org] |
| `node:net` | stdlib | IP address validation | Checking remote socket address (`req.socket.remoteAddress`). [VERIFIED: nodejs.org] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:http` | Fastify / Express / Hono | External packages introduce 50+ transitive dependencies, potential supply-chain attacks, and slower cold start. Local proxy needs only 1-2 ms boot. |
| `node:test` | Vitest / Jest | Vitest adds 50MB+ node_modules. Native `node:test` requires 0 install and runs tests in sub-seconds. |

**Installation:**
```bash
# Zero external packages required!
# Standard package.json only specifies ESM module type:
npm init -y
```

## Package Legitimacy Audit

Zero external packages are used or installed in this phase. The project strictly uses the Node.js standard library.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| None (stdlib only) | N/A | N/A | N/A | github.com/nodejs/node | [OK] | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none  
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
[ Desktop App / Vite Dev Server (Tauri / Browser) ]
                         │
                         │ HTTP Requests (e.g., GET /health, POST ...)
                         ▼
             ┌───────────────────────┐
             │ node:http HTTP Server │ (bound strictly to 127.0.0.1:4820)
             └───────────┬───────────┘
                         │
                         ▼
        [ Guard 1: Host Header & IP Guard ]
        - Check req.headers.host in (127.0.0.1, localhost)
        - Check req.socket.remoteAddress is loopback (127.0.0.1, ::1)
        - REJECT -> HTTP 403 Forbidden { ok: false, error: "Forbidden", code: "ERR_FORBIDDEN_HOST" }
                         │ PASS
                         ▼
        [ Guard 2: CORS Preflight & Headers ]
        - If req.method === 'OPTIONS' -> Return HTTP 204 No Content
        - Set Access-Control-Allow-Origin, Methods, Headers
                         │
                         ▼
        [ Router / Dispatcher ]
        - Match METHOD + pathname (e.g., GET /health)
        - If NOT found -> HTTP 404 { ok: false, error: "Not Found", code: "ERR_NOT_FOUND" }
                         │
                         ▼
        [ Guard 3: Bounded Body Parser (if POST/PUT) ]
        - Stream length <= 10MB (10,485,760 bytes)
        - Exceeded -> HTTP 413 Payload Too Large
        - Malformed JSON -> HTTP 400 Bad Request { ok: false, error: "Invalid JSON", code: "ERR_INVALID_JSON" }
                         │
                         ▼
             [ Endpoint Route Handler ]
                 (GET /health)
                         │
                         ▼
             [ Unified Response Helper ]
    { ok: true, data: { status: "ok", uptime, platform, node } }
```

### Recommended Project Structure
```
src/
├── config.js              # Port (4820), Host (127.0.0.1), Limits (10MB)
├── server.js              # HTTP server bootstrap, listen, close handlers
├── router.js              # Lightweight Map-based route dispatcher
├── middleware/
│   ├── security.js        # Host header & loopback IP validation (DNS rebinding guard)
│   ├── cors.js            # CORS headers & OPTIONS preflight
│   └── body.js            # Bounded JSON body parser with byte limiting
├── routes/
│   └── health.route.js    # GET /health handler
└── utils/
    ├── response.js        # sendJson, sendError, standard envelope helpers
    └── errors.js          # AppError class with HTTP status mapping
test/
├── server.test.js         # Integration tests for server lifecycle, host guard, CORS, health
└── body.test.js           # Unit tests for JSON body parser & size limits
index.js                   # Application entrypoint
package.json               # ESM configuration ("type": "module")
```

### Pattern 1: DNS Rebinding & Host Header Guard
**What:** Intercepts incoming requests before routing. Rejects any request where `Host` header does not match local loopback domain.
**When to use:** Every request hitting the server.
**Example:**
```javascript
// src/middleware/security.js
const ALLOWED_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  `127.0.0.1:${process.env.FS_GW_PORT || 4820}`,
  `localhost:${process.env.FS_GW_PORT || 4820}`
]);

export function validateHost(req) {
  const rawHost = req.headers.host;
  if (!rawHost) return false;
  // Strip port if needed or match host directly
  return ALLOWED_HOSTS.has(rawHost.toLowerCase());
}
```

### Pattern 2: Bounded Stream Body Parser
**What:** Reads incoming stream chunks up to a fixed threshold (10MB) and parses JSON. If the stream exceeds 10MB, the stream is destroyed and a 413 error is returned. If parsing fails, a 400 error is returned.
**When to use:** All POST/PUT requests with `application/json` payload.
**Example:**
```javascript
// src/middleware/body.js
export async function readJsonBody(req, maxBytes = 10 * 1024 * 1024) {
  let totalBytes = 0;
  const chunks = [];

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      const err = new Error('Payload Too Large: exceeds 10MB limit');
      err.statusCode = 413;
      err.code = 'ERR_PAYLOAD_TOO_LARGE';
      throw err;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch (parseErr) {
    const err = new Error(`Malformed JSON payload: ${parseErr.message}`);
    err.statusCode = 400;
    err.code = 'ERR_INVALID_JSON';
    throw err;
  }
}
```

### Pattern 3: Standardized JSON Response Envelope
**What:** Uniform JSON responses for all requests.
**Schema:**
- Success: `{ "ok": true, "data": <any> }`
- Error: `{ "ok": false, "error": "<string>", "code": "<string>" }`
**Example:**
```javascript
// src/utils/response.js
export function sendJson(res, statusCode, data) {
  const body = JSON.stringify({ ok: true, data });
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

export function sendError(res, statusCode, message, code = 'ERR_GENERIC') {
  const body = JSON.stringify({ ok: false, error: message, code });
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}
```

### Anti-Patterns to Avoid
- **Binding to `0.0.0.0` or omission of host argument:** Calling `server.listen(4820)` without `'127.0.0.1'` binds all network interfaces, exposing gateway to local network (LAN) attackers.
- **Blind CORS `Access-Control-Allow-Origin: *`:** Allows any arbitrary web page running in user's browser to send requests to `fs-gw`. Restrict to local dev server and Tauri schemes (`tauri://localhost`, `http://localhost:*`, `http://127.0.0.1:*`).
- **Unbounded Memory Buffering:** Calling `Buffer.concat` without tracking chunk length allows trivial Denial of Service by streaming gigabytes of data into RAM.
- **Swallowing JSON Parse Errors:** Returning generic 500 Internal Server Error when client provides invalid JSON creates confusion. Must return structured 400 Bad Request with `ERR_INVALID_JSON`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| URL Parsing | Custom regex on `req.url` | Native `new URL(req.url, 'http://127.0.0.1')` | Handles query strings, percent-encoding, trailing slashes, and pathname extraction reliably. |
| Test Runner | Custom test scripts with `try/catch` | `node:test` + `node:assert/strict` | Node 20 provides native test assertions, reporting, async lifecycle hooks (`before`, `after`), and isolation out of the box. |
| Stream Aggregation | Complex event listener orchestration | `for await (const chunk of req)` | Native async iteration over readable streams handles backpressure, errors, and cleanup automatically. |

## Common Pitfalls

### Pitfall 1: DNS Rebinding Vulnerability
**What goes wrong:** Malicious public website binds a DNS domain (e.g. `attacker.com`) to `127.0.0.1`. The victim visits the site; the browser makes XMLHttpRequests or fetch requests to `http://attacker.com:4820/health`. Even though server is bound to `127.0.0.1`, the browser sends `Host: attacker.com`.
**Why it happens:** Localhost binding alone does not prevent browser cross-origin interaction if the host header resolves to loopback IP.
**How to avoid:** Validate `req.headers.host`. Reject with 403 Forbidden if host is not `127.0.0.1:*` or `localhost:*`.
**Warning signs:** Server responds with 200 OK when requested with `curl -H "Host: evil.com" http://127.0.0.1:4820/health`.

### Pitfall 2: Port Collision (EADDRINUSE)
**What goes wrong:** Gateway fails to boot if another instance or conflicting application occupies port 4820.
**Why it happens:** Hardcoded port without configuration or diagnostic messaging.
**How to avoid:** Allow setting port via `process.env.FS_GW_PORT` or CLI `--port <num>`. On `EADDRINUSE` event, print helpful diagnostic banner in PowerShell terminal indicating the port is blocked.
**Warning signs:** Uncaught exception `Error: listen EADDRINUSE: address already in use 127.0.0.1:4820` crashing process without clean console message.

### Pitfall 3: Incomplete CORS Preflight
**What goes wrong:** Desktop web client fails to call endpoints because preflight `OPTIONS` request returns 404 or missing headers (`Access-Control-Allow-Headers`).
**Why it happens:** Router handles only GET and POST, forgetting `OPTIONS` requests sent automatically by browsers prior to complex POST requests.
**How to avoid:** Intercept `OPTIONS` method in early middleware, reply with status 204 No Content, headers `Access-Control-Allow-Methods: GET, POST, OPTIONS`, and `Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With`.
**Warning signs:** Browser console error `Response to preflight request doesn't pass access control check: It does not have HTTP ok status`.

### Pitfall 4: Unhandled Stream Errors during Body Parsing
**What goes wrong:** If the client disconnects or aborts during a large POST body upload, the server throws unhandled error on `req` stream and crashes.
**Why it happens:** Missing error handling in stream iteration.
**How to avoid:** Wrap body reader in `try...catch` and handle `req.on('aborted')` / `req.on('error')` cleanly.

## Code Examples

### 1. Minimal Zero-Dependency Server with Host & CORS Guard
```javascript
// src/server.js
import http from 'node:http';
import { handleCors } from './middleware/cors.js';
import { validateHost } from './middleware/security.js';
import { sendError } from './utils/response.js';

export function createGatewayServer(router, options = {}) {
  const server = http.createServer(async (req, res) => {
    // 1. DNS Rebinding Protection
    if (!validateHost(req, options.port || 4820)) {
      return sendError(res, 403, 'Forbidden: Invalid Host header', 'ERR_FORBIDDEN_HOST');
    }

    // 2. CORS & Preflight
    const isPreflight = handleCors(req, res);
    if (isPreflight) return;

    // 3. Dispatch to Router
    try {
      await router.dispatch(req, res);
    } catch (err) {
      const status = err.statusCode || 500;
      const code = err.code || 'ERR_INTERNAL_SERVER_ERROR';
      sendError(res, status, err.message, code);
    }
  });

  return server;
}
```

### 2. Native Automated Integration Test with `node:test`
```javascript
// test/server.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServerInstance } from '../src/server.js';

describe('Gateway Server & Security Integration', () => {
  let server;
  const PORT = 4821; // isolate test port

  before(async () => {
    server = createServerInstance({ port: PORT });
    await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  test('GET /health returns 200 with valid metadata', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'ok');
    assert.equal(typeof body.data.uptime, 'number');
    assert.equal(body.data.platform, process.platform);
  });

  test('Reject request with foreign Host header (DNS rebinding guard)', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
      headers: { Host: 'evil.attacker.com' }
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, 'ERR_FORBIDDEN_HOST');
  });

  test('OPTIONS preflight returns 204 with CORS headers', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'POST'
      }
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express / Fastify for micro-proxies | Native `node:http` with ESM | Node 16+ / 20+ | Eliminates 50+ npm dependencies, 0ms npm install, clean security audit. |
| Jest / Mocha with Babel/ts-node | Native `node:test` + `node:assert/strict` | Node 18+ / 20+ LTS | Zero tooling required. Tests execute directly via `node --test`. |
| `body-parser` npm package | `node:stream/consumers` or `for await (const chunk of req)` | Node 17.5+ | Native async iteration makes stream chunk aggregation trivial in 15 lines of code. |
| Wildcard CORS `*` on localhost | Origin reflection matching `tauri://localhost` and `localhost:*` | OWASP 2023+ recommendations | Completely mitigates drive-by localhost RCE from malicious browser tabs. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Default port 4820 is standard across fs-gw documentation and desktop client | Standard Stack / Architecture | Low; port is made configurable via `process.env.FS_GW_PORT` and `--port`. |
| A2 | 10MB request body limit is sufficient for JSON operations in Phase 1 | Requirements & Parser | Low; Phase 2 file streaming will use chunked streaming rather than buffering into RAM. |

## Open Questions

1. **How should port conflict be resolved if 4820 is busy?**
   - What we know: `EADDRINUSE` causes the server to throw an error on startup.
   - What's unclear: Should the server auto-increment to 4821 or fail fast with clear instructions?
   - Recommendation: For MVP Phase 1, fail fast with a clear error message in the PowerShell console and support `--port <num>` or `FS_GW_PORT=<num>`. Auto-increment port discovery file is formally deferred to v2 (ADV-02 in REQUIREMENTS.md).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | v20.19.5 | — |
| Windows 11 / win32 | OS Platform | ✓ | 10.0.26200 | — |
| PowerShell 5.1 / 7+ | Host Console | ✓ | 5.1 / 7+ | Command Prompt / Windows Terminal |
| npm | Package Init | ✓ | 10.8.2 | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Deferred to v2 (ADV-01 token auth); Phase 1 isolates via loopback and host headers. |
| V3 Session Management | no | Gateway is stateless HTTP RPC. |
| V4 Access Control | yes | Loopback binding (`127.0.0.1`), DNS rebinding mitigation (Host header check), CORS origin restrictions. |
| V5 Input Validation | yes | Bounded JSON parser (10MB limit), malformed JSON syntax catching, strict HTTP method verification. |
| V6 Cryptography | no | Localhost HTTP loopback communication. No SSL overhead required on loopback. |

### Known Threat Patterns for Localhost Gateway

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| DNS Rebinding Attack | Elevation of Privilege / Tampering | Validate `req.headers.host` against `127.0.0.1` and `localhost`. Reject foreign hostnames with HTTP 403. |
| Cross-Origin Exploitation (CSRF / Drive-by Web) | Tampering / Information Disclosure | Restrict CORS allowed origins to desktop app (`tauri://localhost`, `http://localhost:*`). Reject arbitrary web origins. |
| Denial of Service (Memory Exhaustion) | Denial of Service | Enforce maximum payload limit (10MB) during stream collection. Abort stream immediately if exceeded. |
| External Network Access | Information Disclosure / Tampering | Explicitly bind listener to `127.0.0.1`. Never bind `0.0.0.0`. |

## Sources

### Primary (HIGH confidence)
- Node.js Documentation (`node:http`, `node:stream/consumers`, `node:test`, `node:assert`) - [https://nodejs.org/docs/latest-v20.x/api/](https://nodejs.org/docs/latest-v20.x/api/)
- Local environment inspection: Node.js `v20.19.5` on `win32` platform.

### Secondary (MEDIUM confidence)
- OWASP DNS Rebinding Prevention Guidance for Localhost Services.
- Tauri Security Guidelines for Localhost IPC and Webview Origins.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - stdlib only, verified working on installed Node 20.19.5
- Architecture: HIGH - straightforward HTTP dispatcher and middleware pattern
- Pitfalls: HIGH - DNS rebinding, CORS preflight, and body limits thoroughly documented

**Research date:** 2026-11-02  
**Valid until:** 2027-11-02 (Stable Node.js stdlib APIs)
