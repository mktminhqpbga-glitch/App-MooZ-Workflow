# LiBTv AI — nghiên cứu trước khi chỉnh giao diện

Ngày kiểm tra: 07/11/2026 UTC. Người dùng đã chốt **LiBTv AI là chuẩn giao diện và cách làm việc**, sau khi phản hồi bản SwiftUI cơ bản đi quá xa yêu cầu. App đích vẫn native macOS Intel Ventura 13; Chrome companion riêng được giữ. Nghiên cứu này chưa phải bằng chứng đã sao khớp giao diện.

## Đúng sản phẩm và nguồn đã đọc

1. **LibTV / LibLib.tv:** [www.liblib.tv](https://www.liblib.tv). Repo `libtv-labs/libtv-skills` tự mô tả là bộ kỹ năng cho LibLib.tv và dẫn trực tiếp đến website này. README cho project link dạng `https://www.liblib.tv/canvas?projectId=…`.
   - [README tại commit c609246c](https://github.com/libtv-labs/libtv-skills/blob/c609246c1eca69f6bc129bcbb5d64c36734e4a4a/README.md).
   - Đây là sản phẩm cần nghiên cứu; không dùng tên miền đoán `libtv.ai` làm chuẩn.
2. **Liblib AI Marketplace:** [liblib-ai/marketplace](https://github.com/liblib-ai/marketplace), commit `4ac581c3cbdaa53d0d42df85c6bf62e45600bc5f`. Repo công bố plugin LibTV 1.0.0 và production Remote MCP tại `https://mcp.liblib.tv/mcp`, dùng OAuth cá nhân.
   - [README pinned](https://github.com/liblib-ai/marketplace/blob/4ac581c3cbdaa53d0d42df85c6bf62e45600bc5f/README.md).
   - Chưa cài plugin, đăng nhập hoặc gọi tạo media. Việc nghiên cứu giao diện không đòi hỏi chạy dịch vụ trả phí.

## Fact đã có bằng chứng và phần còn thiếu

| Nội dung | Bằng chứng đã đọc | Giới hạn |
| --- | --- | --- |
| Có project và editor Canvas | Project URL trong README libtv-skills | Chưa mở được editor thật |
| Canvas chứa ảnh, video, audio, script và storyboard | [libtv-to-treatment/SKILL.md](https://github.com/liblib-ai/marketplace/blob/4ac581c3cbdaa53d0d42df85c6bf62e45600bc5f/plugins/libtv/skills/libtv-to-treatment/SKILL.md), các mục thu thập tài sản/snapshot | Không cho biết vị trí panel, màu, font hoặc kích thước |
| Quan hệ node/reference có ý nghĩa; tọa độ không tự quyết định thứ tự phim | Cùng skill, mục node relationships và timeline | Không chứng minh hình dạng/cách kéo cổng trong UI |
| Workflow ảnh cảnh → tham chiếu góc nhìn → nhân vật → video node → kiểm kết quả | [libtv-blender-live-action/SKILL.md](https://github.com/liblib-ai/marketplace/blob/4ac581c3cbdaa53d0d42df85c6bf62e45600bc5f/plugins/libtv/skills/libtv-blender-live-action/SKILL.md), workflow và acceptance | Đây là quy trình chức năng, không phải ảnh editor |
| Agent có project/session, upload, poll và download media | libtv-skills README | Chưa xác minh API hiện còn hoạt động; không suy diễn vị trí Agent panel |
| Palette, sidebar, toolbar, node cards, prompt composer, thông số, lịch sử và zoom | **Chưa có visual truy cập được** | Không được tự chọn rồi gọi là “giống LibTV” |

Do đó, các tài liệu xác nhận một phần mô hình làm việc với Canvas/media/reference, nhưng **không đủ để quyết định bố cục giao diện**. Không lấy màn hình của repo clone hoặc một dashboard generic để thay cho sản phẩm thật.

## Tìm ảnh và demo thật

- Đã kiểm README, thư mục assets và danh sách issue của hai repo nêu trên. Assets marketplace chỉ có `libtv-icon.svg`; không có screenshot editor.
- Đã đọc các issue mở `libtv-labs/libtv-skills` #1, #2, #3, #6, #7, #8, #10, #12, #13; issue marketplace #6/#7; tìm GitHub Issues với cụm `"liblib.tv" "screenshot"` không có kết quả.
- [Issue #1 của libtv-skills](https://github.com/libtv-labs/libtv-skills/issues/1), ngày 18/03/2026, có ba ảnh người dùng đính kèm:
  - [Attachment 1](https://github.com/user-attachments/assets/1c2fb13c-5269-42a1-b20c-1ce0ea0d5c51)
  - [Attachment 2](https://github.com/user-attachments/assets/d90528af-6fcd-48a4-9d86-6578bda64d80)
  - [Attachment 3](https://github.com/user-attachments/assets/f600690a-d6bb-4ba0-a1a6-2d7debffdab9)
- Cả ba chưa xem được: URL GitHub trả redirect sang `github-production-user-asset-6210df.s3.amazonaws.com`; proxy chặn CONNECT 403 ở hostname đó. **Chưa biết ảnh là editor, lịch sử tín dụng hay log**, và dù xem được cũng phải ghi là ảnh người dùng từ tháng 3, không tự nhận phiên bản hiện tại.
- [PomeloR611/libtv-video-agent](https://github.com/PomeloR611/libtv-video-agent) có README hướng dẫn workflow/CLI và clip thành phẩm. Nguồn cộng đồng này không cung cấp ảnh editor trong README đã đọc, không dùng clip kết quả làm bằng chứng về UI.

## Blocker truy cập và bước tiếp theo

Đã thử client bình thường với proxy/CA được kế thừa. Sandbox không kết nối được proxy; retry cùng yêu cầu ngoài sandbox đến `https://www.liblib.tv` bị **proxy CONNECT 403**. Đây là chặn mạng, chưa phải login wall của LibTV. Không bỏ proxy, tắt TLS hoặc dùng mirror để vượt chặn.

Cần quyền truy cập website chính thức và các asset thực sự được website dẫn tới, hoặc ảnh/video editor do người dùng cung cấp. Sau khi có visual:

1. Chụp/đọc màn hình editor tổng thể và trạng thái chọn node, mở prompt/thông số, thêm tham chiếu, chạy/nhận kết quả.
2. Lập bảng đối chiếu trực tiếp về phân bổ không gian, panel, hierarchy, màu, typography và thao tác; ghi rõ phiên bản/thời điểm của nguồn.
3. Ánh xạ các thành phần đó sang SwiftUI/AppKit, giữ queue/store/snapshot/receipt đã sửa. Không dùng web runtime để né mục tiêu native.
4. Chụp cùng trạng thái từ app native để so sánh trước khi yêu cầu người dùng tải bản mới. Build thành công không thay cho nghiệm thu giao diện.

Chưa chỉnh UI hay đóng gói một thiết kế “LibTV” mới trong bước nghiên cứu này.
