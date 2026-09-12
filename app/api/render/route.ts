import {NextRequest,NextResponse} from "next/server";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 const body=await req.json(); const worker=process.env.VIDEO_WORKER_URL;
 if(!worker)return NextResponse.json({error:"VIDEO_WORKER_URL belum diisi. AI text/voice tetap bisa digunakan."},{status:503});
 const r=await fetch(`${worker.replace(/\/$/,"")}/render`,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${process.env.VIDEO_WORKER_TOKEN||""}`},body:JSON.stringify(body)});
 const text=await r.text();return new NextResponse(text,{status:r.status,headers:{"Content-Type":"application/json"}});
}