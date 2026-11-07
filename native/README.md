# MooZ Native

Ứng dụng đích là macOS 13+ bằng Swift, SwiftUI/AppKit, SQLite, URLSession và FFmpeg native. HTML/CSS/JavaScript không chạy trong app. Chrome companion là extension riêng.

## Bản kiểm thử Intel Ventura

Mục tiêu chạy app là **Intel x86_64, macOS 13 Ventura+**. [Bản kiểm thử đã qua CI](https://github.com/mktminhqpbga-glitch/App-MooZ-Workflow/actions/runs/42330304806) có ở **Artifacts → MooZ-native-macOS-Intel-test-build** (26,6 MB; GitHub yêu cầu đăng nhập để tải artifact).

Giải nén artifact, rồi giải nén `MooZ-Native-macOS-x86_64.zip` để lấy `MooZ.app`. Gói đã kèm FFmpeg/ffprobe và thư viện xử lý phụ đề; không cần cài Node, Swift hoặc Homebrew để chạy. Có thể đối chiếu hai ZIP với `shasum -a 256 -c SHA256SUMS.txt` trong cùng thư mục. Đây là bản ad-hoc chưa notarize; macOS có thể yêu cầu mở qua Finder → Open.

Chrome: giải nén `MooZ-Connect-Native.zip`, mở `chrome://extensions`, bật Developer mode và chọn Load unpacked đến thư mục có `manifest.json`. Trong app mở **Kết nối**, sao chép mã ghép sang extension, tải lại tab AI rồi chọn đúng tab trong Batch. Mã ghép là quyền truy cập cục bộ; giữ riêng trên máy. Extension là phần riêng, app không chạy JavaScript.

Kho dự án/file mặc định ở `~/Library/Application Support/MooZNative`. API key nằm trong Keychain. Đọc [trạng thái kiểm chứng](docs/STATUS.md) trước khi dùng dữ liệu quan trọng; fixture không xác nhận tài khoản AI thật.

## Build từ nguồn

Build cần macOS và toolchain Swift 6+, Python 3.12, Xcode/Command Line Tools tương thích. CI dùng **macOS 15 Intel** để tạo app target Ventura; không yêu cầu máy Ventura của người dùng phải tự build Swift 6.

```sh
# Từ root repo trên máy build Intel:
brew install pkgconf meson ninja nasm python@3.12
export MOOZ_MEDIA_BUILD_ROOT="${TMPDIR:-/tmp}/mooz-media-ventura"
python3.12 native/Tools/build_media_macos.py
export PATH="$MOOZ_MEDIA_BUILD_ROOT/stage/bin:$PATH"
export MACOSX_DEPLOYMENT_TARGET=13.0
export MOOZ_MAX_MINIMUM_MACOS=13.0
make test
make run
make package
```

`Tools/media-sources.json` khóa nguồn; builder xác minh checksum/revision rồi dựng FFmpeg/libx264/libass và các dependency tĩnh với target 13. Không dùng FFmpeg Homebrew mới để mặc định tuyên bố chạy được trên Ventura. Script package kiểm kiến trúc, load commands, đường dẫn thư viện và minOS thực tế, rồi codesign ad-hoc. `native/artifacts/` chứa `.app`, ZIP, checksum và thông tin bundle; workflow còn lưu screenshot, MP4 và JSON của lần chạy smoke. Chưa có bản Apple Silicon được nghiệm thu.

## Luồng và dữ liệu

- Canvas và Batch cùng tạo/ghi `Job`, input snapshot, role/slot và hàng đợi.
- Planner thuần Swift, preflight toàn đợt; xem ma trận trước khi xếp. Xếp không đồng nghĩa đã gửi.
- Kho dùng SQLite WAL + file content-addressed, SHA256 và provenance request/item. Không lưu base64 media trong JSON job.
- Tab busy → waiting; job gửi chưa rõ → reconcile cùng request ID. ACK chỉ sau khi các file và manifest đã được ghi; cooldown 10 giây lưu trong database.
- Clip từng cảnh giữ riêng. Ghép/trim/nhạc/lời đọc/phụ đề tạo file mới, kiểm H264/AAC, thời lượng và decode toàn bộ MP4.
- API key ở macOS Keychain. Mã ngẫu nhiên riêng mỗi lượt giúp đối chiếu, không thay thế kiểm tab/chat/file.

## Kiểm chứng

Swift core được biên dịch/kiểm thử trên Linux bằng image chính thức `swift:6.1.3-jammy` với `libsqlite3-dev`, `ffmpeg`. Build này không chứng minh giao diện AppKit/SwiftUI chạy trên Mac. Workflow native kiểm build/test/package/launch trên macOS; kết quả cụ thể nằm trong `docs/STATUS.md`.

Xem `docs/STATUS.md` cho phạm vi và các gate còn chưa đạt. Không dùng fixture để tuyên bố đã nghiệm thu tài khoản AI thật.

Companion có hai kiểm thử riêng từ root (cần Python3, unzip, Node/Playwright/Chromium):

```sh
npm --prefix native/Tests ci --ignore-scripts
node native/Tests/companion-worker.cjs
CHROMIUM_PATH=/path/to/chromium node native/Tests/companion.browser.cjs
```

Lõi Swift có thể kiểm trên Linux bằng Docker image `swift:6.1.3-jammy` với `libsqlite3-dev` và `ffmpeg`; bind repo vào container, chạy `swift test -j 4` trong `native`. Cấu hình proxy/CA theo môi trường Docker của bạn. GUI chỉ chạy trên Mac.
