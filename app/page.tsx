 "use client";
import {useState} from "react";
type Result={hook:string;script:string;caption:string;hashtags:string[]};
export default function Home(){
 const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(""),[name,setName]=useState(""),[link,setLink]=useState(""),[style,setStyle]=useState("soft selling"),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[status,setStatus]=useState("Siap"),[audio,setAudio]=useState("");
 const choose=(f:File)=>{setFile(f);setPreview(URL.createObjectURL(f));};
 async function generate(){
  if(!file)return alert("Upload foto produk dulu.");
  setBusy(true);setStatus("AI sedang membaca produk...");
  const fd=new FormData();fd.append("image",file);fd.append("productName",name);fd.append("affiliateLink",link);fd.append("style",style);
  try{
   const r=await fetch("/api/analyze",{method:"POST",body:fd}); if(!r.ok)throw new Error(await r.text());
   const data=await r.json();setResult(data);
   setStatus("Script selesai. Membuat voice-over...");
   const tr=await fetch("/api/tts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:data.script})});
   if(tr.ok){const tj=await tr.json();setAudio(tj.audio||"");}
   setStatus("Konten AI siap.");
  }catch(e:any){setStatus("Gagal: "+e.message)}
  setBusy(false);
 }
 return <main className="wrap">
  <section className="hero"><h1>Affiliate AI Studio</h1><p>Upload sekali → AI buat hook, script, caption, hashtag & voice-over untuk konten affiliate.</p></section>
  <div className="grid">
   <section className="card">
    <div className="drop" onClick={()=>document.getElementById("file")?.click()}>
      {preview?<img src={preview}/>:<><b>＋ Upload foto produk</b><div style={{marginTop:8,color:"#64748b"}}>JPG / PNG</div></>}
    </div>
    <input id="file" hidden type="file" accept="image/*" onChange={e=>e.target.files?.[0]&&choose(e.target.files[0])}/>
    <div className="field"><label>Nama produk</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Contoh: Blazer wanita premium"/></div>
    <div className="field"><label>Link affiliate</label><input value={link} onChange={e=>setLink(e.target.value)} placeholder="https://..."/></div>
    <div className="field"><label>Gaya konten</label><select value={style} onChange={e=>setStyle(e.target.value)}><option>soft selling</option><option>hard selling</option><option>review jujur</option><option>viral / hook kuat</option><option>elegan</option></select></div>
    <button className="btn" disabled={busy} onClick={generate}>{busy?"AI sedang bekerja...":"✨ BUAT KONTEN OTOMATIS"}</button>
    <div className="status">{status}</div>
   </section>
   <section className="card">
    <div className="video">{preview?<><div><b>Preview 9:16</b><br/><small>MP4 final dirender oleh worker setelah storage/worker dihubungkan.</small></div></>:"Preview video akan muncul di sini"}</div>
    {audio&&<audio controls src={audio} style={{width:"100%",marginTop:12}}/>}
   </section>
  </div>
  {result&&<section className="card" style={{marginTop:18}}>
   <h2>Hasil AI</h2><h3>Hook</h3><div className="result">{result.hook}</div>
   <h3>Script</h3><div className="result">{result.script}</div>
   <h3>Caption</h3><div className="result">{result.caption}</div>
   <h3>Hashtag</h3>{result.hashtags.map((x,i)=><span className="pill" key={i}>{x}</span>)}
  </section>}
 </main>
}