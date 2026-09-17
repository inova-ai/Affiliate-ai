import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { ffmpegPath, ffprobePath } from "./media-tools.js";
import { dataDir } from "./storage.js";
const execFileAsync=promisify(execFile);

const ffmpeg=ffmpegPath();
const workDir=path.join(dataDir,"smart-qc");
fs.mkdirSync(workDir,{recursive:true});

function hammingHex(a,b){
  if(!a||!b||a.length!==b.length) return null;
  let n=0;
  for(let i=0;i<a.length;i++){
    let x=parseInt(a[i],16)^parseInt(b[i],16);
    while(x){n+=x&1;x>>>=1;}
  }
  return n;
}

async function imageHash(file){
  // Resize to a tiny grayscale image and hash raw pixels. This is a
  // deterministic visual fingerprint, not face recognition or semantic identity.
  const tmp=path.join(workDir,crypto.randomUUID()+".pgm");
  try{
    await execFileAsync(ffmpeg,["-y","-i",file,"-vf","scale=32:32,format=gray","-frames:v","1","-f","image2",tmp],{timeout:30000});
    const data=fs.readFileSync(tmp);
    return crypto.createHash("sha256").update(data).digest("hex").slice(0,32);
  }finally{try{fs.unlinkSync(tmp)}catch{}}
}

async function extractFrames(video,maxFrames=8){
  const dir=path.join(workDir,crypto.randomUUID()); fs.mkdirSync(dir,{recursive:true});
  try{
    const count=Math.max(1,Number(maxFrames)||8);
    await execFileAsync(ffmpeg,["-y","-i",video,"-vf",`fps=1,scale=640:-2`,"-frames:v",String(count),path.join(dir,"frame-%03d.jpg")],{timeout:120000});
    return fs.readdirSync(dir).filter(x=>x.endsWith(".jpg")).sort().map(x=>path.join(dir,x));
  }catch{return []}
}

async function semanticProvider(payload){
  const url=process.env.VISION_QC_URL;
  if(!url) return {available:false,action:"manual-review",reason:"VISION_QC_URL is not configured."};
  const headers={"content-type":"application/json"};
  if(process.env.VISION_QC_API_KEY) headers.authorization=`Bearer ${process.env.VISION_QC_API_KEY}`;
  try{
    const controller=new AbortController(); const t=setTimeout(()=>controller.abort(),120000);
    const r=await fetch(url,{method:"POST",headers,body:JSON.stringify(payload),signal:controller.signal});
    clearTimeout(t);
    const text=await r.text(); let data; try{data=JSON.parse(text)}catch{data={raw:text}};
    if(!r.ok) return {available:false,action:"manual-review",reason:`Vision provider HTTP ${r.status}`,provider:data};
    return {available:true,...data};
  }catch(e){return {available:false,action:"manual-review",reason:e.message};}
}

export async function smartVisualQC({video,referenceImages=[],product="",character="",prompt="",maxFrames=8}){
  const frames=await extractFrames(video,maxFrames);
  const refFiles=(referenceImages||[]).filter(Boolean).filter(fs.existsSync);
  const refHashes=[];
  for(const f of refFiles){try{refHashes.push({file:f,hash:await imageHash(f)})}catch{}}
  const frameHashes=[];
  for(const f of frames){try{frameHashes.push({file:f,hash:await imageHash(f)})}catch{}}

  const pairScores=[];
  for(const frame of frameHashes){
    const distances=refHashes.map(ref=>hammingHex(frame.hash,ref.hash)).filter(v=>v!==null);
    if(distances.length) pairScores.push({frame:frame.file,minDistance:Math.min(...distances),maxDistance:Math.max(...distances)});
  }
  const threshold=Number(process.env.PHASH_HAMMING_THRESHOLD||120);
  const deterministic = pairScores.length ? {
    available:true,
    threshold,
    framesChecked:pairScores.length,
    referenceCount:refHashes.length,
    scores:pairScores,
    // A perceptual hash can flag large visual drift but cannot establish identity.
    action: pairScores.every(x=>x.minDistance<=threshold) ? "pass-signal" : "drift-signal"
  } : {available:false,action:"manual-review",reason:"No usable reference/frame hashes."};

  const semantic=await semanticProvider({
    task:"visual-consistency-qc",
    product,character,prompt,
    checks:["product-similarity","character-continuity","logo-text-integrity","geometry-deformation","blur-artifacts","shot-continuity"],
    note:"Return structured evidence and scores only; do not claim identity recognition unless the provider actually supports it.",
  });

  let action="manual-review";
  if(semantic.available){
    if(semantic.pass===true) action="pass";
    else if(semantic.pass===false) action="fail";
  }else if(deterministic.action==="pass-signal"){
    action="pass-signal";
  }else if(deterministic.action==="drift-signal"){
    action="drift-signal";
  }

  return {available:semantic.available||deterministic.available,action,deterministic,semantic,
    frames:frames.length,referenceImages:refFiles.length,
    limitation:"Deterministic hashing is a drift signal, not facial/product identity recognition."};
}
