const channels=new Map();

export function createProgress(id){
  const state={id,status:"queued",progress:0,stage:"Queued",message:"Preparing production…",
    segment:0,totalSegments:0,attempt:0,events:[],updatedAt:new Date().toISOString()};
  channels.set(id,state);
  return state;
}
export function getProgress(id){return channels.get(id)||null;}
export function updateProgress(id,patch){
  const s=channels.get(id)||createProgress(id);
  Object.assign(s,patch,{updatedAt:new Date().toISOString()});
  s.events.push({at:s.updatedAt,status:s.status,stage:s.stage,progress:s.progress,message:s.message,
    segment:s.segment,attempt:s.attempt});
  if(s.events.length>100) s.events=s.events.slice(-100);
  channels.set(id,s); return s;
}
export function finishProgress(id,ok,message){
  return updateProgress(id,{status:ok?"ready":"failed",progress:ok?100:safeProgress(id),stage:ok?"VIDEO READY":"Pipeline stopped",message});
}
function safeProgress(id){return Math.max(0,Math.min(99,getProgress(id)?.progress||0));}
export function subscribeProgress(id,res){
  res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-cache","Connection":"keep-alive",
    "X-Accel-Buffering":"no"});
  const send=()=>{const s=getProgress(id); if(s) res.write(`data: ${JSON.stringify(s)}\n\n`);};
  send();
  const timer=setInterval(send,800);
  const end=()=>clearInterval(timer);
  res.on("close",end);
  return end;
}
