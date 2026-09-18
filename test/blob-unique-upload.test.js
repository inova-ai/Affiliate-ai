import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const index=fs.readFileSync(new URL("../server/index.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
test("motion transfer uses Runway ephemeral upload sessions",()=>{
 assert.match(index,/createRunwayEphemeralUploadSession/);
 assert.match(index,/\/api\/runway\/upload-init/);
 assert.match(html,/\/api\/runway\/upload-init/);
});
test("server-side Blob uploads retain unique pathname prefixes",()=>{
 assert.match(index,/luxmotion\/uploads\/\$\{crypto\.randomUUID\(\)\}-\$\{original\}/);
});
