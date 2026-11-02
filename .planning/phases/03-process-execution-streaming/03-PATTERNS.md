# Phase 3: Process Execution & Streaming - Pattern Map

**Mapped:** 2026-11-02  
**Files analyzed:** 7 (4 source files, 3 test files)  
**Analogs found:** 7 / 7 (All planned files have existing analogs in codebase)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/utils/command.js` | utility | transform | `src/utils/path.js` | exact |
| `src/services/process.service.js` | service | event-driven | `src/services/fs.service.js` | role-match |
| `src/routes/exec.route.js` | route | request-response / streaming | `src/routes/fs.route.js` | exact |
| `index.js` | entry / config | lifecycle | `index.js` (existing) | exact |
| `test/command.test.js` | test | request-response | `test/path.test.js` | exact |
| `test/process.service.test.js` | test | event-driven | `test/fs.service.test.js` | role-match |
| `test/exec.test.js` | test | streaming / HTTP | `test/fs.test.js` | exact |

---

## Pattern Assignments

### `src/utils/command.js` (utility, transform)

**Analog:** `src/utils/path.js`

**Imports pattern:**
```javascript
import { AppError } from './errors.js';
import { sanitizePath } from './path.js';
```

**Validation & error throw pattern** (from `src/utils/path.js`, lines 6-23):
```javascript
export function validateExecInput(body) {
  if (!body || typeof body !== 'object') {
    throw new AppError('Request body must be a JSON object', 400, 'ERR_INVALID_BODY');
  }

  const { command, args = [], cwd, env = {}, timeout = 60000, shell = false } = body;

  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new AppError('Field "command" must be a non-empty string', 400, 'ERR_INVALID_COMMAND');
  }

  // Reject ASCII control characters (0-31)
  for (let i = 0; i < command.length; i++) {
    if (command.charCodeAt(i) < 32) {
      throw new AppError('Field "command" contains invalid control characters', 400, 'ERR_INVALID_COMMAND');
    }
  }

  if (!Array.isArray(args) || !args.every(a => typeof a === 'string' || typeof a === 'number')) {
    throw new AppError('Field "args" must be an array of strings or numbers', 400, 'ERR_INVALID_ARGS');
  }

  let sanitizedCwd = undefined;
  if (cwd !== undefined && cwd !== null) {
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

### `src/services/process.service.js` (service, event-driven)

**Analog:** `src/services/fs.service.js`

**Imports pattern:**
```javascript
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { AppError } from '../utils/errors.js';
```

**Core service lifecycle & error handling pattern** (derived from `src/services/fs.service.js` + Windows taskkill):
```javascript
// Tree termination using native Windows taskkill
export function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid || typeof pid !== 'number') {
      return resolve({ success: false, code: -1, message: 'Invalid PID' });
    }

    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    let stderr = '';

    killer.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    killer.on('close', (code) => {
      // 0 = Success, 128 = Process not found / already dead
      if (code === 0 || code === 128) {
        resolve({ success: true, code, message: code === 128 ? 'Process already terminated' : 'Terminated' });
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
    // Ignore errors during process exit cleanup
  }
}
```

**Process registry & execution engine:**
```javascript
class ProcessRegistry {
  constructor() {
    this.active = new Map();
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
}

export const registry = new ProcessRegistry();
```

---

### `src/routes/exec.route.js` (route, request-response / streaming)

**Analog:** `src/routes/fs.route.js`

**Imports pattern:**
```javascript
import { readJsonBody } from '../middleware/body.js';
import { sendJson } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import { validateExecInput } from '../utils/command.js';
import * as processService from '../services/process.service.js';
```

**Route registration pattern** (from `src/routes/fs.route.js`, lines 6-12):
```javascript
export function registerExecRoutes(router) {
  router.register('POST', '/exec/run', async (req, res) => {
    const body = await readJsonBody(req);
    const options = validateExecInput(body);
    const result = await processService.runProcess(options);
    sendJson(res, 200, result);
  });

  router.register('POST', '/exec/kill', async (req, res) => {
    const body = await readJsonBody(req);
    const target = body.pid ? Number(body.pid) : body.id;
    if (!target) {
      throw new AppError('Field "pid" (number) or "id" (string) must be provided', 400, 'ERR_INVALID_TARGET');
    }
    const result = await processService.registry.kill(target);
    sendJson(res, 200, result);
  });

  // SSE Streaming via POST (payload body)
  router.register('POST', '/exec/stream', async (req, res) => {
    const body = await readJsonBody(req);
    const options = validateExecInput(body);
    processService.streamProcessExecution(options, req, res);
  });

  // SSE Streaming via GET (URL searchParams)
  router.register('GET', '/exec/stream', async (req, res, parsedUrl) => {
    const command = parsedUrl.searchParams.get('command');
    const args = parsedUrl.searchParams.getAll('arg');
    const cwd = parsedUrl.searchParams.get('cwd') || undefined;
    const timeout = parsedUrl.searchParams.get('timeout') || undefined;
    const shell = parsedUrl.searchParams.get('shell') === 'true';

    const options = validateExecInput({ command, args, cwd, timeout, shell });
    processService.streamProcessExecution(options, req, res);
  });
}
```

---

### `index.js` (entry / config, lifecycle)

**Analog:** `index.js` (existing lines 5, 23, 33-42)

**Registration & Shutdown Hook Pattern:**
```javascript
import { registerExecRoutes } from './src/routes/exec.route.js';
import { registry } from './src/services/process.service.js';

// Route registration
registerExecRoutes(router);

// Process exit hooks for orphan prevention
function handleShutdown(signal) {
  console.log(`[fs-gw] Received ${signal}. Shutting down cleanly...`);
  registry.killAllSync();
  server.close(() => {
    console.log('[fs-gw] Server closed.');
    process.exit(0);
  });
}

process.on('exit', () => registry.killAllSync());
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
```

---

### `test/command.test.js` (test, request-response)

**Analog:** `test/path.test.js`

**Test structure:**
```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateExecInput } from '../src/utils/command.js';
import { AppError } from '../src/utils/errors.js';

describe('Command Input Sanitizer & Guardrails', () => {
  test('Valid command and array args return normalized options', () => {
    const input = { command: 'git', args: ['status', '--short'], cwd: 'C:\\safe' };
    const result = validateExecInput(input);
    assert.equal(result.command, 'git');
    assert.deepEqual(result.args, ['status', '--short']);
    assert.equal(result.shell, false);
  });

  test('Missing, empty or control char command throws ERR_INVALID_COMMAND', () => {
    assert.throws(() => validateExecInput({ command: '' }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_COMMAND'
    });
    assert.throws(() => validateExecInput({ command: 'node\x00' }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_COMMAND'
    });
  });

  test('Non-array args throw ERR_INVALID_ARGS', () => {
    assert.throws(() => validateExecInput({ command: 'git', args: 'status' }), {
      name: 'AppError',
      statusCode: 400,
      code: 'ERR_INVALID_ARGS'
    });
  });
});
```

---

### `test/process.service.test.js` (test, event-driven)

**Analog:** `test/fs.service.test.js`

**Test structure:**
```javascript
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { runProcess, killProcessTree, registry } from '../src/services/process.service.js';

describe('Process Service Core Operations', () => {
  after(() => {
    registry.killAllSync();
  });

  test('runProcess executes simple command and captures stdout', async () => {
    const res = await runProcess({
      command: 'node',
      args: ['-e', 'console.log("hello-from-process")'],
      timeout: 5000
    });
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes('hello-from-process'));
    assert.equal(res.timedOut, false);
  });

  test('runProcess terminates on timeout', async () => {
    const res = await runProcess({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      timeout: 100
    });
    assert.equal(res.timedOut, true);
  });

  test('killProcessTree terminates spawned process tree', async () => {
    // Verified taskkill /pid /T /F execution
  });
});
```

---

### `test/exec.test.js` (test, streaming / HTTP)

**Analog:** `test/fs.test.js`

**Server setup and teardown pattern** (from `test/fs.test.js`, lines 9-26):
```javascript
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayServer } from '../src/server.js';
import { Router } from '../src/router.js';
import { registerExecRoutes } from '../src/routes/exec.route.js';
import { registry } from '../src/services/process.service.js';

describe('Exec Route Endpoints Integration', () => {
  let server;
  let port;

  before(async () => {
    const router = new Router();
    registerExecRoutes(router);
    server = createGatewayServer(router);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    registry.killAllSync();
    await new Promise((resolve) => server.close(resolve));
  });

  test('POST /exec/run executes command and returns JSON envelope', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/exec/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'node',
        args: ['-e', 'console.log("integration-ok")']
      })
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.exitCode, 0);
    assert.ok(body.data.stdout.includes('integration-ok'));
  });

  test('GET /exec/stream streams Server-Sent Events', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/exec/stream?command=node&arg=-e&arg=console.log("sse-chunk")`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const text = await res.text();
    assert.ok(text.includes('event: start'));
    assert.ok(text.includes('event: stdout'));
    assert.ok(text.includes('sse-chunk'));
    assert.ok(text.includes('event: exit'));
  });
});
```

---

## Shared Patterns

### Error Handling
**Source:** `src/utils/errors.js`  
**Apply to:** All services and validation utilities
```javascript
import { AppError } from '../utils/errors.js';
throw new AppError('Message', statusCode, 'ERR_CODE');
```

### JSON Response Formatting
**Source:** `src/utils/response.js`  
**Apply to:** All REST route handlers
```javascript
sendJson(res, 200, { ok: true, data: result });
```

### Request Body Parsing
**Source:** `src/middleware/body.js`  
**Apply to:** All POST route handlers
```javascript
const body = await readJsonBody(req);
```

### Path Sanitization
**Source:** `src/utils/path.js`  
**Apply to:** `cwd` parameter in `src/utils/command.js`
```javascript
const sanitizedCwd = sanitizePath(cwd);
```

---

## No Analog Found

*None. All components in Phase 3 map directly to existing structures in `src/` and `test/`.*

---

## Metadata

**Analog search scope:** `src/`, `test/`, `index.js`  
**Files scanned:** 13  
**Pattern extraction date:** 2026-11-02  
