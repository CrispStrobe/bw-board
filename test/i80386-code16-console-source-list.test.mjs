import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

test('console source hashes cover the static code16 dispatcher import closure', () => {
  const script=fileURLToPath(new URL('../scripts/run-i80386-at-console.mjs',
    import.meta.url));
  const text=readFileSync(script,'utf8');
  const sourceList=text.match(/const sourcePaths=\[([\s\S]*?)\];/)?.[1];
  assert.ok(sourceList,'console sourcePaths exists');
  const listed=new Set([...sourceList.matchAll(/['"]([^'"]+)['"]/g)]
    .map(([,path])=>path));
  const seen=new Set();
  const visit=path=>{
    assert.ok(listed.has(path),`${path} is absent from console source hashes`);
    if(seen.has(path))return;
    seen.add(path);
    const filename=resolve(dirname(script),path);
    const source=readFileSync(filename,'utf8');
    for(const [,dependency] of source.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)){
      const target=resolve(dirname(filename),dependency);
      visit(relative(dirname(script),target));
    }
  };
  visit('../src/experimental/i80386-code16-wasm-block.js');
  assert.ok(seen.has('../src/experimental/i80386-code16-window.js'));
  assert.ok(seen.has('../src/experimental/i80386-code16-ea.js'));
  assert.ok(seen.has('../src/experimental/i80386-code16-data-window.js'));
});
