const express=require("express"),fs=require("fs"),os=require("os"),path=require("path"),crypto=require("crypto"),ffmpeg=require("fluent-ffmpeg");
const app=express();
app.use(express.json({limit:"20mb"}));
const token=process.env.VIDEO_WORKER_TOKEN||"";
function auth(req,res,next){if(token && req.headers.authorization!==`Bearer ${token}`) return res.status(401).json({error:"unauthorized"}); next();}

function writeData(value,filePath,label){
  if(value==null || value==="") return false;
  if(Buffer.isBuffer(value)){fs.writeFileSync(filePath,value);return true;}
  const s=String(value).trim();
  // Accept normal browser/OpenAI data URLs: data:<mime>;base64,<payload>
  if(s.startsWith("data:")){
    const comma=s.indexOf(",");
    if(comma<0) throw new Error(`Invalid ${label} data URL: missing comma`);
    const meta=s.slice(5,comma);
    if(!/;base64/i.test(meta)) throw new Error(`Invalid ${label} data URL: not base64`);
    const payload=s.slice(comma+1).replace(/\s/g,"");
    if(!payload) throw new Error(`Invalid ${label} data URL: empty payload`);
    const buf=Buffer.from(payload,"base64");
    if(!buf.length) throw new Error(`Invalid ${label} data URL: empty decoded data`);
    fs.writeFileSync(filePath,buf);return true;
  }
  // Also accept raw base64 as a fallback.
  if(/^[A-Za-z0-9+/=\s]+$/.test(s)){
    const buf=Buffer.from(s.replace(/\s/g,""),"base64");
    if(buf.length){fs.writeFileSync(filePath,buf);return true;}
  }
  throw new Error(`Invalid ${label} data URL`);
}
function safeText(s,max=140){return String(s||"").replace(/\r?\n/g," ").slice(0,max);}
app.post("/render",auth,async(req,res)=>{
  const id=crypto.randomUUID(),dir=fs.mkdtempSync(path.join(os.tmpdir(),"affiliate-ai-"));
  const img=path.join(dir,"product.jpg"),aud=path.join(dir,"voice.mp3"),out=path.join(dir,"affiliate.mp4");
  try{
    if(!req.body || !req.body.imageData) throw new Error("imageData tidak diterima Worker");
    writeData(req.body.imageData,img,"image");
    const hasAudio=!!req.body.audioData;
    if(hasAudio) writeData(req.body.audioData,aud,"audio");
    const hook=safeText(req.body.hook||"Produk pilihan yang wajib kamu lihat",100);
    const cta=safeText(req.body.cta||"Cek produknya sekarang",80);
    const hookFile=path.join(dir,"hook.txt"),ctaFile=path.join(dir,"cta.txt");
    fs.writeFileSync(hookFile,hook); fs.writeFileSync(ctaFile,cta);
    const font="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
    const duration=Math.max(10,Math.min(30,Number(req.body.duration||15)));
    const vf=[
      "scale=1080:1920:force_original_aspect_ratio=decrease",
      "pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
      "zoompan=z='min(zoom+0.0007,1.10)':d="+(duration*30)+":s=1080x1920:fps=30",
      `drawbox=x=0:y=0:w=1080:h=390:color=black@0.52:t=fill`,
      `drawtext=fontfile=${font}:textfile=${hookFile}:fontcolor=white:fontsize=58:line_spacing=12:x=70:y=105:box=0`,
      `drawbox=x=55:y=1770:w=970:h=95:color=black@0.68:t=fill`,
      `drawtext=fontfile=${font}:textfile=${ctaFile}:fontcolor=white:fontsize=40:x=(w-text_w)/2:y=1795`
    ].join(",");
    let cmd=ffmpeg(img).inputOptions(["-loop 1"]).videoCodec("libx264").outputOptions([
      "-t",String(duration),"-pix_fmt","yuv420p","-r","30","-movflags","+faststart","-preset","veryfast","-crf","23","-vf",vf
    ]);
    if(hasAudio){
      cmd=cmd.input(aud).audioCodec("aac").audioFilters([`apad=pad_dur=${duration}`]).outputOptions(["-t",String(duration)]);
    } else cmd=cmd.outputOptions(["-an"]);
    await new Promise((resolve,reject)=>cmd.on("end",resolve).on("error",reject).save(out));
    const video="data:video/mp4;base64,"+fs.readFileSync(out).toString("base64");
    res.json({jobId:id,status:"done",video});
  }catch(e){
    console.error("Render failed:",e);
    res.status(500).json({jobId:id,status:"failed",error:e instanceof Error?e.message:String(e)});
  }finally{try{fs.rmSync(dir,{recursive:true,force:true})}catch{}}
});
app.get("/health",(req,res)=>res.json({ok:true}));
app.listen(process.env.PORT||8080,()=>console.log("Affiliate AI video worker ready"));
