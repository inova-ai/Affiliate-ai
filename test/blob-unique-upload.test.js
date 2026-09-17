import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("client Blob uploads use unique filenames", () => {
  assert.match(index, /addRandomSuffix:true/);
  assert.match(html, /addRandomSuffix:(?:true|false)/);
});

test("server-side uploads use unique pathname prefixes", () => {
  assert.match(index, /luxmotion\/uploads\/\$\{crypto\.randomUUID\(\)\}-\$\{original\}/);
});
