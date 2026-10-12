import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('future WASM builds require all same-PC word dispatch regressions',()=>{
    const workflow=readFileSync(new URL('../.github/workflows/labwired-wasm.yml',import.meta.url),'utf8');
    assert.match(workflow,/LABWIRED_WORD_REQUIRED: '1'/);
    assert.match(workflow,/test\/labwired-word-admission\.test\.mjs/);
    // The floor includes the seven word-dispatch cases (108); suites added
    // later may only raise it.
    const floor=/"\$\{tests:-0\}" -ge (\d+)/.exec(workflow);
    assert.ok(floor&&Number(floor[1])>=108,`labwired-wasm.yml test floor ${floor?.[1]} < 108`);
    assert.match(workflow,/"\$\{skips:-1\}" = 0/);
    const proof=readFileSync(new URL('../.github/workflows/labwired-word-dispatch.yml',import.meta.url),'utf8');
    assert.match(proof,/Number\(tests\[1\]\)===7/);
    assert.match(proof,/LABWIRED_WORD_REQUIRED: '1'/);
    assert.match(proof,/Verify original source and module bytes/);
    assert.match(proof,/node-version: '22\.23\.3'/);
});
