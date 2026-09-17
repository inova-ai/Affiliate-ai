import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('motion upload path uses Vercel Blob and server-side Runway ephemeral upload instead of browser Runway upload-init', async()=>{
  const h=await fs.readFile('public/index.html','utf8');
  assert.match(h,/\/api\/blob\/presign/);
  assert.doesNotMatch(h,/\/api\/blob\/read-url/);
  assert.match(h,/sourceImagePath/);
  assert.match(h,/motionReferencePath/);
  assert.doesNotMatch(h,/\/api\/runway\/upload-init/);
});

test('server Blob bridge transfers private Blob paths to Runway ephemeral uploads', async()=>{
  const s=await fs.readFile('server/index.js','utf8');
  assert.match(s,/downloadPrivateToFile/);
  assert.match(s,/uploadEphemeral\(normalizedImage/);
  assert.match(s,/uploadEphemeral\(normalizedVideo/);
  assert.match(s,/sourceImageName/);
  assert.match(s,/motionReferenceName/);
});

test('durable media publish returns Blob metadata used for pathname persistence', async()=>{
  const b=await fs.readFile('server/blob.js','utf8');
  assert.match(b,/return result\|\|null/);
  const p=await fs.readFile('server/production.js','utf8');
  assert.match(p,/masterBlobPath=masterBlob\?\.pathname/);
  assert.match(p,/blobPath=deliveredBlob\?\.pathname/);
});

test('4K delivery avoids Runway ephemeral upload when Blob is configured', async()=>{
  const d=await fs.readFile('server/delivery.js','utf8');
  assert.match(d,/if\(blobConfigured\(\)\)/);
  assert.match(d,/signedUrl\(saved\.pathname/);
  assert.match(d,/video_upscale/);
});
