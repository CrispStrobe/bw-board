/** Load an explicitly supplied native artifact; never build or silently fall back. */
import {createRequire} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {isMainThread} from 'node:worker_threads';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const imageKey=Symbol.for('bw.direct-native-addon.image.v1');
// This entry point admits one canonical image in the main JS realm. Direct
// require() bypasses and separately copied DSOs are outside this loader contract;
// each DSO's native lifetime lock must not be described as process-wide across them.
export function loadDirectNative(path,expectedSha256){
 if(!isMainThread)throw Error('direct native loader requires main thread');
 if(typeof path!=='string'||!path.endsWith('.node')||!(/^[a-f0-9]{64}$/).test(expectedSha256))throw Error('direct native artifact path and SHA required');
 const absolute=realpathSync(resolve(path)),sha=createHash('sha256').update(readFileSync(absolute)).digest('hex');
 if(sha!==expectedSha256)throw Error('direct native artifact SHA mismatch');
 const previous=globalThis[imageKey];
 if(previous&&(previous.path!==absolute||previous.sha256!==sha))throw Error('direct native duplicate addon image rejected');
 if(previous){if(previous.api.abiVersion!==2)throw Error('direct native ABI version mismatch');return previous.api;}
 const api=require(absolute);
 if(api.abiVersion!==2)throw Error('direct native ABI version mismatch');
 for(const name of ['create','resume','setIRQ','inspect','close'])if(typeof api[name]!=='function')throw Error('direct native export missing: '+name);
 Object.defineProperty(globalThis,imageKey,{value:Object.freeze({path:absolute,sha256:sha,api}),configurable:false,writable:false});
 return api;
}
