import os
import requests # type: ignore
import aiohttp # type: ignore
import aiofiles # type: ignore
import asyncio
from google.colab import drive # type: ignore

# Mount Google Drive
drive.mount('/content/drive')

# SỬA CONFIG ĐỂ DOWNLOAD KHÓA HỌC
config = {
	"courseToDownload": "https://moon.vn/khoa-hoc/2549",
	"resolution": "480",
	"username": "0986772288",
	"password": "bac2882001"
}
#-----------------------------------
#ROOT FOLDER CHỨA KHÓA HỌC, MẶC ĐỊNH LÀ 'MOON.VN'
ROOT_FOLDER = "MOON.VN"
#-----------------------------------





Resolution = {
    "stream_0": "1080",
    "stream_1": "720",
    "stream_2": "480"
}
# API Endpoints
LOGIN_API = "https://identity.moon.vn/api/user/login"
COURSE_DETAIL_API = "https://courseapi.moon.vn/api/Course/CourseDetail/"
LESSON_IN_GROUP_API = "https://courseapi.moon.vn/api/Course/LessonInGroup/"
CONFIRMVIDEO_API = "https://courseapi.moon.vn/api/course/VideoLessonTikTok/"

# Helper Functions
def gen_folder_name(name):
    return name.replace(':', '').replace('/', '-').replace('\\', '-').replace('?', '-').replace('%', '-').replace('*', '-').replace('|', '-').replace('<', '-').replace('>', '-')

async def download_segment(session, url, file):
    async with session.get(url) as response:
        async for data in response.content.iter_chunked(1024):
            await file.write(data)

async def download_video(video_name, lesson_path, playlist_url):
    output_path = os.path.join(lesson_path, f"{video_name}.mp4")
    base_uri = "/".join(playlist_url.split("/")[:-1])

    async with aiohttp.ClientSession() as session:
        async with session.get(playlist_url) as response:
            if response.status != 200:
                # print(f"Failed to download playlist for {video_name}")
                return False
            playlist = await response.text()
            segment_urls = [f"{base_uri}/{line.strip()}" for line in playlist.split("\n") if line and not line.startswith("#")]
            async with aiofiles.open(output_path, 'wb') as file:
                tasks = [download_segment(session, url, file) for url in segment_urls]
                await asyncio.gather(*tasks)
                print(f"Downloaded video '{video_name}.mp4' successfully!")
                return True

async def login():
    data = {
        "username": config["username"],
        "password": config["password"],
        "rememberMe": True
    }
    print("Logging in...")
    response = requests.post(LOGIN_API, json=data)
    response_data = response.json()
    if "token" not in response_data:
        raise Exception(f"Error logging in: {response_data['message']}")
    print(f"Logged in with user: {config['username']}")
    return response_data["token"]

async def get_course_detail(course_url):
    course_id = course_url.split("/")[-1]
    response = requests.get(f"{COURSE_DETAIL_API}{course_id}")
    return response.json()

async def get_lesson_in_group(group_id):
    response = requests.get(f"{LESSON_IN_GROUP_API}{group_id}")
    return response.json()

async def download_videos_in_lesson(lesson_id, module_name, token, lesson_path):
    resolution_map = {
        "480": "stream_2",
        "720": "stream_1",
        "1080": "stream_0"
    }
    stream_num = resolution_map.get(config["resolution"], "stream_0")

    headers = {
        "Authorization": f"Bearer {token}"
    }

    if module_name == "ConfirmVideo":
        playlist_url = f"{CONFIRMVIDEO_API}{lesson_id}"
        response = requests.get(playlist_url, headers=headers)
        videos = response.json()
        for video in videos:
            file_name, url_video = video["fileName"], video["urlVideo"]
            playlist_url = f"{url_video.rsplit('/', 1)[0]}/{stream_num}/playlist.m3u8"
            isSuccessCV = await download_video(file_name, lesson_path, playlist_url)
            if not isSuccessCV:
                print(f"Failed to download video '{file_name}.mp4' in {Resolution[stream_num]}")
                for i in range(3):
                    print(f"Retry download video '{file_name}.mp4' in {Resolution[f'stream_{i}']}")
                    video_url = video_url.replace(stream_num, f"stream_{i}")
                    isSuccessCV = await download_video(file_name, lesson_path, playlist_url)
                    if isSuccessCV:
                        break

    elif module_name == "Confirm":
        testing_url = f"https://courseapi.moon.vn/api/Course/Testing/{lesson_id}/1"
        response = requests.get(testing_url, headers=headers)
        for video in response.json():
            order, question_id = video["order"], video["questionId"]
            detail_response = requests.get(f"https://courseapi.moon.vn/api/Course/ItemQuestion/{question_id}", headers=headers)
            video_url = f"{detail_response.json()['listTikTokVideoModel'][0]['urlVideo'].rsplit('/', 1)[0]}/{stream_num}/playlist.m3u8"
            isSuccessC = await download_video(order, lesson_path, video_url)
            if not isSuccessC:
                print(f"Failed to download video '{order}.mp4' in {Resolution[stream_num]}")
                for i in range(3):
                    print(f"Retry download video '{order}.mp4' in {Resolution[f'stream_{i}']}")
                    video_url = video_url.replace(stream_num, f"stream_{i}")
                    isSuccessC = await download_video(order, lesson_path, video_url)
                    if isSuccessC:
                        break

async def main():
    course_url = config["courseToDownload"]
    course_detail = await get_course_detail(course_url)
    course_name = course_detail["name"]
    course_path = os.path.join(f'/content/drive/My Drive/{ROOT_FOLDER}', gen_folder_name(course_name))
    os.makedirs(course_path, exist_ok=True)

    token = await login()

    print("Downloading course...")
    for group in course_detail["groupList"]:
        print(f"Downloading chapter: {group['name']}")
        group_path = os.path.join(course_path, gen_folder_name(group["name"]))
        os.makedirs(group_path, exist_ok=True)
        lessons = await get_lesson_in_group(group["id"])

        for index, lesson in enumerate(lessons):
            # print(f"Lesson data: {lesson}")
            print(f"Downloading lesson: {lesson.get('name', 'Unknown')}")
            lesson_name = lesson.get('name', 'Unknown')
            lesson_path = os.path.join(group_path, gen_folder_name(f"{index + 1}. {lesson_name}"))
            os.makedirs(lesson_path, exist_ok=True)
            await download_videos_in_lesson(lesson["id"], lesson["moduleName"], token, lesson_path)
            print(f"Downloaded lesson: {lesson_name}")
        print(f"Downloaded chapter: {group['name']}")
    print("Download completed!")

# Run the main function
await main()
