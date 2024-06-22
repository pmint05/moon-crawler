HƯỚNG DẪN SỬ DỤNG:
- Tải repo về máy -> Giải nén
* Cách tự động:
- Chạy file edit_config.bat để sửa cấu hình tool, cách sửa ở bên dưới
- Nếu là lần đầu dùng tool thì chạy file install_packages.bat để cài các thư viện cần cho tool
- Chạy tiếp file run_it.bat để thực thi tool
- Chờ đợi là hạnh phúc...
* Cách thủ công
- Đổi tên file 'config.example.json' thành 'config.json'
- Sửa file config.json:
	+ courseToDownload: Link khóa học trên Moon.vn. Ví dụ: https://moon.vn/khoa-hoc/2549
	+ resolution: Độ phân giải của video tải về, mặc định là 1080. Có các tùy chọn 480, 720, 1080.
		-> Tốt nhất nên tải 1080 vì vừa nét và hầu hết các video trên Moon đều có độ phân giải này (mỗi tội down lâu hơn xíu)
	+ username và password tài khoản có khóa học cần down

- Vào folder tool, trên thanh địa chỉ, ấn vào nhập cmd để mở command prompt rồi chạy lần lượt các lệnh sau:
	+ 'npm i' hoặc 'npm install' -> lệnh này cài các package cần dùng cho tool (chỉ cần chạy 1 lần lần sau dùng thì chỉ cần mở cmd và chạy lệnh ngay bên dưới)
	+ 'node index.js' hoặc 'node .' -> lệnh này chạy tool
- Đợi tool chạy xong và hưởng thành quả!


CÁC LỖI THƯỜNG GẶP:
- Chưa cài nodejs, để check: mở cmd -> nhập node -v -> enter -> Nếu hiện ra v.xx.xx.xx thì ok
- Chưa cài package -> mở cmd ở folder chưa tool -> chạy 'npm i' -> xong xuôi thì 'node .' để chạy tool
- ... Còn các lỗi khác nếu gặp thì liên hệ t.me/pmint05