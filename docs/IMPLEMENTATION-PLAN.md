# Hoàn thiện theo tài liệu người dùng

Nguồn: USER-FLOW-SPEC.txt. Bản dán bắt đầu giữa mục 3 và dừng ở tiêu đề 6.5; chỉ dùng nội dung thực sự được cung cấp.

1. Parser prompt/ảnh @tag, kiểm tra toàn đợt, giới hạn 8 MB/ảnh, 8 ảnh/job, 32 MB snapshot, 50 prompt/200 job.
2. Tách chuẩn bị/node khỏi chạy; quản lý queue có Web Lock, pause, concurrency 1–6, cố định tab, không gửi lại sau gián đoạn.
3. Snapshot đúng Task ID, kết quả và checkpoint riêng, xem/tải và tiếp tục có kiểm soát.
4. Graph video 1–12 cảnh: kịch bản JSON được kiểm tra, prompt ảnh/video riêng theo cảnh, ảnh tùy chọn, ghép clip thật.
5. Hậu kỳ local FFmpeg WASM: cắt, xoay, màu, tỷ lệ, audio, SRT, tốc độ, logo, chuyển cảnh, ghép; hủy và giữ nguồn.
6. TTS/Whisper gọi máy chủ giữ key; kiểm tra dữ liệu và thông báo phạm vi gửi.
7. Bộ kiểm thử pure logic, HTTP, trình duyệt, media MP4 thật. Không gửi AI trả phí trong kiểm thử.

Mỗi phần phải có kiểm tra trước khi cập nhật trạng thái hoàn tất. Không khẳng định deployment live khi chưa quan sát được Vercel.
