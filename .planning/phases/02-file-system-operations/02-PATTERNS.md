# Phase 2: File System Operations - Pattern Map

**Mapped:** 2026-11-02
**Files analyzed:** 8
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/utils/path.js` | utility | transform / validate | `src/middleware/security.js` | role-match |
| `src/utils/mime.js` | utility | transform / lookup | `src/config.js` | role-match |
| `src/services/fs.service.js` | service | file-I/O | `src/middleware/body.js` | partial |
| `src/routes/fs.route.js` | route / controller | request-response | `src/routes/health.route.js` | role-match |
| `index.js` | entrypoint | event-driven | `index.js` | exact (modify) |
| `test/path.test.js` | test | unit | `test/body.test.js` | exact |
| `test/fs.service.test.js` | test | unit / file-I/O | `test/body.test.js` | role-match |
| `test/fs.test.js` | test | integration / HTTP | `test/server.test.js` | exact |

---

## Pattern Assignments

### `src/utils/path.js` (utility, transform/validate)

**Analog:** `src/middleware/security.js` and `src/utils/errors.js`

**Imports pattern:**
```javascript
import path from 'node:path';
import { AppError } from './errors.js';
```

**Core pattern (validation & error rejection):**
```javascript
// Copy validation throwing AppError pattern from src/middleware/security.js lines 1-13
const DOS_DEVICE_REGEX = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;

export function sanitizePath(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw new AppError('Path must be a non-empty string', 400, 'ERR_INVALID_PATH');
  }

  // Control characters check (0-31)
  for (let i = 0; i < inputPath.length; i++) {
    if (inputPath.charCodeAt(i) < 32) {
      throw new AppError('Path contains invalid control characters', 400, 'ERR_INVALID_PATH');
    }
  }

  // NTFS ADS check (colon after drive letter)
  const withoutDrive = inputPath.replace(/^[a-zA-Z]:/, '');
  if (withoutDrive.includes(':')) {
    throw new AppError('Path contains forbidden stream specifier', 400, 'ERR_FORBIDDEN_STREAM');
  }

  // Windows DOS device check on all segments
  const segments = inputPath.split(/[/\\]/);
  for (const segment of segments) {
    if (DOS_DEVICE_REGEX.test(segment)) {
      throw new AppError(`Path references reserved device name: ${segment}`, 400, 'ERR_RESERVED_DEVICE');
    }
  }

  return path.resolve(inputPath);
}
```

---

### `src/utils/mime.js` (utility, transform/lookup)

**Analog:** `src/config.js` (dictionary lookup with safe default)

**Imports pattern:**
```javascript
import path from 'node:path';
```

**Core pattern:**
```javascript
const MIME_TYPES = {
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf'
};

export function getMimeHint(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}
```

---

### `src/services/fs.service.js` (service, file-I/O)

**Analog:** `src/middleware/body.js` (async/await, AppError mappings, buffer manipulation)

**Imports pattern:**
```javascript
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';
import { getMimeHint } from '../utils/mime.js';
```

**Core CRUD & atomic write patterns:**
```javascript
export async function readFileContent(resolvedPath, encoding = 'utf8') {
  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) {
      throw new AppError(`Path is not a file: ${resolvedPath}`, 400, 'ERR_NOT_A_FILE');
    }

    const content = await fs.readFile(resolvedPath, encoding === 'base64' ? 'base64' : 'utf8');
    return {
      content,
      size: stat.size,
      encoding,
      mime: getMimeHint(resolvedPath)
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new AppError(`File not found: ${resolvedPath}`, 404, 'ERR_NOT_FOUND');
    }
    if (err instanceof AppError) throw err;
    throw new AppError(err.message, 500, err.code || 'ERR_FS_READ');
  }
}

export async function atomicWriteFile(targetPath, content, encoding = 'utf8', atomic = true) {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });

  const buffer = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');

  if (!atomic) {
    await fs.writeFile(targetPath, buffer);
    return { path: targetPath, bytesWritten: buffer.length };
  }

  // Co-located temp file to prevent EXDEV
  const baseName = path.basename(targetPath);
  const tempPath = path.join(dir, `.${baseName}.${crypto.randomBytes(6).toString('hex')}.tmp`);

  try {
    await fs.writeFile(tempPath, buffer);
    try {
      await fs.rename(tempPath, targetPath);
    } catch (renameErr) {
      if (renameErr.code === 'EPERM' || renameErr.code === 'EBUSY') {
        // Fallback for Windows momentary lock
        await new Promise((r) => setTimeout(r, 25));
        try {
          await fs.rename(tempPath, targetPath);
        } catch {
          await fs.copyFile(tempPath, targetPath);
        }
      } else {
        throw renameErr;
      }
    }
    return { path: targetPath, bytesWritten: buffer.length };
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

export async function statPath(resolvedPath) {
  try {
    const stat = await fs.stat(resolvedPath);
    return {
      exists: true,
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      isSymbolicLink: stat.isSymbolicLink(),
      size: stat.size,
      mtime: stat.mtimeMs,
      birthtime: stat.birthtimeMs
    };
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return { exists: false };
    }
    throw new AppError(err.message, 500, err.code || 'ERR_FS_STAT');
  }
}

export async function listDirectory(resolvedPath) {
  try {
    const dirents = await fs.readdir(resolvedPath, { withFileTypes: true });
    const entries = dirents.map((d) => ({
      name: d.name,
      isFile: d.isFile(),
      isDirectory: d.isDirectory(),
      isSymbolicLink: d.isSymbolicLink()
    }));
    return { entries };
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new AppError(`Directory not found: ${resolvedPath}`, 404, 'ERR_NOT_FOUND');
    }
    if (err.code === 'ENOTDIR') {
      throw new AppError(`Path is not a directory: ${resolvedPath}`, 400, 'ERR_NOT_A_DIRECTORY');
    }
    throw new AppError(err.message, 500, err.code || 'ERR_FS_LIST');
  }
}

export async function makeDirectory(resolvedPath) {
  try {
    await fs.mkdir(resolvedPath, { recursive: true });
    return { created: true, path: resolvedPath };
  } catch (err) {
    throw new AppError(err.message, 500, err.code || 'ERR_FS_MKDIR');
  }
}

export async function deletePath(resolvedPath) {
  try {
    await fs.rm(resolvedPath, { recursive: true, force: true });
    return { deleted: true, path: resolvedPath };
  } catch (err) {
    throw new AppError(err.message, 500, err.code || 'ERR_FS_DELETE');
  }
}
```

---

### `src/routes/fs.route.js` (route/controller, request-response)

**Analog:** `src/routes/health.route.js` and `src/middleware/body.js`

**Imports pattern:**
```javascript
import { readJsonBody } from '../middleware/body.js';
import { sanitizePath } from '../utils/path.js';
import { sendJson } from '../utils/response.js';
import * as fsService from '../services/fs.service.js';
```

**Core handler registration pattern:**
```javascript
export function registerFsRoutes(router) {
  router.register('POST', '/fs/read', async (req, res) => {
    const body = await readJsonBody(req);
    const targetPath = sanitizePath(body.path);
    const result = await fsService.readFileContent(targetPath, body.encoding);
    sendJson(res, 200, result);
  });

  router.register('POST', '/fs/write', async (req, res) => {
    const body = await readJsonBody(req);
    const targetPath = sanitizePath(body.path);
    const result = await fsService.atomicWriteFile(targetPath, body.content ?? '', body.encoding, body.atomic);
    sendJson(res, 200, result);
  });

  router.register('POST', '/fs/stat', async (req, res) => {
    const body = await readJsonBody(req);
    const targetPath = sanitizePath(body.path);
    const result = await fsService.statPath(targetPath);
    sendJson(res, 200, result);
  });

  router.register('POST', '/fs/list', async (req, res) => {
    const body = await readJsonBody(req);
    const targetPath = sanitizePath(body.path);
    const result = await fsService.listDirectory(targetPath);
    sendJson(res, 200, result);
  });

  router.register('POST', '/fs/mkdir', async (req, res) => {
    const body = await readJsonBody(req);
    const targetPath = sanitizePath(body.path);
    const result = await fsService.makeDirectory(targetPath);
    sendJson(res, 200, result);
  });

  router.register('POST', '/fs/delete', async (req, res) => {
    const body = await readJsonBody(req);
    const targetPath = sanitizePath(body.path);
    const result = await fsService.deletePath(targetPath);
    sendJson(res, 200, result);
  });
}
```

---

### `index.js` (entrypoint, event-driven)

**Analog:** `index.js` lines 20-22

**Pattern diff:**
```javascript
// Existing:
// const router = new Router();
// router.register('GET', '/health', healthHandler);

// Add registration:
import { registerFsRoutes } from './src/routes/fs.route.js';

const router = new Router();
router.register('GET', '/health', healthHandler);
registerFsRoutes(router);
```

---

### `test/path.test.js` (test, unit)

**Analog:** `test/body.test.js` lines 1-6

**Imports pattern:**
```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePath } from '../src/utils/path.js';
import { AppError } from '../src/utils/errors.js';
```

**Assertion pattern:**
```javascript
describe('Path Sanitizer Guardrails', () => {
  test('Valid path resolves to absolute path', () => {
    const result = sanitizePath('test/fixtures/file.txt');
    assert.ok(result.endsWith('file.txt'));
  });

  test('DOS device CON rejects with ERR_RESERVED_DEVICE', () => {
    assert.throws(
      () => sanitizePath('C:\\safe\\con.txt'),
      (err) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'ERR_RESERVED_DEVICE');
        return true;
      }
    );
  });

  test('NTFS Alternate Data Stream rejects with ERR_FORBIDDEN_STREAM', () => {
    assert.throws(
      () => sanitizePath('C:\\safe\\file.txt:hidden'),
      (err) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 400);
        assert.equal(err.code, 'ERR_FORBIDDEN_STREAM');
        return true;
      }
    );
  });
});
```

---

### `test/fs.test.js` (test, integration)

**Analog:** `test/server.test.js` lines 1-7, 29-44

**Server setup & teardown pattern:**
```javascript
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createGatewayServer } from '../src/server.js';
import { Router } from '../src/router.js';
import { registerFsRoutes } from '../src/routes/fs.route.js';

describe('FS Route Endpoints Integration', () => {
  let server;
  let port;
  const testTmpDir = path.resolve('test-tmp-fs');

  before(async () => {
    await fs.mkdir(testTmpDir, { recursive: true });
    const router = new Router();
    registerFsRoutes(router);
    server = createGatewayServer(router);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(testTmpDir, { recursive: true, force: true });
  });

  test('POST /fs/write then POST /fs/read returns file content', async () => {
    const targetFile = path.join(testTmpDir, 'hello.txt');
    const writeRes = await fetch(`http://127.0.0.1:${port}/fs/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetFile, content: 'Hello World' })
    });
    assert.equal(writeRes.status, 200);
    const writeBody = await writeRes.json();
    assert.equal(writeBody.ok, true);

    const readRes = await fetch(`http://127.0.0.1:${port}/fs/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetFile })
    });
    assert.equal(readRes.status, 200);
    const readBody = await readRes.json();
    assert.equal(readBody.ok, true);
    assert.equal(readBody.data.content, 'Hello World');
    assert.equal(readBody.data.size, 11);
  });
});
```

---

## Shared Patterns

### Standard JSON Response Envelope
**Source:** `src/utils/response.js` lines 1-17
**Apply to:** All FS endpoints and error handling
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

### Request Body Parsing & Limits
**Source:** `src/middleware/body.js` lines 4-29
**Apply to:** All POST handlers in `src/routes/fs.route.js`
```javascript
const body = await readJsonBody(req);
```

### Application Error Hierarchy
**Source:** `src/utils/errors.js` lines 1-8
**Apply to:** `src/utils/path.js`, `src/services/fs.service.js`, `src/routes/fs.route.js`
```javascript
throw new AppError(message, statusCode, code);
```

### Router Catch & Dispatching
**Source:** `src/server.js` lines 22-28
**Apply to:** All async route handlers
```javascript
try {
  await router.dispatch(req, res);
} catch (err) {
  const status = err.statusCode || 500;
  const code = err.code || 'ERR_INTERNAL_SERVER_ERROR';
  sendError(res, status, err.message, code);
}
```

---

## No Analog Found

*None.* All planned files map directly to existing patterns established in Phase 1 (`src/utils/`, `src/routes/`, `src/middleware/`, `test/`).

---

## Metadata

**Analog search scope:** `src/`, `test/`, `index.js`
**Files scanned:** 10
**Pattern extraction date:** 2026-11-02
