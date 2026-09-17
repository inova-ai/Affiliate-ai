import fs from "fs";
import path from "path";
import { runwayMultiShot } from "./providers.js";
import { lockedPrompt, retryDecision } from "./qc.js";

export async function renderProject({storyboard,duration,imageUrl,mode,format,audio=true,product="",character="",productLock=true,characterLock=false,maxRetries=2,apiKey}){
  const total=Number(duration);
  const shots=storyboard;
  const segments=total<=15?[{duration:total,shots}]:[
    {duration:15,shots:shots.slice(0,Math.ceil(shots.length/2))},
    {duration:15,shots:shots.slice(Math.ceil(shots.length/2))}
  ];
  const results=[];
  let firstFrame=imageUrl||null;
  for(let i=0;i<segments.length;i++){
    const seg=segments[i];
    const sum=seg.shots.reduce((a,x)=>a+Number(x.duration),0);
    // Normalize segment shot durations so they exactly match the requested segment.
    const normalized=seg.shots.map((x,j,a)=>{
      if(j<a.length-1) return {...x,duration:Number(x.duration)};
      return {...x,duration:Math.max(1,Number((seg.duration-(a.slice(0,-1).reduce((q,y)=>q+Number(y.duration),0))).toFixed(2)))};
    });
    let r=null, attempt=0;
    while(attempt<=maxRetries){
      const locked=normalized.map(x=>({...x,prompt:lockedPrompt(x.prompt,{productLock,characterLock,product,character})}));
      r=await runwayMultiShot({shots:locked,duration:seg.duration,firstFrame,format,audio,apiKey});
      if(r.ok) break;
      const d=retryDecision({pass:false},attempt,maxRetries);
      if(!d.retry) break;
      attempt++;
    }
    results.push({segment:i+1,duration:seg.duration,status:r.ok?"completed":"failed",attempts:attempt+1,
      videoUrl:r.output?.[0]||null,taskId:r.taskId||null,error:r.ok?null:r});
    if(!r.ok) break;
    // The next segment can use the previous output as a visual starting point.
    firstFrame=r.output?.[0]||firstFrame;
  }
  return {ok:results.length===segments.length && results.every(x=>x.status==="completed"),results};
}

export function makeConcatList(inputs,file){
  fs.writeFileSync(file,inputs.map(p=>`file '${String(p).replaceAll("'","'\\\\''")}'`).join("\n"));
  return file;
}
