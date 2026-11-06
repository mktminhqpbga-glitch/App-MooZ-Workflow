# Kiểm tra bổ sung 0.3.0

Đã chạy thành công toàn bộ `npm run test:all` và `npm run test:packaged` trên Linux/Chromium/Electron đóng gói. Kiểm tra bổ sung:

- Relay Settings lưu/đọc lại, không trả khóa về giao diện, quyền file 0600, chặn thay cấu hình khi có job. Broker HTTPS/WSS thật với CA thử nghiệm tin cậy: sai khóa bị từ chối, ghép companion mã hóa và RPC tabs chạy, chuyển local thu hồi room.
- Video chiều sâu chạy model MiDaS ONNX thật trong WASM, hủy khi model/worker đã bắt đầu không sinh kết quả, MP4 H264 xám có âm thanh/đúng thời lượng, giữ nguyên nguồn, tải về và thêm Canvas. Không gọi dịch vụ AI bên ngoài.
- Bốn bộ chọn batch cùng hàng khi sidebar thay đổi. Ô nhập kịch bản nằm trên video chồng lấn: elementFromPoint, click/gõ thật, giữ nội dung khi đổi node, không đổi viewport hoặc dựng lại shell; nền sáng đúng theme.
- Bản Electron đóng gói dùng model/FFmpeg đi kèm; ffprobe xác nhận video đầu ra.

Kiểm tra Mac native và phát hành chỉ được coi hoàn tất khi workflow `release-mac.yml` của commit tương ứng thành công. Đây không phải kiểm thử tài khoản AI thật hoặc Chrome trên máy ảo thật của người dùng; chúng chưa được cung cấp. Relay vẫn cần dịch vụ do người dùng triển khai/cung cấp.

---

# Kết quả kiểm tra bản 0.2.0

Môi trường thực thi: Linux, Node 24, Chromium/Playwright và FFmpeg/ffprobe. Không gửi lượt AI trả phí; provider/tab được fixture ở các bài tích hợp. Media MP4/PNG/MP3 được tạo, giải mã và xử lý thật.

Đã chạy thành công:

- 21 unit/HTTP checks: graph, tab trợ lý, idempotency, snapshot/parser/tag/giới hạn, kịch bản JSON, fingerprint sau lưu/validate, OpenAI multipart và speech server-side.
- 5 bộ trình duyệt: dự án/persistence/mobile; workspace/typed refs; media/backup; inline image/video; image controls/dock/quality/gallery/annotation.
- Canvas review: DOM ảnh/video và animation giữ nguyên khi kéo, chuột giữa, marquee chuột trái, popup trên nút/layer/close, submenu hover, text tools, connected AI/shared tab và assistant exclusive.
- Queue/flow: một form fluid, sidebar đẩy nội dung/cột phải, nhân vật tùy chọn, reject toàn đợt, snapshot sau xóa nguồn, chuẩn bị không gửi, queue owner/concurrency/pause, scene prompt, JSON repair, exact-request recovery, local rerun không gọi lại AI, backup gồm snapshot, nối dài frame thật và chặn clip quá ngắn.
- FFmpeg WASM: trim, rotate, color, frame-fit, speed, audio extract/mix, phụ đề SRT, ghép, transition, voice sync, watermark và hủy. Kiểm tra đầu ra bằng ffprobe.
- Electron đã đóng gói cho Linux: thực sự mở app, backend có token, renderer sandbox, tải extension bằng native download, một form, Hậu kỳ và xử lý MP4 bằng WASM được đóng kèm.

Giới hạn xác minh:

- Cross-build Mac Intel ZIP có executable Mach-O x86_64; Linux không chạy được executable macOS. Native Mac checks và DMG thuộc workflow `release-mac.yml`; chỉ release sau khi checks đó pass. Không đánh đồng cross-build với kiểm thử trên Mac.
- Chưa có Developer ID/notarization, không có API key hoặc tài khoản AI thật trong gói.
- Chưa xác nhận Vercel Production; static frontend không thay máy chủ local/relay.
- “Đầu → Cuối” và video API chưa có adapter đã xác thực; giữ vô hiệu/chặn trước khi gửi. Không giả kết quả.
