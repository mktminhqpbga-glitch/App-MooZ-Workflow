# Sửa lỗi ChatGPT Chrome · 0.5.1

| Lỗi | Thay đổi | Kiểm tra |
| --- | --- | --- |
| ChatGPT chỉ nhận prompt, thiếu khung/độ phân giải | ChromeConnection ghép thông số có cấu trúc vào yêu cầu gửi thật; giữ style/camera/lens từ runner | Kiểm payload 9:16, 2K, high, 85 mm, prompt mẫu |
| Tạo ảnh xong nhưng Canvas không nhận | Bridge nhận turn chỉ chứa ảnh; server chấp nhận URL mới do lần gửi đầu khi có chứng nhận URL từ bridge, không chấp nhận chat khác | DOM ChatGPT mô phỏng chạy mã bridge từ ZIP phát hành, trả PNG thật và URL mới |
| URL binding cũ gây lỗi lần gửi sau | Lưu URL đã xác nhận về job và binding node | UI kiểm binding sau kết quả |
| Lỗi gửi làm người dùng không thể tiếp tục | Khôi phục nhãn/nút gửi; kiểm provider trước gửi; nút kiểm tra và mở lại gửi có kiểm phiên AI và giữ giới hạn dịch vụ | Lỗi trước gửi → bấm gửi tiếp → kết quả thành công |
| Không thấy hiệu lực mẫu nội dung | Hiển thị chỉ dẫn đã áp dụng và trạng thái mẫu đang chọn | Bấm đủ 15 mẫu, kiểm nội dung thực trong node và payload |
| Cập nhật tab không có phản hồi | Thông báo đang cập nhật/số tab/lỗi rõ ràng | Thêm tab mới, cập nhật, chọn được tab mới |
| Mất phản hồi sau khi đã tạo | Cache kết quả hoàn tất theo request ID, đối chiếu chỉ đọc; nhận lại vào Canvas/Kho | Không phát sinh GENERATE mới, không nhận request ID khác |

Kiểm tra cục bộ: build, 40 kiểm tra lõi, 19 suite browser/integration và ứng dụng Electron đã đóng gói đều qua. CI Mac kiểm tra lại trước phát hành.

## Cập nhật cần thiết

Cài app 0.5.1 và MooZ Connect 1.9.3 trong Cài đặt. Nếu dùng bản giải nén, thay nội dung thư mục extension đã nạp, mở chrome://extensions và bấm tải lại. Tải lại các tab AI đang mở rồi cập nhật/chọn tab trong app.

Các lượt cũ không được extension 1.9.2 lưu sẽ không xuất hiện trong cache mới: tải ảnh đã tạo và nhập Kho. Cache mới giữ tối đa 8 kết quả trong 30 phút và giới hạn bộ nhớ; không phải kho lưu trữ dài hạn.

Các bài thử ChatGPT dùng DOM mô phỏng và mã extension thật, không phải phiên đăng nhập của người dùng. Chưa thể chứng nhận 100% với mọi thay đổi giao diện ChatGPT hay tài khoản thực tế. Tỷ lệ, độ phân giải và ống kính được gửi đầy đủ như yêu cầu; mức hỗ trợ đầu ra thực tế vẫn do dịch vụ/model quyết định.
