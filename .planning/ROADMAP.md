# Roadmap: File System Gateway (fs-gw)

**Core Value:** Cung cấp kênh giao tiếp cục bộ tin cậy và ổn định để ứng dụng desktop đọc/ghi filesystem và thực thi child process mà không bị EDR/Trellix chặn.
**Mode:** MVP
**Granularity:** Coarse (3 phases)

---

## Phases

- [x] **Phase 1: Core Gateway & Security** - Node.js stdlib HTTP server, loopback binding, DNS rebinding guard, CORS, error envelope, healthcheck.
- [ ] **Phase 2: File System Operations** - CRUD file/directory endpoints, atomic write, safe path sanitizer against DOS devices and traversal.
- [ ] **Phase 3: Process Execution & Streaming** - Safe child process spawn, timeout management, Windows process tree termination, real-time command streaming.

---

## Phase Details

### Phase 1: Core Gateway & Security

**Goal**: Desktop application can reliably verify gateway availability and communicate over loopback HTTP with standardized JSON envelope and DNS rebinding protection.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04, CORE-05
**Success Criteria** (what must be TRUE):

  1. Client sends `GET http://127.0.0.1:4820/health` and receives HTTP 200 `{ ok: true, data: { status: "ok", uptime: number, platform: "win32", node: string } }` using Node.js stdlib only (zero npm dependencies).
  2. Request with invalid or external `Host` header (e.g. `Host: evil.com`) is rejected with HTTP 403 Forbidden.
  3. Preflight `OPTIONS` request with CORS headers matching Vite/Tauri origins returns 204 with allowed methods (GET, POST, OPTIONS) and allowed headers.
  4. Malformed JSON payload or payload exceeding 10MB to any POST endpoint returns structured HTTP 400 error `{ ok: false, error: string, code: string }`.

**Plans:** 2 plans
Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Scaffold HTTP server on 127.0.0.1:4820, DNS rebinding guard, healthcheck route, and standardized JSON envelope

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Implement CORS preflight for desktop/Vite origins and bounded 10MB JSON request body parser

### Phase 2: File System Operations

**Goal**: Client can safely perform file and directory CRUD operations (read, atomic write, stat, list, mkdir, recursive delete) without path traversal or Windows DOS device crashes.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: FS-01, FS-02, FS-03, FS-04, FS-05, FS-06, FS-07
**Success Criteria** (what must be TRUE):

  1. Client can write UTF-8 text or Base64 binary file via `POST /fs/write` with automatic parent folder creation and atomic write replacement, then read it back via `POST /fs/read`.
  2. Client can query `POST /fs/stat` for existing and non-existing paths without gateway throwing 500 error, receiving `exists: false` gracefully.
  3. Client can create directory trees (`POST /fs/mkdir`), list directory contents with entry types (`POST /fs/list`), and delete files or folders recursively (`POST /fs/delete`).
  4. Requests targeting Windows DOS devices (`CON`, `PRN`, `NUL`, `AUX`, `COM1-9`), NTFS streams (`C:\test:stream`), or relative path traversal outside target boundaries return HTTP 400 validation error without hanging the server thread.

**Plans:** 2 plans
Plans:
**Wave 1**

- [ ] 02-01-PLAN.md — Path Sanitizer & FS Service Core with Windows security guardrails and atomic write

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 02-02-PLAN.md — Filesystem HTTP routes & gateway integration with end-to-end integration tests

### Phase 3: Process Execution & Streaming

**Goal**: Client can spawn CLI processes (git, npm) headfully without shell injection, stream stdout/stderr real-time, and cleanly terminate process trees on Windows on timeout or abort.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: EXEC-01, EXEC-02, EXEC-03, EXEC-04, EXEC-05
**Success Criteria** (what must be TRUE):

  1. Client can run a command via `POST /exec/run` with argument array (e.g. `git status` or `node -v`), receiving exit code, captured stdout, and captured stderr in structured JSON response.
  2. Client can stream stdout/stderr real-time via `GET /exec/stream` or chunked SSE for long-running commands without blocking gateway loop.
  3. Client can abort a running process via `POST /exec/kill`, or have long-running process aborted by timeout, with the entire Windows process tree killed via `taskkill.exe /pid <PID> /T /F` leaving zero orphan processes.
  4. Commands execute with `shell: false` default parameter array semantics to prevent command injection and avoid triggering enterprise EDR behavioral alerts.

**Plans**: TBD

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Gateway & Security | 2/2 | Complete | 2026-11-02 |
| 2. File System Operations | 0/2 | Planned | - |
| 3. Process Execution & Streaming | 0/0 | Not started | - |
