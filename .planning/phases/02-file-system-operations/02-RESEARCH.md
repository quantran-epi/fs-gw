# Phase 2: File System Operations - Research

**Researched:** 2026-11-02
**Domain:** Node.js stdlib filesystem operations (`node:fs/promises`, `node:path`), Windows path sanitization (DOS devices, NTFS ADS, traversal), atomic file write, zero-dependency CRUD endpoints
**Confidence:** HIGH

## Executive Summary

Phase 2 implements the File System Operations capability for `fs-gw` (`File System Gateway`). It enables the desktop frontend (Tauri/Vite) to perform essential file and directory operations (`/fs/read`, `/fs/write`, `/fs/stat`, `/fs/list`, `/fs/mkdir`, `/fs/delete`) locally on Windows without triggering OS/EDR blocking, without crashing the Node.js event loop on special Windows device paths, and without leaving corrupted files during interrupted writes.

All operations strictly honor the project constraints: 100% Node.js standard library (`node:fs/promises`, `node:path`, `node:crypto`), zero npm dependencies, bounded request payloads, and consistent JSON envelope responses (`{ ok: true, data }` or `{ ok: false, error, code }`).

**Primary recommendation:** Implement a robust path sanitization and normalization utility (`src/utils/path.js`) blocking DOS devices (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`), NTFS Alternate Data Streams (`:`), and control characters (0-31). Implement an atomic write helper writing to a co-located temporary file (`.<filename>.<random>.tmp`) before executing `fs.rename` with copy-fallback for Windows `EBUSY`/`EPERM` locks. Expose clean POST endpoints matching the table router in `src/routes/fs.route.js`.

## Project Constraints (from CLAUDE.md)

- **Runtime:** Node.js >=20.19 LTS (verified local runtime: `v20.19.5` on `win32`).
- **Dependencies:** Node.js stdlib only. Zero third-party npm packages.
- **Security:** Gateway only listens on `127.0.0.1`.
- **Response Format:** Standard envelope `{ ok: boolean, data?: any, error?: string, code?: string }`.
- **Testing:** Native `node:test` and `node:assert/strict` with zero external test runners.
- **Request Limits:** Bounded JSON request body parser (max 10MB) from Phase 1 (`src/middleware/body.js`).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FS-01 | Endpoint `POST /fs/read` reads text UTF-8 or binary (Base64), returns content, size, mime hint. | `fs.readFile(path)` with encoding detection (`utf8` vs `base64`), `stat.size`, and stdlib extension mime map. |
| FS-02 | Endpoint `POST /fs/write` writes text or binary (Base64) to file, supports recursive parent directory creation (`mkdir -p`), and atomic write via temporary file. | `fs.mkdir(dir, { recursive: true })` + write to `.<name>.<hex>.tmp` + atomic `fs.rename` with copy fallback. |
| FS-03 | Endpoint `POST /fs/stat` checks file/directory info (`exists: boolean`, isFile, isDirectory, size, mtime), does not throw 500 when missing. | `fs.stat(path)` catching `ENOENT`/`ENOTDIR` to return `{ exists: false }` with HTTP 200. |
| FS-04 | Endpoint `POST /fs/list` lists directory contents, returning entry list with type (file/directory/symlink). | `fs.readdir(path, { withFileTypes: true })` extracting `name`, `isFile`, `isDirectory`, `isSymbolicLink`. |
| FS-05 | Endpoint `POST /fs/mkdir` creates recursive directory (`recursive: true`). | `fs.mkdir(path, { recursive: true })`. |
| FS-06 | Endpoint `POST /fs/delete` deletes file or directory recursively (`recursive: true`, `force: true`). | `fs.rm(path, { recursive: true, force: true })`. |
| FS-07 | Path Traversal & Windows DOS Devices guard rejects control chars, special devices (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`), and Alternate Data Streams (`:`). | Custom path sanitizer in `src/utils/path.js` validating segments before resolving absolute paths. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Path Sanitization & Guardrails | API / Backend (`src/utils/path.js`) | — | Path validation must run first before touching filesystem APIs to prevent thread freezes or unauthorized access. |
| Atomic File Writing | API / Backend (`src/services/fs.service.js`) | OS Filesystem | Atomic replace with temp file and retry handles Windows NTFS file-locking quirks. |
| File & Directory CRUD | API / Backend (`src/services/fs.service.js`) | `node:fs/promises` | Decoupled service layer encapsulates filesystem logic for unit testability without HTTP. |
| HTTP FS Route Dispatch | API / Backend (`src/routes/fs.route.js`) | Router (`src/router.js`) | Parses and validates JSON payload, passes sanitized params to FS service, formats response. |
| Client Payload Ingestion | API / Backend (`src/middleware/body.js`) | — | Reuses bounded 10MB parser established in Phase 1. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs/promises` | stdlib (Node 20+) | Async filesystem CRUD | Non-blocking Promise APIs for `readFile`, `writeFile`, `stat`, `readdir`, `mkdir`, `rm`, `rename`. [VERIFIED: nodejs.org] |
| `node:path` | stdlib (Node 20+) | Windows path resolution & normalization | Native Windows path handling, drive letters, separators. [VERIFIED: nodejs.org] |
| `node:crypto` | stdlib (Node 20+) | Random nonce generation for temp files | Fast, collision-free crypto random hex for atomic write temp files. [VERIFIED: nodejs.org] |
| `node:test` | stdlib (Node 20+) | Test runner | Zero-dependency testing framework built into Node.js. [VERIFIED: nodejs.org] |
| `node:assert/strict` | stdlib (Node 20+) | Assertions | Invariant verification and test assertions. [VERIFIED: nodejs.org] |

### Supporting (Zero Dependency)
| Utility | Location | Purpose | When to Use |
|---------|----------|---------|-------------|
| `sanitizePath` | `src/utils/path.js` | Validate and resolve path; reject DOS devices & ADS | Every FS endpoint before any `fs/promises` call. |
| `getMimeHint` | `src/utils/mime.js` | Map file extension to common MIME string | In `POST /fs/read` response payload. |
| `atomicWriteFile` | `src/services/fs.service.js` | Temp write + atomic rename with fallback | In `POST /fs/write`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Stdlib `node:fs/promises` | `fs-extra` | External npm dependency; violates zero-dependency constraint. `node:fs/promises` natively supports `mkdir(recursive: true)` and `rm(force: true, recursive: true)` in Node 20+. |
| Stdlib MIME lookup | `mime-types` npm | Adds 3rd party package for a simple dictionary. A 30-entry dictionary in stdlib covers 99% of desktop app use cases with fallback to `application/octet-stream`. |
| Custom atomic rename | `write-file-atomic` npm | Adds npm dependency with chown/chmod overhead unnecessary on Windows localhost gateway. |

## Package Legitimacy Audit

*Notice: This phase installs 0 external npm packages. Node.js stdlib only.*

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| None (stdlib only) | N/A | N/A | N/A | Node.js core | N/A | Approved |

## Windows Filesystem & Security Guardrails

### 1. Windows Reserved DOS Device Names (FS-07)
On Windows, legacy DOS device names refer directly to hardware or pseudo-devices, regardless of file extension or parent folder:
- Devices: `CON`, `PRN`, `AUX`, `NUL`, `COM1` through `COM9`, `LPT1` through `LPT9`.
- If an application calls `fs.open('CON')` or `fs.readFile('C:\\safe\\con.txt')`, Windows redirects to the console input buffer, hanging the Node.js event loop indefinitely.
- **Rule:** Every path segment between path separators (`/` or `\`) must be checked against:
  ```javascript
  const DOS_DEVICE_REGEX = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
  ```
  If any segment matches, reject immediately with HTTP 400 (`ERR_RESERVED_DEVICE`).

### 2. NTFS Alternate Data Streams (ADS) (FS-07)
NTFS supports Alternate Data Streams via the colon (`:`) separator (e.g. `file.txt:hidden_stream`). Attackers can hide executable data or bypass file extension filters:
- Windows drive specifiers (`C:`, `D:`) are valid, but any colon occurring *after* the drive letter or in any relative segment indicates an ADS or device specifier.
- **Rule:** Strip optional leading drive letter (`^[a-zA-Z]:`), then verify remainder contains no colon (`:`). If colon found, reject with HTTP 400 (`ERR_FORBIDDEN_STREAM`).

### 3. Control Characters (FS-07)
ASCII control characters (0x00 through 0x1F) are invalid in Windows paths (null bytes, newlines, tabs).
- **Rule:** Check `path.charCodeAt(i) < 32`. If any control character is present, reject with HTTP 400 (`ERR_INVALID_PATH`).

### 4. Path Normalization & Traversal (FS-07)
- After passing syntax checks, pass path through `path.resolve(inputPath)`.
- If optional sandboxing is enabled or base directory provided, ensure `resolvedPath.toLowerCase().startsWith(baseDir.toLowerCase())`. For Phase 2, `fs-gw` acts as an unrestricted local bridge for the user's desktop client, but normalization prevents relative dot-dot bypasses and standardizes backslashes.

### 5. Windows Case Insensitivity
NTFS is case-preserving but case-insensitive. Comparisons must normalize casing (`toLowerCase()`) to avoid false negatives when checking path equality or allowed directories.

## Atomic Write Pattern on Windows

### The Problem
Directly overwriting an existing target file via `fs.writeFile(targetPath, ...)` is dangerous:
1. If the client disconnects or the process crashes mid-write, the target file is left truncated or corrupted.
2. If another application (like anti-virus, indexing service, or an editor) briefly reads the file, the write may fail with `EBUSY` or `EPERM`.

### The Solution: Co-located Temp File + Atomic Rename
1. Write contents to a temporary file in the *same* directory as the target:
   `const tempPath = path.join(dir, `.${baseName}.${crypto.randomBytes(6).toString('hex')}.tmp`);`
   *Why same directory?* Moving files across different drives or filesystem partitions triggers `EXDEV` (cross-device link), which cannot be atomic.
2. Flush and close the temporary file.
3. Call `await fs.rename(tempPath, targetPath)`. On NTFS, `rename` in modern Windows is atomic if the file is not locked.
4. **Windows EPERM / EBUSY Fallback:** On Windows, if a handle is momentarily open on the target file, `fs.rename` throws `EPERM` or `EBUSY`. The atomic writer catches this, waits 25ms, and retries once. If rename still fails, it falls back to `fs.copyFile(tempPath, targetPath)` and cleans up the temp file.
5. In a `finally` block, ensure `await fs.unlink(tempPath).catch(() => {})` removes any orphaned temporary file.

## API Request/Response Contracts

All endpoints accept `POST` with `Content-Type: application/json`.

### 1. `POST /fs/read`
**Request Body:**
```json
{
  "path": "D:/projects/doc.txt",
  "encoding": "utf8" // optional: "utf8" (default) or "base64"
}
```
**Response Body (Success 200):**
```json
{
  "ok": true,
  "data": {
    "content": "file content here...",
    "size": 1024,
    "encoding": "utf8",
    "mime": "text/plain; charset=utf-8"
  }
}
```
**Error (404 if file not found, 400 if path invalid):**
```json
{
  "ok": false,
  "error": "File not found: D:\\projects\\doc.txt",
  "code": "ERR_NOT_FOUND"
}
```

### 2. `POST /fs/write`
**Request Body:**
```json
{
  "path": "D:/projects/new-folder/doc.txt",
  "content": "Hello world or base64 data",
  "encoding": "utf8", // optional: "utf8" (default) or "base64"
  "atomic": true // optional: default true
}
```
**Response Body (Success 200):**
```json
{
  "ok": true,
  "data": {
    "path": "D:\\projects\\new-folder\\doc.txt",
    "bytesWritten": 11
  }
}
```

### 3. `POST /fs/stat`
Does not throw 500 when file is missing; returns `exists: false` with 200 OK.
**Request Body:**
```json
{
  "path": "D:/projects/maybe-exists.txt"
}
```
**Response Body (Exists 200):**
```json
{
  "ok": true,
  "data": {
    "exists": true,
    "isFile": true,
    "isDirectory": false,
    "isSymbolicLink": false,
    "size": 2048,
    "mtime": 1730520000000,
    "birthtime": 1730510000000
  }
}
```
**Response Body (Not Exists 200):**
```json
{
  "ok": true,
  "data": {
    "exists": false
  }
}
```

### 4. `POST /fs/list`
**Request Body:**
```json
{
  "path": "D:/projects"
}
```
**Response Body (Success 200):**
```json
{
  "ok": true,
  "data": {
    "entries": [
      {
        "name": "src",
        "isFile": false,
        "isDirectory": true,
        "isSymbolicLink": false
      },
      {
        "name": "package.json",
        "isFile": true,
        "isDirectory": false,
        "isSymbolicLink": false
      }
    ]
  }
}
```

### 5. `POST /fs/mkdir`
**Request Body:**
```json
{
  "path": "D:/projects/nested/dir/path"
}
```
**Response Body (Success 200):**
```json
{
  "ok": true,
  "data": {
    "created": true,
    "path": "D:\\projects\\nested\\dir\\path"
  }
}
```

### 6. `POST /fs/delete`
Recursive deletion of files or directories (`recursive: true, force: true`). Does not fail if path does not exist (`force: true`).
**Request Body:**
```json
{
  "path": "D:/projects/temp-file-or-dir"
}
```
**Response Body (Success 200):**
```json
{
  "ok": true,
  "data": {
    "deleted": true,
    "path": "D:\\projects\\temp-file-or-dir"
  }
}
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recursive directory removal | Custom DFS file walker unlinking files then `rmdir` | `fs.rm(path, { recursive: true, force: true })` | Native stdlib handles Windows directory hierarchies, readonly attributes, and symlinks without race conditions. |
| Unique temporary file naming | `Math.random()` or timestamp concatenation | `crypto.randomBytes(6).toString('hex')` | Prevents collisions during parallel writes from multiple requests. |
| Directory tree creation | Custom parent directory loop | `fs.mkdir(dir, { recursive: true })` | Atomic OS-level recursive directory creation without race conditions. |

## Common Pitfalls

### Pitfall 1: Event Loop Freeze on Windows DOS Devices
**What goes wrong:** Calling `fs.stat('CON')` or `fs.readFile('CON.txt')` freezes the Node.js event loop indefinitely on Windows.
**Why it happens:** Windows maps `CON` to standard input console handle, blocking until console input is provided.
**How to avoid:** Check each segment against `/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i` before any filesystem call. Reject with HTTP 400.

### Pitfall 2: Atomic Write Cross-Device Link Error (`EXDEV`)
**What goes wrong:** Writing temp file to OS temp directory (`os.tmpdir()`) then renaming to target on `D:\` fails with `EXDEV: cross-device link not permitted`.
**Why it happens:** Atomic rename only works within the same volume/filesystem.
**How to avoid:** Always generate the temp file in the target file's parent directory (`path.dirname(targetPath)`).

### Pitfall 3: Windows File Locking (`EBUSY` / `EPERM`) during Atomic Rename
**What goes wrong:** Rapid successive writes to the same file cause `fs.rename` to throw `EPERM: operation not permitted` on Windows.
**Why it happens:** Windows antivirus or file search indexing momentarily holds an open read handle on the destination file.
**How to avoid:** Retry rename after a short backoff (25ms), falling back to `fs.copyFile` and `unlink`.

### Pitfall 4: `POST /fs/stat` Throwing 500 on Missing Files
**What goes wrong:** Client checking if a file exists receives a 500 Internal Server Error when `fs.stat` throws `ENOENT`.
**Why it happens:** Unhandled error in service/route.
**How to avoid:** Explicitly catch errors with `err.code === 'ENOENT'` or `err.code === 'ENOTDIR'` and return `{ exists: false }` with HTTP 200.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (Node stdlib) |
| Config file | `package.json` (`"test": "node --test"`) |
| Quick run command | `node --test test/path.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FS-07 | Sanitizer rejects `CON`, `PRN`, ADS (`:`), control chars | unit | `node --test test/path.test.js` | ❌ Wave 0 Gap |
| FS-01 | Read UTF-8 text and Base64 binary with mime hint | integration | `node --test test/fs.test.js` | ❌ Wave 0 Gap |
| FS-02 | Write UTF-8 text and Base64 binary with atomic rename | integration | `node --test test/fs.test.js` | ❌ Wave 0 Gap |
| FS-03 | Stat returns `exists: true` for real file, `exists: false` for missing file | integration | `node --test test/fs.test.js` | ❌ Wave 0 Gap |
| FS-04 | List returns directory entries with file/dir/symlink booleans | integration | `node --test test/fs.test.js` | ❌ Wave 0 Gap |
| FS-05 | Mkdir creates nested directory tree recursively | integration | `node --test test/fs.test.js` | ❌ Wave 0 Gap |
| FS-06 | Delete removes files and nested folders recursively without error | integration | `node --test test/fs.test.js` | ❌ Wave 0 Gap |

### Sampling Rate
- **Per task commit:** Run specific test file (e.g. `node --test test/path.test.js`)
- **Phase gate:** `npm test` all green before completion.

## Implementation Sequence Recommendation

Divide Phase 2 into 2 sequential plans:

1. **Plan 02-01: Path Sanitizer & FS Service Core**
   - Implement `src/utils/path.js` with `sanitizePath(inputPath)` protecting against DOS devices, ADS, control chars.
   - Implement `src/utils/mime.js` with MIME lookup mapping.
   - Implement `src/services/fs.service.js` with `readFileContent`, `atomicWriteFile`, `statPath`, `listDirectory`, `makeDirectory`, `deletePath`.
   - Comprehensive unit tests in `test/path.test.js` and `test/fs.service.test.js`.

2. **Plan 02-02: HTTP FS Routes & Gateway Integration**
   - Implement `src/routes/fs.route.js` registering `/fs/read`, `/fs/write`, `/fs/stat`, `/fs/list`, `/fs/mkdir`, `/fs/delete` handlers.
   - Register routes in `index.js`.
   - Comprehensive integration tests in `test/fs.test.js` asserting HTTP status codes, standard response envelope, and error conditions.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Unrestricted path resolution: Gateway acts as local user bridge so any valid path on host OS is allowed, rather than confining to a single sandbox directory. | Security & Architecture | If Tauri app requires a strict sandbox root, an optional `rootPath` constraint would need to be added to `sanitizePath`. |

*(All other technical claims verified directly against Node.js v20 stdlib on Windows 11).*

## Sources

### Primary (HIGH confidence)
- Node.js Official Documentation (`node:fs/promises`, `node:path`, `node:crypto`) [VERIFIED: nodejs.org]
- Local Windows 11 Runtime verification (`node v20.19.5` on `win32`)

### Secondary (HIGH confidence)
- Microsoft Windows Dev Center: Naming Files, Paths, and Namespaces (DOS device names, ADS specifications)
- Local test executions verifying `readdir({ withFileTypes: true })`, `rm({ recursive: true, force: true })`, and atomic rename behavior.
