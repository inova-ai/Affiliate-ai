import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let ffmpegStatic = null;
let ffprobeStatic = null;
try { ffmpegStatic = require("ffmpeg-static"); } catch {}
try { ffprobeStatic = require("ffprobe-static"); } catch {}
export function ffmpegPath(){ return process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg"; }
export function ffprobePath(){ return process.env.FFPROBE_PATH || ffprobeStatic?.path || "ffprobe"; }
export function mediaToolInfo(){ return {ffmpeg:ffmpegPath(),ffprobe:ffprobePath(),bundledFfmpeg:Boolean(ffmpegStatic),bundledFfprobe:Boolean(ffprobeStatic?.path)}; }
