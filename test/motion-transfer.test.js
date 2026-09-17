import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
test("motion transfer UI contract is present",async()=>{const h=await fs.readFile("public/index.html","utf8");for(const id of ["motionImage","motionVideo","motionPrompt","motionDuration","motionFormat","motionAudio","motionBtn","motionResult"])assert.match(h,new RegExp(`id=["']${id}["']`));assert.match(h,/\/api\/motion-transfer/)});
test("provider uses Seedance 2.5 video-to-video with image reference",async()=>{const s=await fs.readFile("server/providers.js","utf8");assert.match(s,/videoToVideo\.create/);assert.match(s,/model:"seedance2_5"/);assert.match(s,/promptVideo:referenceVideo/);assert.match(s,/references:\[\{uri:promptImage\}\]/);assert.match(s,/mode:"reference"/);assert.match(s,/tasks\.retrieve/)})

test("Blob-backed motion transfer uses server-side ephemeral Runway upload to satisfy Runway HEAD probes",async()=>{const s=await fs.readFile("server/index.js","utf8");assert.match(s,/sourceImagePath/);assert.match(s,/motionReferencePath/);assert.match(s,/downloadPrivateToFile/);assert.match(s,/uploadEphemeral\(normalizedImage/);assert.match(s,/uploadEphemeral\(normalizedVideo/);assert.match(s,/normalizeRunwayImage/);assert.match(s,/normalizeRunwayVideo/);assert.match(s,/runway-transfer\/runway\/status|motion-transfer\/runway\/status/)});
