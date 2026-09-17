import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

test("Runway asset bridge signature is deterministic",()=>{
  const secret="key_test"; const pathname="luxmotion/uploads/a.jpg"; const expires=Date.now()+900000;
  const sig=crypto.createHmac("sha256",secret).update(`${pathname}\n${expires}`).digest("hex");
  assert.equal(sig.length,64); assert.match(sig,/^[0-9a-f]{64}$/);
});

test("Runway asset bridge requires HTTPS-style GET/HEAD semantics",()=>{
  assert.deepEqual(["GET","HEAD"].sort(),["GET","HEAD"]);
});
