import RunwayML, { TaskFailedError, toFile } from "@runwayml/sdk";
import fs from "fs";

export const MODEL_CATALOG = {
  runway: {
    economy:{label:"Hemat",model:"gen4_turbo",creditsPerSecond:5},
    balanced:{label:"Seimbang",model:"gen4_turbo",creditsPerSecond:5},
    premium:{label:"Premium",model:"gen4.5",creditsPerSecond:12},
    "4k":{label:"4K Delivery",model:"gen4.5",creditsPerSecond:12},
    motion:{label:"Motion Transfer",model:"seedance2_5",creditsPerSecond:30}
  }
};

export function routeModel(mode="balanced",duration=10){
  const key=Object.hasOwn(MODEL_CATALOG.runway,mode)?mode:"balanced";
  return {provider:"runway",...MODEL_CATALOG.runway[key],duration:Math.max(1,Math.min(30,Number(duration)||10))};
}
export function estimate(mode,duration,fps=30){
  const r=routeModel(mode,duration), video=r.creditsPerSecond*r.duration;
  const delivery=mode==="4k"?0.012*fps*r.duration*100:0;
  return {provider:"runway",model:r.model,duration:r.duration,videoCredits:video,deliveryCredits:delivery,totalCredits:Math.ceil(video+delivery),estimatedUsd:Number(((video+delivery)*.01).toFixed(2)),note:"Estimate only; Seedance 2.5 pricing depends on output resolution and reference-video duration. Verify current provider pricing."};
}
function key(explicitKey){return String(explicitKey||process.env.RUNWAYML_API_SECRET||process.env.RUNWAY_API_KEY||"").trim();}
function client(explicitKey){return new RunwayML({apiKey:key(explicitKey)});}
function ratioFor(format="9:16"){
  return ({"9:16":"720:1280","1:1":"960:960","4:5":"832:1040","16:9":"1280:720"})[format]||"720:1280";
}

export async function uploadEphemeral(filePath,originalName,apiKey){
  if(!key(apiKey)) return {ok:false,code:"RUNWAY_API_KEY_MISSING",message:"Set RUNWAYML_API_SECRET in .env."};
  if(!fs.existsSync(filePath)) return {ok:false,code:"FILE_NOT_FOUND",message:"Upload file does not exist."};
  const size=fs.statSync(filePath).size;
  if(size<512) return {ok:false,code:"FILE_TOO_SMALL",message:"Runway ephemeral uploads require at least 512 bytes."};
  if(size>200*1024*1024) return {ok:false,code:"FILE_TOO_LARGE",message:"Runway ephemeral uploads are limited to 200MB."};
  try{
    const response=await client(apiKey).uploads.createEphemeral(fs.createReadStream(filePath));
    return {ok:true,uri:response.uri,expiresInHours:24,originalName};
  }catch(error){
    return {ok:false,code:"RUNWAY_UPLOAD_FAILED",detail:error.message};
  }
}

export async function uploadBufferEphemeral(buffer,filename="asset.bin",apiKey){
  if(!key(apiKey)) return {ok:false,code:"RUNWAY_API_KEY_MISSING"};
  try{
    const response=await client(apiKey).uploads.createEphemeral(await toFile(buffer,filename));
    return {ok:true,uri:response.uri,expiresInHours:24,originalName:filename};
  }catch(error){return {ok:false,code:"RUNWAY_UPLOAD_FAILED",detail:error.message};}
}

export async function runwayRender({promptImage,promptText,duration=5,model="gen4.5",format="9:16",apiKey}){
  if(!key(apiKey)) return {ok:false,code:"RUNWAY_API_KEY_MISSING",message:"Set RUNWAYML_API_SECRET in .env."};
  try{
    const task=await client(apiKey).imageToVideo.create({model,promptImage,promptText,ratio:ratioFor(format),duration:Math.max(2,Math.min(10,Number(duration)||5))}).waitForTaskOutput();
    return {ok:true,status:"completed",taskId:task.id||null,output:task.output||[],raw:task};
  }catch(error){
    if(error instanceof TaskFailedError) return {ok:false,status:"failed",code:"RUNWAY_TASK_FAILED",detail:error.taskDetails};
    return {ok:false,status:"failed",code:"RUNWAY_REQUEST_FAILED",detail:error.message};
  }
}
export async function runwayMotionTransfer({promptImage,referenceVideo,promptText="",duration=5,format="9:16",audio=false,apiKey}){
  if(!key(apiKey)) return {ok:false,code:"RUNWAY_API_KEY_MISSING",message:"Set RUNWAYML_API_SECRET in .env."};
  if(!promptImage) return {ok:false,code:"SOURCE_IMAGE_MISSING",message:"Source image is required."};
  if(!referenceVideo) return {ok:false,code:"REFERENCE_VIDEO_MISSING",message:"Motion reference video is required."};
  const d=Math.max(4,Math.min(30,Number(duration)||5));
  const ratio={"9:16":"1080:1920","1:1":"1440:1440","4:5":"1248:1664","16:9":"1920:1080"}[format]||"1080:1920";
  try{
    const task=await client(apiKey).videoToVideo.create({model:"seedance2_5",promptVideo:referenceVideo,mode:"reference",promptText:promptText||"Use the reference video for motion, camera movement, timing, and physical dynamics. Recreate the scene using the supplied reference image as the primary subject. Preserve the subject identity, appearance, proportions, clothing/product details, and visual character. Do not introduce unrelated subjects or objects.",ratio,duration:d,audio:Boolean(audio),references:[{uri:promptImage}]}).waitForTaskOutput();
    return {ok:true,status:"completed",taskId:task.id||null,output:task.output||[],raw:task};
  }catch(error){ if(error instanceof TaskFailedError) return {ok:false,status:"failed",code:"RUNWAY_MOTION_TASK_FAILED",detail:error.taskDetails}; return {ok:false,status:"failed",code:"RUNWAY_MOTION_REQUEST_FAILED",detail:error.message}; }
}

export async function runwayMultiShot({shots,duration=10,firstFrame,format="9:16",audio=true,apiKey}){
  if(!key(apiKey)) return {ok:false,code:"RUNWAY_API_KEY_MISSING",message:"Set RUNWAYML_API_SECRET in .env."};
  if(![5,10,15].includes(Number(duration))) return {ok:false,code:"UNSUPPORTED_DURATION",message:"Runway Multi-Shot supports total durations of 5, 10, or 15 seconds."};
  try{
    const input={version:"2026-06",mode:"custom",duration:Number(duration),ratio:ratioFor(format),audio:Boolean(audio),shots:shots.map(x=>({prompt:x.prompt,duration:Number(x.duration)}))};
    if(firstFrame) input.firstFrame={uri:firstFrame};
    const task=await client(apiKey).recipes.multiShotVideo(input).waitForTaskOutput();
    return {ok:true,status:"completed",taskId:task.id||null,output:task.output||[],raw:task};
  }catch(error){
    if(error instanceof TaskFailedError) return {ok:false,status:"failed",code:"RUNWAY_TASK_FAILED",detail:error.taskDetails};
    return {ok:false,status:"failed",code:"RUNWAY_REQUEST_FAILED",detail:error.message};
  }
}
