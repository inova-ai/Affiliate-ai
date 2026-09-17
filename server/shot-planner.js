
import crypto from "node:crypto";
const DURATIONS=[10,15,30], RATIOS=["9:16","1:1","4:5","16:9"];
const MOTIONS=["slow push-in","controlled orbit","gentle handheld","macro detail slide","top-down reveal","low-angle hero rise","parallax lateral move","static hero hold"];
const FRAMINGS=["hero medium shot","tight product close-up","macro detail","three-quarter product shot","full product composition","environmental hero shot"];
const clean=(v,max=180)=>String(v??"").replace(/\s+/g," ").trim().slice(0,max);
export function createShotPlan(input={}){
 const duration=DURATIONS.includes(Number(input.duration))?Number(input.duration):15;
 const ratio=RATIOS.includes(input.ratio)?input.ratio:"9:16";
 const brief=clean(input.brief||input.prompt||"Premium social-commerce product video.");
 const product=input.product||null, character=input.character||null;
 const productLock=!!input.productLock, characterLock=!!input.characterLock;
 const lengths=duration===10?[3,3,4]:duration===15?[4,5,6]:[5,5,5,5,5,5];
 const shots=lengths.map((seconds,i)=>{
  const type=i===0?"hook":i===lengths.length-1?"hero-payoff":i%3===1?"detail":"demonstration";
  const intent={hook:"Immediately establish the product and create a visual reason to keep watching.",detail:"Show one tactile or design detail clearly without competing focal points.",demonstration:"Show the product in use or a believable benefit moment.","hero-payoff":"End on a clean, memorable hero composition suitable for a CTA or brand beat."}[type];
  const framing=FRAMINGS[(i+(type==="hero-payoff"?2:0))%FRAMINGS.length], motion=MOTIONS[(i+(type==="detail"?1:0))%MOTIONS.length];
  return {id:`shot-${i+1}`,order:i+1,duration:seconds,type,framing,cameraMotion:motion,intent,prompt:[brief,intent,`${framing}, ${motion}.`,product?.name?`Keep product "${clean(product.name,80)}" visually consistent.`:"Keep the supplied product/reference visually consistent.",character?.name?`Keep character "${clean(character.name,80)}" consistent in face, hair, wardrobe and proportions.`:"","No unrequested logos, text changes, duplicate products, warped geometry, extra fingers, or identity drift.","Preserve realistic materials, lighting continuity and physically plausible motion."].filter(Boolean).join(" ")};
 });
 const riskFlags=[]; if(productLock&&!product)riskFlags.push("product-lock-enabled-without-product-profile"); if(characterLock&&!character)riskFlags.push("character-lock-enabled-without-character-profile");
 const plan={version:"v16",duration,ratio,productLock,characterLock,creativeBrief:brief,shots,preflight:{status:riskFlags.length?"review":"ready",riskFlags,rules:["One primary visual subject per shot.","Do not introduce unsupported product variants or wardrobe changes.","Use motion that supports shot intent.","Keep transitions physically and temporally plausible.","Regenerate a failed shot rather than silently accepting drift."]}};
 plan.planId=crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0,12); return plan;
}
export function compileShotPrompt(shot,{product,character,productLock,characterLock}={}){
 return [shot.prompt,productLock&&product?`PRODUCT LOCK: ${clean(product.name,80)}. Preserve exact shape, colors, materials and logo placement.`:"",characterLock&&character?`CHARACTER LOCK: ${clean(character.name,80)}. Preserve facial features, hair, body proportions and wardrobe.`:"","Premium commercial cinematography, natural physics, clean composition, consistent lighting."].filter(Boolean).join(" ");
}
