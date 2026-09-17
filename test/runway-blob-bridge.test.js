import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('motion upload path uses Vercel Blob and server-side HTTPS bridge instead of browser Runway upload-init', async()=>{
  const h=await fs.readFile('public/index.html','utf8');
  assert.match(h,/https:\/\/esm\.sh\/@vercel\/blob@2\.6\.1\/client/);
  assert.match(h,/handleUploadUrl:"\/api\/blob\/client-upload"/);
  assert.match(h,/access:"private"/);
  assert.match(h,/multipart:true/);
  assert.doesNotMatch(h,/\/api\/blob\/read-url/);
  assert.match(h,/sourceImagePath/);
  assert.match(h,/motionReferencePath/);
  assert.doesNotMatch(h,/\/api\/runway\/upload-init/);
});

test('server Blob motion transfer uses Runway ephemeral uploads with explicit filenames', async()=>{
  const s=await fs.readFile('server/index.js','utf8');
  assert.match(s,/headPrivate/);
  assert.match(s,/uploadEphemeral/);
  assert.match(s,/runway-ephemeral/);
  assert.match(s,/toFile/);
  assert.match(s,/downloadPrivateToFile/);
  assert.match(s,/source-image/);
  assert.match(s,/motion-reference/);
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
