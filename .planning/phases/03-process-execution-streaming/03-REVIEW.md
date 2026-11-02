---
phase: 03-process-execution-streaming
reviewed: 2026-11-02T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/utils/command.js
  - src/services/process.service.js
  - src/routes/exec.route.js
  - index.js
  - test/command.test.js
  - test/process.service.test.js
  - test/exec.test.js
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-11-02T00:00:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed Phase 03 implementation for process execution and streaming (`src/utils/command.js`, `src/services/process.service.js`, `src/routes/exec.route.js`, `index.js`, and test suites). 

Core architecture aligns with project constraints: zero npm dependencies, `windowsHide: false` to satisfy EDR requirements, bounded output buffers (`10MB`), recursive process-tree termination via `taskkill.exe`, SSE streaming with disconnect cleanup, and DNS rebinding protections.

Identified 3 warnings and 3 info-level items:
1. `streamProcessExecution` in `process.service.js` lacks an early listener for process spawn failures, leading to unhandled promise rejections / unhandled emitter errors when binary does not exist.
2. In `streamProcessExecution`, backpressure pause/resume only monitors `child.stdout`, dropping backpressure control for `child.stderr`.
3. In `index.js`, process shutdown handler calls `registry.killAllSync()` synchronously, but does not gracefully wait for `server.close()` sockets, risking hanging connections.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: Uncaught `child.on('error')` during SSE spawn failure

**File:** `src/services/process.service.js:231-244`
**Issue:** `spawn()` in Node.js returns an `EventEmitter` synchronously even when executable resolution fails asynchronously (e.g. `ENOENT`). In `streamProcessExecution`, `entry = registry.register(child)` runs before `child.on('error')` is wired at line 269. If `child` errors before or during SSE registration, or if the process throws an unhandled error event while `res` is already open, `sendEvent('error', ...)` is called but does not call `res.end()`, leaving HTTP SSE connection hanging forever. Furthermore, the `try/catch` around `spawn()` only catches synchronous errors; asynchronous spawn errors emit `'error'` event without terminating response.
**Fix:**
```javascript
  let child;
  try {
    child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell,
      windowsHide: false
    });
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message, code: err.code || 'ERR_SPAWN_FAILED' })}\n\n`);
    res.end();
    return;
  }

  const entry = registry.register(child, { command, timeout });

  // Ensure process error also closes stream
  child.on('error', (err) => {
    sendEvent('error', { error: err.message, code: err.code || 'ERR_PROCESS_ERROR' });
    if (!res.writableEnded) {
      res.end();
    }
  });
```

### WR-02: SSE backpressure ignores `child.stderr` stream

**File:** `src/services/process.service.js:250-256`
**Issue:** `sendEvent` checks return value of `res.write()`. If socket buffer is full (`ok === false`), it pauses `child.stdout`, but does not pause `child.stderr`. If process produces flood of stderr data while client is slow, stderr continues emitting, buffering unbounded chunks in Node.js runtime memory.
**Fix:**
```javascript
  const sendEvent = (event, data) => {
    if (res.writableEnded) return;
    const ok = res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (!ok) {
      if (child.stdout && !child.stdout.isPaused()) child.stdout.pause();
      if (child.stderr && !child.stderr.isPaused()) child.stderr.pause();
      res.once('drain', () => {
        if (!child.killed) {
          if (child.stdout?.isPaused()) child.stdout.resume();
          if (child.stderr?.isPaused()) child.stderr.resume();
        }
      });
    }
  };
```

### WR-03: `runProcess` rejects with `AppError` on `child.on('error')` but might leak registered entry until timeout

**File:** `src/services/process.service.js:193-195`
**Issue:** In `runProcess`, if `child` emits `'error'` (e.g. spawn ENOENT), the Promise rejects immediately, but `child.on('close')` may not fire or may fire later. The process entry remains in `registry.active` until either `close` fires or timer elapses. In error scenarios, `registry.unregister(entry.id)` should be invoked explicitly to prevent stale registry entries.
**Fix:**
```javascript
    child.on('error', (err) => {
      registry.unregister(entry.id);
      reject(new AppError(`Process error: ${err.message}`, 500, err.code || 'ERR_PROCESS_ERROR'));
    });
```

## Info

### IN-01: `taskkill` stderr output encoding on non-English Windows

**File:** `src/services/process.service.js:18-20`
**Issue:** `taskkill` on localized Windows systems (e.g. Vietnamese, Japanese) prints localized OEM messages. Default `.toString()` uses UTF-8, which can produce garbled characters in error message strings. 
**Fix:** Not critical since exit code 0 and 128 are checked numerically, but consider decoding with `windows-1258` or fallback ascii if localized error diagnostics are needed.

### IN-02: Missing validation for non-string values inside `env` object

**File:** `src/utils/command.js:31-33`
**Issue:** `validateExecInput` ensures `env` is an object, but does not sanitize values within `env`. If client sends `{ env: { FOO: { nested: 1 } } }`, `spawn` receives non-primitive values in environment map.
**Fix:**
```javascript
  if (typeof env !== 'object' || Array.isArray(env) || env === null) {
    throw new AppError('Field "env" must be an object of key-value pairs', 400, 'ERR_INVALID_ENV');
  }
  const sanitizedEnv = Object.fromEntries(
    Object.entries(env).map(([k, v]) => [String(k), String(v)])
  );
```

### IN-03: `POST /exec/kill` parameter handling for `pid: 0`

**File:** `src/routes/exec.route.js:17-18`
**Issue:** `target = body.pid !== undefined && body.pid !== null ? Number(body.pid) : body.id;` followed by `if (!target)`. If `body.pid === 0`, `!target` evaluates to true and throws `ERR_INVALID_TARGET`. PID 0 is system idle process on Windows (which should not be killed anyway), but explicit validation for `typeof target !== 'string' && (typeof target !== 'number' || target <= 0)` is clearer.
**Fix:**
```javascript
    const hasPid = body.pid !== undefined && body.pid !== null;
    const target = hasPid ? Number(body.pid) : body.id;
    if (!target || (hasPid && target <= 0)) {
      throw new AppError('Field "pid" (positive number) or "id" (string) must be provided', 400, 'ERR_INVALID_TARGET');
    }
```

---

_Reviewed: 2026-11-02T00:00:00Z_  
_Reviewer: Claude (gsd-code-reviewer)_  
_Depth: standard_
