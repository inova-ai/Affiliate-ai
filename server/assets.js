import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { ffmpegPath, ffprobePath } from "./media-tools.js";
import { dataDir, uploadDir } from "./storage.js";
import { blobConfigured, putPrivateFile, writePrivateJson, readPrivateJson, listPrivate, downloadPrivateToFile } from "./blob.js";

const execFileAsync = promisify(execFile);
export const assetDir = path.join(dataDir, "assets");
export const assetProfileDir = path.join(assetDir, "profiles");
export const assetReferenceDir = path.join(assetDir, "references");
for (const d of [assetDir, assetProfileDir, assetReferenceDir]) fs.mkdirSync(d, {recursive:true});

const minWidth = Number(process.env.ASSET_MIN_WIDTH || 512);
const minHeight = Number(process.env.ASSET_MIN_HEIGHT || 512);
const maxRefs = Math.max(1, Math.min(5, Number(process.env.MAX_REFERENCE_IMAGES || 5)));

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    const s = fs.createReadStream(file);
    s.on("data", d => h.update(d));
    s.on("end", () => resolve(h.digest("hex")));
    s.on("error", reject);
  });
}

async function probeImage(file) {
  try {
    const ffmpeg = ffmpegPath();
    const {stdout} = await execFileAsync(ffmpeg, [
      "-v","error","-select_streams","v:0","-show_entries","stream=width,height,pix_fmt",
      "-of","json",file
    ], {timeout:30000});
    const data = JSON.parse(stdout || "{}");
    const s = data.streams?.[0] || {};
    return {width:Number(s.width||0), height:Number(s.height||0), pixelFormat:s.pix_fmt||null};
  } catch {
    return {width:0,height:0,pixelFormat:null};
  }
}

async function normalizeImage(input, output) {
  const ffmpeg = ffmpegPath();
  await execFileAsync(ffmpeg, [
    "-y","-i",input,
    "-vf","scale=1024:1024:force_original_aspect_ratio=decrease,pad=1024:1024:(ow-iw)/2:(oh-ih)/2:color=black@0",
    "-frames:v","1","-q:v","2",output
  ], {timeout:60000});
  return output;
}

export async function validateAsset(file) {
  if (!file || !fs.existsSync(file)) return {valid:false, errors:["Asset file not found."]};
  const stat = fs.statSync(file);
  const meta = await probeImage(file);
  const errors = [];
  if (meta.width < minWidth || meta.height < minHeight) errors.push(`Reference resolution is ${meta.width}x${meta.height}; minimum is ${minWidth}x${minHeight}.`);
  if (stat.size < 512) errors.push("Reference file is too small.");
  return {
    valid: errors.length === 0,
    errors,
    size: stat.size,
    width: meta.width,
    height: meta.height,
    pixelFormat: meta.pixelFormat,
    qualityGate: {
      oneSubject: "manual-confirmation",
      centered: "manual-confirmation",
      unobstructed: "manual-confirmation",
      adequateResolution: meta.width >= minWidth && meta.height >= minHeight,
      severeBlur: "manual-confirmation"
    }
  };
}

export function consistencyPrompt(profile) {
  if (!profile) return "";
  const m = profile.metadata || {};
  const kind = profile.kind === "character" ? "character/person" : "product";
  const refs = (profile.references || []).length;
  return [
    `CONSISTENCY PROFILE LOCK — ${kind}.`,
    `Reference profile ID: ${profile.id}.`,
    `Use the supplied reference as the same ${kind} throughout every shot and segment.`,
    `Preserve identity/geometry, proportions, materials, colors, wardrobe and distinctive visual details.`,
    m.name ? `Known name: ${m.name}.` : "",
    m.colors ? `Known colors (user supplied): ${m.colors}.` : "",
    m.shape ? `Known shape/form notes (user supplied): ${m.shape}.` : "",
    m.logoText ? `Known logo/text (user supplied): ${m.logoText}. Do not invent or mutate it.` : "",
    m.wardrobe ? `Known wardrobe (user supplied): ${m.wardrobe}.` : "",
    refs ? `Reference set contains ${refs} image(s).` : "",
    "Do not change the subject into a different product/person; avoid geometry drift, extra limbs, warped logos, duplicate subjects, sudden wardrobe changes or unexplained color changes."
  ].filter(Boolean).join(" ");
}

function persistentProfile(profile){
  const clean=JSON.parse(JSON.stringify(profile));
  delete clean.originalFile;
  delete clean.normalizedFile;
  clean.references=(clean.references||[]).map(r=>{const x={...r};delete x.file;return x;});
  return clean;
}

async function persistProfile(profile){
  const clean=persistentProfile(profile);
  if(!blobConfigured()){
    if(process.env.VERCEL) throw new Error("Vercel Blob is required for persistent profiles. Connect a Blob store to this project.");
    fs.writeFileSync(path.join(assetProfileDir, `${profile.id}.json`), JSON.stringify(clean, null, 2));
    return profile;
  }
  await writePrivateJson(`luxmotion/profiles/${profile.id}.json`, clean);
  return profile;
}

async function materializeProfile(profile){
  if(!profile) return null;
  if(!blobConfigured()) return profile;
  const dir=path.join(assetReferenceDir,profile.id);
  fs.mkdirSync(dir,{recursive:true});
  if(profile.originalBlobPath){
    const ext=path.extname(profile.originalName||profile.originalBlobPath)||".bin";
    const f=path.join(dir,`original${ext.toLowerCase()}`);
    try{await downloadPrivateToFile(profile.originalBlobPath,f); profile.originalFile=f;}catch{}
  }
  if(profile.normalizedBlobPath){
    const f=path.join(dir,"normalized.jpg");
    try{await downloadPrivateToFile(profile.normalizedBlobPath,f); profile.normalizedFile=f;}catch{}
  }
  for(const r of profile.references||[]){
    if(r.blobPath){
      const ext=path.extname(r.originalName||r.blobPath)||".bin";
      const f=path.join(dir,`reference-${crypto.createHash("sha1").update(r.blobPath).digest("hex").slice(0,12)}${ext.toLowerCase()}`);
      try{await downloadPrivateToFile(r.blobPath,f); r.file=f;}catch{}
    }
  }
  return profile;
}

export async function createProfile({file, kind="product", originalName="", metadata={}, runwayUri=null}) {
  const id=crypto.randomUUID();
  const refsDir=path.join(assetReferenceDir,id);
  fs.mkdirSync(refsDir,{recursive:true});
  const validation=await validateAsset(file);
  const hash=await hashFile(file);
  const originalExt=path.extname(originalName||file)||".bin";
  const originalCopy=path.join(refsDir,`original${originalExt.toLowerCase()}`);
  fs.copyFileSync(file,originalCopy);
  const normalized=path.join(refsDir,"normalized.jpg");
  let normalizedOk=false;
  try{await normalizeImage(file,normalized); normalizedOk=true;}catch{}

  const profile={
    id,kind:kind==="character"?"character":"product",createdAt:new Date().toISOString(),originalName,
    originalBlobPath:null,normalizedBlobPath:null,runwayUri:runwayUri||null,sha256:hash,
    metadata:{name:metadata.name||"",colors:metadata.colors||"",shape:metadata.shape||"",logoText:metadata.logoText||"",wardrobe:metadata.wardrobe||""},
    qualityGate:validation,references:[],lockedPrompt:""
  };
  if(blobConfigured()){
    profile.originalBlobPath=`luxmotion/profiles/${id}/original${originalExt.toLowerCase()}`;
    await putPrivateFile(originalCopy,profile.originalBlobPath,"application/octet-stream");
    if(normalizedOk){
      profile.normalizedBlobPath=`luxmotion/profiles/${id}/normalized.jpg`;
      await putPrivateFile(normalized,profile.normalizedBlobPath,"image/jpeg");
    }
  }else if(process.env.VERCEL){
    throw new Error("Vercel Blob is required for persistent profiles. Connect a Blob store to this project.");
  }
  profile.references=normalizedOk?[{type:"normalized",blobPath:profile.normalizedBlobPath||null,file:normalizedOk?normalized:null}]:[];
  profile.lockedPrompt=consistencyPrompt(profile);
  await persistProfile(profile);
  return profile;
}

export async function readProfile(id){
  if(!id) return null;
  if(blobConfigured()){
    try{
      const p=await readPrivateJson(`luxmotion/profiles/${id}.json`);
      return p?await materializeProfile(p):null;
    }catch(e){if(process.env.VERCEL) throw e;}
  }
  const file=path.join(assetProfileDir,`${id}.json`);
  if(!fs.existsSync(file)) return null;
  try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return null;}
}

export async function listProfiles(){
  if(blobConfigured()){
    const blobs=await listPrivate("luxmotion/profiles/");
    const profiles=[];
    for(const b of blobs){
      if(!/^luxmotion\/profiles\/[^/]+\.json$/.test(b.pathname)) continue;
      try{const p=await readPrivateJson(b.pathname);if(p)profiles.push(p);}catch{}
    }
    return profiles.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  }
  return fs.readdirSync(assetProfileDir).filter(x=>x.endsWith(".json")).map(x=>{try{return JSON.parse(fs.readFileSync(path.join(assetProfileDir,x),"utf8"))}catch{return null}}).filter(Boolean).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function addReference(profileId,file,{type="additional",originalName=""}={}){
  const profile=await readProfile(profileId);
  if(!profile) throw new Error("Asset profile not found.");
  if((profile.references||[]).length>=maxRefs) throw new Error(`Maximum ${maxRefs} reference images per profile.`);
  const dir=path.join(assetReferenceDir,profileId);fs.mkdirSync(dir,{recursive:true});
  const ext=path.extname(originalName||file)||".bin";
  const refFile=path.join(dir,`reference-${Date.now()}${ext.toLowerCase()}`);fs.copyFileSync(file,refFile);
  const validation=await validateAsset(file);
  const ref={type,originalName,validation,blobPath:null,file:refFile};
  if(blobConfigured()){
    ref.blobPath=`luxmotion/profiles/${profileId}/references/${crypto.randomUUID()}${ext.toLowerCase()}`;
    await putPrivateFile(refFile,ref.blobPath,"application/octet-stream");
  }else if(process.env.VERCEL){
    throw new Error("Vercel Blob is required for persistent profile references.");
  }
  profile.references=[...(profile.references||[]),ref];
  profile.lockedPrompt=consistencyPrompt(profile);
  await persistProfile(profile);
  return profile;
}

export function profileReferenceFiles(profile){
  if(!profile) return [];
  return (profile.references||[]).map(r=>r.file).filter(Boolean).filter(fs.existsSync);
}

export const MAX_REFERENCE_IMAGES=maxRefs;
