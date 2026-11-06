# 0.5.1 · Sửa gửi/nhận ChatGPT Chrome và nút mẫu

- Gửi rõ tỷ lệ, độ phân giải và chất lượng đã chọn trong prompt của mọi tab AI; giữ chỉ dẫn máy ảnh/ống kính/mẫu.
- Nhận URL chat mới chỉ khi bridge xác nhận đúng lần gửi đầu; giữ chặn đổi sang chat khác. Lưu lại binding URL sau kết quả.
- Đọc ảnh ChatGPT trong turn chỉ có ảnh, không yêu cầu markdown/nút copy cũ. Giữ cache kết quả theo đúng request ID để đối chiếu mà không gửi lại AI.
- Cập nhật tab có thông báo số tab; thêm kiểm tra/mở lại gửi sau lỗi và nhận kết quả lượt trước vào Canvas/Kho. Không xóa giới hạn đang chờ hay bỏ qua yêu cầu xác minh của dịch vụ.
- Hiển thị chỉ dẫn đã áp dụng; kiểm tra toàn bộ 15 mẫu, payload và gửi lại sau lỗi trước gửi.
- **Cần cập nhật MooZ Connect lên 1.9.3 trong Cài đặt, nạp lại extension và tải lại các tab AI đang mở.** Bản sửa bridge không thay được mã cũ đang chạy trong tab chưa tải lại.
- Kiểm thử bridge dùng DOM ChatGPT mô phỏng với mã extension thật; chưa thay cho kiểm tra tài khoản ChatGPT đang đăng nhập của người dùng. Lượt lỗi cũ chưa được extension cũ lưu không thể tự nhận lại từ cache mới: tải ảnh đó rồi nhập vào Kho.

# 0.5.0 · Thiết lập luồng, API media và Phòng dựng

- Thiết lập luồng với prompt từng bước: đọc ảnh sản phẩm → kịch bản → video từng cảnh → ghép → lưu Kho → hậu kỳ. Lưu, sửa, nhân bản và áp dụng cho đầu vào mới.
- Cài đặt khóa/model OpenAI, Gemini/Veo và fal; thêm API tương thích OpenAI cho văn bản/vision. Khóa ở file riêng quyền 0600, chưa dùng Keychain.
- Adapter Veo hai frame, fal Motion Control và năm công cụ ảnh chuyên dụng; lưu request ID và đối chiếu kết quả, không tự gửi lại tác vụ chưa rõ trạng thái.
- Ràng buộc thông số theo provider; audio vào Canvas, lưu lựa chọn AI/tab và kiểm URL tab khi kết nối lại.
- Xuất/nhập MooZ kèm media, giấy phép và nguồn; nhập graph JSON ngoài qua màn ánh xạ. LibTV chưa xác minh khi chưa có file xuất thật.
- Phòng dựng: nhiều track, fade, giảm nhạc theo mức tiếng gốc, thumbnail, mốc, zoom timeline, preset và bản nháp.
- Chẩn đoán loại khóa/prompt, kiểm phiên bản, dung lượng/quota mềm, dọn cache theo dự án; sáu ảnh nhân vật minh họa có giấy phép CC BY 4.0.

Các kiểm thử dịch vụ dùng fixture/protocol, chưa thay cho kiểm tra tài khoản AI trả phí hoặc Chrome trên máy ảo thật. Chi tiết giới hạn và chứng cứ trong docs/APP-AUDIT-0.5.0.md.

# 0.4.1 · Làm mới giao diện Phòng dựng

- Khung xem, timeline và thông số chia thành các thẻ gọn; nhóm màu/âm thanh riêng.
- Tiêu đề và thanh bước rõ ràng, nền sáng/tối, nút xuất nổi bật; Đóng góc trên phải và thanh thao tác giữ trong tầm nhìn khi cuộn.
- Điều chỉnh giao diện và cách nhóm trường, giữ nguyên renderer và luồng xử lý media của 0.4.0.

# 0.4.0 · Phòng dựng và rà soát toàn app

- Hai timeline độc lập cho video/nhạc; waveform giải mã thật, kéo đoạn/hai mép và nhập giây.
- Chọn nhạc từ tệp hoặc Kho, nhạc phát từ đầu video đã cắt; lặp đúng đoạn chọn hoặc dừng khi hết đoạn.
- Màu, volume nhạc/tiếng gốc riêng; preview và export dùng cùng renderer FFmpeg; MP4 H264/AAC mới, giữ nguồn.
- Preview không tự lưu; xuất/tải/dùng kết quả, không dùng kết quả cũ sau đổi thiết lập; hủy xử lý.
- Kiểm media thật bằng PCM/tần số/pixel/ffprobe, kiểm UI và app đã đóng gói. Báo cáo toàn app trong docs/APP-AUDIT-0.4.0.md, ghi rõ các adapter/kết nối thật còn thiếu.

MooZ CVN 0.3.0 · relay máy ảo, video depth local và bố cục gọn.

- Cài đặt có chọn local/relay, địa chỉ WSS, khóa quản trị, lưu/kiểm tra/tạo mã ghép/xóa cấu hình. Khóa giữ phía máy chủ, không hiển thị lại; không đổi kết nối trong lúc có request chạy.
- Video đã tải lên có nút Tạo video chiều sâu. MiDaS Small chạy local bằng WASM, xuất MP4 xám, có tiến trình/hủy/chọn đoạn/FPS/giữ âm thanh. Đây là độ sâu tương đối từng khung, không phải khoảng cách mét.
- Bốn mục Ảnh sản phẩm – Luồng mẫu – AI – Tab ở một hàng, nút cập nhật tab thu gọn.
- Composer của node đang chọn nổi trên các node lân cận; ô văn bản sáng/tối có nền đúng.

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
