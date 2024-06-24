@echo off
chcp 65001

set "configFile=config.json"
set "exampleFile=config.example.json"

if exist "%configFile%" (
	echo Đang mở %configFile% trong Notepad...
	echo Cách sửa file config.json nằm trong readme.txt
	notepad "%configFile%"
) else (
	echo Không tìm thấy file config.json
  	if exist "%exampleFile%" (
		echo Tìm thấy file config.example.json, đổi tên thành config.json...
		rename "%exampleFile%" "%configFile%"
	) else (
		echo Đang tạo file config.json...
		:: copy "%exampleFile%" "%configFile%"
		(
		echo {
		echo     "courseToDownload": "your_course_url",
		echo     "chapter": "0",
		echo     "resolution": "480/720/1080",
		echo     "username": "your_username",
		echo     "password": "your_password",
		echo }
		) >"%configFile%"
		notepad "%configFile%"
		echo Cách sửa file config.json nằm trong readme.txt
		echo Ấn phím bất kỳ để thoát...
	)
)