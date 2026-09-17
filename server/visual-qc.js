import fs from "fs";
import path from "path";
import {execFile} from "child_process";
import {promisify} from "util";
const execFileAsync=promisify(execFile);

export async function extractFrames(video,{fps=0.5,maxFrames=8,outDir}={}){
  const dir=outDir||path.join(path.dirname(video),`qc-${Date.now()}`);
  fs.mkdirSync(dir,{recursive:true});
  const pattern=path.join(dir,"frame-%02d.jpg");
  const ffmpeg=ffmpegPath();
  await execFileAsync(ffmpeg,["-y","-i",video,"-vf",`fps=${fps},scale=768:-2`,"-frames:v",String(maxFrames),"-q:v","3",pattern],{timeout:120000});
  return fs.readdirSync(dir).filter(x=>/^frame-\d+\.jpg$/.test(x)).sort().map(x=>path.join(dir,x));
}

export function heuristicVisualQC({frames=[],referenceImage=false,productLock=false,characterLock=false}={}){
  // Technical proxy only. Semantic identity/product/logo checks require a vision provider.
  const count=frames.length;
  const checks=[
    {name:"frame-samples",pass:count>0,detail:`${count} frame sample(s) extracted`},
    {name:"reference-available",pass:Boolean(referenceImage),detail:referenceImage?"Reference supplied":"No reference image supplied"},
    {name:"semantic-vision-provider",pass:Boolean(process.env.VISION_QC_URL),detail:process.env.VISION_QC_URL?"Configured":"Not configured; semantic checks are skipped"}
  ];
  const pass=checks.every(x=>x.pass || x.name==="semantic-vision-provider");
  return {mode:"heuristic",pass,checks,notes:["This does not determine identity/product similarity, logo correctness, or anatomical fidelity.","Use a vision provider for semantic QC."],frames:frames.map(f=>path.basename(f))};
}

export async function providerVisualQC({frames,referenceImage,product,character,prompt}={}){
  const url=process.env.VISION_QC_URL;
  if(!url) return {ok:false,configured:false,error:"VISION_QC_URL is not configured"};
  const body={frames:frames.map(f=>({filename:path.basename(f),base64:fs.readFileSync(f).toString("base64")})),referenceImage,product,character,prompt,checks:["product_similarity","character_similarity","logo_text_integrity","geometry_deformation","blur_artifacts","continuity"]};
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",...(process.env.VISION_QC_API_KEY?{Authorization:`Bearer ${process.env.VISION_QC_API_KEY}`}:{})},body:JSON.stringify(body)});
  const text=await r.text(); let data; try{data=JSON.parse(text)}catch{data={raw:text}};
  if(!r.ok) return {ok:false,configured:true,status:r.status,error:"Vision QC provider request failed",detail:data};
  return {ok:true,configured:true,result:data};
}

export async function visualQC({video,referenceImage=false,product="",character="",prompt="",fps=0.5,maxFrames=8}={}){
  const frames=await extractFrames(video,{fps,maxFrames});
  const heuristic=heuristicVisualQC({frames,referenceImage,productLock:Boolean(product),characterLock:Boolean(character)});
  const semantic=await providerVisualQC({frames,referenceImage,product,character,prompt});
  const semanticPass=semantic.ok ? (semantic.result?.pass ?? semantic.result?.approved ?? false) : false;
  return {ok:true,mode:semantic.ok?"semantic+technical":"technical-only",technical:heuristic,semantic,pass:semantic.ok?Boolean(semanticPass):false,action:semantic.ok?(semanticPass?"pass":"regenerate"):"manual-review"};
}

export function visualRetryDecision(qc,{attempt=0,maxRetries=2}={}){
  if(qc?.pass) return {retry:false,reason:"visual QC passed"};
  if(attempt>=maxRetries) return {retry:false,reason:"retry limit reached"};
  if(qc?.action==="manual-review") return {retry:false,reason:"semantic vision provider unavailable"};
  return {retry:true,reason:"semantic visual QC failed",nextAttempt:attempt+1};
}
