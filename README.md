# MooZ — ứng dụng macOS native

Hướng phát triển chính là app Swift/SwiftUI/AppKit cho macOS 13+: chọn đầu vào → xem kế hoạch → Canvas/hàng đợi chung → Kho → ghép cảnh và hậu kỳ → xuất MP4.

App không chạy HTML/CSS/JavaScript, Electron hoặc WebView. MooZ Connect Native là extension Chrome riêng.

```sh
# Trên Mac có Xcode/Command Line Tools và Swift 6+
brew install ffmpeg-full
export PATH="$(brew --prefix ffmpeg-full)/bin:$PATH"
make test
make run
make package
```

`make package` tạo `native/artifacts/MooZ.app` và ZIP kiểm thử, kèm FFmpeg/ffprobe native và companion. Đây là bản ad-hoc; chưa có chứng nhận Developer ID/notarization.

- [Hướng dẫn native](native/README.md)
- [Kiến trúc và luồng dữ liệu](native/docs/ARCHITECTURE.md)
- [Bằng chứng kiểm thử và phần cần nghiệm thu](native/docs/STATUS.md)
- [Nhận diện tab và mã đối chiếu](native/docs/CHROME-IDENTITY.md)

Mã web/Electron cũ được giữ để tham chiếu chuyển đổi; [hướng dẫn cũ](docs/LEGACY-WEB-README.md) không phải cách build app native. Workflow cũ chỉ chạy thủ công và không xuất bản release tự động.

Giấy phép: [GPL-2.0-or-later](LICENSE). Các bridge Chrome kế thừa nguồn trong `downloads/MooZ-Connect.zip` và `vendor/mooz`; giữ nguyên thông báo bản quyền của nguồn.
