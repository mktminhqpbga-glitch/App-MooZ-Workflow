# MooZ CVN / Toonflow — ngữ cảnh hiện tại

## Mục tiêu đã được người dùng chốt

- Dùng code Toonflow thay app Swift cũ, giữ bộ máy Canvas, media task, provider và file của Toonflow.
- Giao diện theo App-MooZ-Workflow/main c922c8cde98eb42f006b44351829eae01a50e5f4: xám đậm, xanh nhạt, sidebar thu gọn, form trái rộng và queue phải. Tiếng Việt mặc định, gồm UI plugin. Không dịch dữ liệu/prompt người dùng.
- Xưởng ảnh và xưởng video là route /images và /videos riêng, không nằm trong Canvas. Kho /library, hậu kỳ /post, Canvas /workspace.
- Intel macOS 13 Ventura; người dùng không nâng hệ điều hành. compat/macIntel lấy từ upstream v2.0.8 af6e884c3d8cda353acaf8ef13aea8ea754a4afd, SDK 1.18.1; Web/Server hiện tại không bị hạ phiên bản. Hook kiểm Mach-O tối thiểu OS, không chỉ đổi plist.
- Chrome local, máy khác, VM qua extension/Render. App tự mở relay loopback và sinh khóa riêng; Render cần tài khoản/hạ tầng thực, chưa triển khai. Không xuất bản release hoặc đụng main.

## Bản đồ mã nguồn cần đọc

- apps/web/src/components/studioShell.vue: shell MooZ và điều hướng.
- apps/web/src/pages/batchStudio/index.vue và pages/workspace/panels/batch/index.vue: chọn dự án độc lập, form/ảnh/@anhN, split prompt, model rules, preset, preview, queue và tải file.
- apps/server/src/utils/batch/{composer,index}.ts: plan, hash cấu hình/file, snapshot, queue lưu bền và mediaTasks theo UUID; không gửi lại khi kết quả chưa rõ.
- apps/server/src/utils/media/{tasks,generation,provider,render}.ts: task/checkpoint, ghi file, probe video, ACK sau persist, ghép MP4. SHA256 host tool là dấu vân tay dispatch; không dùng Bun.hash dạng số thay cho chuỗi 64 hex.
- packages/providers/src/media/museChrome.ts: Muse ảnh/video (text và tối đa 8 ảnh); không tự khai báo first/last/extend. Kiểm protocol/receipt/nonce/conversation, dữ liệu thật; host FFprobe trước hoàn tất/ACK.
- apps/chromeRelay/src/server.ts: factory Bun server; index.ts chỉ CLI. Store JSON atomically trên đĩa riêng, một instance. Không coi process-local queue là khóa phân tán.
- apps/server/src/utils/chromeRelay/index.ts: quản lý relay và embedded loopback; apps/desktop/src/index.ts bật chromeRelay.
- apps/chromeExtension: MV3, bridge từ app-mooz/companion, dispatch intent trước click, nonce + tab/device/epoch/conversation, one-use permit, busy/offline chờ, ACK đúng lượt, ZIP tạo bằng build.
- apps/web/src/pages/{library,postStudio}: file dự án và hậu kỳ FFmpeg thật (cắt/ghép, nhạc/lời đọc từ file, SRT, MP4). Không tự sinh lời đọc/phụ đề.
- packages/i18n: host + plugin UI, 948 chuỗi plugin và 24 nhãn model/node bổ sung vào vi.json; dynamic form labels được dịch, field/value/prompt giữ nguyên.
- .github/workflows/venturaIntel.yml: chỉ build/upload artifact Intel; không tạo release. FFmpeg kèm theo, kiểm hash từ release chính chủ.

## Lệnh và dữ liệu

Bun 1.4.3: /workspace/.devtools/bin/bun. Cài bun install --frozen-lockfile. Linux dùng bun run build:server (root build --filter có bug upstream). Server/Web/relay/extension có typecheck riêng. Không thêm test modules, mocks, fixture, check script hoặc CI test entry. Chỉ chạy checks có sẵn và thao tác thực cần thiết.

Server phát triển: TOONFLOW_DATA_DIR=/tmp/toonflow-local-edition-data TOONFLOW_SERVER_PORT=4179 TOONFLOW_EMBEDDED_CHROME_RELAY=1 bun build/server/index.js. Mac dữ liệu mặc định ~/Library/Application Support/ToonflowMooZ; dự án do người dùng chọn, không ghi vào .app.

Backups cũ ngoài checkout: /workspace/.backups/App-MooZ-Workflow-20261107T031630Z (Git bundle + working-tree tar đã khôi phục kiểm chứng). Origin và lịch sử repo giữ nguyên. Mọi push cần thiết vào feat/native-macos đã được cho phép; main chỉ đọc.

## Giới hạn bằng chứng

Build/typecheck không chứng minh tạo AI thật hay chạy trên Ventura thật. Cloud Chrome bị quản trị chặn extension unpacked; không lách chính sách. Cần nghiệm thu Muse/account thật, Chrome máy khác/VM và Render WSS. Không tạo media giả làm kết quả AI. Nếu dùng video ghi hình app để kiểm hậu kỳ, ghi rõ đó là đầu vào ghi màn hình thật, không phải clip AI.

Đã bỏ UI tài khoản, quảng cáo, khám phá, sponsorship và telemetry; backend chặn các API cloud/tenant của bản cục bộ, không mở quyền online. Không xóa OSS/database online. Bản kết hợp GPL-2.0-or-later, MIT upstream giữ tại docs/toonflowMitLicense.txt. Xem docs/thirdPartyNotices.md.
