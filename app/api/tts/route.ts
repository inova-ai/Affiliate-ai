import {NextRequest,NextResponse} from "next/server";
export const runtime="nodejs";
export async function POST(req:NextRequest){
 const {text}=await req.json(); const key=process.env.OPENAI_API_KEY;
 if(!key)return NextResponse.json({audio:""});
 const r=await fetch("https://api.openai.com/v1/audio/speech",{method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({model:process.env.OPENAI_TTS_MODEL||"gpt-4o-mini-tts",voice:process.env.OPENAI_TTS_VOICE||"alloy",input:String(text||"").slice(0,4000),response_format:"mp3"})});
 if(!r.ok)return NextResponse.json({error:await r.text()},{status:500});
 const b=Buffer.from(await r.arrayBuffer());return NextResponse.json({audio:`data:audio/mpeg;base64,${b.toString("base64")}`});
}