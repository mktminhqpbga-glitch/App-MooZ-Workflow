MooZ CVN 0.2.1 · sửa nhóm công cụ và ổn định Canvas.

- Click nhóm công cụ giữ bảng mở; click ngoài hoặc nút Đóng mới đóng. Hover vẫn xem nhanh, có khoảng chờ khi rời bảng.
- Không bật lại dashboard khi một Canvas cũ hoàn tất dọn dẹp sau màn hình mới; chặn mount đã hết hạn và ẩn dashboard dưới Canvas.
- Công cụ cần chọn ảnh/video hiển thị hướng dẫn và vô hiệu hóa đúng điều kiện; tìm loại node không làm hỏng nút Đóng.
- Kiểm tra riêng từng nhóm nút, cả theme sáng/tối, và kiểm tra lại trên app đã đóng gói.

MooZ CVN cho macOS Intel (x64), kèm MooZ Connect trong Cài đặt.

- Một khu làm việc rộng, ảnh sản phẩm và ảnh nhân vật tùy chọn.
- Chuẩn bị node/snapshot riêng với chạy hàng đợi; giới hạn concurrency và đúng tab.
- Kịch bản nhiều cảnh, checkpoint và MP4 ghép thật bằng FFmpeg local.
- Hậu kỳ local giữ nguồn; TTS/Whisper dùng khóa OpenAI phía máy chủ.
- Dữ liệu cục bộ trong hồ sơ; xuất sao lưu để chuyển máy.

Bản này chưa ký Developer ID và chưa notarize. macOS có thể yêu cầu xác nhận mở ứng dụng. Không có API key hoặc tài khoản AI trong gói. Đăng nhập website AI trong Chrome và cài extension theo hướng dẫn trong Cài đặt.

Release chỉ được xuất sau kiểm thử trên runner macOS Intel và mở kiểm tra chính gói app đã tạo. Kiểm thử AI dùng fixtures, không chạy lượt trả phí trên tài khoản thật.
