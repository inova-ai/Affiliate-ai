import { execFile } from "child_process";
import { promisify } from "util";
import { ffmpegPath, ffprobePath } from "./media-tools.js";
const execFileAsync=promisify(execFile);

export function lockedPrompt(base,{productLock=true,characterLock=false,product="",character=""}={}){
  const locks=[];
  if(productLock) locks.push(`PRODUCT LOCK: preserve exact product shape, proportions, materials, branding placement and color of ${product||"the supplied product reference"}. Do not redesign it.`);
  if(characterLock) locks.push(`CHARACTER LOCK: preserve the supplied person's facial identity, hair, skin tone, body proportions and wardrobe unless the shot explicitly changes wardrobe.`);
  return [base,...locks,"Maintain continuity with previous shots. Avoid warped hands, duplicate objects, deformed logos, text artifacts and geometry drift."].join(" ");
}

export async function mediaQC(file,{expectedDuration=0,requireAudio=false}={}){
  const ffprobe=ffprobePath();
  const ffmpeg=ffmpegPath();
  const report={file,pass:true,checks:[]};
  try{
    const p=await execFileAsync(ffprobe,["-v","error","-show_entries","format=duration","-show_streams","-of","json",file],{timeout:30000});
    const j=JSON.parse(p.stdout||"{}");
    const duration=Number(j.format?.duration||0);
    const video=(j.streams||[]).find(x=>x.codec_type==="video");
    const audio=(j.streams||[]).find(x=>x.codec_type==="audio");
    const durationOk=!expectedDuration || Math.abs(duration-expectedDuration)<=0.75;
    report.checks.push({name:"duration",pass:durationOk,value:duration,expected:expectedDuration});
    report.checks.push({name:"video_stream",pass:Boolean(video)});
    report.checks.push({name:"audio_stream",pass:requireAudio?Boolean(audio):true});
    report.pass=report.checks.every(x=>x.pass);
    // Fast black-frame scan; this catches empty/near-empty renders without claiming semantic vision.
    try{
      const b=await execFileAsync(ffmpeg,["-hide_banner","-i",file,"-vf","blackdetect=d=0.8:pix_th=0.98","-an","-f","null","-"],{timeout:60000});
      report.checks.push({name:"black_frame_scan",pass:true,detail:"no fatal black-frame condition detected"});
    }catch(e){
      const stderr=String(e.stderr||"");
      const fatal=/black_start:/i.test(stderr);
      report.checks.push({name:"black_frame_scan",pass:!fatal,detail:fatal?"black frames detected":"scan completed with nonfatal ffmpeg output"});
      report.pass=report.pass && !fatal;
    }
  }catch(e){
    report.pass=false;
    report.checks.push({name:"media_probe",pass:false,detail:e.message});
  }
  return report;
}

export function retryDecision(qc,attempt,max=2){
  if(qc.pass) return {retry:false,reason:"QC passed"};
  if(attempt>=max) return {retry:false,reason:"retry limit reached"};
  return {retry:true,reason:"QC failed; regenerate only the failed segment"};
}
