# Rà soát toàn app · 0.4.0

Phạm vi: đối chiếu yêu cầu trong hội thoại, tài liệu `USER-FLOW-SPEC.txt`, mã nguồn và các bài kiểm tra. “Đã có” không đồng nghĩa đã chạy trên tài khoản/thiết bị thật của người dùng. Tài liệu dán ban đầu bắt đầu giữa mục 3 và dừng ở tiêu đề 6.5; chưa có phần bị thiếu để đối chiếu.

## Phần đã triển khai

| Khu vực | Hiện trạng và bằng chứng |
| --- | --- |
| Dự án / Tổng quan | Tạo, mở, đổi tên, nhân bản, nhập/xuất; kiểm tra ghi xung đột; bộ trình duyệt projects. |
| Canvas / công cụ | Node ảnh/video/văn bản; typed edges; menu nhóm; hover Thêm node; nút đóng; chuột trái chọn, giữa kéo, V/H; thêm giữa viewport; sắp xếp 30px; không tự zoom khi mở công cụ. Các bộ dock, Canvas review, inline và image controls kiểm tra thao tác. |
| Chớp / lớp hiển thị | Giữ DOM media khi kéo/cập nhật; chặn cleanup Canvas cũ làm hiện dashboard; popup/ô nhập node chọn ở trên node lân cận. Có kiểm thử DOM và click/gõ thật; chưa chứng minh hết trên GPU/máy người dùng. |
| Văn bản | Editor thật, sửa/tách/tải TXT/sao chép/nhân bản; tạo text không dùng placeholder ảnh. |
| Kho | Thẻ nhỏ, thumbnail thật, chọn một/nhiều, đầu vào/kết quả, tham chiếu sản phẩm/nhân vật, backup media. Kho nhân vật dùng ảnh người dùng tải lên. |
| Kết nối AI | Chrome local và relay WSS; Settings URL/khóa/test/tạo mã; OpenAI/Gemini API cho text/ảnh; chọn AI đang kết nối và tab đúng provider. Relay TLS/auth/RPC được kiểm thử với companion thử nghiệm. |
| Trợ lý | Chọn riêng tab trợ lý trong Settings, chặn workflow sử dụng tab đó ở UI/runner/server; trả lời/chat qua kết nối. Kiểm thử dùng phản hồi thử nghiệm. |
| Hàng loạt | Một luồng rộng + hàng đợi bên phải; 4 lựa chọn cùng hàng; ảnh nhân vật tùy chọn; thumbnail; tách prompt/@tag/negative prompt; snapshot; chưa tự gửi khi tạo kế hoạch. |
| Queue / nhiều cảnh | Task ID riêng, 1–6 slot, một job/tab, pin tab, pause, một chủ Web Lock; checkpoint và đối chiếu gián đoạn; JSON 1–12 cảnh; ảnh/video prompt riêng; ghép media thật; Nối dài dùng frame cuối thật. |
| Hậu kỳ cũ | Cắt/xoay/màu/tỷ lệ/tốc độ, MP3, mix, SRT, logo, ghép/chuyển cảnh/khớp lời đọc; FFmpeg WASM thực, ffprobe kiểm đầu ra; TTS/Whisper có adapter phía server. |
| Phòng dựng mới | Một video + nhạc tùy chọn; hai thước độc lập; waveform giải mã thật; kéo vùng/mép, nhập giây; chọn nhạc Kho/tải lên; màu, hai volume; chỉ lặp đoạn chọn; nghe thử bằng cùng renderer; lưu/tải MP4 H264/AAC mới, nguồn nguyên vẹn. Kiểm thử tín hiệu tần số chứng minh đoạn nhạc đúng, loop/silence và màu thật. |
| Chiều sâu | MiDaS ONNX CPU thật, gần sáng/xa tối, giới hạn đoạn/FPS, đảo, hủy, MP4, lưu/tải/thêm Canvas. Không gọi AI trả phí, model đóng kèm. |
| Desktop / extension | Mac Intel ZIP/DMG; extension 1.9.2 tải trong Settings; server local + token + sandbox; CI chỉ phát hành sau khi chạy app đã đóng gói. |

## Tồn đọng cần giải quyết hoặc xác minh

Ưu tiên P0 là điều kiện xác nhận dùng thực tế; không có nghĩa đã quan sát lỗi hỏng trong kiểm thử.

| Mã | Ưu tiên | Tồn đọng thực tế | Việc cần làm / điều kiện xong |
| --- | --- | --- | --- |
| A01 | P0 · cần môi trường thật | Chưa chạy Chrome trong máy ảo thật của người dùng, chưa có relay production do người dùng cung cấp. | Triển khai/cấp endpoint WSS và khóa; cài extension vào Chrome VM; ghép, lấy tab, tạo một text/ảnh/video, kiểm tra mất mạng/kết nối lại. App có giao diện cấu hình, không kèm relay hosted sẵn. |
| A02 | P0 · cần tài khoản thật | Chưa kiểm thử end-to-end AI trên các tài khoản Muse/Gemini/ChatGPT/Grok/Flow và khóa API thật. Fixture không chứng minh website hiện tại hoặc quyền model. | Chạy từng loại media/provider, xác nhận đúng tab/lượt/bytes tải về; kiểm hạn mức, đăng nhập lại, tab ngủ và lỗi dịch vụ. Không tự gửi lượt trả phí khi chưa có cấu hình/tài khoản. |
| A03 | P1 · chưa triển khai | “Đầu → Cuối” đang vô hiệu hóa. | Adapter hỗ trợ hai frame thật, xác thực giới hạn trước gửi, kiểm tra kết quả trên dịch vụ thật. |
| A04 | P1 · chưa triển khai | API video Google Veo/fal Motion Control được nhắc trong tài liệu nhưng app này hiện chỉ có API text/ảnh OpenAI và Gemini. | Adapter video + quyền model, upload ảnh/video đúng định dạng, polling/reconciliation, download thật; chưa coi đường Chrome là API video. |
| A05 | P1 · chưa triển khai | HD AI/chỉnh vùng AI/multiview/tách lớp/panorama chưa có handler chuyên dụng hoạt động. | Nối adapter cụ thể, công bố giới hạn và kiểm thử đầu ra. Hiện ẩn hoặc không bật; prompt mẫu không thay thế xử lý chuyên dụng. |
| A06 | P1 · thiếu luồng sử dụng | Chưa có màn nhập/lưu/xóa khóa OpenAI/Gemini API trong Settings. Hiện dùng biến môi trường phía server, gồm TTS/Whisper. | Thêm GUI/test model và lưu an toàn phía desktop/server; không đưa khóa vào frontend. GUI relay đã có nhưng là khóa relay, không phải khóa API AI. |
| A07 | P1 · giới hạn chưa ràng buộc đủ UI | UI có 13 tỷ lệ, nhưng adapter OpenAI ảnh chỉ ánh xạ về ba kích thước (vuông/dọc/ngang); chất lượng/model/provider không đồng nhất. | Ràng buộc bộ chọn theo capability của provider hoặc công bố chuyển đổi rõ; kiểm đầu ra thực. Không hứa mọi AI xuất đúng mọi tỷ lệ/4K/số giây chỉ vì UI chọn được. |
| A08 | P1 · thiếu ở Canvas | Tài sản audio có trong Kho/hậu kỳ và schema graph, nhưng nút thêm audio từ Kho vào Canvas đang bị vô hiệu hóa. | Hoàn thiện tạo/render/chọn/nối node audio xuyên suốt UI → runner, thêm kiểm thử. Phòng dựng vẫn chọn và dùng audio thật được. |
| A09 | P1 · chưa lưu lâu dài | Binding AI/tab từng node nằm trong Map của phiên Canvas; chưa giữ lựa chọn qua đóng/mở lại. | Lưu preference thích hợp vào graph; đối chiếu lại tab ID sau reconnect, không gán nhầm tab cũ; tính lại số node chung tab. Snapshot job đã có tab riêng. |
| A10 | P1 · phân phối | Mac chưa Developer ID/notarization; chưa auto-update; extension cài Load unpacked. | Ký/notarize bằng tài khoản Apple và hoàn thiện updater; kênh phân phối extension khi cần. Hiện tải gói/thay app thủ công; không có phí/tài khoản Apple trong workspace. |
| A11 | P1 · cần xác minh triển khai | Chưa xác nhận Vercel Production hiện chạy đúng commit/backend. Web tĩnh không thay được Node backend/relay. | Xem deployment/log/domain thật, xác nhận bản hiện tại và endpoint; không dùng git push hoặc thông báo AI Gateway Credit để kết luận app live/hết token. |
| A12 | P1 · cần thiết bị thật | Chớp toàn giao diện và chuột giữa đã có sửa + kiểm tra hồi quy, nhưng chưa chạy trên đúng Mac/GPU/chuột của người dùng. Native CI chạy Mac Intel runner, không phải máy đó. | Mở bản mới trên máy gặp lỗi, thử kéo/click/giữ con lăn và ghi log/video nếu tái hiện; không khẳng định hết mọi trường hợp. |
| A13 | P2 · bảo quản khóa | Khóa relay hiện lưu file cục bộ quyền 0600; chưa mã hóa bằng macOS Keychain. | Bổ sung Keychain/OS credential store, quy trình đổi/thu hồi khóa; không mô tả quyền file là mã hóa at-rest. |
| A14 | P2 · giới hạn sản phẩm | Queue/dự án lưu trong hồ sơ cục bộ; không đồng bộ đa máy/đội nhóm. Đóng app khi đang chạy không có worker nền tiếp tục. | Nếu cần: server queue/cloud sync/auth và quản lý media. Hiện reload chuyển sang Cần kiểm tra để tránh gửi trùng là hành vi chủ ý. |
| A15 | P2 · giới hạn hậu kỳ | FFmpeg WASM giới hạn 100 MB/tệp, tiêu thụ RAM/CPU; preview phải dựng tệp nên không tức thời. Phòng dựng mới một video/một nhạc, chưa lưu bản nháp timeline qua đóng app. | Benchmark clip dài/4K trên Mac thật; cân nhắc native FFmpeg và draft persistence. Không hứa GPU render hay tiếp tục export sau thoát app. |
| A16 | P2 · giới hạn depth | MiDaS dự đoán từng frame, có thể dao động theo thời gian, không có khoảng cách mét. Tối đa 1.200 frame phân tích, output cạnh dài 640px. | Nếu cần chuyên nghiệp: model video có temporal consistency và backend GPU phù hợp; kiểm dữ liệu thật. Không coi range smoothing là model video mới. |
| A17 | P2 · nội dung chưa có | Kho chưa có bộ nhân vật chính thức từ nhà cung cấp. | Chuẩn bị bộ ảnh có quyền sử dụng/metadata hoặc tiếp tục dùng ảnh người dùng tải lên. |
| A18 | P2 · tài liệu thiếu | Tài liệu gốc bị cắt đầu/cuối. | Nhận phần còn thiếu rồi đối chiếu; không tự coi các mục chưa nhận là đã đáp ứng. |

## Các bổ sung hữu ích, chưa phải cam kết đã làm

- Phòng dựng: fade in/out nhạc, tự giảm nhạc khi có lời nói, nhiều track, thumbnail video, marker, zoom timeline, preset xuất và lưu bản nháp. Luồng người dùng vừa yêu cầu chỉ cần một video/một bài nhạc và đã triển khai theo phạm vi đó.
- Chẩn đoán kết nối: nút xuất gói log đã loại khóa, hướng dẫn từng bước local/VM và kiểm tra phiên bản extension/relay.
- Quản lý dung lượng: hiển thị/quota hồ sơ, dọn cache theo dự án, nhắc backup định kỳ; cân nhắc file media ngoài IndexedDB cho dự án lớn.
- Kiểm thử thêm: tác vụ kéo dài, ngủ/đánh thức Mac, mất mạng giữa chừng, cổng 4174 bị chiếm, nâng cấp hồ sơ cũ, mọi quyền model thật và accessibility bằng bàn phím/VoiceOver.

## Thứ tự đề nghị

1. A01–A02: xác nhận đường kết nối thật và một lượt AI thực tế trước khi mở rộng hàng loạt.
2. A06, A09, A08: khóa API dễ cấu hình, giữ lựa chọn tab, hoàn thiện audio Canvas.
3. A03–A05, A07: adapter/capability còn thiếu, tránh lựa chọn UI vượt khả năng thực.
4. A10–A13: phân phối/ký bản, deployment thật, chẩn đoán máy người dùng, Keychain.
5. A14–A18 và các bổ sung hậu kỳ tùy nhu cầu thực tế.

Kết quả kiểm tra từng bản ghi trong `TEST-RESULTS.md`; trạng thái phát hành Mac chính xác xem workflow của commit tương ứng. Báo cáo không tuyên bố “toàn app không còn lỗi”.
