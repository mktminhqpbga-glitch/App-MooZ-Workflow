# MooZ Native

Ứng dụng đích là macOS 13+ bằng Swift, SwiftUI/AppKit, SQLite, URLSession và FFmpeg native. HTML/CSS/JavaScript không chạy trong app. Chrome companion là extension riêng.

## Chạy trên Mac

```sh
# Cần Xcode/Command Line Tools và FFmpeg có libx264/libass.
brew install ffmpeg
cd native
swift test -j 4
swift run MooZ
```

`make package` từ root tạo `.app`, ZIP và checksum trong `native/artifacts/`. Script đóng gói cả các dylib FFmpeg; không dựa vào Homebrew trên máy người nhận. Bản ad-hoc là bản kiểm thử, chưa phải Developer ID/notarized public release.

## Luồng và dữ liệu

- Canvas và Batch cùng tạo/ghi `Job`, input snapshot, role/slot và hàng đợi.
- Planner thuần Swift, preflight toàn đợt; xem ma trận trước khi xếp. Xếp không đồng nghĩa đã gửi.
- Kho dùng SQLite WAL + file content-addressed, SHA256 và provenance request/item. Không lưu base64 media trong JSON job.
- Tab busy → waiting; job gửi chưa rõ → reconcile cùng request ID. ACK chỉ sau khi các file và manifest đã được ghi; cooldown 10 giây lưu trong database.
- Clip từng cảnh giữ riêng. Ghép/trim/nhạc/lời đọc/phụ đề tạo file mới, kiểm H264/AAC, thời lượng và decode toàn bộ MP4.
- API key ở macOS Keychain. Mã ngẫu nhiên riêng mỗi lượt giúp đối chiếu, không thay thế kiểm tab/chat/file.

## Kiểm chứng

Swift core được biên dịch/kiểm thử trên Linux bằng image chính thức `swift:6.1.3-jammy` với `libsqlite3-dev`, `ffmpeg`. Build này không chứng minh giao diện AppKit/SwiftUI chạy trên Mac. Workflow native phải build/test/package/launch trên macOS trước khi có thể xác nhận app native.

Xem `docs/STATUS.md` cho phạm vi và các gate còn chưa đạt. Không dùng fixture để tuyên bố đã nghiệm thu tài khoản AI thật.
