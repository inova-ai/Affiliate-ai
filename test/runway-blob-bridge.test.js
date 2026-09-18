import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('motion upload path uses Runway server-created ephemeral upload sessions', async()=>{
  const h=await fs.readFile('public/index.html','utf8');
  assert.match(h,/\/api\/runway\/upload-init/);
  assert.match(h,/uploadUrl/);
  assert.match(h,/form\.append\("file",file,file\.name\)/);
  assert.match(h,/sourceImageUri/);
  assert.match(h,/motionReferenceUri/);
});

test('server motion endpoint accepts Runway ephemeral URIs directly', async()=>{
  const s=await fs.readFile('server/index.js','utf8');
  assert.match(s,/sourceImageUri/);
  assert.match(s,/motionReferenceUri/);
  assert.match(s,/runwayMotionCreate/);
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
