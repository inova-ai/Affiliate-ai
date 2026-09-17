import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const html=fs.readFileSync("public/index.html","utf8");
const server=fs.readFileSync("server/index.js","utf8");
test("browser Runway API manager is present",()=>{
 assert.match(html,/runwayApiKey/);
 assert.match(html,/TEST CONNECTION/);
 assert.match(html,/X-Luxmotion-Runway-Key/);
 assert.match(server,/\/api\/runway\/test/);
 assert.match(server,/x-luxmotion-runway-key/);
});
