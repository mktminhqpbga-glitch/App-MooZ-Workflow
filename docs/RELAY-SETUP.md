# Chrome máy ảo / máy khác

Trong Cài đặt → Kết nối Chrome máy ảo:

1. Chọn “Chrome máy ảo / máy khác · relay WSS”.
2. Nhập địa chỉ relay MooZ tương thích, ví dụ wss://relay.example.com/remote, và khóa quản trị của dịch vụ. URL HTTPS của dịch vụ được chuẩn hóa sang WSS /remote.
3. Kiểm tra relay xác minh HTTPS, giao thức MooZ và đăng nhập WSS bằng khóa. Thao tác này không tạo phòng, không gửi AI, không thay cấu hình đã lưu.
4. Lưu cấu hình rồi Tạo mã ghép. Dán mã vào MooZ Connect trong Chrome máy ảo, mở website AI và đăng nhập; cập nhật danh sách tab trong app.

Khóa được lưu phía máy chủ trong runtime/chrome-connection.json, file quyền 0600; không trả khóa qua GET/status, không lưu localStorage. Trên desktop runtime thuộc userData của app. Để trống ô khóa để giữ khóa đã lưu cho cùng địa chỉ; đổi địa chỉ cần nhập lại khóa. Đổi cấu hình ngắt phiên Chrome cũ, chặn đổi khi có request đang chạy. Có xóa cấu hình và trở về local. Không cần chạy Terminal để nhập hai biến môi trường nữa.

App không tự tạo dịch vụ relay/VPS. Cần địa chỉ và khóa từ relay đã triển khai. Source tương thích được giữ ở vendor/mooz/relay-server.cjs, chạy Node 22+ với dependency ws, RELAY_ADMIN_KEY (32–256 ký tự không khoảng trắng), PORT và TLS/WSS tại /remote. Health ở /health. Không dùng địa chỉ website AI làm relay.

Biến môi trường MOOZ_RELAY_URL/MOOZ_RELAY_KEY vẫn được dùng nếu chưa có cấu hình lưu. Cấu hình đã lưu có ưu tiên; cấu hình lỗi có thể sửa trong giao diện thay vì làm app không khởi động.

Kiểm thử TLS/WSS thật có CA test được tin cậy riêng, giữ kiểm tra chứng chỉ; companion giả lập thực hiện handshake và RPC mã hóa. Kiểm thử giao diện dùng máy chủ thật, xác nhận lưu/reload/clear/không trả secret/không đổi kết nối trong lúc đang xử lý job. Không coi fixture này là đã kiểm tra máy ảo/tài khoản AI thực tế của người dùng.
