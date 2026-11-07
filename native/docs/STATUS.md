# Trạng thái nghiệm thu native — 07/11/2026 UTC

Mục tiêu người dùng đã chốt: app Swift/SwiftUI/AppKit cho **Intel, macOS 13 Ventura+**, giữ Chrome companion riêng. Baseline legacy `5bd7dea` được giữ để tham chiếu. Số màn hình/nút không phải tiêu chí hoàn thành.

## Đã kiểm chứng

[GitHub Actions run 42330304806](https://github.com/mktminhqpbga-glitch/App-MooZ-Workflow/actions/runs/42330304806), commit `affe689`: **PASS** cả hai job native và companion.

- **26 XCTest** trên Swift/macOS; cùng 26 ca cũng PASS trong container Swift 6.1.3/Linux. Có HTTP fixture API, planner/role/alias, snapshot bất biến, SQLite reopen, busy/partial/unknown/mất ACK và quyền gửi bền vững.
- **5 kiểm thử đóng gói**: từ chối SQLite Homebrew/host rpath ở executable chính, từ chối minOS cao hơn target và cho phép runtime Swift hệ thống. Đây là fixture cho bộ kiểm tra; gói thực tế còn được kiểm bằng `otool/lipo/codesign` trên Mac.
- Worker và Chromium DOM fixture companion PASS: device/session, whitelist START/STATUS/ACK, executeScript array, nonce/receipt, hai ảnh, partial download/retry và START lặp không click hai lần.
- FFmpeg thật: hai clip đỏ/xanh ghép đúng thứ tự/thời lượng/pixel; trim, phụ đề có pixel chữ, cả nhạc 700 Hz và lời đọc 1100 Hz xuất hiện trong PCM; giải mã toàn bộ H264/AAC. Test luồng hai cảnh qua queue → reopen → MP4 thật.
- **Bản build cấu hình release đã đóng gói, codesign ad-hoc và mở cửa sổ native trên runner macOS 15 Intel**. Smoke nhập ba PNG thật, kiểm alias gộp ảnh khác nhau, preview sáu job, chạy một job hai cảnh qua provider fixture, kiểm hai submit/hai ACK và khoảng cách ≥10 giây, mở lại SQLite/file, ghép 2 giây, hậu kỳ trim/SRT thành MP4, chụp cửa sổ.
- Bundle thực tế: `architectures: ["x86_64"]`, `minimumMacOS: "13.0"`, `bundledDylibs: 0`. FFmpeg/libass/x264 và dependency dựng tĩnh từ nguồn đã khóa, cùng deployment target 13. Main app dùng SQLite hệ thống. Gate kiểm mọi executable/dylib; không sửa nhãn plist để che minOS cao hơn.

Smoke chạy trong kho UUID mới ngay cả khi có `MOOZ_DATA_DIR`, tránh đụng dữ liệu/queue của người dùng. Reopen ở đây là mở kết nối store mới; chưa tự động đóng/mở lại toàn bộ process app.

## Lấy bản kiểm thử

Trong run trên, chọn **Artifacts → MooZ-native-macOS-Intel-test-build**. Artifact chứa:

- `MooZ-Native-macOS-x86_64.zip` → `MooZ.app`, đã kèm FFmpeg/ffprobe và companion.
- `MooZ-Connect-Native.zip` riêng để Load unpacked trong Chrome; `SHA256SUMS.txt` đối chiếu hai ZIP.
- `native-bundle-info.json`, `native-smoke.json`, screenshot `native-smoke.png` và MP4 thật `native-smoke-final.mp4`.

GitHub yêu cầu đăng nhập để tải artifact. Đây là **bản kiểm thử ad-hoc**, chưa phát hành public, chưa Developer ID/notarization. Không cần cài Node/Swift/Homebrew để chạy app đóng gói.

## Lỗi đã tái hiện và sửa

- SwiftUI property wrapper khai báo nhiều biến và `Dictionary.keys()` làm build Mac lỗi.
- Kế hoạch bị xóa bởi callback giao diện khi nạp/lưu dự án; nay giữ snapshot draft của preview, bỏ qua hydration không đổi và từ chối enqueue khi nội dung đã thay.
- Cooldown từng tính từ trước lúc chờ ACK. Test ACK chậm tái hiện khoảng cách <10 giây; nay lấy đồng hồ sau ACK thành công.
- ACK lỗi từng có thể ghi đè manifest mới bằng job cũ; nay tải lại trạng thái trước khi cập nhật.
- Giới hạn 200 từng tính cả job đã hoàn tất; nay chỉ giới hạn job đang hoạt động, test giữ lịch sử + nhận đủ 200 job mới.
- Health của Chrome đọc response array sai và worker thiếu whitelist message mới; fixture khớp hợp đồng thật của `executeScript`.
- FFmpeg thiếu libass/lavfi; gói Homebrew có minOS 15; rpath host có thể che thiếu thư viện. Nay dựng nguồn target 13, kiểm capability/load commands cả executable chính, dùng SQLite hệ thống và cấm host rpath.

## Cần nghiệm thu tiếp

- **Chạy trên máy Intel thật đang cài Ventura 13**. Build/launch trên runner 15 và kiểm binary target 13 là bằng chứng tương thích tĩnh, chưa thay cho lượt chạy này.
- Thao tác người dùng bằng chuột/bàn phím: kéo nối Canvas, kéo ảnh vào prompt, Save panel. Smoke gọi ViewModel trong app thật, không tự động thao tác tất cả control.
- Chrome với tài khoản AI thật: selector/upload, model/settings, ảnh/video nhiều biến thể, reload/mất mạng. Fixture không xác nhận website hiện tại hoặc tài khoản đăng nhập.
- Generic bridge video hiện thu một kết quả; gallery nhiều video chưa nghiệm thu. Nếu một scene có nhiều clip, giữ clip trong Kho, không tự chọn biến thể để báo xong.
- Model/chất lượng/resolution trên website chưa được adapter điều khiển đầy đủ như API; cần chọn trên tab và kiểm thực tế.
- API thật có key/hạn mức và model hiện được cung cấp; HTTP fixture chỉ kiểm hợp đồng.
- UI khôi phục thủ công unknown khi mất receipt, nhiều phiên app cùng mở một kho và hiệu năng dữ liệu lớn.
- Canvas hiện mô tả ảnh đầu vào → cảnh → ghép; chưa là engine cho mọi graph tùy ý. Không đủ ảnh LibLib trong checkout để xác nhận khớp từng chi tiết.
- Developer ID/notarization và bản Apple Silicon.

Không gọi đây là app đã nghiệm thu toàn bộ luồng AI thật hoặc bản phát hành chính thức. Người dùng đã cho phép push `feat/native-macos`; branch được đẩy để chạy CI, không merge main hay publish release.
