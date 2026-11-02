# Phase 1: Core Gateway & Security - Pattern Map

**Mapped:** 2026-11-02  
**Files analyzed:** 13  
**Analogs found:** 0 / 13 (Greenfield codebase; reference patterns established from technical research)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `package.json` | config | file-I/O | None (Greenfield) | none |
| `src/config.js` | config | request-response | None (Greenfield) | none |
| `src/server.js` | service | request-response | None (Greenfield) | none |
| `src/router.js` | controller | request-response | None (Greenfield) | none |
| `src/middleware/security.js` | middleware | request-response | None (Greenfield) | none |
| `src/middleware/cors.js` | middleware | request-response | None (Greenfield) | none |
| `src/middleware/body.js` | middleware | streaming | None (Greenfield) | none |
| `src/routes/health.route.js` | route | request-response | None (Greenfield) | none |
| `src/utils/response.js` | utility | request-response | None (Greenfield) | none |
| `src/utils/errors.js` | model | request-response | None (Greenfield) | none |
| `test/server.test.js` | test | request-response | None (Greenfield) | none |
| `test/body.test.js` | test | streaming | None (Greenfield) | none |
| `index.js` | utility | event-driven | None (Greenfield) | none |

---

## Pattern Assignments

Since repository has no prior implementation files, patterns originate from verified architectural specifications in `.planning/phases/01-core-gateway-security/01-RESEARCH.md`.

### `src/server.js` (service, request-response)

**Analog:** Reference Architecture in `01-RESEARCH.md` (lines 285-315)

**Imports pattern:**
```javascript
import http from 'node:http';
import { handleCors } from './middleware/cors.js';
import { validateHost } from './middleware/security.js';
import { sendError } from './utils/response.js';
```

**Core server factory pattern:**
```javascript
export function createGatewayServer(router, options = {}) {
  const port = options.port || 4820;
  const host = options.host || '127.0.0.1';

  const server = http.createServer(async (req, res) => {
    // 1. Host & Loopback Guard (DNS rebinding prevention)
    if (!validateHost(req, port)) {
      return sendError(res, 403, 'Forbidden: Invalid Host header', 'ERR_FORBIDDEN_HOST');
    }

    // 2. CORS Preflight & Headers
    if (handleCors(req, res)) return;

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

---

### `src/middleware/security.js` (middleware, request-response)

**Analog:** Research Pattern 1 in `01-RESEARCH.md` (lines 165-179)

**Host validation pattern:**
```javascript
export function validateHost(req, port = 4820) {
  const rawHost = req.headers.host;
  if (!rawHost) return false;

  const allowedHosts = new Set([
    '127.0.0.1',
    'localhost',
    `127.0.0.1:${port}`,
    `localhost:${port}`
  ]);

  return allowedHosts.has(rawHost.toLowerCase());
}
```

---

### `src/middleware/cors.js` (middleware, request-response)

**Analog:** Research CORS Specification in `01-RESEARCH.md` (lines 37-38, 271-275)

**CORS handler pattern:**
```javascript
const ALLOWED_ORIGIN_PATTERNS = [
  /^tauri:\/\/localhost$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/
];

export function handleCors(req, res) {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGIN_PATTERNS.some(re => re.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
```

---

### `src/middleware/body.js` (middleware, streaming)

**Analog:** Research Pattern 2 in `01-RESEARCH.md` (lines 186-213)

**Bounded stream reader pattern:**
```javascript
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

---

### `src/router.js` (controller, request-response)

**Analog:** Research Architecture Map in `01-RESEARCH.md` (lines 119-122)

**Lightweight dispatcher pattern:**
```javascript
export class Router {
  constructor() {
    this.routes = new Map(); // key: "METHOD /pathname"
  }

  register(method, path, handler) {
    this.routes.set(`${method.toUpperCase()} ${path}`, handler);
  }

  async dispatch(req, res) {
    const parsedUrl = new URL(req.url, 'http://127.0.0.1');
    const key = `${req.method.toUpperCase()} ${parsedUrl.pathname}`;
    const handler = this.routes.get(key);

    if (!handler) {
      const err = new Error(`Route not found: ${req.method} ${parsedUrl.pathname}`);
      err.statusCode = 404;
      err.code = 'ERR_NOT_FOUND';
      throw err;
    }

    await handler(req, res, parsedUrl);
  }
}
```

---

### `src/utils/response.js` (utility, request-response)

**Analog:** Research Pattern 3 in `01-RESEARCH.md` (lines 223-241)

**Envelope output pattern:**
```javascript
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

---

### `src/routes/health.route.js` (route, request-response)

**Analog:** Requirements CORE-02 & Research in `01-RESEARCH.md` (lines 36, 149)

**Healthcheck handler pattern:**
```javascript
import { sendJson } from '../utils/response.js';

export function healthHandler(req, res) {
  sendJson(res, 200, {
    status: 'ok',
    uptime: process.uptime(),
    platform: process.platform,
    node: process.version
  });
}
```

---

### `test/server.test.js` (test, request-response)

**Analog:** Research Example 2 in `01-RESEARCH.md` (lines 320-369)

**Node stdlib integration test pattern:**
```javascript
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayServer } from '../src/server.js';
import { Router } from '../src/router.js';
import { healthHandler } from '../src/routes/health.route.js';

describe('Gateway Server & Security Integration', () => {
  let server;
  const PORT = 4821;

  before(async () => {
    const router = new Router();
    router.register('GET', '/health', healthHandler);
    server = createGatewayServer(router, { port: PORT });
    await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  });

  after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  test('GET /health returns 200 with standard envelope', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.status, 'ok');
  });
});
```

---

## Shared Patterns

### Response Envelope
**Source:** `src/utils/response.js`  
**Apply to:** All HTTP endpoints and error handling middleware  
- Success envelope: `{ ok: true, data: any }`
- Error envelope: `{ ok: false, error: string, code: string }`

### Error Handling
**Source:** `src/utils/errors.js`  
**Apply to:** Handlers, router, and middleware  
```javascript
export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'ERR_INTERNAL_SERVER_ERROR') {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
```

### Loopback Enforcement
**Source:** `src/config.js` and `src/server.js`  
**Apply to:** Network listener  
- Listener MUST explicitly bind `127.0.0.1`. Never default to `0.0.0.0`.

---

## No Analog Found

Greenfield repository. All files are new. Research reference patterns in `01-RESEARCH.md` serve as primary baseline:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `package.json` | config | file-I/O | Greenfield project. Initial ESM package definition. |
| `src/config.js` | config | request-response | Greenfield project. First configuration module. |
| `src/server.js` | service | request-response | Greenfield project. First HTTP server instance. |
| `src/router.js` | controller | request-response | Greenfield project. First router module. |
| `src/middleware/security.js` | middleware | request-response | Greenfield project. First security guard. |
| `src/middleware/cors.js` | middleware | request-response | Greenfield project. First CORS middleware. |
| `src/middleware/body.js` | middleware | streaming | Greenfield project. First body parser. |
| `src/routes/health.route.js` | route | request-response | Greenfield project. First HTTP route. |
| `src/utils/response.js` | utility | request-response | Greenfield project. First response helper. |
| `src/utils/errors.js` | model | request-response | Greenfield project. First custom error class. |
| `test/server.test.js` | test | request-response | Greenfield project. First integration test suite. |
| `test/body.test.js` | test | streaming | Greenfield project. First unit test suite. |
| `index.js` | utility | event-driven | Greenfield project. First application entrypoint. |

---

## Metadata

**Analog search scope:** Repository root (`D:\personal\fs-gw`)  
**Files scanned:** 0 existing JS source files (greenfield repository)  
**Pattern extraction date:** 2026-11-02  
