const express=require("express"),fs=require("fs"),os=require("os"),path=require("path"),crypto=require("crypto"),ffmpeg=require("fluent-ffmpeg");
const app=express();app.use(express.json({limit:"25mb"}));
const token=process.env.VIDEO_WORKER_TOKEN||"";
function auth(req,res,next){if(token && req.headers.authorization!==`Bearer ${token}`)return res.status(401).json({error:"unauthorized"});next()}
function writeData(v,p){const m=String(v).match(/^data:.*?;base64,(.*)$/);fs.writeFileSync(p,Buffer.from(m?m[1]:v,"base64"))}
app.post("/render",auth,async(req,res)=>{
 const id=crypto.randomUUID(),dir=fs.mkdtempSync(path.join(os.tmpdir(),"aff-"));const img=path.join(dir,"image"),aud=path.join(dir,"audio.mp3"),out=path.join(dir,"output.mp4");
 try{
  writeData(req.body.imageData,img); if(req.body.audioData)writeData(req.body.audioData,aud);
  const dur=Number(req.body.duration||15);
  let cmd=ffmpeg(img).inputOptions(["-loop 1"]).videoCodec("libx264").outputOptions(["-t "+dur,"-pix_fmt yuv420p","-vf scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2","-r 30","-movflags +faststart"]);
  if(req.body.audioData)cmd=cmd.input(aud).audioCodec("aac").outputOptions(["-shortest"]);
  await new Promise((resolve,reject)=>cmd.on("end",resolve).on("error",reject).save(out));
  // For production, upload `out` to S3/R2 here and return a public/signed URL.
  const mp4="data:video/mp4;base64,"+fs.readFileSync(out).toString("base64");
  res.json({jobId:id,status:"done",video:mp4});
 }catch(e){res.status(500).json({jobId:id,status:"failed",error:e.message})}finally{try{fs.rmSync(dir,{recursive:true,force:true})}catch{}}
});
app.get("/health",(req,res)=>res.json({ok:true}));
app.listen(process.env.PORT||8080,()=>console.log("worker ready"));

// NOTE: This legacy FFmpeg worker is retained as part of the historical project bundle.
// The current MVP uses Wan 2.2 Image-to-Video directly from the frontend for free testing.
