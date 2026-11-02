# Project Research Summary

**Project:** fs-gw (File System Gateway)
**Domain:** Local Filesystem & Process Execution Bridge Server (Node.js stdlib / Windows 11 Enterprise)
**Researched:** 2026-11-02
**Confidence:** HIGH

## Executive Summary

fs-gw la HTTP localhost bridge server viet bang Node.js stdlib thuan (zero external npm dependencies), chay trong cua so PowerShell headful cua nguoi dung tren Windows 11 Enterprise. Server dong vai tro trung gian IOC cho ung dung desktop Tauri (task-management), giai quyet triet de rao can chinh sach EDR/AppLocker cua doanh nghiep von tu dong chan cac tien trinh headless (CREATE_NO_WINDOW) khi spawn truc tiep tu binary desktop chua ky so.

Kien truc chuan su dung node:http lang nghe strictly tai 127.0.0.1:4820, router table-driven toi gian, node:fs/promises cho cac thao tac filesystem, va node:child_process.spawn cho viec thuc thi CLI (git, npm, cli tools) voi co windowsHude: false. Toan bo response tuan thu cau truc JSON chuan { ok, data } hoac { error, code }, kem theo ho tro streaming (chunked transfer / SSE) cho file dung luong lon va command output keo dai.

Rui ro lon nhat tren moi truong Windows tap trung vao: command injection qua metacharacters/batch file traps (CVE-2024-27980), zombie processes khi client timeout do thieu tree-kill (can dung taskkill.exe /pid <PID> /T /F), path traversal loi dung DOS reserved devices (CON, NUL), va nguy co DNS rebinding / host header injection tu web browser. Toan bo cac rui ro nay duoc phong ngua thong qua parameter array spawn (khong dung exec), explicit tree termination, path containment sanitizer, va strict localhost Host/CORS headers.

## Key Findings

### Recommended Stack

Node.js stdlib thuan (>=20.19 LTS, khuyen nghi Node 20.x hoac 22.x) dap ung 100% yeu cau ma khong can cai bat ky package npm ben thu ba nao.

**Core technologies:**
- node:http: HTTP/1.1 REST Server - zero dependency, khoi dong tuc thi, low latency cho localhost IPC.
- node:fs/promises & node:fs: Thao tac filesystem async non-blocking, ho tro atomic write va streaming file lon qua streams.
- node:child_process: Thuc thi lenh qua spawn voi argument array, kiem soat process tree va streaming output.
- node:path/win32: Chuan hoa duong dan Windows, ngan chan directory traversal va DOS device name attacks.
- node:test & node:assert/strict: Test runner tich hop san trong Node, chay unit/integration test ngay lap tuc ma khong can Jest/Vitest.

### Expected Features

**Must have (table stakes):**
- GET /health - Tauri client kiem tra gateway san sang truoc khi ket noi.
- Strict CORS & Host header validation - Ho tro tauri://localhost va http://localhost:*, chan DNS rebinding.
- File operations (POST /fs/read, write, stat, list, mkdir, delete) - Xu ly text/binary (base64) va recursive mkdir/rm.
- Process execution (POST /exec/run) - Chay command voi working directory, args array, timeout, tra ve exit code, stdout, stderr.
- Chuan hoa dinh dang loi - JSON envelope ro rang (status 400/404/403/500) kem ma loi.

**Should have (competitive):**
- Process tree kill (POST_ /exec/kill) - Triet tieu toan bo cay process con tren Windows qua taskkill /pid <PID> /T /F.
- Real-time command streaming (GET_ /exec/stream hoac SSE) - Tranh UI freeze cho cac lenh dai nhu git clone hoac npm install.
- Chunked file streaming - Doc/ghi stream file lon khong ton RAM heap.
- Path normalization & DOS device guard - Chan thiet bi DOS (CON, PRN, NUL) va NTFS Colon Streams (:).

**Defer (v2+):**
- Dynamic port allocation voi discovery file (%TEMP%/fs-gw.port).
- Shared secret header token (X-FS-GW-Token) chong browser cross-origin scanning.
- Daemon background service (giu nguyen mo hinh headful PowerShell window de EPR chap thuan).n
### Architecture Approach

Kien truc phan tang 4 lop don gian va ro rang:
1. HTTP Infrastructure: server.js bind 127.0.0.1, cors.js + security.js kiem tra Host header va remote address, router Map dispatch O2(1).
2. Middleware: body.js gioi han kich thuoc payload (max 10MB) ngan DoS bo noo.
3. Core Services: fs.service.js (goi gon node:fs/promises, path sanitizer) va proc.service.js (goi gon child_process.spawn, process tree registry, timeout management).
4. Transport/Routes: Cac route handlers mong map HTTP request/response vao service layer va format response qua response.js.

**Major components:**
1. Server & Security Guard: Dam bao chi loopback process duoc quyen tuong tac, bao ve port 4820.
2. FS Service & Path Sanitizer: Thuc hien file IO an toan, validate path containment, tranh path lock EBUSY.
3. Process Execution Engine: Quan ly lifecycle cua child process, thu thap stdout/stderr, xu ly timeout va kill tree an toan.

### Critical Pitfalls

1. **Shell Injection & Batch File Traps (CVE-2024-27980):** Dung child_process.spawn(cmd, args, { shell: false }) voi mang tham so ro rang. Khong bao gio dung exec() hoac chuoi noi lenh shell.
2. **Zombie Process khi Timeout/Abort:** Tren Windows, child.kill() chi ngat process vo. Phai dung taskkill.exe /pid <PID> /T /F de don sach toan bo cay tien trinh con.
3. **Path Traversal & Windows DOS Device Hang:** fs.open('CON') hoac fs.stat('NUL') lam treo thread. Phai regex chan cac ten thiet bi DOS (CON, PRN, AUX, NUL, COM1-9, LPT1-9) va NTFS stream syntax (:).
4. **Tran bo nho do Buffering Output lon:** Tranh gom vo han buffer stdout/stderr hoac dung fs.readFile cho file lon. Can dat gioi han maxOutputBytes (truncate flag) hoac stream truc tiep qua SSE / HTTP chunked response.
5. **DNS Rebinding & Cross-Origin Web Attacks:** Kiem tra bat buoc header Host thuoc 127.0.0.1:<PORT> hoac localhost:<PORT>, tu choi cac request xuat phat tu website cong cong.

## implications for Roadmap

Dua tren ket qua nghien cuu kien truc va phu thuoc, lo trinh trien khai de xuat chia thanh 4 giai doan logic:

### Phase 1: Foundation, Security & Core HTTP Skeleton
**Rationale:** Can nen tang HTTP server vung chac, an toan loopback, dinh dang response/error dong nhat truoc khi xay dung bat ky logic nghiep vu nao.
**Delivers:** Server loopback 127.0.0.1, cau hinh port (4820), security check (Host header, remote IP), CORS handler, Map router, va endpoint GET /health.
**Addresses:** GET /health, CORS Handling, Standardized Error Format.
**Avoids:** Pitfall 5 (Port collision), Pitfall 6 (DNS rebinding / unvalidated Host header).

### Phase 2: Filesystem Service & Endpoints
**Rationale:** Thao tac filesystem la dich vu stateless, it rui ro hon process execution, cung cap ngay gia tri cho client doc/ghi workspace.
**Delivers:** Path sanitizer guard (chong DOS devices, traversal), payload body parser an toan (max limit 10MB), cac endpoint POST /fs/read, /fs/write (atomic write via temp file), /fs/stat, /fs/list, /fs/mkdir, /fs/delete.
**Addresses:** Toan bo table stakes ve filesystem.
**Avoids:** Pitfall 3 (Path traversal & DOS device hangs), Pitfall 4 (OOM qua unbounded file payload).

### Phase 3: Process Execution Engine & Lifecycle Management
**Rationale:** Thuc thi lenh la tinh nang cot loi giai quyet bai toan EPR bypass, doi hoi co che quan ly lifecycle va timeout chat che.
**Delivers:** Service proc.service.js su dung spawn (array args, windowsHude: false), quan ly PID map, timeout tu dong, endpoint POST /exec/run va POST /exec/kill Tich hop tree kill (taskkill /T /F).
**Addresses:** POST /exec/run, POST /exec/kill, Command Timeout Control.
**Avoids:** Pitfall 1 (Command injection / CVE-2024-27980), Pitfall 2 (Windows zombie orphan processes).

### Phase 4: Streaming Enhancements & End-to-End Integration
**Rationale:** Nang cao trai nghiem khi lam viec voi file lon va lenh CLI keo dai ma khong lam thay doi kien truc co ban.
**Delivers:** Streaming cho process output (SSE hoac chunked NDJSON qua GET_ /exec/stream), file download/upload streaming endpoint truc tiep qua fs.createReadStream, bo integration test tu dong bang node:test.
**Addresses:** Streaming Exec Output, Chunked Large File Read/Write.
**Avoids:** Pitfall 4 (V8 heap exhaustion / maxBuffer crash tren command dai).

### Phase Ordering Rationale

- Foundation truoc nhat: Route router va format loi duoc tai su dung xyen suot toan bo endpoint.
- FS truoc Exec: File system de co lap, de kiem thu, xac thuc ngay kha nang tuong thich duong dan Windows (C:\\_..) ma khong sinh side-effects tien trinh.
- Exec rau FS: Thuc thi process dua vao ha tang bao mat da hoan thien va can kiem thu ky luong ve tree-kill tren Windows.
- Streaming cuoi cung: Toi uu hoa hieu nang va trai nghiem sau khi cac luong buffered dong bo da van hanh on dinh.

3## Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (Process Execution):** Can luu y xu ly chinh xac binary extensions tren Windows (.exe, .cmd, .bat qua PATHEXT) va co che goi an toan taskkill.exe /pid <PID> /T /F.

Phases with standard patterns (skip research-phase):
- **Phase 1 (HTTP Foundation & Health):** Su dung cac pattern tieu chuan cua node:http.
- **Phase 2 (Filesystem Operations):** API node:fs/promises da duoc chuan hoa va on dinh xem Node 20+.

## Confidence Assessment

| Area | Confidence | Notes |
|------e|------------|-------|
| Stack | HIGH | Da kiem chung truc tiep tren Node v20.19.5 Windows 11 Pro; stdlib dap ung 100%. |
| Features | HIGH | Phu hop chinh xac voi yeu cau desktop bridge tu ung dung task-management. |
| Architecture | HIGH | Kien truc module phan tang khong dependency da duoc kiem chung rong rai. |
| Pitfalls | HIGH | Rui ro Windows child process, batch file traps va EDR headless policies deu co tai lieu chi tiet va giai phap cu the. |

**Overall confidence:** HIGH

### Gaps to Address

- atch execution argument quoting: Tren Windows, goi script .bat/.cmd co the gap loi neu path chua dau cach hoac ky tu dacb biet. Trong qua trinh lap ke hoach Phase 3, can xac dinh ro quy tac whitelist hoac boc PowerShell script neu bat buoc chay batch file.
- Tauri Port Discovery: Hien tai chot port mac dinh 4820. Can thong ndat voi ung dung client Tauri phuong an fallback neu port 4820 bi ung dung khac chiem giu.

## Sources

### Primary (HIGH confidence)
- Node.js Official Documentation (node:http, node:fs/promises, node:child_process, node:test).
- Node.js Security Advisory CVE-2024-27980 (Windows batch injection mitigations).
- Microsoft Windows API Documentation (CreateProcessW, TerminateProcess, taskkill).

3## Secondary (MEDIUM confidence)
- OWASP Localhost API & DNS Rebinding Security Guidance.
- Tauri v2 IOC Architecture & Security Guidelines.

---
*Research completed: 2026-11-02*
*Ready for roadmap: yes
