const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const axios = require("axios");

const config = require("../config.json");

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

async function axiosGetWithRetry(
	url,
	options = {},
	maxRetries = 5,
	retryDelay = 3000
) {
	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			return await axios.get(url, {
				...options,
				maxContentLength: Infinity,
				maxBodyLength: Infinity,
				headers: {
					...options?.headers,
					Connection: "keep-alive",
				},
			});
		} catch (error) {
			const isServiceUnavailable =
				error.response && error.response.status === 503;
			if (attempt === maxRetries - 1 || !isServiceUnavailable) {
				console.log("Cannot download video");
				return null;
			}

			// Optionally increase delay for 503 errors
			const delay = isServiceUnavailable ? retryDelay * 2 : retryDelay;
			console.log(
				`Attempt ${
					attempt + 1
				}: Service unavailable, retrying in ${delay}ms...`
			);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
}
let donwloadedVideo = 0;
const downloadVideo = async (fileName, lessonPath, playlistUrl) => {
	// console.log(playlistUrl);
	const videoName = validPath(fileName);
	const outputPath = path.join(lessonPath, `${videoName}.mp4`);

	// const m3u8Url =
	// 	"https://lessonvid.moon.vn/12046453/12046456/stream_0/playlist.m3u8";
	const baseUri = playlistUrl.split("/").slice(0, -1).join("/");

	const httpsAgent = new https.Agent({
		hostname: "lessonvid.moon.vn",
		port: 443,
	});
	const arrayOfSegments = [];
	return axiosGetWithRetry(playlistUrl, {
		httpsAgent,
		maxContentLength: Infinity,
		maxBodyLength: Infinity,
	})
		.then(async (response) => {
			if (!response) {
				return false;
			}
			console.log(`Downloading video '${videoName}.mp4' ...`);
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
						httpsAgent,
						maxContentLength: Infinity,
						maxBodyLength: Infinity,
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
const getCourseDetail = async (courseUrl, token) => {
	const courseId = courseUrl.split("/").pop();
	if (!courseId) {
		console.error("Invalid course url");
		process.exit(1);
	}
	const courseDetailUrl = `${COURSE_DETAIL_API}${courseId}`;
	try {
		const response = await axios.get(courseDetailUrl, {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});
		return response.data;
	} catch (error) {
		console.error("Error getting course detail: ", error);
		process.exit(1);
	}
};

const getLessonInGroup = async (groupId) => {
	const lessonInGroupUrl = `${LESSON_IN_GROUP_API}${groupId}`;
	const response = await axiosGetWithRetry(lessonInGroupUrl);
	if (!response) {
		return [];
	}
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
			const response = await axiosGetWithRetry(playlistUrl, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});
			if (!response) {
				return false;
			}
			if (response.data.length === 0) {
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
						playlistDataUrl = await getSubPlaylistUrl(
							urlVideo,
							`stream_${i}`
						);
						if (!playlistDataUrl) {
							console.log(
								`Video '${fileName}' doesn't have ${Resolution[stream_num]} quality`
							);
							continue;
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
				} else {
					console.log(`Cannot download video '${fileName}.mp4'`);
				}
			}
			return true;
		case "Confirm":
			const testingUrl = `https://courseapi.moon.vn/api/Course/Testing/${lessonId}/1`;
			const testingResponse = await axiosGetWithRetry(testingUrl, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});
			if (!testingResponse) {
				return false;
			}
			for (video of testingResponse.data) {
				const { order, questionId } = video;
				const detail = await axiosGetWithRetry(
					`https://courseapi.moon.vn/api/Course/ItemQuestion/${questionId}`,
					{
						headers: {
							Authorization: `Bearer ${token}`,
						},
					}
				);
				if (!detail) {
					return false;
				}
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
						if (!videoUrl) {
							console.log(
								`Video '${order}.mp4' doesn't have ${Resolution[stream_num]} quality`
							);
							continue;
						}
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
	const token = await login();
	const { courseToDownload: courseUrl, chapter } = config;
	const courseDetail = await getCourseDetail(courseUrl, token);
	// console.log("Course detail: ", courseDetail);
	const { isBuy, groupList, name: courseName, linkBuy, money } = courseDetail;
	if (!isBuy) {
		console.error(`You haven't bought this course: ${courseName}`);
		console.log(
			`Please buy this course at: ${new URL(linkBuy, courseUrl).href}`
		);
		console.log(
			`Price: ${money.toLocaleString("vi-VN", {
				style: "currency",
				currency: "VND",
			})}`
		);
		process.exit(1);
	}
	if (!fs.existsSync(path.join(__dirname, "../download"))) {
		fs.mkdirSync(path.join(__dirname, "../download"));
	}
	if (
		!fs.existsSync(
			path.join(__dirname, "../download", validPath(courseName))
		)
	) {
		fs.mkdirSync(
			path.join(__dirname, "../download", validPath(courseName))
		);
	}
	const coursePath = path.join(
		__dirname,
		"../download",
		validPath(courseName)
	);
	// console.log("Calculating total video in course...");
	// const totalVideo = await countVideoInCourse(courseDetail, token);
	// console.log("Total video in course: ", totalVideo);
	console.log("Downloading course...");
	if (chapter && Number(chapter) > 0) {
		await downloadChapter(chapter, groupList, coursePath, token);
		return;
	}
	for (let i = 0; i < groupList.length; i++) {
		const group = groupList[i];
		const { id, name } = group;
		console.log("Downloading chapter: ", name);
		if (!fs.existsSync(path.join(coursePath, validPath(name)))) {
			fs.mkdirSync(path.join(coursePath, validPath(name)));
		}
		const groupPath = path.join(coursePath, validPath(name));
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
					path.join(groupPath, validPath(`${j + 1}. ${lessonName}`))
				)
			) {
				fs.mkdirSync(
					path.join(groupPath, validPath(`${j + 1}. ${lessonName}`))
				);
			}
			const lessonPath = path.join(
				groupPath,
				validPath(`${j + 1}. ${lessonName}`)
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
	console.log(`DOWNLOAD COURSE ${courseName} SUCCESSFULLY!`);
	console.log("WITH TOTAL VIDEOS: ", donwloadedVideo);
};

const validPath = (name) => {
	return name.replace(/:/g, "").replace(/[/\\?%*|"<>]/g, "-");
};
const downloadChapter = async (chapter, groupList, coursePath, token) => {
	const group = groupList[Number(chapter) - 1];
	if (!group) {
		console.error("Invalid chapter");
		process.exit(1);
	}
	const { id, name } = group;
	console.log("Downloading chapter: ", name);
	if (!fs.existsSync(path.join(coursePath, validPath(name)))) {
		fs.mkdirSync(path.join(coursePath, validPath(name)));
	}
	const groupPath = path.join(coursePath, validPath(name));
	const lessons = await getLessonInGroup(id);
	for (let j = 5; j < lessons.length; j++) {
		const lesson = lessons[j];
		if (!lesson) {
			continue;
		}
		const { id: lessonId, name: lessonName, moduleName } = lesson;
		console.log("Downloading lesson: ", lessonName);
		if (
			!fs.existsSync(
				path.join(groupPath, validPath(`${j + 1}. ${lessonName}`))
			)
		) {
			fs.mkdirSync(
				path.join(groupPath, validPath(`${j + 1}. ${lessonName}`))
			);
		}
		const lessonPath = path.join(
			groupPath,
			validPath(`${j + 1}. ${lessonName}`)
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
					const response = await axiosGetWithRetry(playlistUrl, {
						headers: {
							Authorization: `Bearer ${token}`,
						},
					});
					count += response.data.length;
					break;
				case "Confirm":
					const testingUrl = `https://courseapi.moon.vn/api/Course/Testing/${lessonId}/1`;
					const testingResponse = await axiosGetWithRetry(
						testingUrl,
						{
							headers: {
								Authorization: `Bearer ${token}`,
							},
						}
					);
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
	const response = await axiosGetWithRetry(url);
	if (!response) {
		return "";
	}
	return await response.data;
}

async function getSubPlaylistUrl(mainPlaylistUrl, streamNum) {
	const mainPlaylistContent = await fetchText(mainPlaylistUrl);
	if (!mainPlaylistContent) {
		return "";
	}
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

main();
