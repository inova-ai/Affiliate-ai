import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import crypto from "crypto";
import {blobConfigured, writePrivateJson, readPrivateJson} from "./blob.js";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
export const dataDir=process.env.VERCEL ? path.join("/tmp","luxmotion") : path.join(__dirname,"..","data");
export const uploadDir=path.join(dataDir,"uploads");
export const renderDir=path.join(dataDir,"renders");
export const projectDir=path.join(dataDir,"projects");
export const qcDir=path.join(dataDir,"qc");
for(const d of [dataDir,uploadDir,renderDir,projectDir,qcDir]) fs.mkdirSync(d,{recursive:true});

export function publicMediaUrl(req,filePath){ return `${req.protocol}://${req.get("host")}/media/${path.basename(filePath)}`; }
export async function downloadToFile(url,filePath){
  const r=await fetch(url); if(!r.ok) throw new Error(`Download failed: HTTP ${r.status}`);
  fs.writeFileSync(filePath,Buffer.from(await r.arrayBuffer())); return filePath;
}
export function safeName(name="output.mp4"){ return name.replace(/[^a-zA-Z0-9._-]/g,"_"); }
export function jobFile(prefix="job"){ return path.join(projectDir,`${prefix}-${Date.now()}-${crypto.randomUUID().slice(0,8)}.json`); }

function persistentProject(project){
  const clean=JSON.parse(JSON.stringify(project));
  delete clean.masterFile;
  if(Array.isArray(clean.segments)){
    for(const seg of clean.segments){
      if(seg.accepted) delete seg.accepted.file;
      if(Array.isArray(seg.attempts)) for(const a of seg.attempts) delete a.file;
    }
  }
  if(clean.references){
    delete clean.references.productFiles;
    delete clean.references.characterFiles;
  }
  return clean;
}

export async function writeProject(project){
  const file=path.join(projectDir,`${project.id}.json`);
  const clean=persistentProject(project);
  fs.writeFileSync(file,JSON.stringify(clean,null,2));
  if(blobConfigured()) await writePrivateJson(`luxmotion/projects/${project.id}.json`,clean);
  return file;
}

export async function readProject(id){
  if(!id) return null;
  if(blobConfigured()){
    try{
      const remote=await readPrivateJson(`luxmotion/projects/${id}.json`);
      if(remote) return remote;
    }catch(e){
      if(process.env.VERCEL) throw e;
    }
  }
  const file=path.join(projectDir,`${id}.json`);
  if(!fs.existsSync(file)) return null;
  try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return null;}
}

export async function listProjects(){
  if(blobConfigured()){
    const {listPrivate}=await import("./blob.js");
    const blobs=await listPrivate("luxmotion/projects/");
    const projects=[];
    for(const b of blobs){
      if(!b.pathname.endsWith(".json")) continue;
      try{const p=await readPrivateJson(b.pathname); if(p) projects.push(p);}catch{}
    }
    return projects.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  }
  return fs.readdirSync(projectDir).filter(x=>x.endsWith(".json")).map(x=>{try{return JSON.parse(fs.readFileSync(path.join(projectDir,x),"utf8"))}catch{return null}}).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
