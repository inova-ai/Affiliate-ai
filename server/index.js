import { createShotPlan } from './shot-planner.js';
import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {fileURLToPath} from "url";
import {execFile} from "child_process";
import {promisify} from "util";
import {ffmpegPath, ffprobePath, mediaToolInfo} from "./media-tools.js";
import {blobConfigured, blobAuthInfo, createPresignedPut, createPresignedGet, publishFile, signedUrl, headPrivate, readPrivate, downloadPrivateToFile} from "./blob.js";
import {buildStoryboard} from "./storyboard.js";
import {routeModel,estimate,runwayRender,runwayMotionTransfer,runwayMotionCreate,runwayMotionStatus,uploadEphemeral} from "./providers.js";
import {renderProject,makeConcatList} from "./pipeline.js";
import {mediaQC,lockedPrompt,retryDecision} from "./qc.js";
import {visualQC,visualRetryDecision} from "./visual-qc.js";
import {dataDir,uploadDir,renderDir,projectDir,publicMediaUrl,downloadToFile,safeName,readProject,listProjects,writeProject} from "./storage.js";
import {upscale4K} from "./delivery.js";
import {runProduction,deliverProduction4K} from "./production.js";
import {createProgress,getProgress,subscribeProgress,updateProgress} from "./progress.js";
import {createProfile,readProfile,listProfiles,addReference,validateAsset,profileReferenceFiles} from "./assets.js";
import {smartVisualQC} from "./smart-visual-qc.js";

const execFileAsync=promisify(execFile);
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(), PORT=process.env.PORT||8787;

function requestRunwayKey(req){ return String(req.headers["x-luxmotion-runway-key"]||req.body?.runwayApiKey||process.env.RUNWAYML_API_SECRET||process.env.RUNWAY_API_KEY||"").trim(); }
function keySource(req){ return requestRunwayKey(req) ? (req.headers["x-luxmotion-runway-key"]||req.body?.runwayApiKey ? "browser" : "environment") : "none"; }
function runwayBridgeSecret(){
  return String(process.env.RUNWAY_ASSET_BRIDGE_SECRET||process.env.RUNWAYML_API_SECRET||process.env.RUNWAY_API_KEY||"").trim();
}
function runwayBridgeSignature(pathname,expires){
  return crypto.createHmac("sha256",runwayBridgeSecret()).update(`${pathname}\n${expires}`).digest("hex");
}
function runwayBridgeUrl(req,pathname,ttlMs=15*60*1000){
  const expires=Date.now()+ttlMs;
  const sig=runwayBridgeSignature(pathname,expires);
  const proto=String(req.headers["x-forwarded-proto"]||"https").split(",")[0].trim();
  return `${proto}://${req.headers.host}/api/runway-asset?pathname=${encodeURIComponent(pathname)}&expires=${expires}&sig=${sig}`;
}
function validRunwayBridge(pathname,expires,sig){
  if(!pathname||!sig||!runwayBridgeSecret()) return false;
  const exp=Number(expires); if(!Number.isFinite(exp)||exp<Date.now()) return false;
  const expected=runwayBridgeSignature(pathname,exp);
  const a=Buffer.from(expected), b=Buffer.from(String(sig));
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}


async function profilePrimaryUrl(profile){
  const pathname=profile?.normalizedBlobPath||profile?.originalBlobPath||null;
  if(pathname && blobConfigured()) return await signedUrl(pathname,30*60*1000);
  return profile?.runwayUri||null;
}

app.use(cors()); app.use(express.json({limit:"3mb"})); app.use(express.static(path.join(__dirname,"..","public")));
app.use("/media",express.static(renderDir));
const upload=multer({dest:uploadDir,limits:{fileSize:3*1024*1024}});
const profileUpload=multer({dest:uploadDir,limits:{fileSize:3*1024*1024}});
const motionUpload=multer({dest:uploadDir,limits:{fileSize:200*1024*1024}});

app.get("/api/health",async(req,res)=>{
 let ffmpeg=false,ffprobe=false;
 try{await execFileAsync(ffmpegPath(),["-version"],{timeout:5000});ffmpeg=true}catch{}
 try{await execFileAsync(ffprobePath(),["-version"],{timeout:5000});ffprobe=true}catch{}
 let blobReachable=false,blobError=null;
 if(blobConfigured()){
   try{const {listPrivate}=await import("./blob.js"); await listPrivate("luxmotion/",1); blobReachable=true;}catch(e){blobError=e.message;}
 }
 const rk=requestRunwayKey(req);
 res.json({ok:true,version:"18.3.3",runtime:"node24",runwayConfigured:Boolean(rk),runwayKeySource:keySource(req),ffmpegConfigured:ffmpeg,ffprobeConfigured:ffprobe,mediaTools:mediaToolInfo(),blobConfigured:blobConfigured(),blobAuth:blobAuthInfo(),blobReachable,durablePersistence:Boolean(blobConfigured()&&blobReachable),blobError,persistencePaths:{profiles:"luxmotion/profiles/*.json",projects:"luxmotion/projects/*.json",profileAssets:"luxmotion/profiles/<id>/*",media:"luxmotion/renders/*"},visualQCConfigured:Boolean(process.env.VISION_QC_URL),strictVisualQC:String(process.env.STRICT_VISUAL_QC||"false").toLowerCase()==="true"});
});

app.post("/api/plan",(req,res)=>{
 const b=req.body||{}; res.json({ok:true,storyboard:buildStoryboard(b)});
});
app.post("/api/estimate",(req,res)=>{
 const b=req.body||{}; res.json({ok:true,estimate:estimate(b.mode||"balanced",b.duration||10)});
});
app.post("/api/blob/presign",async(req,res)=>{
  try{
    if(!blobConfigured()) return res.status(503).json({ok:false,error:"Vercel Blob is not configured. Connect a Blob store to this project."});
    const filename=String(req.body?.filename||"asset.bin").replace(/[^a-zA-Z0-9._-]/g,"_");
    const contentType=String(req.body?.contentType||"application/octet-stream");
    const pathname=`luxmotion/uploads/${crypto.randomUUID()}-${filename}`;
    const url=await createPresignedPut(pathname,contentType);
    res.json({ok:true,url,pathname});
  }catch(e){res.status(503).json({ok:false,error:"Blob presign failed",detail:e.message});}
});

app.post("/api/blob/read-url",async(req,res)=>{
  try{
    if(!blobConfigured()) return res.status(503).json({ok:false,error:"Vercel Blob is not configured."});
    const pathname=String(req.body?.pathname||"").trim(); if(!pathname) return res.status(400).json({ok:false,error:"pathname is required"});
    const url=await createPresignedGet(pathname); res.json({ok:true,url,note:"Browser GET only. For Runway inputs use a Blob pathname with /api/motion-transfer/runway; Runway probes URLs with HEAD."});
  }catch(e){res.status(503).json({ok:false,error:"Blob read URL failed",detail:e.message});}
});

app.post("/api/runway/upload-init",async(req,res)=>{
 try{
   const filename=String(req.body?.filename||"").trim();
   const contentType=String(req.body?.contentType||"application/octet-stream");
   if(!filename) return res.status(400).json({ok:false,error:"filename is required"});
   const result=await createRunwayEphemeralUpload(filename,contentType,requestRunwayKey(req));
   res.status(result.ok?200:503).json(result);
 }catch(e){res.status(503).json({ok:false,error:"Direct upload preparation failed",detail:e.message});}
});

app.post("/api/upload-from-url",async(req,res)=>{
  const url=String(req.body?.url||"").trim();
  const pathname=String(req.body?.pathname||"").trim();
  const originalName=String(req.body?.originalName||"asset.bin");
  const kind=req.body?.kind==="character"?"character":"product";
  const file=path.join(uploadDir,`${crypto.randomUUID()}-${safeName(originalName)}`);
  try{
    if(pathname){
      const {downloadPrivateToFile}=await import("./blob.js");
      await downloadPrivateToFile(pathname,file);
    }else if(/^https:\/\//i.test(url)){
      await downloadToFile(url,file);
    }else return res.status(400).json({ok:false,error:"A Blob pathname or public HTTPS asset URL is required."});
    const profile=await createProfile({file,kind,originalName,metadata:{name:req.body?.name||""},runwayUri:null});
    let runway=null;
    if(requestRunwayKey(req)){
      const up=await uploadEphemeral(file,originalName,requestRunwayKey(req));
      if(up.ok) runway={ok:true,uri:up.uri,source:"runway-ephemeral-upload",expiresInHours:24};
      else runway={ok:false,source:"runway-ephemeral-upload",error:up};
    }
    res.json({ok:true,files:{asset:{path:file,originalName,mimeType:req.body?.mimeType||"application/octet-stream",size:fs.statSync(file).size,runway}},profile});
  }catch(e){res.status(502).json({ok:false,error:"Remote asset import failed",detail:e.message});}
});

app.post("/api/upload",upload.fields([
 {name:"product",maxCount:5},{name:"person",maxCount:5},{name:"motionReference",maxCount:1}
]),async(req,res)=>{
 const files={};
 try{
   for(const[k,a]of Object.entries(req.files||{})){
     const f=a?.[0]; if(!f) continue;
     const item={path:f.path,originalName:f.originalname,mimeType:f.mimetype,size:f.size};
     files[k]=item;
     if(k==="product"||k==="person"){
       item.profile=await createProfile({
         file:f.path,kind:k==="person"?"character":"product",originalName:f.originalname,
         metadata:{name:req.body?.productName||req.body?.characterName||""},runwayUri:item.runway?.uri||null
       });
       if(requestRunwayKey(req)) {
         const u=await profilePrimaryUrl(item.profile);
         item.runway=u?{ok:true,uri:u,source:"vercel-blob-signed-url",expiresInMinutes:30}:null;
       }
     }
   }
   res.json({ok:true,files,note:"Assets persist in Vercel Blob; Runway receives short-lived signed HTTPS URLs instead of browser-side ephemeral uploads."});
 }catch(e){
   res.status(400).json({ok:false,error:"Asset upload/profile creation failed",detail:e.message});
 }
});

app.get("/api/assets",async(req,res)=>{try{res.json({ok:true,profiles:await listProfiles()});}catch(e){res.status(503).json({ok:false,error:"profiles unavailable",detail:e.message});}});

app.get("/api/assets/:id",async(req,res)=>{
 try{const p=await readProfile(req.params.id); if(!p) return res.status(404).json({ok:false,error:"asset profile not found"}); res.json({ok:true,profile:p});}
 catch(e){res.status(503).json({ok:false,error:"asset profile read failed",detail:e.message});}
});

app.post("/api/assets/profile",profileUpload.single("file"),async(req,res)=>{
 if(!req.file) return res.status(400).json({ok:false,error:"file is required"});
 try{
   const profile=await createProfile({
     file:req.file.path,kind:req.body?.kind||"product",originalName:req.file.originalname,
     metadata:{name:req.body?.name,colors:req.body?.colors,shape:req.body?.shape,logoText:req.body?.logoText,wardrobe:req.body?.wardrobe},
     runwayUri:null
   });
   res.json({ok:true,profile});
 }catch(e){res.status(400).json({ok:false,error:"profile creation failed",detail:e.message});}
});

app.post("/api/assets/reference",profileUpload.single("file"),async(req,res)=>{
 if(!req.file||!req.body?.profileId) return res.status(400).json({ok:false,error:"profileId and file are required"});
 try{
   const profile=await addReference(req.body.profileId,req.file.path,{type:req.body.type||"additional",originalName:req.file.originalname});
   res.json({ok:true,profile});
 }catch(e){res.status(400).json({ok:false,error:"reference add failed",detail:e.message});}
});

app.post("/api/assets/validate",profileUpload.single("file"),async(req,res)=>{
 if(!req.file) return res.status(400).json({ok:false,error:"file is required"});
 try{res.json({ok:true,validation:await validateAsset(req.file.path)});}
 catch(e){res.status(400).json({ok:false,error:"validation failed",detail:e.message});}
});


async function validateMotionReference(file){
 const ffprobe=ffprobePath();
 try{ const {stdout}=await execFileAsync(ffprobe,["-v","error","-select_streams","v:0","-show_entries","stream=width,height,duration","-of","json",file],{timeout:15000}); const st=JSON.parse(stdout||"{}").streams?.[0]; if(!st) throw new Error("Video referensi tidak memiliki video stream yang valid."); const width=Number(st.width||0),height=Number(st.height||0),duration=Number(st.duration||0); if(width<480||height<480) throw new Error(`Video referensi minimal 480p. Terdeteksi ${width}x${height}.`); if(duration<=0) throw new Error("Durasi video referensi tidak dapat dibaca."); if(duration>30) throw new Error(`Video referensi maksimal 30 detik. Terdeteksi ${duration.toFixed(1)} detik.`); return {width,height,duration}; }
 catch(e){ if(e.code==="ENOENT") return {warning:"ffprobe tidak tersedia; validasi resolusi/durasi dilewati."}; throw e; }
}

function safeAssetName(name,fallback){
 const base=path.basename(String(name||fallback||"asset.bin"));
 return base.replace(/[^a-zA-Z0-9._-]/g,"_") || fallback;
}

async function normalizeRunwayImage(input, output){
 const ffmpeg=ffmpegPath();
 await execFileAsync(ffmpeg,["-y","-i",input,"-frames:v","1","-vf","scale=min(2048\,iw):-2","-q:v","2",output],{timeout:60000});
 return output;
}

async function normalizeRunwayVideo(input, output){
 const ffmpeg=ffmpegPath();
 await execFileAsync(ffmpeg,["-y","-i",input,"-vf","scale=min(1280\,iw):-2","-c:v","libx264","-preset","veryfast","-crf","20","-pix_fmt","yuv420p","-c:a","aac","-b:a","128k","-movflags","+faststart",output],{timeout:180000});
 return output;
}

async function createRunwayEphemeralUpload(filename, contentType="application/octet-stream", apiKey){
 const safe=String(filename||"asset.bin").replace(/[^a-zA-Z0-9._-]/g,"_");
 if(!blobConfigured()) return {ok:false,code:"BLOB_REQUIRED",message:"Vercel Blob must be connected for direct browser uploads."};
 const pathname=`luxmotion/uploads/${crypto.randomUUID()}-${safe}`;
 const uploadUrl=await createPresignedPut(pathname,contentType);
 return {ok:true,uploadUrl,pathname,uploadMode:"vercel-blob",message:"Upload file to the returned Vercel Blob URL, then use /api/blob/read-url to obtain a Runway-compatible HTTPS URL."};
}

app.post('/api/runway/test',async(req,res)=>{
 const secret=requestRunwayKey(req);
 if(!secret) return res.status(400).json({ok:false,code:'RUNWAY_API_KEY_MISSING',error:'Masukkan Runway API key terlebih dahulu.'});
 try{
   const r=await fetch(`https://api.dev.runwayml.com/v1/tasks/${crypto.randomUUID()}`,{headers:{Authorization:`Bearer ${secret}`,"X-Runway-Version":process.env.RUNWAY_API_VERSION||'2024-11-06'}});
   const body=await r.json().catch(()=>({}));
   if(r.status===404) return res.json({ok:true,status:'connected',message:'Runway API key valid dan server berhasil terhubung.',source:keySource(req)});
   if(r.status===401||r.status===403) return res.status(401).json({ok:false,status:'invalid',error:'API key Runway ditolak (401/403).',detail:body?.error||body?.message||null});
   return res.status(r.ok?200:502).json({ok:r.ok,status:r.ok?'connected':'error',httpStatus:r.status,detail:body?.error||body?.message||body});
 }catch(e){return res.status(502).json({ok:false,status:'network_error',error:'Tidak bisa menghubungi Runway API.',detail:e.message});}
});

app.all("/api/runway-asset",async(req,res)=>{
  const pathname=String(req.query?.pathname||"");
  const expires=String(req.query?.expires||"");
  const sig=String(req.query?.sig||"");
  if(!validRunwayBridge(pathname,expires,sig)) return res.status(403).send("Forbidden");
  try{
    if(req.method==="HEAD") {
      const meta=await headPrivate(pathname);
      if(!meta) return res.status(404).end();
      res.status(200).set({"Content-Type":meta.contentType||"application/octet-stream","Content-Length":String(meta.size),"Cache-Control":"no-store"});
      return res.end();
    }
    if(req.method!=="GET") return res.status(405).set("Allow","GET, HEAD").end();
    const result=await readPrivate(pathname);
    if(!result || result.statusCode!==200) return res.status(404).end();
    res.status(200).set({"Content-Type":result.blob?.contentType||"application/octet-stream","Cache-Control":"no-store"});
    if(result.blob?.size!=null) res.setHeader("Content-Length",String(result.blob.size));
    return result.stream.pipeTo(new WritableStream({write(chunk){res.write(Buffer.from(chunk));},close(){res.end();},abort(err){res.destroy(err);}})).catch(err=>{try{res.destroy(err);}catch{}});
  }catch(e){ return res.status(404).send("Not found"); }
});

app.post("/api/motion-transfer/runway",async(req,res)=>{
 const b=req.body||{};
 const sourcePath=String(b.sourceImagePath||"").trim();
 const referencePath=String(b.motionReferencePath||"").trim();
 if((!sourcePath && !b.sourceImageUri)||(!referencePath && !b.motionReferenceUri)) return res.status(400).json({ok:false,error:"sourceImagePath/sourceImageUri and motionReferencePath/motionReferenceUri are required"});
 try{
   const apiKey=requestRunwayKey(req);
   if(!apiKey) return res.status(503).json({ok:false,error:"RUNWAYML_API_SECRET is not configured."});
   let promptImage=String(b.sourceImageUri||"").trim();
   let referenceVideo=String(b.motionReferenceUri||"").trim();
   const bridgeMeta={};
   const tempFiles=[];
   try{
     // Blob-backed inputs are downloaded server-side and uploaded to Runway's
     // ephemeral object storage. This avoids Runway needing to reach a Vercel
     // Function URL (which can be blocked by deployment protection/WAF) and
     // guarantees explicit filenames/content types via SDK toFile().
     if(sourcePath){
       if(!blobConfigured()) return res.status(503).json({ok:false,error:"Vercel Blob is required for Blob-backed Runway assets."});
       const meta=await headPrivate(sourcePath);
       const contentType=String(meta?.contentType||"");
       if(!/^image\/(jpeg|png|webp)$/.test(contentType)) return res.status(400).json({ok:false,error:"Source image Blob has unsupported Content-Type",detail:{contentType}});
       const ext=contentType==="image/png"?".png":contentType==="image/webp"?".webp":".jpg";
       const local=path.join(uploadDir,`${crypto.randomUUID()}${ext}`); tempFiles.push(local);
       await downloadPrivateToFile(sourcePath,local);
       const up=await uploadEphemeral(local,`source-image${ext}`,apiKey);
       if(!up.ok) return res.status(502).json({ok:false,error:"Source image Runway upload failed",detail:up});
       promptImage=up.uri;
       bridgeMeta.sourceImage={bytes:Number(meta?.size||0),contentType,uriType:"runway-ephemeral",filename:`source-image${ext}`};
     }
     if(referencePath){
       if(!blobConfigured()) return res.status(503).json({ok:false,error:"Vercel Blob is required for Blob-backed Runway assets."});
       const meta=await headPrivate(referencePath);
       const contentType=String(meta?.contentType||"");
       if(!/^video\/(mp4|quicktime|webm|x-matroska|3gpp|ogg|x-msvideo|mpeg)$/.test(contentType)) return res.status(400).json({ok:false,error:"Motion reference Blob has unsupported Content-Type",detail:{contentType}});
       const ext=contentType==="video/quicktime"?".mov":contentType==="video/webm"?".webm":contentType==="video/x-matroska"?".mkv":".mp4";
       const local=path.join(uploadDir,`${crypto.randomUUID()}${ext}`); tempFiles.push(local);
       await downloadPrivateToFile(referencePath,local);
       const up=await uploadEphemeral(local,`motion-reference${ext}`,apiKey);
       if(!up.ok) return res.status(502).json({ok:false,error:"Motion reference Runway upload failed",detail:up});
       referenceVideo=up.uri;
       bridgeMeta.motionReference={bytes:Number(meta?.size||0),contentType,uriType:"runway-ephemeral",filename:`motion-reference${ext}`};
     }
     const result=await runwayMotionCreate({promptImage,referenceVideo,promptText:String(b.prompt||"").slice(0,15000),duration:Number(b.duration||5),format:b.format||"9:16",audio:Boolean(b.audio),apiKey});
     if(!result.ok) return res.status(502).json({...result,bridgeMeta});
     res.status(202).json({...result,bridgeMeta,message:"Runway task submitted. Poll /api/motion-transfer/runway/status/:taskId."});
   } finally {
     await Promise.all(tempFiles.map(f=>fs.promises.unlink(f).catch(()=>{})));
   }
 }catch(e){res.status(502).json({ok:false,error:"Motion transfer preparation failed",detail:e.message});}
});
app.get("/api/motion-transfer/runway/status/:taskId",async(req,res)=>{
 try{
   const result=await runwayMotionStatus(req.params.taskId,requestRunwayKey(req));
   if(!result.ok && result.status!=="failed") return res.status(502).json(result);
   if(result.status==="failed" || result.status==="canceled") return res.status(200).json(result);
   if(result.status!=="completed") return res.status(200).json(result);
   if(result.output?.[0] && blobConfigured()){
     const local=path.join(renderDir,`motion-${crypto.randomUUID()}.mp4`);
     try{
       await downloadToFile(result.output[0],local);
       const durable=await publishFile(local,`luxmotion/motion/${path.basename(local)}`,"video/mp4");
       if(durable){ result.durableOutput=await signedUrl(durable.pathname).catch(()=>null); result.durableBlobPath=durable.pathname; }
     } finally { await fs.promises.unlink(local).catch(()=>{}); }
   }
   return res.json(result);
 }catch(e){return res.status(502).json({ok:false,error:"Motion status failed",detail:e.message});}
});

app.post("/api/motion-transfer",motionUpload.fields([
 {name:"sourceImage",maxCount:1},{name:"motionReference",maxCount:1}
]),async(req,res)=>{
 const image=req.files?.sourceImage?.[0],video=req.files?.motionReference?.[0];
 if(!image||!video) return res.status(400).json({ok:false,error:"sourceImage and motionReference are required"});
 try{ const motionMeta=await validateMotionReference(video.path); const imgUp=await uploadEphemeral(image.path,image.originalname,requestRunwayKey(req)); if(!imgUp.ok) return res.status(502).json({ok:false,error:"Source image upload failed",detail:imgUp}); const vidUp=await uploadEphemeral(video.path,video.originalname,requestRunwayKey(req)); if(!vidUp.ok) return res.status(502).json({ok:false,error:"Motion reference upload failed",detail:vidUp}); const result=await runwayMotionTransfer({promptImage:imgUp.uri,referenceVideo:vidUp.uri,promptText:String(req.body?.prompt||"").slice(0,15000),duration:Number(req.body?.duration||5),format:req.body?.format||"9:16",audio:String(req.body?.audio||"false").toLowerCase()==="true",apiKey:requestRunwayKey(req)}); if(result.ok&&Array.isArray(result.output)&&result.output[0]&&blobConfigured()){try{const local=path.join(renderDir,`motion-${crypto.randomUUID()}.mp4`);await downloadToFile(result.output[0],local);const durable=await publishFile(local,`luxmotion/motion/${path.basename(local)}`,"video/mp4");if(durable){result.durableBlobPath=durable.pathname;result.durableOutput=await signedUrl(durable.pathname).catch(()=>null);}}catch(e){result.persistenceWarning=`Motion result could not be copied to Blob: ${e.message}`;}} res.status(result.ok?200:502).json({...result,sourceImage:image.originalname,motionReference:video.originalname,motionMeta}); }
 catch(e){ res.status(502).json({ok:false,error:"Motion transfer failed",detail:e.message}); }
});

app.post("/api/creative-kit",(req,res)=>{
 const {productName="produk",audience="pembeli online"}=req.body||{};
 res.json({ok:true,hook:`POV: kamu baru nemu ${productName} yang bikin ${audience} berhenti scroll.`,
 script:`Tunjukkan ${productName} dari detail utama, manfaat paling relevan, lalu CTA singkat.`,
 caption:`${productName} — detail yang bikin beda. ✨`,hashtags:["#affiliate","#fyp","#reviewproduk","#racunbelanja","#luxmotion"]});
});

app.post("/api/render",async(req,res)=>{
 const b=req.body||{}, id=crypto.randomUUID(), duration=Number(b.duration||10);
 const route=routeModel(b.mode||"balanced",duration), storyboard=buildStoryboard(b);
 const productProfile=b.productProfileId?await readProfile(b.productProfileId):null, characterProfile=b.characterProfileId?await readProfile(b.characterProfileId):null;
 const job={id,status:"queued",createdAt:new Date().toISOString(),mode:b.mode||"balanced",duration,route,
 storyboard,locks:{character:Boolean(b.characterLock),product:Boolean(b.productLock)},references:{productProfileId:productProfile?.id||null,characterProfileId:characterProfile?.id||null},
 qc:{enabled:Boolean(b.autoQC),maxRegenerations:2,status:"pending"},
 poseJob:b.threePose?{status:"provider-pending",instruction:"One image, three distinct poses, identity preserved.",identityLock:Boolean(b.characterLock)}:null,
 renderPlan:{shots:storyboard.map(s=>({shot:s.index,status:"pending",duration:s.duration}))}};
 // Attempt first provider call only when an image URL was supplied.
 if(b.imageUrl){
   const r=await runwayRender({promptImage:b.imageUrl,promptText:storyboard[0]?.prompt||"",duration:Math.min(10,duration),model:route.model,format:b.format||"9:16",apiKey:requestRunwayKey(req)});
   job.providerResponse=r;
   job.status=r.ok?"completed":"needs-provider";
   if(r.ok && r.output?.[0]) job.videoUrl=r.output[0];
 }
 await writeProject(job);
 res.json({ok:true,job});
});

app.get("/api/progress/:id",(req,res)=>{
 const p=getProgress(req.params.id);
 if(!p) return res.status(404).json({ok:false,error:"progress not found"});
 res.json({ok:true,progress:p});
});
app.get("/api/progress/:id/stream",(req,res)=>{
 if(!getProgress(req.params.id)) createProgress(req.params.id);
 subscribeProgress(req.params.id,res);
});

app.post("/api/auto-produce",async(req,res)=>{
 const b=req.body||{};
 if(!b.imageUrl && !b.productProfileId && !b.characterProfileId) return res.status(400).json({ok:false,error:"A primary imageUrl or asset profile is required"});
 const duration=Number(b.duration||10);
 if(![10,15,30].includes(duration)) return res.status(400).json({ok:false,error:"duration must be 10, 15, or 30"});
 const storyboard=buildStoryboard(b), id=crypto.randomUUID();
 createProgress(id);
 const productProfile=b.productProfileId?await readProfile(b.productProfileId):null;
 const characterProfile=b.characterProfileId?await readProfile(b.characterProfileId):null;
 if(b.productProfileId && !productProfile) return res.status(404).json({ok:false,error:"product profile not found"});
 if(b.characterProfileId && !characterProfile) return res.status(404).json({ok:false,error:"character profile not found"});
 const primaryUrl=b.imageUrl || await profilePrimaryUrl(productProfile) || await profilePrimaryUrl(characterProfile);
 const run=runProduction({
   id,storyboard,duration,imageUrl:primaryUrl,
   mode:b.mode||"balanced",format:b.format||"9:16",audio:b.audio!==false,product:b.product||"",character:b.character||"",
   productLock:b.productLock!==false,characterLock:Boolean(b.characterLock),autoQC:b.autoQC!==false,
   visualEnabled:b.visualQC!==false,maxRegenerations:b.maxRegenerations,
   productProfile,characterProfile,apiKey:requestRunwayKey(req)
 });
 if(process.env.VERCEL){
   const result=await run;
   return res.status(result.ok?200:502).json({ok:result.ok,id,status:result.project?.status||"failed",project:result.project,error:result.error||null});
 }
 run.catch(e=>updateProgress(id,{status:"failed",progress:99,stage:"Pipeline failed",message:e.message}));
 res.status(202).json({ok:true,id,status:"started",progressUrl:`/api/progress/${id}`,streamUrl:`/api/progress/${id}/stream`,references:{productProfileId:productProfile?.id||null,characterProfileId:characterProfile?.id||null}});
});


app.post("/api/deliver-project-4k",async(req,res)=>{
 const body=req.body||{}; const id=String(body.id||body.project?.id||"");
 if(!id) return res.status(400).json({ok:false,error:"id or project is required"});
 const file=path.join(projectDir,`${id}.json`);
 try{
   let project=body.project||null;
   if(!project && fs.existsSync(file)) project=JSON.parse(fs.readFileSync(file,"utf8"));
   if(!project) return res.status(404).json({ok:false,error:"project not found in this runtime. Send the returned project object or enable Vercel Blob."});
   if(project.masterUrl && (!project.masterFile || !fs.existsSync(project.masterFile))){
     project.masterFile=path.join(renderDir,`${id}-master-source.mp4`);
     await downloadToFile(project.masterUrl,project.masterFile);
   }
   const updated=await deliverProduction4K(project,requestRunwayKey(req));
   res.json({ok:true,project:updated});
 }catch(e){res.status(503).json({ok:false,error:"4K delivery failed",detail:e.message});}
});

app.post("/api/render-project",async(req,res)=>{
 const b=req.body||{};
 if(!b.imageUrl) return res.status(400).json({ok:false,error:"imageUrl is required"});
 const duration=Number(b.duration||10), storyboard=buildStoryboard(b), id=crypto.randomUUID();
 const project={id,status:"rendering",createdAt:new Date().toISOString(),mode:b.mode||"balanced",
   duration,format:b.format||"9:16",storyboard,segments:[]};
 await writeProject(project);
 const result=await renderProject({storyboard,duration,imageUrl:b.imageUrl,mode:b.mode||"balanced",format:b.format||"9:16",audio:b.audio!==false,product:b.product||"",character:b.character||"",
   productLock:b.productLock!==false,characterLock:Boolean(b.characterLock),maxRetries:2,apiKey:requestRunwayKey(req)});
 project.segments=result.results;
 project.status=result.ok?"generated":"partial-failure";
 await writeProject(project);
 res.status(result.ok?200:502).json({ok:result.ok,project});
});

app.post("/api/download-compose",async(req,res)=>{
 const {urls=[],outputName="luxmotion-final.mp4"}=req.body||{};
 if(!Array.isArray(urls)||!urls.length) return res.status(400).json({ok:false,error:"urls required"});
 const dir=path.join(dataDir,"renders"); fs.mkdirSync(dir,{recursive:true});
 const local=[];
 try{
   for(let i=0;i<urls.length;i++){
     const u=urls[i];
     if(!/^https?:\/\//i.test(u)) throw new Error("Only HTTPS/HTTP output URLs are accepted.");
     const r=await fetch(u);
     if(!r.ok) throw new Error(`Download failed for segment ${i+1}: HTTP ${r.status}`);
     const ext=u.split("?")[0].toLowerCase().endsWith(".webm")?".webm":".mp4";
     const f=path.join(dir,`${Date.now()}-${i}${ext}`);
     fs.writeFileSync(f,Buffer.from(await r.arrayBuffer())); local.push(f);
   }
   const list=path.join(dir,`concat-${Date.now()}.txt`);
   makeConcatList(local,list);
   const out=path.join(dir,outputName.replace(/[^a-zA-Z0-9._-]/g,"_"));
   const ffmpeg=ffmpegPath();
   try{
     await execFileAsync(ffmpeg,["-y","-f","concat","-safe","0","-i",list,"-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart",out],{timeout:300000});
   }catch(e){
     return res.status(503).json({ok:false,error:"FFmpeg composition failed.",detail:e.message});
   }finally{try{fs.unlinkSync(list)}catch{}}
   const published=await publishFile(out,`luxmotion/renders/${safeName(outputName)}`,"video/mp4").catch(()=>null);
   const publishedUrl=published?.pathname?await signedUrl(published.pathname).catch(()=>null):null;
   res.json({ok:true,output:publishedUrl||out,blobPath:published?.pathname||null,localOutput:out,segments:local});
 }catch(e){res.status(502).json({ok:false,error:e.message});}
});


app.post("/api/deliver-4k",async(req,res)=>{
 const b=req.body||{}; if(!b.file) return res.status(400).json({ok:false,error:"file required"});
 const out=path.join(renderDir,`luxmotion-4k-${Date.now()}.mp4`);
 try{ const result=await upscale4K(b.file,out,b.format||"9:16",requestRunwayKey(req)); const published=await publishFile(out,`luxmotion/renders/${path.basename(out)}`,"video/mp4").catch(()=>null); result.blobPath=published?.pathname||null; result.url=published?.pathname?await signedUrl(published.pathname).catch(()=>null):publicMediaUrl(req,out); res.json(result); }
 catch(e){res.status(503).json({ok:false,error:"4K delivery failed",detail:e.message});}
});

app.post("/api/qc-media",async(req,res)=>{
 const {file,expectedDuration,requireAudio=false}=req.body||{};
 if(!file) return res.status(400).json({ok:false,error:"file required"});
 const result=await mediaQC(file,{expectedDuration:Number(expectedDuration||0),requireAudio});
 res.json({ok:true,qc:result});
});

app.post("/api/consistency-prompt",(req,res)=>{
 const b=req.body||{};
 res.json({ok:true,prompt:lockedPrompt(b.prompt||"",b)});
});

app.post("/api/retry-plan",(req,res)=>{
 const b=req.body||{};
 res.json({ok:true,decision:retryDecision(b.qc||{pass:false},Number(b.attempt||0),Number(b.maxRetries||2))});
});

app.post("/api/render-shot",async(req,res)=>{
 const b=req.body||{};
 const route=routeModel(b.mode||"balanced",b.duration||5);
 if(!b.imageUrl) return res.status(400).json({ok:false,error:"imageUrl is required"});
 const result=await runwayRender({promptImage:b.imageUrl,promptText:b.prompt||"",duration:b.duration||5,model:route.model,format:b.format||"9:16",apiKey:requestRunwayKey(req)});
 res.status(result.ok?200:502).json(result);
});


app.post("/api/qc-visual",async(req,res)=>{
 const b=req.body||{}; if(!b.file) return res.status(400).json({ok:false,error:"file required"});
 try{ const result=await visualQC({video:b.file,referenceImage:b.referenceImage||false,product:b.product||"",character:b.character||"",prompt:b.prompt||"",fps:Number(b.fps||0.5),maxFrames:Number(b.maxFrames||8)}); res.json(result); }
 catch(e){res.status(503).json({ok:false,error:"Visual QC failed",detail:e.message});}
});
app.post("/api/qc-visual-retry",(req,res)=>{ const b=req.body||{}; res.json({ok:true,decision:visualRetryDecision(b.qc||{},{attempt:Number(b.attempt||0),maxRetries:Number(b.maxRetries||2)})}); });

app.post("/api/qc",(req,res)=>{
 const failed=(req.body?.checks||[]).filter(x=>x.pass===false);
 res.json({ok:true,status:failed.length?"regenerate":"pass",failed,
 action:failed.length?"Regenerate failed shot(s) while preserving locks.":"Pass automated rule set."});
});
app.post("/api/compose",async(req,res)=>{
 const {inputs=[],output}=req.body||{}; if(!inputs.length)return res.status(400).json({ok:false,error:"No inputs."});
 const out=output||path.join(dataDir,`final-${Date.now()}.mp4`), ffmpeg=process.env.FFMPEG_PATH||"ffmpeg";
 const list=path.join(dataDir,`concat-${Date.now()}.txt`);
 fs.writeFileSync(list,inputs.map(p=>`file '${String(p).replaceAll("'","'\\\\''")}'`).join("\n"));
 try{await execFileAsync(ffmpeg,["-y","-f","concat","-safe","0","-i",list,"-c","copy",out],{timeout:120000});
 res.json({ok:true,output:out});}catch(e){res.status(503).json({ok:false,error:"FFmpeg unavailable or incompatible inputs.",detail:e.message});
 }finally{try{fs.unlinkSync(list)}catch{}}
});

app.post("/api/qc-smart",upload.single("video"),async(req,res)=>{
 if(!req.file) return res.status(400).json({ok:false,error:"video is required"});
 try{
   const refs=(req.body?.referenceFiles||"").split(",").map(x=>x.trim()).filter(Boolean);
   const profileIds=(req.body?.profileIds||"").split(",").map(x=>x.trim()).filter(Boolean);
   const loadedProfiles=await Promise.all(profileIds.map(id=>readProfile(id)));
   const profileRefs=loadedProfiles.flatMap(p=>profileReferenceFiles(p));
   const result=await smartVisualQC({video:req.file.path,referenceImages:[...refs,...profileRefs],
     product:req.body?.product||"",character:req.body?.character||"",prompt:req.body?.prompt||"",maxFrames:Number(req.body?.maxFrames||8)});
   res.json({ok:true,result});
 }catch(e){res.status(400).json({ok:false,error:"smart visual QC failed",detail:e.message});}
});

app.get("/api/project/:id",async(req,res)=>{
 try{
   const project=await readProject(req.params.id);
   if(!project) return res.status(404).json({ok:false,error:"project not found"});
   const view={...project};
   if(view.masterBlobPath) view.masterUrl=await signedUrl(view.masterBlobPath).catch(()=>null);
   if(view.delivery4K?.blobPath) view.delivery4K={...view.delivery4K,url:await signedUrl(view.delivery4K.blobPath).catch(()=>null)};
   res.json({ok:true,project:view});
 }catch(e){res.status(503).json({ok:false,error:"project read failed",detail:e.message});}
});

app.get("/api/projects",async(req,res)=>{
 try{res.json({ok:true,projects:await listProjects()});}
 catch(e){res.status(503).json({ok:false,error:"projects unavailable",detail:e.message});}
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"..","public","index.html")));

app.post('/api/shot-plan',(req,res)=>{try{res.json({ok:true,plan:createShotPlan(req.body||{})});}catch(e){res.status(400).json({ok:false,error:e.message});}});
app.get('/api/shot-plan/health',(req,res)=>res.json({ok:true,engine:'intelligent-shot-planner',version:'v16'}));

app.use((err,req,res,next)=>{
  console.error("[LUXMOTION] request error:",err);
  if(res.headersSent) return next(err);
  res.status(Number(err?.status)||500).json({
    ok:false,
    error:"Internal server error",
    detail:process.env.NODE_ENV==="production" ? undefined : String(err?.message||err)
  });
});

export default app;
export { app };

if (!process.env.VERCEL) {
  app.listen(PORT,()=>console.log(`LUXMOTION AI v18.3.3 on http://localhost:${PORT}`));
}
