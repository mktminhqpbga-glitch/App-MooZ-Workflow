# MooZ — ứng dụng macOS native

Hướng phát triển chính là app Swift/SwiftUI/AppKit cho macOS 13+: chọn đầu vào → xem kế hoạch → Canvas/hàng đợi chung → Kho → ghép cảnh và hậu kỳ → xuất MP4.

App không chạy HTML/CSS/JavaScript, Electron hoặc WebView. MooZ Connect Native là extension Chrome riêng.

Bản kiểm thử hiện hướng đến **Intel, macOS 13 Ventura trở lên**. Workflow [Native macOS](https://github.com/mktminhqpbga-glitch/App-MooZ-Workflow/actions/workflows/native-macos.yml) dựng Swift trên runner macOS 15 Intel với deployment target 13. FFmpeg và các thư viện phụ đề được dựng từ nguồn đã khóa phiên bản/checksum; kiểm tra gói sẽ thất bại nếu binary yêu cầu macOS mới hơn 13.

Xem [hướng dẫn native](native/README.md) để tải bản kiểm thử hoặc build từ nguồn. `make package` tạo `native/artifacts/MooZ.app` và ZIP kèm FFmpeg/ffprobe và companion riêng. Đây là bản ad-hoc; chưa có chứng nhận Developer ID/notarization. Người chạy bản đã đóng gói không cần cài Node, Swift hoặc Homebrew.

- [Hướng dẫn native](native/README.md)
- [Kiến trúc và luồng dữ liệu](native/docs/ARCHITECTURE.md)
- [Bằng chứng kiểm thử và phần cần nghiệm thu](native/docs/STATUS.md)
- [Nhận diện tab và mã đối chiếu](native/docs/CHROME-IDENTITY.md)

Mã web/Electron cũ được giữ để tham chiếu chuyển đổi; [hướng dẫn cũ](docs/LEGACY-WEB-README.md) không phải cách build app native. Workflow cũ chỉ chạy thủ công và không xuất bản release tự động.

Giấy phép: [GPL-2.0-or-later](LICENSE). Các bridge Chrome kế thừa nguồn trong `downloads/MooZ-Connect.zip` và `vendor/mooz`; giữ nguyên thông báo bản quyền của nguồn.
