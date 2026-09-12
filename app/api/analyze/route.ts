import {NextRequest,NextResponse} from "next/server";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 const form=await req.formData(); const image=form.get("image") as File|null; const productName=String(form.get("productName")||""); const style=String(form.get("style")||"soft selling");
 if(!image)return NextResponse.json({error:"image required"},{status:400});
 const key=process.env.OPENAI_API_KEY;
 if(!key)return NextResponse.json({hook:"Demo: Produk yang kelihatan biasa, ternyata kepakai banget! 🔥",script:`${productName||"Produk ini"} cocok untuk kamu yang ingin tampil lebih rapi dan praktis. Lihat detailnya, cek ukurannya, lalu bandingkan harganya sebelum checkout.`,caption:`Lagi cari ${productName||"produk menarik"}? Ini bisa jadi pilihan. Cek detail dan harga lewat link affiliate.`,hashtags:["#affiliate","#racunbelanja","#rekomendasi"]});
 const buf=Buffer.from(await image.arrayBuffer()); const mime=image.type||"image/jpeg"; const data=`data:${mime};base64,${buf.toString("base64")}`;
 const body={model:process.env.OPENAI_TEXT_MODEL||"gpt-5.6-luna",input:[{role:"user",content:[
  {type:"input_text",text:`Buat materi affiliate berbahasa Indonesia. Nama produk: ${productName||"(lihat gambar)"}. Gaya: ${style}. Analisis gambar. Jangan mengarang spesifikasi yang tidak terlihat. Output JSON saja dengan hook, script, caption, hashtags (array 6 item). Hook singkat dan kuat. Script 15-20 detik, natural, tidak menipu, tanpa klaim medis.`},
  {type:"input_image",image_url:data}
 ]}],text:{format:{type:"json_schema",name:"affiliate",schema:{type:"object",additionalProperties:false,properties:{hook:{type:"string"},script:{type:"string"},caption:{type:"string"},hashtags:{type:"array",items:{type:"string"}}},required:["hook","script","caption","hashtags"]}}}};
 const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
 if(!r.ok)return NextResponse.json({error:await r.text()},{status:500});
 const j=await r.json(); let txt="";
 for(const o of (j.output||[]))for(const c of (o.content||[]))if(c.type==="output_text")txt+=c.text||"";
 try{return NextResponse.json(JSON.parse(txt))}catch{return NextResponse.json({error:"AI JSON invalid"},{status:500})}
}