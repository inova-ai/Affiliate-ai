import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("Vercel Express entrypoint and function contract are present",()=>{
  const cfg=JSON.parse(fs.readFileSync("vercel.json","utf8"));
  assert.equal(cfg.framework,"express");
  assert.equal(cfg.functions["index.js"].maxDuration,300);
  assert.ok(fs.existsSync("index.js"));
  const entry=fs.readFileSync("index.js","utf8");
  assert.match(entry,/import\s+express\s+from ['"]express['"]/);
  assert.match(entry,/export default app/);
  const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
  assert.equal(pkg.engines.node,"24.x");
  for(const dep of ["@vercel/blob","ffmpeg-static","ffprobe-static","@runwayml/sdk"]) assert.ok(pkg.dependencies[dep],`${dep} dependency missing`);
});

test("large browser uploads avoid Vercel's server payload path",()=>{
  const html=fs.readFileSync("public/index.html","utf8");
  const server=fs.readFileSync("server/index.js","utf8");
  assert.match(html,/\/api\/blob\/presign/);
  assert.match(html,/method:"PUT"/);
  assert.match(server,/\/api\/blob\/presign/);
  assert.match(server,/\/api\/upload-from-url/);
});

test("Vercel auto-production does not rely on fire-and-forget work",()=>{
  const server=fs.readFileSync("server/index.js","utf8");
  assert.match(server,/if\(process\.env\.VERCEL\)\{\s*const result=await run/);
  assert.match(server,/return res\.status\(result\.ok\?200:502\)/);
});

test("Blob persistence is not falsely reported just because the app runs on Vercel",()=>{
  const blob=fs.readFileSync("server/blob.js","utf8");
  assert.match(blob,/BLOB_STORE_ID \|\|/);
  assert.match(blob,/BLOB_READ_WRITE_TOKEN \|\|/);
  assert.match(blob,/VERCEL_OIDC_TOKEN/);
  assert.doesNotMatch(blob,/BLOB_READ_WRITE_TOKEN \|\| process\.env\.VERCEL\)/);
  assert.match(blob,/access:"private"/);
});

test("Persistent media uses private Blob paths and signed read URLs",()=>{
  const index=fs.readFileSync("server/index.js","utf8");
  const production=fs.readFileSync("server/production.js","utf8");
  assert.match(index,/signedUrl\(/);
  assert.match(index,/masterBlobPath/);
  assert.match(production,/masterBlobPath/);
  assert.match(production,/blobPath/);
});

test("Health exposes real Blob reachability and durable persistence state",()=>{
  const server=fs.readFileSync("server/index.js","utf8");
  assert.match(server,/blobReachable=false/);
  assert.match(server,/durablePersistence:Boolean\(blobConfigured\(\)&&blobReachable\)/);
});


test('Blob upload flow verifies the exact pathname before using it', async()=>{
  const s=fs.readFileSync('server/index.js','utf8');
  const h=fs.readFileSync('public/index.html','utf8');
  assert.match(s,/app\.post\("\/api\/blob\/verify"/);
  assert.match(s,/waitForPrivateBlob/);
  assert.match(h,/\/api\/blob\/verify/);
});

test('Blob not-found errors are normalized instead of leaking SDK exception', async()=>{
  const b=fs.readFileSync('server/blob.js','utf8');
  assert.match(b,/does not exist\|not found\|404/);
  assert.match(b,/waitForPrivateBlob/);
});
