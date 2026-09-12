// Read-only admission check for externally supplied internal test media.
// This verifies an explicit review record, not the legal correctness of that review.
import {readFileSync, realpathSync, lstatSync, statSync} from 'node:fs';
import {resolve, relative, isAbsolute, join, sep} from 'node:path';
import {createHash} from 'node:crypto';

const requireValue = (ok, message) => {if (!ok) throw new Error(`private guest: ${message}`);};
const within = (root, path) => {const r=relative(root,path);return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r));};
export function inspectPrivateGuest({root, repository, manifest = 'manifest.json'}) {
    requireValue(typeof root === 'string' && root.length > 0, 'external fixture root required');
    const base = realpathSync(root), repo = realpathSync(repository);
    requireValue(!within(repo,base), 'media must remain outside the public source tree');
    function file(name, cap) {
        requireValue(typeof name === 'string' && /^[A-Za-z0-9_./-]+$/.test(name) && !isAbsolute(name), 'unsafe relative filename');
        const parts = name.split('/');
        requireValue(parts.every(p=>p && p !== '.' && p !== '..'), 'unsafe path component');
        let path = base;
        for (const part of parts) {path=join(path,part);requireValue(!lstatSync(path).isSymbolicLink(),'symlinks are not admitted');}
        requireValue(within(base,realpathSync(path)) && !within(repo,realpathSync(path)), 'fixture path escaped');
        const stat = statSync(path);
        requireValue(stat.isFile() && stat.size > 0 && stat.size <= cap,'fixture size/type limit');
        return readFileSync(path);
    }
    const m = JSON.parse(file(manifest,64*1024));
    requireValue(m.schema === 'brickwright-private-guest-v1' && m.distribution === 'private-test-only','private-only manifest required');
    requireValue(typeof m.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(m.id),'invalid id');
    requireValue(typeof m.version === 'string' && m.version.length > 0,'exact version required');
    requireValue(m.review?.status === 'approved-for-internal-testing' && typeof m.review.reference === 'string' && m.review.reference.trim(),'internal rights review required');
    requireValue(typeof m.source === 'string' && m.source.startsWith('https://'),'original source URL required');
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    for (const [key, cap] of [['archive',64*1024*1024],['terms',1024*1024]]) {
        requireValue(m[key] && /^[a-f0-9]{64}$/.test(m[key].sha256),'exact archive and terms hashes required');
        requireValue(hash(file(m[key].file,cap)) === m[key].sha256,`${key} hash mismatch`);
    }
    // No bytes, local paths, terms text or credentials in a shareable receipt.
    return {id:m.id,version:m.version,archiveSha256:m.archive.sha256,termsSha256:m.terms.sha256,
        admittedForLocalTesting:true,redistributionApproved:false,guestExecuted:false};
}
