# Requirements: File System Gateway (fs-gw)

**Defined:** 2026-11-02  
**Core Value:** Cung cấp kênh giao tiếp cục bộ tin cậy và ổn định để ứng dụng desktop đọc/ghi filesystem và thực thi child process mà không bị EDR/Trellix chặn.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Core Gateway & Security

- [ ] **CORE-01**: Gateway server khởi động trên Node.js stdlib thuần (`node:http`), chỉ bind loopback `127.0.0.1:4820`, 0 npm dependencies.
- [ ] **CORE-02**: Endpoint `GET /health` trả về thông tin trạng thái server (`status: "ok"`, uptime, platform, node version).
- [ ] **CORE-03**: CORS preflight hỗ trợ đầy đủ các methods (GET, POST, OPTIONS) và headers cần thiết cho frontend Vite / Tauri.
- [ ] **CORE-04**: Bảo vệ localhost chống DNS rebinding bằng việc kiểm tra strict `Host` header (chỉ chấp nhận `127.0.0.1`, `localhost`).
- [ ] **CORE-05**: Bounded JSON request body parser (tối đa 10MB) với xử lý lỗi cú pháp JSON và mã phản hồi chuẩn hóa (`{ ok: boolean, data?: any, error?: string, code?: string }`).

### File System Operations

- [ ] **FS-01**: Endpoint `POST /fs/read` đọc file dạng text UTF-8 hoặc binary (Base64), trả về content, size, mime gợi ý.
- [ ] **FS-02**: Endpoint `POST /fs/write` ghi nội dung text hoặc binary (Base64) xuống file, hỗ trợ tự động tạo thư mục cha (`mkdir -p`) và cơ chế atomic write qua temporary file.
- [ ] **FS-03**: Endpoint `POST /fs/stat` kiểm tra thông tin file/thư mục (tồn tại `exists: boolean`, isFile, isDirectory, size, mtime), không ném 500 khi file không tồn tại.
- [ ] **FS-04**: Endpoint `POST /fs/list` liệt kê nội dung thư mục, trả về danh sách entry kèm loại (file/directory/symlink).
- [ ] **FS-05**: Endpoint `POST /fs/mkdir` tạo thư mục đệ quy (`recursive: true`).
- [ ] **FS-06**: Endpoint `POST /fs/delete` xóa file hoặc thư mục đệ quy (`recursive: true`, `force: true`).
- [ ] **FS-07**: Bộ lọc Path Traversal & Windows DOS Devices chặn các đường dẫn chứa ký tự điều khiển, thiết bị đặc biệt (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) và Alternate Data Streams (`:`).

### Process Execution Engine

- [ ] **EXEC-01**: Endpoint `POST /exec/run` thực thi command/binary bằng `node:child_process.spawn` với danh sách arguments dạng mảng, `cwd` tùy chọn, và timeout giới hạn.
- [ ] **EXEC-02**: Cơ chế thực thi an toàn không dùng shell string concatenation (`shell: false` mặc định), tránh command injection và không kích hoạt cảnh báo hành vi của Trellix.
- [ ] **EXEC-03**: Endpoint `POST /exec/kill` hủy tiến trình và toàn bộ cây tiến trình con (process tree) trên Windows bằng `taskkill.exe /pid <PID> /T /F`.
- [ ] **EXEC-04**: Theo dõi danh sách process đang chạy (Active PID registry) để tự động thu dọn và ngăn chặn zombie processes khi gateway tắt hoặc tiến trình timeout.
- [ ] **EXEC-05**: Endpoint streaming `GET /exec/stream` hoặc chunked SSE truyền tải real-time stdout/stderr và exit code cho các lệnh kéo dài (git clone/pull, npm test, build).

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Features

- **ADV-01**: Token-based authentication ngẫu nhiên sinh ra mỗi lần start và ghi ra file tạm (`%TEMP%/fs-gw.token`) để ứng dụng client xác thực.
- **ADV-02**: Tự động dò tìm cổng trống kế tiếp nếu port 4820 bị xung đột và ghi port vào discovery file.
- **ADV-03**: Dynamic file stream download (`GET /fs/download`) với HTTP range requests cho file cực lớn (>500MB).

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Third-party npm dependencies | Giữ zero-dependency tuyệt đối để khởi động tức thì, không bị rủi ro bảo mật supply-chain |
| Remote network binding (`0.0.0.0`) | Chỉ bind `127.0.0.1` để ngăn chặn RCE từ mạng nội bộ hoặc external network |
| Complex GUI / System Tray | Server chạy trực tiếp trong PowerShell console headful của người dùng để EDR Trellix công nhận là phiên tương tác người dùng hợp lệ |
| JWT / OAuth authentication | Quá phức tạp và không cần thiết cho ứng dụng cục bộ loopback |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 1 | Pending |
| CORE-02 | Phase 1 | Pending |
| CORE-03 | Phase 1 | Pending |
| CORE-04 | Phase 1 | Pending |
| CORE-05 | Phase 1 | Pending |
| FS-01 | Phase 2 | Pending |
| FS-02 | Phase 2 | Pending |
| FS-03 | Phase 2 | Pending |
| FS-04 | Phase 2 | Pending |
| FS-05 | Phase 2 | Pending |
| FS-06 | Phase 2 | Pending |
| FS-07 | Phase 2 | Pending |
| EXEC-01 | Phase 3 | Pending |
| EXEC-02 | Phase 3 | Pending |
| EXEC-03 | Phase 3 | Pending |
| EXEC-04 | Phase 3 | Pending |
| EXEC-05 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---
*Requirements defined: 2026-11-02*
*Roadmap mapped: 2026-11-02 (Coarse MVP)*
