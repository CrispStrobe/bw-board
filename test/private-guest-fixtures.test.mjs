import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectPrivateGuest} from '../scripts/lib/private-guest-fixtures.mjs';

function fixture(t) {
    const top=mkdtempSync(join(tmpdir(),'bw-private-contract-')),root=join(top,'private'),repository=join(top,'public');
    t.after(()=>rmSync(top,{recursive:true,force:true}));mkdirSync(root);mkdirSync(repository);
    const archive='owned synthetic archive bytes',terms='owned synthetic permission statement';
    const hash=s=>createHash('sha256').update(s).digest('hex');
    writeFileSync(join(root,'owned.zip'),archive);writeFileSync(join(root,'terms.txt'),terms);
    const m={schema:'brickwright-private-guest-v1',id:'synthetic',version:'1',distribution:'private-test-only',
        source:'https://example.org/owned',review:{status:'approved-for-internal-testing',reference:'synthetic test'},
        archive:{file:'owned.zip',sha256:hash(archive)},terms:{file:'terms.txt',sha256:hash(terms)}};
    const save=()=>writeFileSync(join(root,'manifest.json'),JSON.stringify(m));save();
    return {root,repository,m,save};
}
test('owned external fixture admission is read-only and not execution or redistribution approval',t=>{
    const f=fixture(t),result=inspectPrivateGuest(f);
    assert.equal(result.admittedForLocalTesting,true);assert.equal(result.redistributionApproved,false);
    assert.equal(result.guestExecuted,false);assert.equal(result.archiveSha256,f.m.archive.sha256);
    assert.ok(!JSON.stringify(result).includes(f.root));
});
test('missing review, terms and mismatched archive fail closed',t=>{
    const f=fixture(t);f.m.review.status='pending';f.save();assert.throws(()=>inspectPrivateGuest(f),/review required/);
    f.m.review.status='approved-for-internal-testing';f.m.terms.sha256='0'.repeat(64);f.save();assert.throws(()=>inspectPrivateGuest(f),/terms hash mismatch/);
    f.m.archive.sha256='0'.repeat(64);f.save();assert.throws(()=>inspectPrivateGuest(f),/archive hash mismatch/);
});
test('public tree, traversal and symlink media are refused',t=>{
    const f=fixture(t);assert.throws(()=>inspectPrivateGuest({...f,repository:f.root}),/outside/);
    f.m.archive.file='../private/owned.zip';f.save();assert.throws(()=>inspectPrivateGuest(f),/path component/);
    symlinkSync(join(f.root,'owned.zip'),join(f.root,'link.zip'));
    f.m.archive.file='link.zip';f.save();assert.throws(()=>inspectPrivateGuest(f),/symlinks/);
});
