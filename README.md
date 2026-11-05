# MooZ CVN

Canvas sáng tạo với prompt đặt trực tiếp dưới mỗi bước tạo ảnh/video. Các khu riêng: Canvas, tạo ảnh hàng loạt, tạo video hàng loạt, Kho, kết nối AI và giao diện.

## Deploy Vercel dạng Static Site

`vercel.json` dùng Framework Preset `Other` (`framework: null`), Build Command `npm run build` và Output Directory `dist`. Vercel chỉ phục vụ các tệp frontend xuất ra sau build; không chạy Node serverless. `.vercelignore` loại mã máy chủ và dữ liệu runtime khỏi nguồn deploy.

Trong Vercel, đặt Root Directory là thư mục gốc repo. Nếu dashboard đang có cấu hình framework hoặc build cũ, bỏ các override đó để dùng `vercel.json`.

Canvas và Kho lưu dữ liệu trên trình duyệt. Bản static chưa chạy kết nối AI hoặc hàng đợi phía máy chủ.

## Chạy máy chủ riêng khi cần kết nối AI

Node.js 22+ (kiểm tra trên Node 24):

```sh
npm ci
npm run start:server
```

Máy chủ mặc định chạy tại loopback, cổng 4174. Để mở ra mạng, đặt HOST và MOOZ_ACCESS_TOKEN, dùng HTTPS. Biến môi trường tùy chọn nằm trong `.env.example`. Khóa API chỉ đặt trên máy chủ. `.env` không được tự động nạp.

`npm run build` xuất frontend tĩnh; kết nối AI cần máy chủ Node đầy đủ. Dữ liệu dự án và Kho nằm trên trình duyệt; dùng Sao lưu để giữ bản có media. Chrome cùng máy dùng ghép local; Chrome ở máy khác cần relay WSS. Lượt chưa rõ kết quả không tự gửi lại.

## Kiểm tra

```sh
npm test
npm run build
CHROMIUM_PATH=/usr/bin/chromium npm run test:all
```

Bộ kiểm tra media cần FFmpeg. Kiểm thử AI dùng phản hồi mẫu, không phải tài khoản thật.

Các thông báo giấy phép được giữ tại LICENSE và vendor/mooz/NOTICE.md.

## App macOS Intel và extension

```sh
npm run package:mac
npm run test:packaged
```

Chạy hai lệnh này trên macOS Intel để tạo và kiểm tra ZIP/DMG. Trên Linux chỉ có thể cross-build ZIP bằng `npm run package:mac:zip`; không thể dùng nó để xác nhận app chạy trên macOS. macOS tối thiểu 13; bản phát hành chưa ký/notarize. Extension kèm trong Cài đặt và `downloads/MooZ-Connect.zip`.

GitHub Actions `.github/workflows/release-mac.yml` chạy toàn bộ kiểm thử, đóng gói Mac Intel, mở kiểm tra chính app đã đóng gói (gồm FFmpeg MP4 thật), rồi mới tạo release latest để Cài đặt tải về. Download latest chỉ có sau khi workflow phát hành thành công.

Batch có một khu làm việc, ảnh sản phẩm/nhân vật tùy chọn và queue riêng. `Thêm & tạo node` chỉ chốt kế hoạch; `Chạy hàng đợi` mới gửi AI. Job đang gửi khi gián đoạn cần đối chiếu, không tự gửi lại. Hậu kỳ thông thường xử lý local bằng WASM; TTS/Whisper cần OpenAI key phía máy chủ và có thông báo gửi dữ liệu.

Thông báo media/font bổ sung ở `vendor/mooz/THIRD-PARTY-NOTICES.md`. Đối chiếu phạm vi còn chưa xác thực ở `docs/USER-REQUEST-REVIEW.md`.
