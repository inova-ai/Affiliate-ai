
import assert from "node:assert";
import {createShotPlan,compileShotPrompt} from "../server/shot-planner.js";
const p10=createShotPlan({duration:10,ratio:"9:16",brief:"Show a premium bottle."});
assert.equal(p10.shots.length,3); assert.equal(p10.shots.reduce((a,s)=>a+s.duration,0),10); assert.equal(p10.shots[0].type,"hook");
const p30=createShotPlan({duration:30,brief:"Luxury skincare demo.",productLock:true,product:{name:"Serum X"}});
assert.equal(p30.shots.length,6); assert.equal(p30.shots.reduce((a,s)=>a+s.duration,0),30); assert.equal(p30.preflight.status,"ready");
assert(compileShotPrompt(p30.shots[0],{productLock:true,product:{name:"Serum X"}}).includes("PRODUCT LOCK"));
console.log("shot-planner smoke test: PASS");
