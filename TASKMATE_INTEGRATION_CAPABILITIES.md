# Đánh Giá Khả Năng Tích Hợp TaskMate Với File System Gateway (fs-gw)

Tài liệu này tổng hợp phân tích kiến trúc hiện tại của `task-management` (TaskMate) và liệt kê chi tiết các tính năng, điểm nghẽn (bottlenecks) trước đây bị hệ điều hành/EDR Windows chặn, cùng giải pháp mở khóa khi tích hợp với `fs-gw`.

---

## 1. Bối Cảnh Kỹ Thuật & Vấn Đề Gốc Của TaskMate

### A. Vấn đề EDR Windows 11 Enterprise
- `task-management` chạy trên **Tauri v2** (`TaskMate.exe`). Khi Tauri spawn child process ngầm (`CREATE_NO_WINDOW = 0x08000000`) như `claude.cmd`, `git.exe`, hoặc shell con trong `src-tauri/src/agent_manager.rs`, EDR/AppLocker phát hiện đây là hành vi **headless process injection / anomalous binary execution** và lập tức chặn hoặc treo process.
- Việc mở terminal bên ngoài (`launch_claude_at_local_path` trong `src-tauri/src/jira_proxy.rs`) chỉ là giải pháp tạm thời, khiến TaskMate mất quyền kiểm soát luồng dữ liệu (stdout/stderr) và không thể tích hợp sâu vào giao diện chat UI.

### B. Giải pháp với `fs-gw`
- `fs-gw` chạy trực tiếp trong cửa sổ PowerShell headful của người dùng (Interactive Session).
- Khi TaskMate gọi `fs-gw` qua HTTP loopback (`http://127.0.0.1:4820`):
  1. `fs-gw` spawn process với `windowsHide: false`, kế thừa console user session, hoàn toàn hợp lệ với chính sách EDR.
  2. Mọi luồng dữ liệu `stdout`, `stderr`, trạng thái `exitCode` được truyền ngược về TaskMate qua Server-Sent Events (SSE) theo thời gian thực.
  3. `taskkill.exe /pid <PID> /T /F` đảm bảo diệt sạch process tree khi người dùng bấm dừng, tránh zombie process.

---

## 2. Các Tính Năng Có Thể Mở Khóa & Leverage `fs-gw`

### 1. Ghost Dev & AI Coding Agent (Tính Năng Quan Trọng Nhất)
*Hiện trạng trong TaskMate:*
- TaskMate đã có module `agent_manager.rs`, `agent_diff_ops.rs` để chạy Claude Code tự động trong Git Worktree, nhưng gặp khó khăn khi spawn trực tiếp từ binary Rust của Tauri trên Windows.
- Hiện chỉ mở được cửa sổ cmd ngoài: `cmd.exe /d /k claude` làm đứt gãy luồng trải nghiệm trên UI.

*Khi tích hợp `fs-gw`:*
- **Chạy Claude Code Headless Embedded:** Gọi `POST /exec/stream` với `{ command: "claude", args: ["-p", prompt, "--output", "stream"], cwd: worktreePath }`.
- **Stream Log Thời Gian Thực Vào Chat UI:** Frontend TaskMate kết nối SSE để hiển thị phản hồi AI, từng dòng suy nghĩ, và công cụ Claude đang chạy theo thời gian thực mà không sợ bị EDR chặn.
- **Hỗ trợ Multiple Concurrent Agents:** Chạy đồng thời 2-4 worker agents trên các Git Worktree khác nhau phục vụ các task song song (tận dụng kiến trúc async non-blocking của `fs-gw`).
- **Nút Stop/Abort An Toàn:** Gọi `POST /exec/kill` để diệt tức thì toàn bộ tiến trình con của Claude Code mà không để lại tác vụ treo ngầm.

---

### 2. Quản Lý Git Worktree & Thao Tác Diff Nhanh
*Hiện trạng trong TaskMate:*
- `agent_diff_ops.rs` và `agent_manager.rs` phải tự spawn `git ls-files`, `git diff`, `git apply`, `git worktree add/remove` thông qua Rust `std::process::Command`. Nếu git bị hook hoặc quét EDR, lệnh trong Rust sẽ bị block hoặc chậm.

*Khi tích hợp `fs-gw`:*
- **Thực thi Git CLI mượt mà:** Chuyển các lệnh git sang `POST /exec/run`:
  - `git worktree add -b <branch> <path>`
  - `git status --porcelain`
  - `git diff`
  - `git apply <patch>`
  - `git worktree remove --force <path>`
- **Đọc Diff & Nội Dung File Worktree:** Sử dụng `POST /fs/read` (UTF-8 và Base64) để nạp nội dung file trước/sau khi AI chỉnh sửa, hỗ trợ render visual diff view trên UI với tốc độ cao.
- **Duyệt cây file:** Dùng `POST /fs/list` để render cây thư mục trực quan của worktree.

---

### 3. Đồng Bộ & Backup Database Cục Bộ (SQLite & Markdown/JSON)
*Hiện trạng trong TaskMate:*
- TaskMate dùng Dexie (IndexedDB) trên frontend và `sqlite_persistence.rs` trên backend Rust để lưu trữ task, project, work session.
- Khi người dùng muốn export/import backup file, họ phải phụ thuộc vào Web Download API hoặc hộp thoại lưu file của Tauri (`save_file_dialog`).

*Khi tích hợp `fs-gw`:*
- **Auto-Sync / Auto-Export File Thật:** Tự động ghi bản snapshot backup định kỳ ra thư mục cục bộ người dùng cấu hình (ví dụ: `D:\Documents\TaskMate-Backups\2026-11-02.json`) qua `POST /fs/write`.
- **Atomic File Writing:** Tận dụng tính năng ghi nguyên tử (`atomicWriteFile`) của `fs-gw` giúp file backup không bao giờ bị hỏng (corrupted) nếu máy bị tắt đột ngột hoặc crash.
- **Hỗ trợ Local Vault (Markdown Notes):** Cho phép đồng bộ ghi chú (`notes`, `noteAttachments`) trực tiếp vào các vault Markdown cục bộ như Obsidian hoặc thư mục cá nhân.

---

### 4. Quản Lý Đính Kèm File (Note & Task Attachments)
*Hiện trạng trong TaskMate:*
- TaskMate có `NoteAttachmentsPanel.tsx` và bảng `noteAttachments`. Nếu lưu toàn bộ file attachment vào IndexedDB/SQLite, database sẽ nhanh chóng bị phình to (bloat), gây lag app.

*Khi tích hợp `fs-gw`:*
- **Lưu File Đính Kèm Ra Ổ Cứng Ngoài:** File ảnh, PDF, tài liệu Word/Excel được lưu trực tiếp vào thư mục `.taskmate/attachments/<note_id>/` bằng `POST /fs/write` (hỗ trợ Base64).
- **Đọc File Trực Tiếp:** Lấy dữ liệu file kèm MIME type chính xác (`application/pdf`, `image/png`, ...) qua `POST /fs/read`.
- **Dọn dẹp tự động:** Khi xóa task hoặc ghi chú, gọi `POST /fs/delete` để xóa triệt để thư mục đính kèm trên ổ cứng.

---

### 5. Xuất File Báo Cáo & Tài Liệu Không Cần Thẻ `<a download>`
*Hiện trạng trong TaskMate:*
- TaskMate tích hợp các thư viện xuất file lớn: `docx`, `exceljs`, `pptxgenjs`, `jszip` để xuất báo cáo công việc, timesheet, slide standup.
- Vì WebView2/trình duyệt không có quyền ghi file trực tiếp, app phải tạo Blob URL (`URL.createObjectURL(blob)`) rồi tạo thẻ ẩn `<a download="report.xlsx">` và gọi `.click()`.
- **Nhược điểm lớn của thẻ `<a>`:*
  - File tự động rơi vào thư mục `Downloads` mặc định của Windows, người dùng phải tự mở Explorer ra để tìm và dời file đi nơi khác.
  - Không thể tự động lưu thẳng hoặc ghi đè vào thư mục dự án / thư mục làm việc đã cấu hình.
  - Không biết được tiến trình lưu file thành công hay thất bại trên ổ cứng (browser chỉ kích hoạt download rồi ngắt liên lạc).
  - Có thể bị trình duyệt chặn tải hàng loạt (multiple download block).

*Khi tích hợp `fs-gw`:*
- **Lưu Thẳng Vào Đường Dẫn Mong Muốn (Silent / Direct Save):** Chuyển ArrayBuffer hoặc Blob sang Base64 rồi gửi qua `POST /fs/write` với đường dẫn đích (ví dụ: `D:\Projects\client-x\reports\2026-11-weekly.docx`).
- **Ghi Nguyên Tử (Atomic):** Dùng `atomic: true` để tránh file Word/Excel bị hỏng giữa chừng khi export file lớn.
- **Tự Tạo Thư Mục:** `fs-gw` tự động tạo toàn bộ cây thư mục cha nếu chưa tồn tại (`mkdir -p`), không bao giờ bị lỗi thiếu đường dẫn.
- **Xác Nhận Kết Quả:** Nhận phản hồi HTTP `{ ok: true, data: { bytesWritten, path } }` rõ ràng để thông báo toast thành công kèm nút "Mở thư mục" cho người dùng.

---

### 6. Terminal Runner Tích Hợp Trên TaskMate (Custom Build / Script Tasks)
*Hiện trạng trong TaskMate:*
- Người dùng quản lý công việc phát triển phần mềm, thường cần chạy: `npm test`, `cargo build`, `pytest`, `docker compose up`, v.v. liên kết với từng Task thẻ.
- TaskMate trước đây không thể chạy terminal runner tích hợp do bị chặn spawn headless.

*Khi tích hợp `fs-gw`:*
- **Action Buttons Cho Task:** Mỗi Task có thể gắn script (VD: `npm test`). Bấm nút "Run" trên Task card -> gọi `POST /exec/stream`.
- **Embedded Console Widget:** Hiển thị console mini ngay trong modal chi tiết của Task, stream output thời gian thực.
- **Tự động bắt Exit Code:** Nếu exit code = 0 -> tự động chuyển trạng thái Task sang "Done" hoặc thêm Worklog tự động.

---

### 7. Local Automation & CLI Toolchain Integration
*Khi tích hợp `fs-gw`:*
- **Hỗ trợ chạy Python Script / Shell Script:** Cho phép TaskMate kích hoạt các script tự động hóa cá nhân (như script tổng hợp báo cáo tuần, script crawler, script backup).
- **Jira CLI / GitHub CLI:** Ngoài việc dùng Jira API / GitHub Octokit trên web, TaskMate có thể tận dụng session đăng nhập sẵn có của `gh` CLI và `jira` CLI trên máy người dùng qua `POST /exec/run`, không cần lưu lại Personal Access Token trong app.

---

## 3. Kiến Trúc Tích Hợp Đề Xuất (Client-Side Adapter)

Trong TaskMate (`src/services/` hoặc `src/api/`), xây dựng một module trung gian:

```typescript
// task-management/src/services/fsGatewayClient.ts

const FS_GW_BASE = 'http://127.0.0.1:4820';

export const fsGw = {
  // 1. Healthcheck
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${FS_GW_BASE}/health`);
      return res.ok;
    } catch {
      return false;
    }
  },

  // 2. File Operations
  async readFile(path: string, encoding: 'utf-8' | 'base64' = 'utf-8') {
    const res = await fetch(`${FS_GW_BASE}/fs/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, encoding }),
    });
    return res.json();
  },

  async writeFile(path: string, content: string, encoding: 'utf-8' | 'base64' = 'utf-8') {
    const res = await fetch(`${FS_GW_BASE}/fs/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content, encoding, atomic: true }),
    });
    return res.json();
  },

  // 3. Process Execution
  async runCommand(command: string, args: string[], cwd?: string, timeout?: number) {
    const res = await fetch(`${FS_GW_BASE}/exec/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, args, cwd, timeout }),
    });
    return res.json();
  },

  // 4. SSE Streaming Command
  streamCommand(
    command: string,
    args: string[],
    cwd: string,
    onLog: (text: string, isErr: boolean) => void,
    onExit: (code: number | null) => void
  ): { abort: () => void } {
    const url = new URL(`${FS_GW_BASE}/exec/stream`);
    url.searchParams.set('command', command);
    args.forEach(arg => url.searchParams.append('arg', arg));
    if (cwd) url.searchParams.set('cwd', cwd);

    const eventSource = new EventSource(url.toString());

    eventSource.addEventListener('stdout', (e) => onLog(JSON.parse(e.data).chunk, false));
    eventSource.addEventListener('stderr', (e) => onLog(JSON.parse(e.data).chunk, true));
    eventSource.addEventListener('exit', (e) => {
      const data = JSON.parse(e.data);
      onExit(data.exitCode);
      eventSource.close();
    });

    return {
      abort: () => eventSource.close(),
    };
  }
};
```

---

## 4. Bảng So Sánh Trước & Sau Khi Có `fs-gw`

| Hạng Mục | Trước đây (Tauri Standalone trên Win 11 EDR) | Sau khi có `fs-gw` (Headful PowerShell Gateway) |
|---|---|---|
| **Chạy Claude Code Headless** | Bị chặn `CREATE_NO_WINDOW`, phải mở cmd ngoài rời rạc | Nhúng trực tiếp vào UI, stream real-time qua SSE |
| **Quản lý Process Tree** | Dễ để lại process ma khi app crash hoặc kill giữa chừng | Diệt sạch 100% bằng `taskkill /pid <PID> /T /F` |
| **Thao tác File System** | Giới hạn trong sandbox WebView hoặc Tauri command | Đọc/ghi toàn bộ ổ cứng, atomic write chống hỏng dữ liệu |
| **Xuất File & Lưu Báo Cáo** | Hack thẻ `<a download>` thả bừa vào `Downloads/` | Lưu trực tiếp vào thư mục dự án qua `POST /fs/write` |
| **Chạy đồng thời nhiều agent** | Dễ nghẽn event loop, thiếu cơ chế timeout tập trung | Hỗ trợ nhiều concurrent agent mượt mà trên nền async Node.js |
| **Độ phụ thuộc bên thứ 3** | Cần cấu hình quyền Tauri phức tạp trong capabilities | 0 npm package, bảo mật cao, kết nối REST localhost đơn giản |

---
*Tài liệu được khởi tạo và lưu trữ tại thư mục dự án `fs-gw` làm tài liệu kỹ thuật tham chiếu cho quá trình tích hợp.*
