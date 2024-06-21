const fs = require("fs");
const path = require("path");
const https = require("https");
const axios = require("axios");

const config = require("./config.json");

const LOGIN_API = "https://identity.moon.vn/api/user/login";
const COURSE_DETAIL_API = "https://courseapi.moon.vn/api/Course/CourseDetail/";
const LESSON_IN_GROUP_API =
	"https://courseapi.moon.vn/api/Course/LessonInGroup/";
const CONFIRMVIDEO_API =
	"https://courseapi.moon.vn/api/course/VideoLessonTikTok/";

const Resolution = {
	stream_0: "1080",
	stream_1: "720",
	stream_2: "480",
};
let stream_num = "";
const { resolution } = config;
switch (resolution) {
	case "480":
		stream_num = "stream_2";
		break;
	case "720":
		stream_num = "stream_1";
		break;
	case "1080":
		stream_num = "stream_0";
		break;
	default:
		stream_num = "stream_0";
}

let donwloadedVideo = 0;
const downloadVideo = async (videoName, lessonPath, playlistUrl) => {
	const outputPath = path.join(lessonPath, `${videoName}.mp4`);

	// const m3u8Url =
	// 	"https://lessonvid.moon.vn/12046453/12046456/stream_0/playlist.m3u8";
	const baseUri = playlistUrl.split("/").slice(0, -1).join("/");

	const httpsAgent = new https.Agent({
		hostname: "lessonvid.moon.vn",
		port: 443,
	});
	const arrayOfSegments = [];
	return await axios
		.get(playlistUrl, { httpsAgent })
		.then(async (response) => {
			console.log(`Downloading video '${videoName}.pm4' ...`);
			response.data.split(/\r?\n/).forEach((line) => {
				if (line.startsWith("#") || line.trim() === "") {
					return;
				}

				const segmentUrl = `${baseUri}/${line.trim()}`;
				arrayOfSegments.push(segmentUrl);
			});
			const output = fs.createWriteStream(outputPath);
			output.setMaxListeners(arrayOfSegments.length * 2);
			let downloadedSegments = 0;

			for (let i = 0; i < arrayOfSegments.length; i++) {
				const fileUrl = arrayOfSegments[i];

				try {
					const response = await axios({
						url: fileUrl,
						method: "GET",
						responseType: "stream",
					});
					await new Promise((resolve, reject) => {
						response.data.pipe(output, { end: false });
						response.data.on("end", () => {
							downloadedSegments++;
							process.stdout.clearLine();
							process.stdout.cursorTo(0);
							process.stdout.write(
								`Downloaded ${Number(
									(downloadedSegments /
										arrayOfSegments.length) *
										100
								).toFixed(2)}%`
							);
							resolve();
						});
						response.data.on("error", reject);
					});

					// console.log(`Successfully concatenated: ${fileUrl}`);
				} catch (error) {
					console.error(
						`Error downloading or concatenating: ${fileUrl}`,
						error
					);
				}
			}
			process.stdout.write("\n");
			output.end();
			return true;
		})
		.catch((error) => {
			// console.error("Error downloading segments:", error);
			return false;
		});
};
const getCourseDetail = async (courseUrl) => {
	const courseId = courseUrl.split("/").pop();
	if (!courseId) {
		console.error("Invalid course url");
		process.exit(1);
	}
	const courseDetailUrl = `${COURSE_DETAIL_API}${courseId}`;
	try {
		const response = await axios.get(courseDetailUrl);
		return response.data;
	} catch (error) {
		console.error("Error getting course detail: ", error);
		process.exit(1);
	}
};

const getLessonInGroup = async (groupId) => {
	const lessonInGroupUrl = `${LESSON_IN_GROUP_API}${groupId}`;
	const response = await axios.get(lessonInGroupUrl);
	return response.data;
};
const login = async () => {
	console.log("Logging in...");
	const { username, password } = config;
	try {
		const response = await axios.post(LOGIN_API, {
			username,
			password,
			rememberMe: true,
		});
		if (!response.data.token) {
			console.error("Error logging in: ", response.data.message);
			process.exit(1);
		}
		const { token } = response.data;
		console.log(`Logged in with user: ${username}`);
		return token;
	} catch (error) {
		console.error("Error logging in: ", error);
		process.exit(1);
	}
};
const donwloadVideoInLesson = async (
	lessonId,
	moduleName,
	token,
	lessonPath
) => {
	switch (moduleName) {
		case "ConfirmVideo":
			const playlistUrl = `${CONFIRMVIDEO_API}${lessonId}`;
			const response = await axios.get(playlistUrl, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});
			if (!response.data) {
				console.log("Lesson doesn't have video");
				return false;
			}
			const playlist = response.data;
			for (video of playlist) {
				const { fileName, urlVideo } = video;
				if (!urlVideo) {
					console.log(`Video '${fileName}' doesn't have video url`);
					continue;
				}
				let playlistDataUrl = await getSubPlaylistUrl(
					urlVideo,
					stream_num
				);
				if (!playlistDataUrl) {
					console.log(
						`Video '${fileName}' doesn't have ${Resolution[stream_num]} quality`
					);
					for (let i = 0; i < 3; i++) {
						console.log(
							`Retry download video ${fileName} in ${
								Resolution[`stream_${i}`]
							}`
						);
						if (Number(stream_num.split("_")[1]) === i) continue;
						playlistDataUrl = getSubPlaylistUrl(
							urlVideo,
							`stream_${i}`
						);
						const isSuccessCV = await downloadVideo(
							fileName,
							lessonPath,
							playlistDataUrl
						);
						if (isSuccessCV) {
							console.log(
								`Download video '${fileName}.mp4' successfully!`
							);
							donwloadedVideo++;
							console.log(
								"TOTAL VIDEOS DOWNLOADED: ",
								donwloadedVideo
							);
							break;
						}
					}
				}
				const isSuccessCV = await downloadVideo(
					fileName,
					lessonPath,
					playlistDataUrl
				);
				if (isSuccessCV) {
					console.log(
						`Download video '${fileName}.mp4' successfully!`
					);
					donwloadedVideo++;
					console.log("TOTAL VIDEOS DOWNLOADED: ", donwloadedVideo);
				}
			}
			return true;
		case "Confirm":
			const testingUrl = `https://courseapi.moon.vn/api/Course/Testing/${lessonId}/1`;
			const testingResponse = await axios.get(testingUrl, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});
			for (video of testingResponse.data) {
				const { order, questionId } = video;
				const detail = await axios.get(
					`https://courseapi.moon.vn/api/Course/ItemQuestion/${questionId}`,
					{
						headers: {
							Authorization: `Bearer ${token}`,
						},
					}
				);
				if (!detail.data.listTikTokVideoModel[0]) {
					console.log(
						`Question ${order} doesn't have solution video`
					);
					continue;
				}
				let videoUrl = await getSubPlaylistUrl(
					detail.data.listTikTokVideoModel[0].urlVideo,
					stream_num
				);
				if (!videoUrl) {
					console.log(
						`Video '${order}.mp4' doesn't have ${Resolution[stream_num]} quality`
					);
					for (let i = 0; i < 3; i++) {
						console.log(
							`Retry download video ${order}.mp4 in ${
								Resolution[`stream_${i}`]
							}`
						);
						if (Number(stream_num.split("_")[1]) === i) continue;
						videoUrl = await getSubPlaylistUrl(
							detail.data.listTikTokVideoModel[0].urlVideo,
							`stream_${i}`
						);
						const isSuccessC = await downloadVideo(
							order,
							lessonPath,
							videoUrl
						);
						if (isSuccessC) {
							console.log(
								`Download video '${order}.mp4' successfully!`
							);
							donwloadedVideo++;
							console.log(
								"TOTAL VIDEOS DOWNLOADED: ",
								donwloadedVideo
							);
							break;
						}
					}
				}
				const isSuccessC = await downloadVideo(
					order,
					lessonPath,
					videoUrl
				);
				if (isSuccessC) {
					console.log(`Download video '${order}.mp4' successfully!`);
					donwloadedVideo++;
					console.log("TOTAL VIDEOS DOWNLOADED: ", donwloadedVideo);
				}
			}
			return true;
		default:
			return false;
	}
};
const main = async () => {
	const { courseToDownload: courseUrl } = config;
	const courseDetail = await getCourseDetail(courseUrl);
	// console.log("Course detail: ", courseDetail);
	const { groupList, name: courseName } = courseDetail;
	if (!fs.existsSync(path.join(__dirname, "download"))) {
		fs.mkdirSync(path.join(__dirname, "download"));
	}
	if (
		!fs.existsSync(
			path.join(__dirname, "download", genFolderName(courseName))
		)
	) {
		fs.mkdirSync(
			path.join(__dirname, "download", genFolderName(courseName))
		);
	}
	const coursePath = path.join(
		__dirname,
		"download",
		genFolderName(courseName)
	);
	const token = await login();
	console.log("Calculating total video in course...");
	// const totalVideo = await countVideoInCourse(courseDetail, token);
	// console.log("Total video in course: ", totalVideo);
	console.log("Downloading course...");
	for (let i = 0; i < groupList.length; i++) {
		const group = groupList[i];
		const { id, name } = group;
		console.log("Downloading chapter: ", name);
		if (!fs.existsSync(path.join(coursePath, genFolderName(name)))) {
			fs.mkdirSync(path.join(coursePath, genFolderName(name)));
		}
		const groupPath = path.join(coursePath, genFolderName(name));
		const lessons = await getLessonInGroup(id);
		for (let j = 0; j < lessons.length; j++) {
			const lesson = lessons[j];
			if (!lesson) {
				continue;
			}
			const { id: lessonId, name: lessonName, moduleName } = lesson;
			// console.log(lesson);
			console.log("Downloading lesson: ", lessonName);
			if (
				!fs.existsSync(
					path.join(
						groupPath,
						genFolderName(`${j + 1}. ${lessonName}`)
					)
				)
			) {
				fs.mkdirSync(
					path.join(
						groupPath,
						genFolderName(`${j + 1}. ${lessonName}`)
					)
				);
			}
			const lessonPath = path.join(
				groupPath,
				genFolderName(`${j + 1}. ${lessonName}`)
			);
			const isLessonDownloaded = await donwloadVideoInLesson(
				lessonId,
				moduleName,
				token,
				lessonPath
			);
			if (isLessonDownloaded) {
				console.log("Downloaded lesson: ", lessonName);
				console.log("\n");
			}
		}
		console.log("Downloaded chapter: ", name);
		console.log("\n");
	}
	console.log("Download completed!");
};

const genFolderName = (name) => {
	return name.replace(/:/g, "").replace(/[/\\?%*|"<>]/g, "-");
};
const countVideoInCourse = async (courseDetail, token) => {
	let count = 0;
	const { groupList } = courseDetail;
	for (let i = 0; i < groupList.length; i++) {
		const group = groupList[i];
		const lessons = await getLessonInGroup(group.id);
		for (let j = 0; j < lessons.length; j++) {
			const lesson = lessons[j];
			const { id: lessonId, moduleName } = lesson;
			switch (moduleName) {
				case "ConfirmVideo":
					const playlistUrl = `${CONFIRMVIDEO_API}${lessonId}`;
					const response = await axios.get(playlistUrl, {
						headers: {
							Authorization: `Bearer ${token}`,
						},
					});
					count += response.data.length;
					break;
				case "Confirm":
					const testingUrl = `https://courseapi.moon.vn/api/Course/Testing/${lessonId}/1`;
					const testingResponse = await axios.get(testingUrl, {
						headers: {
							Authorization: `Bearer ${token}`,
						},
					});
					count += testingResponse.data.length;
					break;
				default:
					break;
			}
		}
	}
	return count;
};

async function fetchText(url) {
	const response = await axios.get(url);
	return await response.data;
}

async function getSubPlaylistUrl(mainPlaylistUrl, streamNum) {
	const mainPlaylistContent = await fetchText(mainPlaylistUrl);
	const lines = mainPlaylistContent.split("\n");
	let subPlaylistUrl = "";

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (
			!line.startsWith("#") &&
			line.includes(streamNum) &&
			line.endsWith(".m3u8")
		) {
			subPlaylistUrl = new URL(line, mainPlaylistUrl).href;
			break;
		}
	}

	return subPlaylistUrl;
}

async function getSegmentUrls(subPlaylistUrl) {
	const subPlaylistContent = await fetchText(subPlaylistUrl);
	const lines = subPlaylistContent.split("\n");
	const segmentUrls = lines
		.filter((line) => line && !line.startsWith("#"))
		.map((line) => new URL(line, subPlaylistUrl).href);
	return segmentUrls;
}
// (async () => {
// 	const { courseToDownload: courseUrl } = config;
// 	const token = await login();
// 	const courseDetail = await getCourseDetail(courseUrl);
// 	const { groupList, name: courseName } = courseDetail;
// 	for (let i = 0; i < groupList.length; i++) {
// 		const group = groupList[i];
// 		const { id, name } = group;
// 		console.log("Downloading chapter: ", name);
// 		const lessons = await getLessonInGroup(id);
// 		for (let j = 0; j < lessons.length; j++) {
// 			const lesson = lessons[j];
// 			const { id: lessonId, name: lessonName, moduleName } = lesson;
// 			console.log("Downloading lesson: ", lessonName);
// 			fs.mkdirSync(
// 				path.join(__dirname, "test", genFolderName(`${lessonName}`))
// 			);
// 			const lessonPath = path.join(
// 				__dirname,
// 				"test",
// 				genFolderName(`${lessonName}`)
// 			);
// 			const isLessonDownloaded = await donwloadVideoInLesson(
// 				lessonId,
// 				moduleName,
// 				token,
// 				lessonPath
// 			);
// 			if (isLessonDownloaded) {
// 				console.log("Downloaded lesson: ", lessonName);
// 				console.log("\n");
// 			}
// 		}
// 	}
// })();

main();
