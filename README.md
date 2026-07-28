# 🚀 mcp-pr-companion (Local MCP Server)

`mcp-pr-companion` là một **Local MCP Server (Model Context Protocol)** chạy hoàn toàn cục bộ trên máy lập trình viên. 

Dự án có nhiệm vụ tự động quét dữ liệu Git branch, phân tích raw diff, phân loại thay đổi theo từng tầng kiến trúc (Database, API Controllers, Services, gRPC, Unit Tests) bằng quy tắc gom nhóm AST/Regex, sau đó đóng gói thành một **JSON Payload siêu rút gọn (~1-2KB)**.

---

## 🎯 Mục Đích & Đối Tượng Phục Vụ

- **Mục đích**: 
  - Cắt giảm **80% - 90% lượng token dư thừa** (không cần gửi toàn bộ raw diff hàng vạn dòng vào AI context).
  - Tăng tốc độ sinh PR Description chuyên nghiệp gấp **5 - 10 lần**.
  - Đảm bảo tính bảo mật: Mọi thao tác xử lý Git diff diễn ra 100% offline tại máy local trước khi gửi JSON đã làm sạch cho AI.
- **Đối tượng phục vụ**: Software Engineers, Tech Leads, QA Reviewers làm việc với Bitbucket, GitHub, GitLab cần tạo PR Note/Description nhanh chóng, chính xác.

---

## 📁 Cấu Trúc Thư Mục & Lưu Ý Bảo Mật

```
mcp-pr-companion/
├── bin/
│   └── cli.js                      # Entrypoint khởi chạy CLI
├── scripts/
│   └── setup.js                    # Kịch bản Auto-Setup 1-Click
├── src/
│   ├── healthcheck/                # Quét kiểm tra môi trường Node, Git CLI
│   │   └── healthcheck.ts
│   ├── config/                     # Quản lý & validate file cấu hình
│   │   ├── config.loader.ts
│   │   └── config.schema.ts
│   ├── core/                       # Core logic bóc tách dữ liệu Git
│   │   ├── git/                    # Thực thi lệnh git CLI local
│   │   ├── analyzer/               # Phân loại module & trích xuất điểm nổi bật (Highlights)
│   │   └── generator/              # Đóng gói JSON Payload (~1-2KB)
│   ├── mcp/                        # Khởi tạo MCP Server (Stdio Transport)
│   │   ├── server.ts
│   │   └── tools/                  # Đăng ký tool: generate_pr_payload
│   └── utils/
│       └── logger.ts               # Log an toàn ra stderr (tránh nhiễu stdio)
│
├── ⚠️ config.json                  # [SENSITIVE] File cấu hình thực tế (ĐÃ IGNORE TRONG GIT)
├── config.example.json             # File cấu hình mẫu (Commit an toàn)
├── .gitignore                      # Ignore các file token, credential, config cá nhân
├── package.json
├── tsconfig.json
└── README.md
```

> [!CAUTION]
> **[⚠️ SENSITIVE DATA WARNING]**
> File `config.json` có thể chứa cấu hình cá nhân hoặc quy tắc riêng của dự án. File này đã được thêm vào `.gitignore` để **NGĂN CHẶN TUYỆT ĐỐI** việc lỡ commit các thông tin nhạy cảm lên Git repository.

---

## ⚙️ Hướng Dẫn Cài Đặt 1-Click (Quick Setup)

Khi kéo repository về bất kỳ môi trường hoặc máy mới nào, bạn chỉ cần thực hiện 1 lệnh duy nhất:

```bash
npm run setup
```

**Kịch bản Auto-Setup sẽ tự động thực hiện 5 bước:**
1. 🔍 **Check Node.js (>= 18) & Git CLI**.
2. 📦 **Quét và cài đặt các packages thiếu (`npm install`)**.
3. ⚙️ **Tự động tạo `config.json` từ `config.example.json` nếu chưa có**.
4. 🛠️ **Biên dịch mã nguồn TypeScript (`npm run build`)**.
5. ✅ **Kiểm tra trạng thái sẵn sàng (Healthcheck Complete)**.

---

## 🛠️ Hướng Dẫn Cấu Hình MCP Client

Để nhúng `mcp-pr-companion` vào trợ lý AI (như Antigravity CLI, VSCode MCP, hoặc Claude Desktop), bạn bổ sung đoạn cấu hình Stdio vào file cài đặt MCP:

```json
{
  "mcpServers": {
    "mcp-pr-companion": {
      "command": "node",
      "args": [
        "d:/VisualStudioCode/mcp-pr-companion/dist/mcp/server.js"
      ],
      "env": {}
    }
  }
}
```

---

## 🚀 Cách Sử Dụng Với AI

Sau khi tích hợp, bạn chỉ cần gửi câu lệnh đơn giản cho AI:

> *"Tôi vừa xong branch `feature/WCE-815-staging`. Bạn hãy dùng tool `generate_pr_payload` để lấy data rồi gen giúp tôi bản PR Description dán vào Bitbucket."*

AI sẽ gọi tool `generate_pr_payload` từ Local MCP Server, nhận về JSON payload ~1KB và tạo ra PR Description hoàn hảo chỉ trong vài giây!
