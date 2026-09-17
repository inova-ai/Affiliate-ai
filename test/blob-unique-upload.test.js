import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("motion video uploads use a fresh UUID pathname and private signed PUT", () => {
  assert.match(index, /const pathname=`luxmotion\/uploads\/\$\{crypto\.randomUUID\(\)\}-\$\{filename\}`/);
  assert.match(html, /\/api\/blob\/presign/);
  assert.doesNotMatch(html, /https:\/\/esm\.sh\/@vercel\/blob/);
});

test("server-side uploads use unique pathname prefixes", () => {
  assert.match(index, /luxmotion\/uploads\/\$\{crypto\.randomUUID\(\)\}-\$\{original\}/);
});
