# Walking Skeleton — File System Gateway (fs-gw)

**Phase:** 1
**Generated:** 2026-11-02

## Capability Proven End-to-End

A client application sends `GET http://127.0.0.1:4820/health` and receives a standardized JSON envelope `{ ok: true, data: { status: "ok", uptime: <number>, platform: "win32", node: "<version>" } }` served strictly over IPv4 loopback using pure Node.js stdlib with zero npm dependencies and DNS rebinding protection.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime & Framework | Native Node.js `node:http` (>=20.19 LTS) | Zero npm dependencies, instantaneous startup, minimal memory footprint, zero supply-chain risk. |
| Host Binding & Network | `127.0.0.1` IPv4 loopback only | Strictly prevents external LAN/WAN interface exposure without requiring complex auth. |
| Security Perimeter | DNS rebinding guard (`Host` header validation) + Origin-filtered CORS | Rejects malicious browser/external requests targeting localhost port 4820 with HTTP 403 Forbidden. |
| Protocol & Envelope | HTTP/1.1 REST with uniform JSON envelope (`{ ok, data }` / `{ ok, error, code }`) | Native `fetch` compatibility in Tauri/Vite frontend without custom binary deserialization. |
| Testing Stack | Built-in `node:test` + `node:assert/strict` | No Jest/Vitest installation overhead; executes tests in sub-seconds via `node --test`. |
| Directory Layout | Feature-separated stdlib modules under `src/` (`middleware/`, `routes/`, `utils/`) | Clear separation of routing, middleware guards, and transport logic without framework abstractions. |

## Stack Touched in Phase 1

- [x] Project scaffold (`package.json` with ESM `"type": "module"`, `node:test` test script)
- [x] Routing — Map-based dispatcher (`src/router.js`) and healthcheck route (`src/routes/health.route.js`)
- [x] Network & Security — Loopback listener (`127.0.0.1:4820`), DNS rebinding guard (`src/middleware/security.js`), CORS handler (`src/middleware/cors.js`)
- [x] Transport & Body — Bounded JSON stream body parser with 10MB limit (`src/middleware/body.js`) and standardized JSON response helpers (`src/utils/response.js`, `src/utils/errors.js`)
- [x] Deployment — Running directly via `node index.js` in headful Windows PowerShell session

## Out of Scope (Deferred to Later Slices)

- File system CRUD operations (`/fs/read`, `/fs/write`, `/fs/stat`, `/fs/list`, `/fs/mkdir`, `/fs/delete`) — Phase 2
- Path traversal and DOS device sanitization (`CON`, `PRN`, `AUX`, `NUL`, NTFS streams) — Phase 2
- Child process spawning and execution (`/exec/run`, `/exec/kill`, `/exec/stream`) — Phase 3
- Process tree termination via Windows `taskkill.exe` — Phase 3
- Dynamic ephemeral token auth file (`%TEMP%/fs-gw.token`) — v2 (ADV-01)
- Automatic port discovery and conflict resolution — v2 (ADV-02)
- Chunked range request file streaming (>500MB) — v2 (ADV-03)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: Client can safely read, write atomically, stat, list, and delete files/directories on the host filesystem via safe path-sanitized REST endpoints.
- Phase 3: Client can spawn child CLI commands headfully with argument arrays, stream execution stdout/stderr in real-time, and cleanly terminate Windows process trees without leaving orphans.
