# File System Gateway (fs-gw)

## What This Is

Node.js HTTP proxy server chạy trong cửa sổ PowerShell headful để làm cầu nối (gateway) cho ứng dụng desktop `task-management` (Tauri). Proxy cung cấp các REST API cho phép đọc/ghi file hệ thống và thực thi process, giúp ứng dụng vượt qua chính sách bảo mật ngăn chặn process spawn headless từ binary lạ.

## Core Value

Cung cấp kênh giao tiếp cục bộ tin cậy và ổn định để ứng dụng desktop đọc/ghi filesystem và thực thi child process mà không bị EDR/hệ điều hành chặn.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] HTTP REST server tối giản sử dụng Node.js stdlib (`node:http`, `node:fs/promises`, `node:child_process`), 0 third-party dependencies.
- [ ] Binding mặc định an toàn tại `127.0.0.1` với port có thể cấu hình (hoặc port mặc định cố định, ví dụ 4820).
- [ ] File System endpoints: Đọc file (UTF-8 / Binary), ghi file, tạo thư mục (`mkdir -p`), xóa file/thư mục, kiểm tra tồn tại (`exists`), liệt kê thư mục (`readdir`), và lấy thông tin file (`stat`).
- [ ] Child Process Execution endpoint: Chạy lệnh shell/binary (git, npm, cli...) với working directory tuỳ chọn, trả về exit code, stdout, stderr.
- [ ] Streaming support hoặc cơ chế chunking cho kết quả đọc file lớn / output command dài.
- [ ] CORS & Healthcheck: Hỗ trợ CORS cho local origin của Tauri/Vite và endpoint `GET /health` kiểm tra trạng thái gateway.
- [ ] Error handling chuẩn hoá: Trả về JSON lỗi có cấu trúc (`{ error: string, code?: string, details?: any }`) với HTTP status codes thích hợp.

### Out of Scope

- [ ] Giao diện đồ hoạ GUI — server chạy trực tiếp trong terminal PowerShell.
- [ ] Xác thực phức tạp / Token auth — hiện tại chỉ bind localhost `127.0.0.1`, không mở ra mạng ngoài.
- [ ] Cloud sync / remote file transfer — chỉ phục vụ filesystem cục bộ trên máy host.

## Context

- Ứng dụng nguồn: `@../task-management` (Tauri v2 + React 19 + Vite desktop app).
- Môi trường: Windows 11 Enterprise với chính sách EDR/AppLocker chặn process bị spawn headless (`CREATE_NO_WINDOW`) từ binary ứng dụng chưa ký duyệt.
- Quản trị viên xác nhận ứng dụng an toàn nhưng chính sách máy không thể sửa. Khi người dùng tự mở PowerShell headful và chạy server Node.js thì các process con được phép thực thi bình thường.

## Constraints

- **Tech stack**: Node.js stdlib only (không cài thư viện ngoài npm nhằm khởi động nhanh, zero maintenance, an toàn tuyệt đối).
- **Security**: Chỉ lắng nghe trên `127.0.0.1` (IPv4 loopback), từ chối kết nối từ external interface.
- **Port**: Cố định cổng mặc định (ví dụ 4820) hoặc tự động chọn/ghi nhận port để app dễ kết nối.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Node.js stdlib thuần (`node:http`) | Không cần phụ thuộc npm, nhẹ, khởi động tức thì, không bị ảnh hưởng bởi supply chain attacks | — Pending |
| HTTP REST API | Chuẩn hóa, dễ tích hợp trực tiếp từ frontend fetch trong React / Tauri | — Pending |
| Localhost bind only | Đơn giản hóa, không cần setup auth token cho cá nhân, an toàn trong phạm vi loopback | — Pending |

---
*Last updated: 2026-11-02 after initial project creation*
