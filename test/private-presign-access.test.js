import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("private Blob presign helpers explicitly request private access", async () => {
  const source = await fs.readFile(new URL("../server/blob.js", import.meta.url), "utf8");
  assert.match(source, /operation:"put",access:"private"/);
  assert.match(source, /operation:"head",access:"private"/);
  assert.match(source, /operation:"get",access:"private"/);
});
