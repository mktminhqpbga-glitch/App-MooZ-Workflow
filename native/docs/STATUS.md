# Trạng thái nghiệm thu native

Nguồn chuyển từ baseline `5bd7dea` sang Swift. Không dùng số nút/màn hình làm tiêu chí hoàn tất.

## Đã có bằng chứng chạy trên Linux

- Swift 6.1.3 official container: planner, SQLite reopen, queue busy, mất response/ACK, partial và cooldown.
- Tab/device/session/chat, nonce đúng/sai, permission tồn tại qua restart và không cấp lại.
- FFmpeg tạo clip thật đỏ/xanh, ghép đúng thứ tự, kiểm pixel/thời lượng, cắt + nhạc + SRT và giải mã toàn bộ H264/AAC.
- Companion native tạo riêng, kiểm cú pháp JavaScript; extension cũ không bị ghi đè.

Kết quả cụ thể ghi ở cuối tài liệu khi chốt. Linux không type-check code trong `#if os(macOS)`.

## Đã viết, cần macOS xác nhận

- SwiftUI/AppKit UI, Canvas kéo/nối, NSTextView chèn thẻ, AVPlayer, Keychain, Network.framework WebSocket.
- Build release `.app`, bundle FFmpeg/dylib/companion, ad-hoc codesign, ZIP/checksum.
- Workflow native macOS test/package/launch; smoke dùng file thật, preview 6 job, chạy 1 job hai cảnh, mở lại SQLite, hậu kỳ, MP4 và screenshot. Không phát hành tự động.

## Chưa được nghiệm thu

- Build/launch trên Mac hoặc runner macOS thành công, thao tác UI, kéo thả và Save panel.
- Chrome với tài khoản AI thật: đăng nhập, selector, model/settings đúng lựa chọn, đa ảnh/đa video, reload/mất mạng.
- API thật có key/hạn mức; fixture HTTP chỉ kiểm hợp đồng, không xác nhận model còn được cung cấp.
- Model/chất lượng/resolution trên website chưa có adapter điều khiển đầy đủ như API; không tuyên bố đã áp dụng trên Chrome.
- Khôi phục thủ công unknown khi mất receipt; nhiều phiên app cùng mở một kho; hiệu năng file lớn.
- Canvas hiện ảnh đầu vào → cảnh → ghép video, chưa phải engine cho mọi graph tùy ý.
- Developer ID, notarization và kiểm riêng Intel/Apple Silicon.

Không gọi đây là bản phát hành hoàn chỉnh trước khi các gate thực tế liên quan đạt. Không đủ ảnh LibLib trong checkout để đối chiếu từng chi tiết tham chiếu cũ.
