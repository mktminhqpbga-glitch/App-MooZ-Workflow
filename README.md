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
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
```

Bộ kiểm tra media cần FFmpeg. Kiểm thử AI dùng phản hồi mẫu, không phải tài khoản thật.

Các thông báo giấy phép được giữ tại LICENSE và vendor/mooz/NOTICE.md.
