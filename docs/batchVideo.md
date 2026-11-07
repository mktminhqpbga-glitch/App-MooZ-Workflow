# Các xưởng hàng loạt trong MooZ/Toonflow

## Sử dụng

1. Chọn **Tạo ảnh hàng loạt** hoặc **Tạo video hàng loạt** trên thanh điều hướng MooZ CVN. Đây là hai xưởng độc lập ngoài Canvas; chọn hoặc tạo thư mục dự án ngay tại xưởng.
2. Cài và cấu hình provider video trong Cài đặt → Model đa phương tiện. Bộ cài kèm các provider gốc Toonflow và Muse Chrome (ảnh/video); không kèm tài khoản/khóa API.
3. Chọn text, ảnh tham chiếu, khung đầu/cuối hoặc video nguồn. Gán vai trò cho từng file. Gộp ảnh sản phẩm thành một nhóm hoặc tách mỗi ảnh thành tác vụ riêng; ảnh nhân vật đi cùng mỗi nhóm.
4. Bấm hoặc kéo `@anhN` vào prompt. Chọn cách tách yêu cầu: khối `[ ... ]`, từng dòng, từng đoạn hoặc toàn văn. Trong xưởng video có thể bật mỗi dòng trong yêu cầu là một cảnh, ghép theo thứ tự.
5. **Xem chính xác tác vụ**: xem model, prompt, ảnh/vai trò, số video và tổng số clip. Mọi thay đổi làm preview cũ hết hiệu lực. Backend cũng đối chiếu hash file và cấu hình khi thêm đợt.
6. Thêm đợt mới chỉ lưu dữ liệu. Bấm **Chạy / tiếp tục** để gửi AI. Chỉ chạy một lượt clip tại một thời điểm; không tự đổi model hoặc tab.
7. Tải từng clip hoặc xem/tải MP4. Nếu provider trả nhiều clip cho một cảnh, chọn clip để ghép; tất cả clip vẫn giữ nguyên.

## Dữ liệu và khôi phục

Ảnh/video nhập nằm trong `batchInputs`. Mỗi đợt giữ snapshot đầu vào trong `batchProjects/<id>`, kịch bản, UUID tác vụ cho từng cảnh, model/cài đặt, hash cấu hình, clip trung gian và MP4 cuối. Danh mục nằm trong `batchQueue.json` ở thư mục dữ liệu ứng dụng. Mac dùng `~/Library/Application Support/ToonflowMooZ`; thư mục dự án do người dùng chọn.

Intent và request được lưu trước gửi; tái khởi động đối chiếu cùng UUID qua media task gốc. Không tự gửi lượt mới cho tác vụ thất bại/không rõ kết quả. Đổi model/provider/tab làm hàng đợi dừng để tránh đổi đầu vào của tác vụ đã chốt. Dừng hàng đợi chỉ dừng cấp lượt tiếp theo; lượt đã gửi tiếp tục được provider xử lý và giữ UUID để đối chiếu khi tiếp tục.

FFmpeg giữ thứ tự cảnh, chuẩn hóa tỷ lệ/fps/âm thanh, bổ sung khoảng lặng cho clip không có audio, xuất H264/AAC MP4 vào file tạm, probe file thật rồi mới rename thành phẩm. File gốc/clip không bị xóa. Bộ cài Intel kèm FFmpeg/ffprobe có hash và giấy phép.

## Phạm vi đã và chưa xác nhận

Đã triển khai chuyển hợp đồng composer của app-mooz sang TypeScript/Vue, giữ giao diện Toonflow và dùng task/file/FFmpeg gốc. Các kiểu đầu vào chỉ chạy nếu model đã khai báo hỗ trợ. Đây là batch nhận prompt/kịch bản do người dùng cung cấp; chưa chuyển toàn bộ bước tự phân tích sản phẩm → tự viết kịch bản của app-mooz. Không được gọi bước đó là hoàn tất.

Muse Chrome đã được nối vào bridge video của app-mooz cho văn bản và tối đa 8 ảnh tham chiếu, yêu cầu videoResultProtocol=1 và kiểm file bằng FFprobe trước ACK. Chưa có nghiệm thu tài khoản Muse thật. Các chế độ khung đầu/cuối và nối dài dùng model Toonflow có khai báo hỗ trợ, không tự gán cho Muse. Không tạo kết quả giả để chứng minh pipeline. Cloud Chrome cấm extension unpacked theo chính sách quản trị, vì vậy Muse thật, Chrome trên máy khác/VM và Render còn cần nghiệm thu trên Chrome không bị giới hạn và tài khoản của người dùng.

Build/typecheck và kiểm tra giao diện/API cục bộ không thay thế việc chạy thật từ provider video có tài khoản đến MP4, hoặc chạy app trên máy Intel Ventura của người dùng.

## Kho và hậu kỳ

Kho dự án duyệt file gốc, đầu vào batch, clip và thành phẩm trong cùng thư mục dự án. Video trong Kho hoặc kết quả batch có nút Đưa vào hậu kỳ. Phòng hậu kỳ cho đổi thứ tự, cắt đầu/cuối clip, thêm file nhạc/lời đọc, chỉnh âm lượng và nhập phụ đề SRT; lưu bản dựng vào postDraft.json, request/clip/output vào postWork. MP4 phải được probe rồi mới đổi tên khỏi .partial và hiện là hoàn tất. Lượt xuất bị ngắt được giữ để khôi phục bản dựng, không tự ghi đè file cũ. Lời đọc và SRT là file/văn bản người dùng cung cấp, không mô tả là đã tự sinh giọng hay nhận diện phụ đề.
