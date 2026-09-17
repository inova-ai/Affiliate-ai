import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let blob = null;
try { blob = require("@vercel/blob"); } catch {}

export function blobConfigured(){
  // Vercel Blob OIDC in Functions uses the x-vercel-oidc-token request context.
  // The connected store is identified by BLOB_STORE_ID; the SDK resolves the
  // request-scoped OIDC token automatically. Static-token stores use
  // BLOB_READ_WRITE_TOKEN. Local builds may use VERCEL_OIDC_TOKEN.
  return Boolean(blob?.put && blob?.get && blob?.list && (
    process.env.BLOB_STORE_ID ||
    process.env.BLOB_READ_WRITE_TOKEN ||
    process.env.VERCEL_OIDC_TOKEN
  ));
}

export function blobAuthInfo(){
  return {
    sdkAvailable:Boolean(blob?.put && blob?.get && blob?.list),
    storeIdConfigured:Boolean(process.env.BLOB_STORE_ID),
    readWriteTokenConfigured:Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    oidcEnvConfigured:Boolean(process.env.VERCEL_OIDC_TOKEN),
    authMode:process.env.BLOB_READ_WRITE_TOKEN ? "read-write-token" : (process.env.BLOB_STORE_ID ? "vercel-oidc/store" : (process.env.VERCEL_OIDC_TOKEN ? "vercel-oidc-env" : "not-configured"))
  };
}
function requireBlob(){
  if(!blobConfigured()) throw new Error("Vercel Blob is not configured. Connect a Blob store to this project.");
  return blob;
}

export async function createPresignedPut(pathname,contentType="application/octet-stream"){
  const b=requireBlob();
  if(!b.presignUrl || !b.issueSignedToken) throw new Error("Vercel Blob signed upload is unavailable. Update @vercel/blob and connect a Blob store.");
  const token=await b.issueSignedToken({operations:["put"]});
  const {presignedUrl}=await b.presignUrl(token,{pathname,operation:"put",validUntil:Date.now()+15*60*1000,contentType});
  return presignedUrl;
}

export async function createPresignedGet(pathname,validMs=24*60*60*1000){
  const b=requireBlob();
  if(!b.presignUrl || !b.issueSignedToken) throw new Error("Vercel Blob signed read is unavailable.");
  const token=await b.issueSignedToken({operations:["get"]});
  const {presignedUrl}=await b.presignUrl(token,{pathname,operation:"get",validUntil:Date.now()+validMs});
  return presignedUrl;
}

export async function putPrivate(pathname,body,contentType="application/octet-stream",allowOverwrite=true){
  const b=requireBlob();
  const result=await b.put(pathname,body,{access:"private",addRandomSuffix:false,contentType,allowOverwrite});
  return result;
}

export async function publishFile(filePath,pathname,contentType="application/octet-stream"){
  if(!blobConfigured()) return null;
  const fs=await import("node:fs/promises");
  const data=await fs.readFile(filePath);
  const result=await blob.put(pathname,data,{access:"private",addRandomSuffix:false,contentType,allowOverwrite:true});
  return result||null;
}

export async function publishPrivateFile(filePath,pathname,contentType="application/octet-stream"){
  if(!blobConfigured()) return null;
  const fs=await import("node:fs/promises");
  return putPrivate(pathname,await fs.readFile(filePath),contentType,true);
}

export async function signedUrl(pathname,validMs=60*60*1000){
  return createPresignedGet(pathname,Math.min(validMs,7*24*60*60*1000));
}

export async function putPrivateFile(filePath,pathname,contentType="application/octet-stream"){
  const fs=await import("node:fs/promises");
  return putPrivate(pathname,await fs.readFile(filePath),contentType,true);
}

export async function headPrivate(pathname){
  const clean=String(pathname||"").trim();
  if(!clean) return null;
  const b=requireBlob();
  if(!b.head) throw new Error("Vercel Blob head() is unavailable. Update @vercel/blob.");
  try{
    return await b.head(clean);
  }catch(e){
    // Vercel Blob throws when the object is genuinely missing. Normalize that
    // case so callers can return a useful 404/409 instead of leaking the SDK
    // error text. Other authentication/network errors are preserved.
    const msg=String(e?.message||e||"");
    if(/does not exist|not found|404/i.test(msg)) return null;
    throw e;
  }
}

export async function waitForPrivateBlob(pathname, attempts=8, delayMs=350){
  const clean=String(pathname||"").trim();
  if(!clean) return null;
  for(let i=0;i<Math.max(1,attempts);i++){
    const meta=await headPrivate(clean);
    if(meta) return meta;
    if(i<attempts-1) await new Promise(r=>setTimeout(r,delayMs));
  }
  return null;
}

export async function readPrivate(pathname){
  const clean=String(pathname||"").trim();
  if(!clean) return null;
  const b=requireBlob();
  try{
    const result=await b.get(clean,{access:"private",useCache:false});
    if(!result) return null;
    return result;
  }catch(e){
    const msg=String(e?.message||e||"");
    if(/does not exist|not found|404/i.test(msg)) return null;
    throw e;
  }
}

export async function readPrivateJson(pathname){
  const result=await readPrivate(pathname);
  if(!result) return null;
  const text=await new Response(result.stream).text();
  return JSON.parse(text);
}

export async function writePrivateJson(pathname,value){
  return putPrivate(pathname,JSON.stringify(value,null,2),"application/json",true);
}

export async function downloadPrivateToFile(pathname,filePath){
  const result=await readPrivate(pathname);
  if(!result) throw new Error(`Blob object not found: ${pathname}`);
  const fs=await import("node:fs/promises");
  const buf=Buffer.from(await new Response(result.stream).arrayBuffer());
  await fs.writeFile(filePath,buf);
  return filePath;
}

export async function listPrivate(prefix="",limit=1000){
  const b=requireBlob();
  const all=[]; let cursor;
  do{
    const page=await b.list({prefix,limit,cursor});
    all.push(...(page.blobs||[]));
    cursor=page.hasMore?page.cursor:undefined;
  }while(cursor);
  return all;
}

export async function deleteBlob(pathname){
  const b=requireBlob();
  return b.del(pathname);
}
