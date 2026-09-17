import fs from "fs";
import {execFile} from "child_process";
import {promisify} from "util";
import {ffmpegPath} from "./media-tools.js";
import {blobConfigured, publishPrivateFile, signedUrl} from "./blob.js";
const execFileAsync=promisify(execFile);
export const TARGETS={"9:16":{w:2160,h:3840},"1:1":{w:2160,h:2160},"4:5":{w:2160,h:2700},"16:9":{w:3840,h:2160}};

export async function upscale4K(input,output,format="9:16",apiKey=""){
  if(!fs.existsSync(input)) throw new Error("Input video not found");
  const secret=String(apiKey||process.env.RUNWAYML_API_SECRET||process.env.RUNWAY_API_KEY||"").trim();
  if(secret){
    try{
      const {createRequire}=await import("node:module");
      const require=createRequire(import.meta.url);
      const RunwayML=require("@runwayml/sdk").default;
      const client=new RunwayML({apiKey:secret});
      let upload=null;
      if(blobConfigured()){
        const saved=await publishPrivateFile(input,`luxmotion/temp/upscale-${Date.now()}.mp4`,"video/mp4");
        if(saved?.pathname) upload=await signedUrl(saved.pathname,30*60*1000);
      }
      if(!upload) upload=(await client.uploads.createEphemeral(fs.createReadStream(input))).uri;
      const r=await fetch("https://api.dev.runwayml.com/v1/video_upscale",{method:"POST",headers:{Authorization:`Bearer ${secret}`,"X-Runway-Version":process.env.RUNWAY_API_VERSION||"2024-11-06","Content-Type":"application/json"},body:JSON.stringify({model:"magnific_video_upscaler_creative",videoUri:upload,resolution:"4k"})});
      const body=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(body?.error?.message||body?.message||`Runway 4K upscale failed (HTTP ${r.status})`);
      let task=body;
      const deadline=Date.now()+Math.min(900000,Number(process.env.RUNWAY_UPSCALE_TIMEOUT_MS||600000));
      while(!["SUCCEEDED","FAILED","CANCELED"].includes(task.status)&&Date.now()<deadline){
        await new Promise(r=>setTimeout(r,3000));
        const pr=await fetch(`https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(body.id)}`,{headers:{Authorization:`Bearer ${secret}`,"X-Runway-Version":process.env.RUNWAY_API_VERSION||"2024-11-06"}});
        task=await pr.json().catch(()=>({}));
      }
      if(task.status!=="SUCCEEDED"||!task.output?.[0]) throw new Error(task.failure||"Runway 4K upscale did not complete in time.");
      const vr=await fetch(task.output[0]); if(!vr.ok) throw new Error(`Failed to download Runway 4K output (HTTP ${vr.status})`);
      fs.writeFileSync(output,Buffer.from(await vr.arrayBuffer()));
      const t=TARGETS[format]||TARGETS["9:16"];
      return {ok:true,output,width:t.w,height:t.h,native:false,delivery:"Runway Magnific 4K"};
    }catch(e){
      if(String(process.env.RUNWAY_4K_FALLBACK||"true").toLowerCase()!=="true") throw e;
    }
  }
  const t=TARGETS[format]||TARGETS["9:16"], ffmpeg=ffmpegPath();
  const vf=`scale=${t.w}:${t.h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${t.w}:${t.h}:(ow-iw)/2:(oh-ih)/2:color=black`;
  await execFileAsync(ffmpeg,["-y","-i",input,"-vf",vf,"-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-movflags","+faststart",output],{timeout:600000});
  return {ok:true,output,width:t.w,height:t.h,native:false,delivery:"4K upscale"};
}
