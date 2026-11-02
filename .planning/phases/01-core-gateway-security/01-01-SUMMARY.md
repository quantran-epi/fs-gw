---
phase: 01-core-gateway-security
plan: 01
subsystem: core-server
tags: [http, security, loopback, health, zero-dependency]
dependency_graph:
  requires: []
  provides: [core-http-server, router, health-endpoint, security-guard]
  affects: [all-future-routes]
tech_stack:
  added: [node:http, node:test, node:assert]
  patterns: [table-driven-router, unified-json-envelope, host-header-whitelist]
key_files:
  created:
    - package.json
    - src/config.js
    - src/utils/errors.js
    - src/utils/response.js
    - src/middleware/security.js
    - src/router.js
    - src/routes/health.route.js
    - src/server.js
    - index.js
    - test/server.test.js
  modified: []
decisions:
  - "Used node:http native request in tests to allow explicit Host header injection; native fetch overrides Host header on loopback"
  - "Dynamically resolved port in createGatewayServer when options.port is omitted or set to 0 for conflict-free test suites"
metrics:
  duration: 4m
  completed_date: "2026-11-02"
---

# Phase 01 Plan 01: Core Gateway & Security Summary

Zero-dependency Node.js HTTP gateway server strictly bound to IPv4 loopback (127.0.0.1) with Host header DNS rebinding validation and diagnostic health endpoint.

## What Was Done

1. **Package Scaffolding (`package.json`)**: Configured ESM module with native `node --test` script and 0 third-party npm dependencies.
2. **Configuration (`src/config.js`)**: Defined loopback binding constants (`127.0.0.1`, default port `4820`, 10MB payload ceiling).
3. **Error & Response Utilities (`src/utils/errors.js`, `src/utils/response.js`)**: Implemented `AppError` class and standard JSON envelopes (`{ ok: true, data }` and `{ ok: false, error, code }`).
4. **DNS Rebinding Guard (`src/middleware/security.js`)**: Implemented `validateHost` verifying `Host` header strictly against allowed loopback variants (`127.0.0.1`, `localhost`, and their port-qualified strings), returning HTTP 403 `ERR_FORBIDDEN_HOST` for unauthorized hosts.
5. **Route Dispatcher (`src/router.js`)**: Implemented Map-based table router with clean 404 `ERR_NOT_FOUND` error emission.
6. **Health Endpoint (`src/routes/health.route.js`)**: Implemented `GET /health` returning server uptime, platform, and node version diagnostics.
7. **Server Factory & Entrypoint (`src/server.js`, `index.js`)**: Bound security guards before router dispatch with graceful shutdown handlers (`SIGINT`/`SIGTERM`) and CLI `--port` argument parser.
8. **Automated Integration Tests (`test/server.test.js`)**: Created comprehensive test suite verifying 200 healthcheck, 403 Host rejection, and 404 unmatched route behavior using `node:test` and `node:assert/strict`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Node.js `fetch` overrides custom `Host` headers**
- **Found during:** Task 2 verification
- **Issue:** Native `fetch()` in Node.js ignores or overrides the `Host` header with the target URL authority, preventing test verification of the 403 Forbidden DNS rebinding guard.
- **Fix:** Used `node:http.request()` helper `makeRawRequest` in `test/server.test.js` to send raw custom `Host` headers.
- **Files modified:** `test/server.test.js`
- **Commit:** `3acd43b`

**2. [Rule 2 - Missing Functionality] Dynamic port resolution for test isolation**
- **Found during:** Task 2 integration testing
- **Issue:** Fixed port 4821 could collide if a background test process held the socket.
- **Fix:** Updated `createGatewayServer` to inspect `server.address().port` when port is not explicitly pinned, enabling ephemeral test ports via port `0`.
- **Files modified:** `src/server.js`, `test/server.test.js`
- **Commit:** `3acd43b`

## Self-Check: PASSED

- FOUND: `package.json`
- FOUND: `src/config.js`
- FOUND: `src/utils/errors.js`
- FOUND: `src/utils/response.js`
- FOUND: `src/middleware/security.js`
- FOUND: `src/router.js`
- FOUND: `src/routes/health.route.js`
- FOUND: `src/server.js`
- FOUND: `index.js`
- FOUND: `test/server.test.js`
- Commits exist: `c387838`, `3acd43b`
