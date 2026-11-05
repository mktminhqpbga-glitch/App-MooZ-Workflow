# Đối chiếu yêu cầu và kiểm tra

Danh sách này theo các yêu cầu trong cuộc trao đổi; cập nhật cùng mã nguồn, không coi ảnh giao diện hay nút bị vô hiệu hóa là chức năng hoàn chỉnh.

## Canvas

| Yêu cầu | Kết quả hiện tại | Kiểm tra |
| --- | --- | --- |
| Đủ nhóm công cụ góc dưới trái: tài sản, sắp xếp, bản đồ, dây nối, hút lưới, zoom | Đã có | Mã và trình duyệt; Kho không đổi route |
| Quản lý tài sản mở bảng bên trái, không thoát ra dashboard | Đã sửa | Mở/đóng và mở lại dự án liên tiếp |
| Nút cộng mở nhóm thêm node; rê ra đóng nhóm | Đã có cho loại node được hỗ trợ | Trình duyệt |
| Menu chuột phải “Thêm node” mở khi rê chuột | Đã bổ sung menu con cạnh menu chính; có bàn phím, lật sang trái khi sát mép | Trình duyệt: rê, chọn Kịch bản |
| Popup nhỏ nằm trên nút mở; nút đóng góc trên phải | Đã sửa các popup Canvas và Thông số | Trình duyệt: vị trí, đóng, bật/tắt |
| Click lần một mở, lần hai đóng; bỏ click thứ hai của double-click | Đã có ở nhóm popup và Thông số | Trình duyệt và mã |
| Bảng Thông số bị thanh công cụ đè | Đã sửa lớp hiển thị; cuộn theo không gian phía trên nút | Trình duyệt: kiểm tra phần tử nằm trên cùng ở vùng giao nhau |
| Icon con trỏ/bàn tay đổi đúng chế độ | Đã sửa | Trình duyệt: V/H, chọn bàn tay và thả chuột giữa |
| Chuột trái kéo chọn; chuột giữa nhấn con lăn kéo Canvas | Đã tách riêng; có khung chọn nhiều node | Trình duyệt: vùng trống, video, thanh công cụ, giữ nhiều nút chuột |
| Nút giao diện không tự thay đổi zoom | Đã bỏ tự fit khỏi mở/thu prompt, thêm node, sắp xếp và popup | Trình duyệt: ảnh/video, bố cục, Kho |
| Node mới xuất hiện giữa phần Canvas đang thấy | Đã có; menu chuột phải dùng vị trí click | Trình duyệt |
| Sắp xếp workflow cách trên/dưới 30px | Đã sửa theo chiều cao thực của preview | Trình duyệt: đo từng cột |
| Dấu cộng đầu nối chỉ hiện khi chuột tới gần | Đã có vùng gần preview; vẫn hỗ trợ bàn phím/touch | Trình duyệt |
| Dây có luồng chạy theo hướng nguồn → đích | Đã có; giữ nguyên phần tử animation khi kéo | Trình duyệt: animation không bị tạo lại |
| Hết chớp ảnh/video khi kéo và thao tác khác | Đã mở rộng sửa: giữ node không đổi, giữ media khi node đổi dữ liệu, giữ toolbar, thumbnail bảng tài sản và hàng đợi không đổi khi dữ liệu không đổi | Trình duyệt: hai lần kéo, thêm node, không tải lại media. Chưa khẳng định mọi tổ hợp GPU/trình duyệt đều đã được thử |
| Thanh công cụ ảnh/video nằm trên node, co theo các công cụ thực sự có | Đã có; công cụ cần kết quả bị vô hiệu hóa khi node trống | Trình duyệt |
| Sắp lại hàng điều khiển cuối prompt | Đã nhóm AI, thông số, công cụ và nút chạy; có xuống dòng khi thiếu chỗ | Mã và trình duyệt |
| Tham chiếu chọn thumbnail ảnh/video có trong Canvas, ngang rồi xuống hàng | Đã có; bỏ node rỗng và tên chữ đơn thuần | Trình duyệt |
| Kho ảnh tham chiếu nhỏ, thẻ nhỏ, chọn một/nhiều, lưới/trượt | Đã có; ảnh tải lên hiển thị thật, các nhóm đầu vào/kết quả riêng | Trình duyệt |
| Lịch sử mặc định là sản phẩm của dự án hiện tại | Đã có; có chuyển tất cả dự án | Trình duyệt |
| Bỏ mục Đánh giá | Đã bỏ khỏi menu node | Trình duyệt |
| Kịch bản là văn bản, có sửa/tách/tải/sao chép/nhân bản | Đã có trình soạn thảo, tách theo đoạn/dòng, tải TXT và nhân bản | Trình duyệt; không còn placeholder ảnh |
| AI chỉ gồm kết nối đang có; chọn AI rồi chọn tab tương ứng | Đã lọc theo status API và danh sách tab Chrome thực tế | Kiểm thử với nguồn kết nối mô phỏng |
| Tab hiển thị số node sử dụng, tên và trạng thái | Đã có; đếm theo binding hiện tại trong Canvas, trạng thái bận cập nhật từ jobs | Kiểm thử hai node cùng tab; binding hiện chỉ giữ trong phiên Canvas |
| Tab dành riêng cho trợ lý đặt trong Settings, cấm dùng cho công việc khác | Đã có ở giao diện, bộ chạy và máy chủ | 2 kiểm thử tự động cho quyền tab + trình duyệt với kết nối mô phỏng |

## Tạo hàng loạt

| Yêu cầu | Kết quả hiện tại | Kiểm tra |
| --- | --- | --- |
| Yêu cầu mới nhất thay hai khu bằng một luồng rộng + tiến trình | Một form, lựa chọn nằm dưới prompt, ảnh nhân vật tùy chọn, cột queue sát phải; sidebar đẩy nội dung | Trình duyệt: đo khi mở/thu sidebar |
| Chọn ảnh bằng hình thay cho danh sách tên file | Đã có lưới thumbnail, xem ảnh đang chọn và bỏ chọn | Trình duyệt |
| Kiểm tra các nút ảnh/luồng mẫu/AI/tab/cập nhật/tỷ lệ/xếp hàng | Đã nối dữ liệu; chụp lựa chọn riêng khi xếp job, giữ tab hợp lệ khi cập nhật, không gửi nếu thiếu tab | Trình duyệt: cả API và Chrome mô phỏng |
| Tỷ lệ mở bảng nhiều lựa chọn như Canvas | Đã có 13 tỷ lệ, 5 mức chất lượng, độ phân giải, nền và số ảnh; video có thời lượng | Trình duyệt và bộ chạy |
| Thanh trạng thái và thanh nhóm giống mẫu | Đã có, hiển thị số tab nhận được và số job đang xử lý | Mã và trình duyệt |
| Luồng mẫu phải dùng thông số vừa chọn, không giữ tỷ lệ cũ | Đã sửa, xóa đầu ra cũ của mẫu | Trình duyệt |
| Hiển thị tiến trình thật | Đếm bước AI/local có đầu ra được chấp nhận / tổng bước, kèm trạng thái job, khu, AI và tab | Trình duyệt với kết quả mô phỏng; không bịa phần trăm AI đang tạo |

## Chưa hoàn chỉnh / chưa kiểm chứng trực tiếp

- “Đầu → Cuối” còn vô hiệu hóa: chưa có adapter đã xác thực hỗ trợ hai frame đầu/cuối. “Nối dài” đã có chuỗi frame cuối thật → video mới → ghép và kiểm tra thời lượng thật.
- Đã có node hậu kỳ video/âm thanh local, TTS/Whisper phía máy chủ và ghép nhiều cảnh. Các công cụ AI chuyên biệt chưa có adapter sẽ không được trình bày như chức năng đã hoàn thành.
- Các công cụ AI chuyên sâu trong ảnh tham khảo (ví dụ toàn cảnh/hiệu ứng chuyên biệt) chỉ hiển thị hoặc hoạt động khi có handler thực sự; không coi một mẫu prompt là bộ xử lý chuyên dụng.
- Chưa có danh mục nhân vật chính thức từ nhà cung cấp. Kho hiện dùng ảnh người dùng đã có/tải lên.
- Chưa kiểm tra tạo kết quả trên tài khoản AI thật trong lượt này; các kiểm tra dùng phản hồi thử nghiệm.
- Chưa xác nhận deployment Production của Vercel đã nhận commit mới. Workspace build được; môi trường này bị chặn truy cập trực tiếp Vercel, nên không xác nhận website live chỉ dựa vào git push.

## Bổ sung theo tài liệu và bản desktop 0.2.0

- Chuẩn bị toàn đợt trước khi tạo dữ liệu; parser khối/dòng/đoạn/toàn văn, @tag, negative prompt, bản sao độc lập, snapshot ảnh bất biến và giới hạn dung lượng.
- Chạy queue riêng, Web Lock một chủ, 1–6 slot, mỗi tab một job, pin tab, pause không hủy lượt đã gửi, reload cần đối chiếu.
- Kịch bản JSON 1–12 cảnh, prompt ảnh/video riêng, checkpoint, sửa JSON không tạo lại bước đã nhận, MP4 FFmpeg thật.
- Các công cụ hậu kỳ giữ nguồn, sắp thứ tự clip, hủy xử lý; output đã đổi thông số được đánh dấu cũ.
- App Electron x64 có backend loopback, renderer sandbox, extension ZIP kèm Cài đặt. Native macOS CI tạo ZIP/DMG và chỉ publish sau khi chạy kiểm tra gói thật. Chưa có Developer ID/notarization.
- Tạo gói Mac trên Linux không đồng nghĩa đã chạy app trên Mac; ghi nhận kết quả riêng trong báo cáo kiểm thử.
