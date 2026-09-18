import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
test('motion uses Runway direct ephemeral upload session, not Blob input upload', async()=>{
 const h=await fs.readFile('public/index.html','utf8');
 assert.match(h,/\/api\/runway\/upload-init/);
 assert.match(h,/uploadUrl/);
 assert.match(h,/form\.append\("file",file,file\.name\)/);
});
test('server upload-init calls Runway v1 uploads',async()=>{
 const p=await fs.readFile('server/providers.js','utf8');
 assert.match(p,/https:\/\/api\.dev\.runwayml\.com\/v1\/uploads/);
 assert.match(p,/type:"ephemeral"/);
 assert.match(p,/X-Runway-Version/);
});
