import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
test("photos still use the server-side Blob upload path",()=>{
 const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
 assert.match(html,/compressImageForServerUpload/);
 assert.match(html,/fetch\("\/api\/blob\/upload"/);
});
