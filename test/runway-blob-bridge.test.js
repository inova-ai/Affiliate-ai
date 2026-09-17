import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('motion upload path uses Vercel Blob signed HTTPS URLs instead of browser Runway upload-init', async()=>{
  const h=await fs.readFile('public/index.html','utf8');
  assert.match(h,/\/api\/blob\/presign/);
  assert.match(h,/\/api\/blob\/read-url/);
  assert.match(h,/return rj\.url/);
  assert.doesNotMatch(h,/\/api\/runway\/upload-init/);
});

test('server Blob bridge creates signed URLs for Runway inputs', async()=>{
  const s=await fs.readFile('server/index.js','utf8');
  assert.match(s,/profilePrimaryUrl/);
  assert.match(s,/source:"vercel-blob-signed-url"/);
  assert.match(s,/createPresignedGet/);
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
