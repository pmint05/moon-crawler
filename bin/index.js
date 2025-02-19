const fs = require("fs");
const path = require("path");
const https = require("https");
const axios = require("axios");
const config = require("../config.json");
const htmlTemplate = fs.readFileSync(
	path.join(__dirname, "./template/pdf_template.hbs"),
	"utf8"
);
const puppeteer = require("puppeteer");
const Handlebars = require("handlebars");

const LOGIN_API = "https://identity.moon.vn/api/user/login";
const COURSE_DETAIL_API = "https://courseapi.moon.vn/api/Course/CourseDetail/";
const LESSON_IN_GROUP_API =
	"https://courseapi.moon.vn/api/Course/LessonInGroup/";
const CONFIRMVIDEO_API =
	"https://courseapi.moon.vn/api/course/VideoLessonTikTok/";
const LESSON_DETAIL_API = "https://courseapi.moon.vn/api/Course/LessonDetail/";
const TEST_DETAIL_API =
	"https://courseapi.moon.vn/api/testing/ReadingInLesson/";
const MTEST_KEY_DETAIL_API =
	"https://courseapi.moon.vn/api/Course/LessonDetail/mtest-key-detail/";
const MTEST_KEY_SECTION_API =
	"https://courseapi.moon.vn/api/testing/QuestionInMTest/";
const Resolution = {
	stream_0: "1080",
	stream_1: "720",
	stream_2: "480",
};
const ResolutionWidth = {
	stream_0: "1920",
	stream_1: "1280",
	stream_2: "858",
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
				`Attempt ${attempt + 1}: Service unavailable, retrying in ${delay}ms...`
			);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
}

let donwloadedVideo = 0;
const downloadVideo = async (fileName, targetPath, playlistUrl) => {
	const videoName = validPath(fileName);
	const outputPath = path.join(targetPath, `${videoName}.mp4`);

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
									(downloadedSegments / arrayOfSegments.length) * 100
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

const getLessonInGroup = async (groupId, token) => {
	const lessonInGroupUrl = `${LESSON_IN_GROUP_API}${groupId}`;
	const response = await axiosGetWithRetry(lessonInGroupUrl, {
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});
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
		console.log(
			`Logged in with user: ${username.slice(0, 5)}${Array(username.length - 5)
				.fill("*")
				.join("")}`
		);
		return token;
	} catch (error) {
		console.error("Error logging in: ", error.message);
		process.exit(1);
	}
};
const donwloadVideoInLesson = async (
	lessonId,
	moduleName,
	token,
	lessonPath
) => {
	switch (moduleName.toLowerCase()) {
		case "confirmvideo":
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
				let playlistDataUrl = await getSubPlaylistUrl(urlVideo, stream_num);
				if (!playlistDataUrl) {
					console.log(
						`Video '${fileName}' doesn't have ${Resolution[stream_num]} quality`
					);
					for (let i = 0; i < 3; i++) {
						console.log(
							`Retry download video ${fileName} in ${Resolution[`stream_${i}`]}`
						);
						if (Number(stream_num.split("_")[1]) === i) continue;
						playlistDataUrl = await getSubPlaylistUrl(urlVideo, `stream_${i}`);
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
							console.log(`Download video '${fileName}.mp4' successfully!`);
							donwloadedVideo++;
							console.log("TOTAL VIDEOS DOWNLOADED: ", donwloadedVideo);
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
					console.log(`Download video '${fileName}.mp4' successfully!`);
					donwloadedVideo++;
					console.log("TOTAL VIDEOS DOWNLOADED: ", donwloadedVideo);
				} else {
					console.log(`Cannot download video '${fileName}.mp4'`);
				}
			}
			return true;
		case "stest-key":
		case "stest":
			const testingUrl = `${TEST_DETAIL_API}${lessonId}`;
			const testingResponse = await axiosGetWithRetry(testingUrl, {
				headers: {
					Authorization: `Bearer ${token}`,
				},
			});
			if (!testingResponse) {
				return false;
			}
			const { data } = testingResponse;
			if (data.length === 0) {
				console.log("Lesson is empty");
				return false;
			}
			// savePdf(browser, data, `${lessonPath}/test.pdf`);
			await download2025Test(data, lessonPath, "test");
			break;
		case "mtest-key":
			const mtestKeyDetail = await axiosGetWithRetry(
				MTEST_KEY_DETAIL_API + lessonId,
				{
					headers: {
						Authorization: `Bearer ${token}`,
					},
				}
			);
			// console.log(mtestKeyDetail);
			if (!mtestKeyDetail) {
				console.error("Failed to fetch mtest key detail");
				return false;
			}
			const { data: mtestKeyData } = mtestKeyDetail;
			const { sections } = mtestKeyData;
			for (const section of sections) {
				const { name, lessonId } = section;
				const mtestKeySection = await axiosGetWithRetry(
					`${MTEST_KEY_SECTION_API}${lessonId}`,
					{
						headers: {
							Authorization: `Bearer ${token}`,
						},
					}
				);
				if (!mtestKeySection) {
					console.error("Failed to fetch mtest key section");
					continue;
				}
				const { data: mtestKeySectionData } = mtestKeySection;
				await download2025Test(mtestKeySectionData, lessonPath, name);
			}
			break;
		case "confirm":
			const lessonDetail = await axiosGetWithRetry(
				`${LESSON_DETAIL_API}${lessonId}`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
					},
				}
			);
			if (!lessonDetail) {
				console.error("Failed to fetch lesson detail");
				return false;
			}
			// console.log("Lesson detail:", lessonDetail.data);
			const { subModuleName, keyAllEnglish } = lessonDetail.data;
			if (subModuleName === "audio" && keyAllEnglish !== null) {
				const testingUrl = `https://courseapi.moon.vn/api/Course/TestingEnglish/${lessonId}/1`;
				const testingResponse = await axiosGetWithRetry(testingUrl, {
					headers: {
						Authorization: `Bearer ${token}`,
					},
				});
				if (!testingResponse) {
					return false;
				}
				for (let i = 0; i < testingResponse.data.length; i++) {
					const { id, isAudio, title } = testingResponse.data[i];
					if (isAudio) {
						const audioUrl = `https://media.moon.vn/audio/englishtitle?id=${id}`;
						const audioPath = path.join(lessonPath, validPath(title));
						if (!fs.existsSync(audioPath)) {
							fs.mkdirSync(audioPath);
						}
						console.log(`Downloading audio '${title}.mp3' ...`);
						const audioOutputPath = path.join(
							audioPath,
							`${validPath(title)}.mp3`
						);
						const audioOutput = fs.createWriteStream(audioOutputPath);
						const audioResponse = await axios({
							url: audioUrl,
							method: "GET",
							responseType: "stream",
						});
						if (!audioResponse) {
							return false;
						}
						audioResponse.data.pipe(audioOutput);
					} else {
						const detail = await axiosGetWithRetry(
							`https://courseapi.moon.vn/api/Course/ItemQuestion/${id}`,
							{
								headers: {
									Authorization: `Bearer ${token}`,
								},
							}
						);
						if (!detail) {
							console.error(`Failed to fetch question detail: ${id}`);
							continue;
						}
						const questionPath = path.join(lessonPath, `Câu ${i + 1}`);
						if (!fs.existsSync(questionPath)) {
							fs.mkdirSync(questionPath);
						}
						if (!detail.data.listTikTokVideoModel[0]) {
							console.log(`Question ${i + 1} doesn't have solution video`);
							continue;
						}
						let videoUrl = await getSubPlaylistUrl(
							detail.data.listTikTokVideoModel[0].urlVideo,
							stream_num
						);
						if (!videoUrl) {
							console.log(
								`Video '${i + 1}.mp4' doesn't have ${
									Resolution[stream_num]
								} quality`
							);
							for (let i = 0; i < 3; i++) {
								console.log(
									`Retry download video ${i + 1}.mp4 in ${
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
										`Video '${i + 1}.mp4' doesn't have ${
											Resolution[stream_num]
										} quality`
									);
									continue;
								}
								const isSuccessC = await downloadVideo(
									i + 1,
									questionPath,
									videoUrl,
									moduleName,
									detail
								);
								if (isSuccessC) {
									console.log(`Download video '${i + 1}.mp4' successfully!`);
									donwloadedVideo++;
									console.log("TOTAL VIDEOS DOWNLOADED: ", donwloadedVideo);
									break;
								}
							}
						}
						const isSuccessC = await downloadVideo(
							i + 1,
							questionPath,
							videoUrl,
							moduleName,
							detail
						);
						if (isSuccessC) {
							console.log(`Download video '${i + 1}.mp4' successfully!`);
							donwloadedVideo++;
							console.log("TOTAL VIDEOS DOWNLOADED: ", donwloadedVideo);
						}
					}
				}
				return true;
			} else if (
				keyAllEnglish &&
				keyAllEnglish.length > 0 &&
				subModuleName.toLowerCase() == "english"
			) {
				const testingUrl = `https://courseapi.moon.vn/api/Course/TestingEnglish/${lessonId}/1`;
				const testingResponse = await axiosGetWithRetry(testingUrl, {
					headers: {
						Authorization: `Bearer ${token}`,
					},
				});
				if (!testingResponse.data) {
					return false;
				}
				// console.log(testingResponse.data);

				for (let i = 0; i < testingResponse.data.length; i++) {
					const { id, isAudio, testingList, title, content } =
						testingResponse.data[i];
					if (isAudio) {
						const audioUrl = `https://media.moon.vn/audio/englishtitle?id=${id}`;
						console.log(`Downloading audio '${title}.mp3' ...`);
						const audioOutputPath = path.join(
							lessonPath,
							`${validPath(title)}.mp3`
						);
						const audioOutput = fs.createWriteStream(audioOutputPath);
						const audioResponse = await axios({
							url: audioUrl,
							method: "GET",
							responseType: "stream",
						});
						if (!audioResponse) {
							return false;
						}
						audioResponse.data.pipe(audioOutput);
						console.log(`Downloaded audio '${title}.mp3'`);
						if (testingList.length > 0) {
							await downloadPDF(
								"Full",
								{
									data: testingList,
									title,
									content,
								},
								lessonPath
							);
						}
					} else {
						await downloadPDF(
							"Full",
							{
								data: testingList,
								title,
								content,
							},
							lessonPath
						);
						if (moduleName.toLowerCase() === "stest-key") return;
						for (let i = 0; i < testingList.length; i++) {
							const { questionId, order } = testingList[i];
							const detail = await axiosGetWithRetry(
								`https://courseapi.moon.vn/api/Course/ItemQuestion/${questionId}`,
								{
									headers: {
										Authorization: `Bearer ${token}`,
									},
								}
							);

							if (!detail || !detail.data) {
								console.error(`Failed to fetch question detail: ${questionId}`);
								continue;
							}
							if (!detail.data.listTikTokVideoModel[0]) {
								console.log(`Question ${order} doesn't have solution video`);
								continue;
							}
							let videoUrl = await getSubPlaylistUrl(
								detail.data.listTikTokVideoModel[0].urlVideo,
								stream_num
							);
							if (!videoUrl) {
								console.log(
									`Video '${i + 1}.mp4' doesn't have ${
										Resolution[stream_num]
									} quality`
								);
								for (let i = 0; i < 3; i++) {
									console.log(
										`Retry download video ${i + 1}.mp4 in ${
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
											`Video '${i + 1}.mp4' doesn't have ${
												Resolution[stream_num]
											} quality`
										);
										continue;
									}
									const isSuccessC = await downloadVideo(
										order,
										lessonPath,
										videoUrl,
										moduleName,
										detail
									);
									if (isSuccessC) {
										console.log(`Download video '${i + 1}.mp4' successfully!`);
										donwloadedVideo++;
										console.log("TOTAL VIDEOS DOWNLOADED: ", donwloadedVideo);
										break;
									}
								}
							}
							const isSuccessC = await downloadVideo(
								order,
								lessonPath,
								videoUrl,
								moduleName,
								detail
							);
							if (isSuccessC) {
								console.log(`Download video '${order}.mp4' successfully!`);
								donwloadedVideo++;
								console.log("TOTAL VIDEOS DOWNLOADED: ", donwloadedVideo);
							}
						}
					}
				}
			} else {
				const testingUrl = `https://courseapi.moon.vn/api/Course/Testing/${lessonId}/1`;
				const testingResponse = await axiosGetWithRetry(testingUrl, {
					headers: {
						Authorization: `Bearer ${token}`,
					},
				});
				if (!testingResponse.data) {
					return false;
				}
				await downloadPDF(
					"Full",
					{
						data: testingResponse.data,
					},
					lessonPath
				);
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
						console.log(`Question ${order} doesn't have solution video`);
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
								videoUrl,
								moduleName,
								detail
							);
							if (isSuccessC) {
								console.log(`Download video '${order}.mp4' successfully!`);
								donwloadedVideo++;
								console.log("TOTAL VIDEOS DOWNLOADED: ", donwloadedVideo);
								break;
							}
						}
					}
					const isSuccessC = await downloadVideo(
						order,
						lessonPath,
						videoUrl,
						moduleName,
						detail
					);
					if (isSuccessC) {
						console.log(`Download video '${order}.mp4' successfully!`);
						donwloadedVideo++;
						console.log("TOTAL VIDEOS DOWNLOADED: ", donwloadedVideo);
					}
				}
				return true;
				const readingUrl = `https://courseapi.moon.vn/api/testing/ReadingInLesson/19731699`;
				const readingResponse = await axiosGetWithRetry(readingUrl, {
					headers: {
						Authorization: `Bearer ${token}`,
					},
				});
				if (!readingResponse) {
					console.error("Failed to fetch reading data");
					return false;
				}
				await downloadPDF("ReadingInLesson", readingResponse.data, lessonPath);
				return true;
			}
		case "livestream":
			const liveStreamDetail = await axiosGetWithRetry(
				`${LESSON_DETAIL_API}${lessonId}`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
					},
				}
			);
			if (!liveStreamDetail) {
				return false;
			}
			const { linkLiveStream } = liveStreamDetail.data;
			if (!linkLiveStream) {
				console.log("Lesson doesn't have live stream");
				return false;
			}
			const liveStreamLinkTxt = path.join(lessonPath, "link.txt");
			fs.writeFileSync(liveStreamLinkTxt, linkLiveStream);
			console.log("Saved live stream link");
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
		!fs.existsSync(path.join(__dirname, "../download", validPath(courseName)))
	) {
		fs.mkdirSync(path.join(__dirname, "../download", validPath(courseName)));
	}
	const coursePath = path.join(__dirname, "../download", validPath(courseName));
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
		const lessons = await getLessonInGroup(id, token);
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
	return name
		.toString()
		.replace(/\t/g, "")
		.replace(/:/g, "")
		.replace(/\//g, "")
		.replace(/[\\?%*|"<>]/g, "-")
		.replace(/\.$/, "")
		.replace(/\s+/g, " ")
		.trim();
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
	const lessons = await getLessonInGroup(id, token);
	const { lesson: lessonToDown } = config;
	let low = 0;
	let high = lessons.length;
	if (Number(lessonToDown) > 0) {
		low = Number(lessonToDown) - 1;
		high = Number(lessonToDown);
	}
	if (high > lessons.length) {
		console.error("Invalid lesson: ", lessonToDown);
	}
	for (let j = low; j < high; j++) {
		const lesson = lessons[j];
		if (!lesson) {
			continue;
		}
		const { id: lessonId, name: lessonName, moduleName } = lesson;
		console.log("Downloading lesson: ", lessonName);
		if (
			!fs.existsSync(path.join(groupPath, validPath(`${j + 1}. ${lessonName}`)))
		) {
			fs.mkdirSync(path.join(groupPath, validPath(`${j + 1}. ${lessonName}`)));
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
};

async function downloadPDF(name, data, savePath) {
	const html = Handlebars.compile(htmlTemplate)({
		data,
	});
	// fs.writeFileSync("final.html", html);
	console.log("Saving PDF...");
	// console.log(html);
	// fs.writeFileSync("final.html", html);
	const browser = await puppeteer.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	});
	const page = await browser.newPage();

	await page.setContent(html, { waitUntil: "networkidle0" });

	// Run any necessary JavaScript here
	await page.evaluate(() => {
		// const images = document.querySelectorAll("img");
		// // refetch src and save as base64 then replace src
		// images.forEach((img) => {
		// 	const src = img.getAttribute("src");
		// 	fetch(src, {
		// 		mode: "no-cors",
		// 	}).then((response) => {
		// 		response.blob().then((blob) => {
		// 			const reader = new FileReader();
		// 			reader.readAsDataURL(blob);
		// 			reader.onloadend = function () {
		// 				const base64data = reader.result;
		// 				console.log("base64data", base64data);
		// 				img.setAttribute("src", base64data);
		// 			};
		// 		});
		// 	});
		// });
	});

	// Generate PDF
	await page
		.pdf({
			path: path.join(savePath, `${validPath(name)}.pdf`), // path: "final.pdf
			format: "A4",
			margin: {
				top: "20px",
				right: "20px",
				bottom: "20px",
				left: "20px",
			},
			printBackground: true,
		})
		.then(() => {
			console.log("Saved PDF successfully!");
		})
		.catch((error) => {
			console.error("Error saving PDF: ", error);
		});

	await browser.close();
}

let browser;
const testHtmlTemplate = fs.readFileSync(
	path.join(__dirname, "./template/test_pdf_template.hbs"),
	"utf8"
);
async function download2025Test(data, savePath, fileName = "test") {
	const html = Handlebars.compile(testHtmlTemplate)({
		data,
	});
	console.log("Saving Test PDF...");
	if (!browser) {
		browser = await puppeteer.launch({
			headless: true,
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		});
	}
	const page = await browser.newPage();

	await page.setContent(html, { waitUntil: "networkidle0" });

	await page
		.pdf({
			path: path.join(savePath, `${validPath(fileName)}.pdf`),
			format: "A4",
			margin: {
				top: "20px",
				right: "20px",
				bottom: "20px",
				left: "20px",
			},
			printBackground: true,
		})
		.then(() => {
			console.log(`Saved ${fileName} PDF successfully!`);
		})
		.catch((error) => {
			console.error(`Error saving ${fileName} PDF: `, error);
		});
}

const countVideoInCourse = async (courseDetail, token) => {
	let count = 0;
	const { groupList } = courseDetail;
	for (let i = 0; i < groupList.length; i++) {
		const group = groupList[i];
		const lessons = await getLessonInGroup(group.id, token);
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
					const testingResponse = await axiosGetWithRetry(testingUrl, {
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

	if (!subPlaylistUrl) {
		for (let i = 0; i < lines.length; i++) {
			if (
				!lines[i].startsWith("#") &&
				lines[i].endsWith(".m3u8") &&
				(lines[i - 1].includes(Resolution.stream_2) ||
					lines[i - 1].includes(ResolutionWidth.stream_2))
			) {
				subPlaylistUrl = new URL(lines[i], mainPlaylistUrl).href;
				break;
			}
		}
	}
	if (!subPlaylistUrl) {
		for (let i = 0; i < lines.length; i++) {
			if (!lines[i].startsWith("#") && lines[i].endsWith(".m3u8")) {
				subPlaylistUrl = new URL(lines[i], mainPlaylistUrl).href;
				break;
			}
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
