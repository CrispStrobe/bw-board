import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// A dated guest receipt attests to the source it executed, not to HEAD today.
// CI fetches this exact commit before the evidence tests; a missing object is
// a hard failure, never a reason to skip a source check.
const root=new URL('../../',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export function assertI80386HistoricalSourceBindings(receipt,required=[]){
  assert.match(receipt.executionRevision,/^[0-9a-f]{40}$/);
  const bound=Object.entries(receipt.sourceSha256??{});
  assert.ok(bound.length>=required.length&&bound.length>0,
    'historical receipt must bind a nonempty source set');
  for(const file of required)
    assert.ok(file in receipt.sourceSha256,`${file} must be source-bound`);
  for(const [file,hash] of bound){
    assert.match(file,/^(src|scripts)\/[a-zA-Z0-9._/-]+$/);
    assert.match(hash,/^[0-9a-f]{64}$/);
    const committed=execFileSync('git',
      ['show',`${receipt.executionRevision}:${file}`],{cwd:root});
    assert.equal(hash,sha(committed),
      `${file} source binding at ${receipt.executionRevision}`);
  }
}
