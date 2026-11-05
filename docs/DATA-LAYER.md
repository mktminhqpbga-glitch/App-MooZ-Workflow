# MooZ CVN — nền tảng dữ liệu lớp 2A

> Ghi chép mốc lớp 2A. Phần triển khai mới hơn và giới hạn hiện tại nằm trong [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md).

Triển khai theo ranh giới GraphModel / ProjectRepository / CommandController trong tài liệu bàn giao MooZ Agent 0.69.0. Đây là lõi web mới, chưa phải migration hoặc bản sao đầy đủ engine desktop.

## Đã có

- Project ID UUID, schemaVersion 1, revision, thời gian tạo/cập nhật, tên và graph.
- IndexedDB `mooz-cvn-projects`, object store `projects`. Ghi cả bản ghi trong transaction; kiểm tra revision trong chính transaction readwrite để tránh ghi đè dữ liệu của tab khác.
- Tổng quan hiển thị dự án thật. Tạo, mở, đổi tên, nhân bản, nhập và xuất JSON. Mở dự án hiện thống kê dữ liệu; chưa có canvas editor.
- Graph giữ node ID, loại, tọa độ, dữ liệu whitelist; edge giữ ID và cổng. Kiểm tra loại cổng, node/edge/group trùng ID, dây thừa, cổng đơn/đa nguồn, node không tồn tại và vòng lặp. Topological order xác định phụ thuộc, chưa thực thi AI.
- Các loại ban đầu: prompt, imageInput, videoInput, generateText, generateImage, generateVideo, preview. Cổng `reference` nhận nhiều ảnh; cổng khác nhận một nguồn. Chưa hỗ trợ mọi loại node của desktop.
- GraphController: thêm/sửa/xóa node, nối dây, undo/redo tối đa 50 lệnh. Lệnh lỗi không thay graph hoặc lịch sử. API không phụ thuộc DOM hay Electron.
- Xuất whitelist, không đưa credential/configuration, tab, cookie hay phiên đăng nhập vào JSON. Nhập tạo project ID mới và giữ node ID trong graph được sao chép.

## Contract

`ProjectRepository.save(project, {create:true})` tạo bản mới; `save(project)` cập nhật khi revision khớp. Giá trị trả về chứa revision đã tăng; caller phải dùng bản mới này cho lần ghi tiếp theo. Không tự retry stale write vì có thể xóa thay đổi của tab khác.

Dạng xuất có `format: "mooz-cvn-project"`, `schemaVersion: 1`, `name`, `graph`. Đây là contract riêng của web; chỉ nhận đúng phiên bản này. Không nhận file desktop hoặc ví dụ minh họa trong handbook như một định dạng tương thích. Khi thay schema phải bổ sung migration và kiểm thử trước.

## Chưa có trong lớp này

Chưa có canvas renderer, media Blob store, xóa/khôi phục dự án, đồng bộ server, scheduler, AI adapter, extension/relay hay gửi lệnh AI. `assetId` chỉ là tham chiếu cho bước tích hợp media sau; JSON hiện không đóng gói media. Người dùng cần giữ bản gốc, và xuất JSON để sao lưu metadata. Dữ liệu không đồng bộ giữa máy; xóa dữ liệu trình duyệt có thể xóa dự án.

UI phải gọi một command layer chung khi nối canvas, rồi lưu snapshot qua repository. Không ghi trạng thái job đang chạy vào graph này và không dựng engine thứ hai trong renderer.

## Kiểm chứng

`npm test`: graph validation, thứ tự phụ thuộc, từ chối vòng lặp/cổng sai, undo/redo, import/export và loại dữ liệu nhạy cảm khỏi cấu hình xuất.

`npm run test:browser`: dùng Playwright (cài bằng `npm ci`), cần Chromium. Có thể chọn trình duyệt có sẵn bằng `CHROMIUM_PATH=/usr/bin/chromium npm run test:browser`, hoặc `npx playwright install chromium` rồi chạy bình thường. Bộ test mở server riêng cổng 4191 và dùng profile trình duyệt tạm, không xóa dự án của người dùng. Bao gồm create/reload/rename/duplicate/export/import, hai writer xung đột và bố cục mobile.
