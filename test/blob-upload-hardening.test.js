import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("blob upload hardening: photos avoid presigned browser PUT",()=>{
 const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 assert.match(html,/compressImageForServerUpload/);
 assert.match(html,/fetch\("\/api\/blob\/upload"/);
 const fn=html.slice(html.indexOf("async function uploadToRunwayDirect"),html.indexOf("async function motionTransfer"));
 assert.doesNotMatch(fn,/file\.size<=4\*1024\*1024/);
});
