import fs from "fs";
import path from "path";
import crypto from "crypto";
import { runwayMultiShot, uploadEphemeral } from "./providers.js";
import { mediaQC, lockedPrompt } from "./qc.js";
import { visualQC } from "./visual-qc.js";
import { smartVisualQC } from "./smart-visual-qc.js";
import { upscale4K } from "./delivery.js";
import { downloadToFile, renderDir, qcDir, writeProject } from "./storage.js";
import { createProgress, updateProgress } from "./progress.js";
import { execFile } from "child_process";
import { promisify } from "util";
import { ffmpegPath } from "./media-tools.js";
import { publishFile, signedUrl } from "./blob.js";
const execFileAsync=promisify(execFile);

function keepTemp(){return String(process.env.KEEP_TEMP_FILES||"false").toLowerCase()==="true";}
function maxRetries(v){return Math.max(0,Math.min(5,Number(v ?? process.env.MAX_REGENERATIONS ?? 2)));}

async function composeFiles(files,out){
  if(!files.length) throw new Error("No local segments to compose.");
  const list=path.join(renderDir,`concat-${crypto.randomUUID()}.txt`);
  fs.writeFileSync(list,files.map(p=>`file '${String(p).replaceAll("'","'\\\\''")}'`).join("\n"));
  try{
    await execFileAsync(ffmpegPath(),["-y","-f","concat","-safe","0","-i",list,
      "-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p",
      "-c:a","aac","-b:a","192k","-movflags","+faststart",out],{timeout:600000});
  }finally{try{fs.unlinkSync(list)}catch{}}
  return out;
}

async function firstFrameToRunway(video, originalName, apiKey){
  const image=path.join(qcDir,`first-${crypto.randomUUID()}.jpg`);
  await execFileAsync(ffmpegPath(),["-y","-ss","0","-i",video,"-frames:v","1","-q:v","2",image],{timeout:60000});
  try{
    const pathname=`luxmotion/temp/${crypto.randomUUID()}-${String(originalName||"first-frame.jpg").replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    const {publishPrivateFile}=await import("./blob.js");
    const saved=await publishPrivateFile(image,pathname,"image/jpeg");
    if(saved?.pathname) return await signedUrl(saved.pathname,30*60*1000);
  }catch{}
  try{
    const uploaded=await uploadEphemeral(image,originalName||"first-frame.jpg",apiKey);
    if(uploaded.ok) return uploaded.uri;
  }catch{}
  finally{if(!keepTemp()) try{fs.unlinkSync(image)}catch{}}
  if(!keepTemp()) try{fs.unlinkSync(image)}catch{}
  return null;
}

async function saveRemoteVideo(url,projectId,segmentIndex,attempt){
  if(!url) throw new Error("Provider returned no output URL.");
  const ext=String(url).split("?")[0].toLowerCase().endsWith(".webm")?".webm":".mp4";
  const file=path.join(renderDir,`${projectId}-segment-${segmentIndex}-attempt-${attempt}${ext}`);
  await downloadToFile(url,file);
  return file;
}

async function inspectSegment({id,file,duration,autoQC,visualEnabled,referenceImage,product,character,prompt}){
  const technical=await mediaQC(file,{expectedDuration:Number(duration),requireAudio:false});
  let visual=null;
  if(visualEnabled){
    updateProgress(id,{status:"qc",progress:91,stage:"Final visual QC",message:"Running final visual consistency check…"});
    visual=await visualQC({video:file,referenceImage:referenceImage||false,product,character,prompt,fps:0.5,maxFrames:8});
  }
  const strict=String(process.env.STRICT_VISUAL_QC||"false").toLowerCase()==="true";
  const technicalPass=!autoQC || technical.pass;
  const visualPass=!visualEnabled || visual?.pass || (!strict && visual?.action==="manual-review");
  return {pass:Boolean(technicalPass&&visualPass),technical,visual};
}

function splitStoryboard(storyboard,total){
  if(total<=15) return [{duration:total,shots:storyboard}];
  const source = Array.isArray(storyboard) && storyboard.length ? storyboard : [{
    index:1,duration:15,prompt:"Premium commercial shot.",textOverlay:""
  }];
  const mid=Math.max(1,Math.floor(source.length/2));
  let a=source.slice(0,mid), b=source.slice(mid);
  if(!b.length){ b=[{...a[a.length-1],index:Number(a[a.length-1].index||a.length)+1,textOverlay:""}]; }
  return [{duration:15,shots:a},{duration:15,shots:b}];
}

export async function runProduction({
  id,storyboard,duration,imageUrl,mode,format,audio=true,product="",character="",
  productLock=true,characterLock=false,autoQC=true,visualEnabled=true,maxRegenerations,
  productProfile=null,characterProfile=null,apiKey
}){
  createProgress(id);
  const retries=maxRetries(maxRegenerations);
  const productProfilePrompt=productProfile?.lockedPrompt||"";
  const characterProfilePrompt=characterProfile?.lockedPrompt||"";
  const consistencyProfile=[productProfilePrompt,characterProfilePrompt].filter(Boolean).join("\n");
  const project={id,status:"rendering",startedAt:new Date().toISOString(),duration:Number(duration),
    format,mode,options:{audio,productLock,characterLock,autoQC,visualEnabled,maxRegenerations:retries},
    references:{productProfileId:productProfile?.id||null,characterProfileId:characterProfile?.id||null,
      productFiles:productProfile?.references?.map(x=>x.file).filter(Boolean)||[],
      characterFiles:characterProfile?.references?.map(x=>x.file).filter(Boolean)||[]},
    segments:[],events:[]};
  await writeProject(project);

  try{
    updateProgress(id,{status:"rendering",progress:3,stage:"Preparing",message:"Preparing storyboard and locked reference profiles…"});
    const segments=splitStoryboard(storyboard,Number(duration));
    const localFiles=[];
    let firstFrame=imageUrl||productProfile?.runwayUri||characterProfile?.runwayUri||null;
    updateProgress(id,{totalSegments:segments.length});

    for(let i=0;i<segments.length;i++){
      const seg=segments[i];
      const totalSegDuration=Number(seg.duration);
      const rawShots=Array.isArray(seg.shots)&&seg.shots.length?seg.shots:[{index:1,duration:totalSegDuration,prompt:"Premium commercial showcase.",textOverlay:""}];
      let remaining=totalSegDuration;
      const shots=rawShots.map((s,j,a)=>{
        const left=a.length-j;
        const d=j===a.length-1 ? Math.max(1,Number(remaining.toFixed(2))) : Math.max(1,Number((remaining/left).toFixed(2)));
        remaining-=d;
        return {...s,duration:d,prompt:lockedPrompt(s.prompt,{productLock,characterLock,product,character,referenceProfile:consistencyProfile})};
      });
      let accepted=null;
      const attempts=[];
      for(let attempt=1;attempt<=retries+1;attempt++){
        const base=8 + Math.floor((i/segments.length)*65);
        updateProgress(id,{status:"rendering",progress:base,stage:`Rendering segment ${i+1}/${segments.length}`,
          message:"AI render in progress…",segment:i+1,totalSegments:segments.length,attempt});
        project.events.push({at:new Date().toISOString(),segment:i+1,attempt,status:"provider-render"});
        await writeProject(project);

        const r=await runwayMultiShot({shots,duration:seg.duration,firstFrame,format,audio,referenceProfile:consistencyProfile,apiKey});
        if(!r.ok){
          attempts.push({attempt,status:"provider-failed",error:r});
          updateProgress(id,{status:"retrying",progress:Math.min(92,base+18),stage:`Render retry ${i+1}`,
            message:"Provider render failed — retrying this segment only.",segment:i+1,attempt});
          if(attempt<=retries) continue;
          break;
        }
        let local=null;
        try{
          local=await saveRemoteVideo(r.output?.[0],id,i+1,attempt);
          updateProgress(id,{status:"qc",progress:Math.min(92,base+25),stage:`QC segment ${i+1}/${segments.length}`,
            message:"Technical + visual QC running…",segment:i+1,attempt});
          const qc=await inspectSegment({id,file:local,duration:seg.duration,autoQC,visualEnabled,
            referenceImage:imageUrl||productProfile?.normalizedFile||false,product,character,
            prompt:shots.map(x=>x.prompt).join("\n")});
          const smart=await smartVisualQC({
            video:local,
            referenceImages:[
              productProfile?.normalizedFile,
              ...(productProfile?.references||[]).map(x=>x.file),
              characterProfile?.normalizedFile,
              ...(characterProfile?.references||[]).map(x=>x.file)
            ].filter(Boolean),
            product,character,prompt:shots.map(x=>x.prompt).join("\n"),maxFrames:8
          });
          qc.smartVisual=smart;
          if(visualEnabled && smart.action==="drift-signal") qc.pass=false;
          attempts.push({attempt,status:qc.pass?"qc-passed":"qc-failed",taskId:r.taskId||null,file:local,qc});
          if(qc.pass){
            updateProgress(id,{status:"accepted",progress:Math.min(92,base+31),stage:`Segment ${i+1} approved`,
              message:"QC passed.",segment:i+1,attempt});
            accepted={...r,local,qc}; break;
          }
          updateProgress(id,{status:"retrying",progress:Math.min(92,base+27),stage:`QC failed — retry ${i+1}`,
            message:"QC rejected this segment; regenerating only the failed segment.",segment:i+1,attempt});
        }catch(e){
          attempts.push({attempt,status:"inspection-failed",error:e.message,file:local});
          updateProgress(id,{status:"retrying",progress:Math.min(92,base+27),stage:`Inspection retry ${i+1}`,
            message:"QC inspection failed; retrying this segment.",segment:i+1,attempt});
        }
      }

      if(!accepted){
        updateProgress(id,{status:"failed",progress:99,stage:"Segment failed",
          message:`Segment ${i+1} could not pass the configured QC/retry limit.`});
        project.segments.push({segment:i+1,status:"failed",attempts});
        project.status="failed"; project.finishedAt=new Date().toISOString(); await writeProject(project);
        return {ok:false,project};
      }

      localFiles.push(accepted.local);
      let acceptedBlobPath=null;
      try{
        const {publishPrivateFile}=await import("./blob.js");
        const saved=await publishPrivateFile(accepted.local,`luxmotion/renders/${id}-segment-${i+1}.mp4`,"video/mp4");
        acceptedBlobPath=saved?.pathname||null;
      }catch{}
      project.segments.push({segment:i+1,status:"completed",attempts,accepted:{
        taskId:accepted.taskId||null,file:accepted.local,blobPath:acceptedBlobPath,providerUrl:accepted.output?.[0]||null}});
      project.events.push({at:new Date().toISOString(),segment:i+1,status:"accepted"});
      await writeProject(project);

      if(i<segments.length-1){
        firstFrame=await firstFrameToRunway(accepted.local,`segment-${i+1}-first-frame.jpg`) || firstFrame;
      }
    }

    updateProgress(id,{status:"composing",progress:75,stage:"Composing master video",
      message:"Joining approved segments and encoding master MP4…"});
    const composed=path.join(renderDir,`${id}-master.mp4`);
    await composeFiles(localFiles,composed);
    project.masterFile=composed; const masterBlob=await publishFile(composed,`luxmotion/renders/${id}-master.mp4`,"video/mp4").catch(()=>null); project.masterBlobPath=masterBlob?.pathname||null; project.masterUrl=null; project.status="composed"; await writeProject(project);

    updateProgress(id,{status:"qc",progress:86,stage:"Master QC",message:"Checking final master video…"});
    const masterQC=await mediaQC(composed,{expectedDuration:Number(duration),requireAudio:Boolean(audio)});
    project.masterQC=masterQC;
    if(autoQC && !masterQC.pass){
      updateProgress(id,{status:"failed",progress:99,stage:"Master QC failed",message:"Final master did not pass technical QC."});
      project.status="master-qc-failed"; project.finishedAt=new Date().toISOString(); await writeProject(project);
      return {ok:false,project};
    }

    if(visualEnabled){
      project.masterSmartVisualQC=await smartVisualQC({
        video:composed,
        referenceImages:[
          productProfile?.normalizedFile,
          ...(productProfile?.references||[]).map(x=>x.file),
          characterProfile?.normalizedFile,
          ...(characterProfile?.references||[]).map(x=>x.file)
        ].filter(Boolean),
        product,character,prompt:storyboard.map(x=>x.prompt).join("\n"),maxFrames:12
      });
      project.masterVisualQC=await visualQC({video:composed,
        referenceImage:imageUrl||productProfile?.normalizedFile||false,product,character,
        prompt:storyboard.map(x=>x.prompt).join("\n"),fps:0.5,maxFrames:12});
      const strict=String(process.env.STRICT_VISUAL_QC||"false").toLowerCase()==="true";
      if(strict && (project.masterVisualQC?.pass===false || project.masterSmartVisualQC?.action==="drift-signal")){
        updateProgress(id,{status:"failed",progress:99,stage:"Visual QC failed",message:"Final visual QC rejected the master."});
        project.status="master-visual-qc-failed"; project.finishedAt=new Date().toISOString(); await writeProject(project);
        return {ok:false,project};
      }
    }

    updateProgress(id,{status:"ready",progress:100,stage:"VIDEO READY",message:"Production complete. Master video is ready."});
    project.status="ready"; project.finishedAt=new Date().toISOString(); await writeProject(project);
    return {ok:true,project};
  }catch(e){
    project.status="failed"; project.error={message:e.message,stack:e.stack}; project.finishedAt=new Date().toISOString();
    await writeProject(project);
    updateProgress(id,{status:"failed",progress:99,stage:"Pipeline failed",message:e.message});
    return {ok:false,project,error:e.message};
  }finally{
    // No global job state: Vercel may run concurrent invocations in the same instance.
  }
}

export async function deliverProduction4K(project,apiKey=""){
  updateProgress(project.id,{status:"delivery",progress:95,stage:"4K delivery",message:"Upscaling and preparing 4K delivery…"});
  if(!project) throw new Error("Project is required.");
  if(!project.masterFile || !fs.existsSync(project.masterFile)){
    if(project.masterBlobPath){
      const {downloadPrivateToFile}=await import("./blob.js");
      project.masterFile=path.join(renderDir,`${project.id}-master-source.mp4`);
      await downloadPrivateToFile(project.masterBlobPath,project.masterFile);
    } else if(project.masterUrl){
      project.masterFile=path.join(renderDir,`${project.id}-master-source.mp4`);
      await downloadToFile(project.masterUrl,project.masterFile);
    } else throw new Error("Project master video is not available.");
  }
  const out=path.join(renderDir,`${project.id}-4k.mp4`);
  const result=await upscale4K(project.masterFile,out,project.format||"9:16",apiKey);
  const deliveredBlob=await publishFile(out,`luxmotion/renders/${project.id}-4k.mp4`,"video/mp4").catch(()=>null);
  result.blobPath=deliveredBlob?.pathname||null;
  result.url=result.blobPath?await signedUrl(result.blobPath,24*60*60*1000).catch(()=>null):null;
  project.delivery4K=result; project.status="delivered"; project.finishedAt=new Date().toISOString();
  await writeProject(project);
  updateProgress(project.id,{status:"delivered",progress:100,stage:"4K READY",message:"4K delivery is ready."});
  return project;
}
