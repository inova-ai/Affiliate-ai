"use client";
import {useState} from "react";

type Result={hook:string;script:string;caption:string;hashtags:string[]};
const HF_SPACE="prithivMLmods/Wan2.2-Fast";
const NEG="blurry, low quality, distorted face, deformed hands, extra fingers, extra limbs, duplicate person, warped body, flicker, jitter, text, watermark";
const motion:{[k:string]:string}={
 Natural:"natural head movement, subtle facial expression, small hand and shoulder movements, realistic body motion, fixed camera, photorealistic",
 Review:"natural product reviewer gestures, small hand movements, slight head nods, relaxed shoulders, realistic presenter body language, fixed camera, photorealistic",
 Energetic:"confident posture, expressive but realistic hand gestures, natural head movement, energetic presenter body language, fixed camera, photorealistic",
 Elegant:"subtle elegant head movement, gentle hand gesture, refined posture, smooth natural body movement, fixed camera, photorealistic"
};
export default function Home(){
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(""),[name,setName]=useState(""),[link,setLink]=useState(""),[style,setStyle]=useState("Review"),[duration,setDuration]=useState("4"),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState("Siap"),[video,setVideo]=useState("");
 const choose=(f:File)=>{setFile(f);setPreview(URL.createObjectURL(f));setVideo("");};
 const toDataURL=(f:File)=>new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(f)});
 async function generate(){
  if(!file)return alert("Upload foto dulu.");
  setBusy(true);setVideo("");setStatus("AI sedang membaca foto...");
  try{
   const fd=new FormData();fd.append("image",file);fd.append("productName",name);fd.append("affiliateLink",link);fd.append("style",style);
   const r=await fetch("/api/analyze",{method:"POST",body:fd}); if(r.ok)setResult(await r.json());
   setStatus("Menyiapkan gerakan AI...");
   const dataURL=await toDataURL(file);
   const {Client}=await import("@gradio/client");
   const app=await Client.connect(HF_SPACE);
   const prompt=`${motion[style]}. The person in the source image should move naturally as if presenting the product. Preserve identity, clothing, proportions and background. ${name?`The product is ${name}.`:""}`;
   const res:any=await app.predict("/generate_video",[dataURL,prompt,4,NEG,Number(duration),1,1,42,true]);
   const payload=res?.data?.[0] ?? res?.data ?? res;
   const url=typeof payload==="string"?payload:payload?.video;
   if(!url)throw new Error("Video tidak dikembalikan oleh Wan 2.2.");
   setVideo(url);setStatus(`Video ${duration} detik selesai.`);
  }catch(e:any){setStatus("Gagal: "+(e?.message||e));}
  finally{setBusy(false)}
 }
 return <main className="wrap">
  <section className="hero"><div className="eyebrow">AFFILIATE AI STUDIO</div><h1>Upload sekali.<br/><span>Konten siap jual.</span></h1><p>Foto → AI buat materi affiliate → AI menghidupkan foto menjadi video dengan gerakan natural.</p></section>
  <div className="grid">
   <section className="card">
    <div className="sectionTitle">01 <b>Foto</b></div>
    <div className="drop" onClick={()=>document.getElementById("file")?.click()}>{preview?<img src={preview}/>:<><div className="uploadIcon">＋</div><b>Upload foto produk / model</b><div className="muted">JPG / PNG / WEBP</div></>}</div>
    <input id="file" hidden type="file" accept="image/*" onChange={e=>e.target.files?.[0]&&choose(e.target.files[0])}/>
    <div className="field"><label>Nama produk</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Contoh: Blazer premium"/></div>
    <div className="field"><label>Link affiliate</label><input value={link} onChange={e=>setLink(e.target.value)} placeholder="https://..."/></div>
    <div className="row"><div className="field"><label>Gerakan</label><select value={style} onChange={e=>setStyle(e.target.value)}>{Object.keys(motion).map(x=><option key={x}>{x}</option>)}</select></div><div className="field"><label>Durasi</label><select value={duration} onChange={e=>setDuration(e.target.value)}><option value="3.5">3,5 detik</option><option value="4">4 detik</option><option value="5">5 detik</option></select></div></div>
    <button className="btn" disabled={busy} onClick={generate}>{busy?"AI sedang bekerja…":"✨ BUAT VIDEO AI"}</button><div className="status">{status}</div><div className="tiny">Wan 2.2 gratis/public untuk tahap testing. Bisa antre dan memiliki kuota ZeroGPU.</div>
   </section>
   <section className="card resultCard"><div className="sectionTitle">02 <b>Video</b></div><div className="video">{video?<video controls playsInline src={video}/>:preview?<img src={preview}/>:<div className="muted">Hasil video akan muncul di sini</div>}</div>{video&&<a className="download" href={video} download="affiliate-ai-video.mp4">⬇ Download MP4</a>}</section>
  </div>
  {result&&<section className="card content"><div className="sectionTitle">03 <b>Materi Affiliate</b></div><h3>Hook</h3><div className="result">{result.hook}</div><h3>Script</h3><div className="result">{result.script}</div><h3>Caption</h3><div className="result">{result.caption}</div><h3>Hashtag</h3><div>{result.hashtags?.map((x,i)=><span className="pill" key={i}>{x}</span>)}</div></section>}
  <footer>Affiliate AI Studio · Free MVP · Wan 2.2 Image-to-Video</footer>
 </main>
}
