# Tab cố định và mã nhận diện câu trả lời

Tab không được nhận diện bằng tiêu đề, thứ tự cửa sổ hay tab đang được chọn. Binding chụp khi tạo job gồm:

| Trường | Ý nghĩa |
|---|---|
| deviceID | UUID trong chrome.storage.local của bản cài companion |
| epoch | UUID chrome.storage.session; đổi khi Chrome khởi động lại, không đổi khi service worker ngủ/thức |
| tabID | ID nội bộ Chrome của đúng tab đã chọn |
| conversationURL | Danh tính chat; giữ query/fragment có thể xác định cuộc trò chuyện |
| provider | Dịch vụ AI suy ra từ host HTTPS hợp lệ |

Tab đóng, sai thiết bị/phiên, URL chat đổi ngoài lượt đang xử lý → chờ/đối chiếu. App không tự focus, chọn tab khác hoặc phát lại prompt. Từ chat mới sang URL chat có ID chỉ được chấp nhận khi cùng host, đúng requestID và user-turn chứa mã của lượt đó.

Mỗi Scene có UUID requestID và mã ngẫu nhiên `MZ-…` riêng, lưu bền vững từ kế hoạch. Prompt chứa `[MOOZ_REQUEST:MZ-…]`; văn bản được yêu cầu trả `[MOOZ_REPLY:MZ-…]`. Với ảnh/video, bridge kiểm mã trong user-turn và lấy media sau lượt đó; không yêu cầu vẽ mã lên hình. RequestID/code trong JSON đơn thuần không đủ chứng minh.

Quyền chuẩn bị/gửi gắn đúng request/device/epoch/tab, ghi xuống đĩa trước khi cấp quyền click. Quyền dùng một lần, hết hạn không cấp lại. Cùng provider không chuẩn bị hai tab song song. Tải và kiểm file, lưu manifest, ACK thành công rồi mới mở khóa và bắt đầu cooldown 10 giây trong SQLite.

Đây là đối chiếu app/companion, không phải chứng thực nội dung do AI ký. DOM website cần nghiệm thu trực tiếp và có thể thay đổi. Reload trang làm mất receipt/content-script state → giữ unknown, không đoán để báo hoàn tất.
