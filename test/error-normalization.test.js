import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('public/index.html','utf8');

test('client error handling never constructs Error directly from JSON error objects',()=>{
  assert.match(html,/function explainError\(value\)/);
  assert.match(html,/new Error\(explainError\(j\.detail\|\|j\.error\|\|j/);
  assert.match(html,/new Error\(explainError\(sj\.detail\|\|sj\.error\|\|sj/);
  assert.match(html,/new Error\(explainError\(ij\.detail\|\|ij\.error\|\|ij/);
});

test('motion transfer catch renders normalized text instead of Error.message object coercion',()=>{
  assert.ok(html.includes('catch(e){const msg=explainError(e);status.textContent="Error: "+msg;$("job").textContent=msg}'));
  assert.doesNotMatch(html,/catch\(e\)\{\$\("job"\)\.textContent=e\.message\}/);
});
