# Video bản đồ độ sâu local

Đầu ra người dùng đã xác nhận: video xám thể hiện tương quan gần/xa. Nút “Tạo video chiều sâu” nằm trong thanh công cụ của video đã có media, gồm video tải lên. Model không gửi khung hình ra AI bên ngoài.

## Nguồn đã đối chiếu

- MiDaS: https://github.com/isl-org/MiDaS — độ sâu tương đối (inverse depth); MIT. Bản v2.1 Small 256 có ONNX, phù hợp chạy CPU. Theo tf/run_onnx.py và tf/utils.py: resize 256×256, RGB 0..1, NCHW; model export đã chứa normalization.
- Video Depth Anything: https://github.com/DepthAnything/Video-Depth-Anything — model video có tính liên tục theo thời gian; benchmark chính thức dùng GPU A100. Small Apache-2.0; Base/Large CC-BY-NC-4.0.
- DepthCrafter: https://github.com/Tencent/DepthCrafter — model chuỗi depth; hướng dẫn chính thức nêu khoảng 9 GB GPU cho cấu hình thấp 512×256, khoảng 26 GB ở 1024×576.

Chọn MiDaS Small + ONNX Runtime Web WASM để Mac Intel dùng được mà không cần CUDA hoặc cài Python. Đây là model cũ hơn, dự đoán từng khung; không khẳng định có temporal consistency như model video. Tùy chọn ổn định chỉ làm mượt dải chuẩn hóa sáng, có reset theo thay đổi cảnh, không khôi phục hình học hay khoảng cách mét.

## Xử lý và giới hạn

- Phân tích 1/2/4/8/12/24 FPS, mặc định 4; tối đa 1.200 khung/lượt, có chọn đoạn.
- Inference thực chạy trong Worker; cancel hủy Worker/FFmpeg. Không lưu kết quả của lượt đã hủy.
- Gần sáng/xa tối, có đảo chiều; xuất MP4 H.264 24 FPS. Khi phân tích FPS thấp, bản đồ được giữ giữa các lần phân tích, không bịa thêm suy luận.
- Cạnh dài xuất tối đa 640 px; model suy luận 256×256 rồi đưa về tỷ lệ nguồn. Có giữ âm thanh gốc tùy chọn.
- Giữ nguồn; kết quả vào Kho Kết quả, có metadata model/SHA/settings/derivedFrom, xem/tải/thêm vào Canvas. Đổi thiết lập chặn dùng kết quả cũ cho đến khi thiết lập khớp hoặc tạo lại.
- Model 64 MB được tải lúc build từ release GitHub chính thức và kiểm SHA256 cố định. App đóng gói kèm model và WASM; khi chạy không cần tải model ngoài mạng.

Kiểm thử chạy inference thật và xuất MP4 thật, kiểm tra bằng ffprobe/giải mã pixel, kiểm tra hủy, âm thanh/thời lượng, download, nguồn giữ nguyên và không gọi AI/địa chỉ ngoài origin. Không xem thử nghiệm tự động là bằng chứng độ sâu chính xác ở mọi cảnh.
