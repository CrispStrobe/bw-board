/** Load an explicitly supplied native artifact; never build or silently fall back. */
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
export function loadDirectNative(path,expectedSha256){
 if(typeof path!=='string'||!path.endsWith('.node')||!(/^[a-f0-9]{64}$/).test(expectedSha256))throw Error('direct native artifact path and SHA required');
 const absolute=resolve(path),sha=createHash('sha256').update(readFileSync(absolute)).digest('hex');
 if(sha!==expectedSha256)throw Error('direct native artifact SHA mismatch');
 const api=require(absolute);
 for(const name of ['create','resume','setIRQ','inspect','close'])if(typeof api[name]!=='function')throw Error('direct native export missing: '+name);
 return api;
}
