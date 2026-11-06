# Rà soát 0.5.0

## Đã triển khai và có kiểm thử tự động

| Mục | Kết quả | Phạm vi kiểm tra |
| --- | --- | --- |
| Luồng đã lưu / Luồng xử lý | Trình thiết lập bước, prompt riêng, thêm/xóa/đổi thứ tự, biên dịch graph và dùng lại | UI + fixture AI: đọc sản phẩm, kịch bản hai cảnh, clip thật, ghép MP4, bản lưu Kho, FFmpeg hậu kỳ |
| A03 | Hai ảnh đầu/cuối, xác thực provider/thời lượng | Body Veo/fal, snapshot hai ảnh, giới hạn trước gửi |
| A04 | Google Veo và fal Veo/Motion Control | Request, checkpoint ID, polling, đối chiếu, tải media; fixture giao thức |
| A05 | HD AI, mask vùng, nhiều góc, tách lớp, panorama qua fal | Nút mở bảng thật, mask đúng kích thước, endpoint riêng, lưu nhiều kết quả và đối chiếu không gửi lặp |
| A06 | Nhập/lưu/xóa/test key và model trong Cài đặt | HTTP + UI; file 0600; snapshot không chứa khóa; test chỉ đọc model |
| A07 | Capability trong Canvas/batch và server | OpenAI ba tỷ lệ, Google/fal video; không nhận chọn 4K rồi âm thầm trả 1K |
| A08 | Audio Kho → Canvas → runner | File audio thật → node → mix → MP4 |
| A09 | AI/tab lưu trong graph | Reload giữ lựa chọn; ID trùng nhưng URL đổi không gán nhầm |
| A17 | Sáu nhân vật minh họa DiceBear | SHA256, import PNG thật, metadata CC BY 4.0, backup giữ giấy phép |
| Workflow trao đổi | MooZ kèm media + nguồn; graph JSON tổng quát có ánh xạ | Roundtrip ID mới, prompt, dây có kiểu, giấy phép; chặn node chưa ánh xạ |
| Phòng dựng | Fade, tối đa tám track, offset/loop/volume, duck theo mức âm thanh gốc, thumbnails, marker, zoom, preset, nháp | Decode waveform thật, FFmpeg H264/AAC; PCM xác nhận duck; đóng/mở khôi phục nháp |
| Chẩn đoán/dung lượng | Export log whitelist; hướng dẫn local/VM; kiểm phiên bản; quota mềm/cache dự án | Không xuất khóa/prompt; chặn thêm vượt quota; cache ứng dụng khác còn nguyên; offline/online |
| AI mở rộng | Profile API tương thích OpenAI text/vision | GUI → model test → HTTP thật tới dịch vụ giả lập cục bộ → kết quả lưu |

## Còn cần xác minh hoặc bổ sung

- **LibTV:** chưa có file workflow xuất thật. Bộ đọc JSON tổng quát không phải chứng nhận tương thích LibTV. ZIP/schema khác cần adapter và mẫu tương ứng. Không thực thi code hoặc model tùy ý từ file nguồn.
- **AI dịch vụ thật:** chưa có khóa/tài khoản được cấp cho phiên này. Chưa kiểm quyền model, tín dụng, hàng đợi dài, chính sách dịch vụ hay chất lượng đầu ra thực tế. Các adapter có triển khai giao thức và kiểm thử fixture; không ghi là live đã qua.
- **Chrome máy ảo thật:** cần VM/relay và phiên đăng nhập thực. Kiểm UI/config/bridge tự động chưa chứng minh kết nối máy ảo của người dùng.
- **Trình duyệt AI mới:** profile API mới dùng text/vision tương thích OpenAI. Trang AI khác cần adapter DOM riêng; không thể chỉ nhập URL là tự động hóa được mọi website.
- **Bảo mật khóa:** file riêng quyền 0600, không trả khóa về frontend; chưa tích hợp macOS Keychain. Bản Mac chưa ký/notarize.
- **Hậu kỳ:** duck theo mức âm thanh gốc, chưa nhận diện ngữ nghĩa lời nói; marker là mốc trong app, không nhúng chapter MP4. Preset giới hạn cạnh dài và không tự upscale nguồn. Mẫu nhân vật là tranh minh họa, không phải ảnh người thật.
- **Vận hành:** cần Mac vật lý để kiểm ngủ/đánh thức, VoiceOver, Gatekeeper và tương tác chuột thực; cần bài soak nhiều giờ, mất mạng dài trong tác vụ trả phí, nâng cấp dữ liệu người dùng có dung lượng lớn.
- **Dung lượng:** quota là ngưỡng mềm do người dùng đặt; media vẫn nằm IndexedDB, chưa chuyển sang kho file ngoài cho dự án rất lớn.

## Nguồn giao thức/giấy phép

- Google Gemini Cookbook, ví dụ Veo 3.1: https://github.com/google-gemini/cookbook (REST predictLongRunning, image/lastFrame, operation polling).
- fal schema endpoint và queue: gói chính thức `@fal-ai/client` 1.10.1, `src/types/endpoints.d.ts` và `src/queue.ts`: https://www.npmjs.com/package/@fal-ai/client . Veo mặc định/fast; công cụ ảnh và Motion Control dùng endpoint riêng.
- Bộ nhân vật: DiceBear Adventurer 9.4.2, Lisa Wischofsky, CC BY 4.0. Nguồn, SHA256, ghi công và toàn văn giấy phép ở `vendor/characters/`.

Không tính việc kiểm thử fixture là đã chạy AI trả phí. Release Mac chỉ được xuất bản khi CI đã mở và kiểm tra ứng dụng đóng gói thành công.

## Kiểm tra trước phát hành

- `npm run build`: qua.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:all`: qua 38 kiểm tra lõi và toàn bộ 18 suite browser/integration; dùng fixture AI, media và HTTP thật tại local.
- `npm run package:linux:test` và `npm run test:packaged`: qua. Mở Electron đóng gói, server bảo vệ, tải extension ZIP, WASM/depth, Phòng dựng, workflow/audio/binding và các luồng bổ sung.
- Release CI macOS Intel chạy lại source tests, đóng gói ZIP/DMG và mở app kiểm tra trước khi publish. Kết quả Mac phải đọc từ run tương ứng, không suy từ Linux.
