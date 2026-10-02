/** Distinct ABI3 worker-local loader. ABI2 main-thread restriction is unchanged. */
import {createRequire} from 'node:module';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {isMainThread} from 'node:worker_threads';
import {sha256} from './derive.mjs';
const require=createRequire(import.meta.url);let image=null;
export function loadOwnedNative(path,expectedSha256){
 if(isMainThread)throw Error('owned ABI3 requires private initializing worker');
 if(typeof path!=='string'||!path.endsWith('.node')||typeof expectedSha256!=='string'||!(/^[a-f0-9]{64}$/).test(expectedSha256))throw Error('owned artifact path/SHA');
 const actual=realpathSync(path),st=statSync(actual);if(!st.isFile()||st.size>256*1024*1024)throw Error('bounded regular addon');
 if(sha256(readFileSync(actual))!==expectedSha256)throw Error('owned artifact SHA mismatch');
 if(image)throw Error('owned loader one image lifetime');
 const api=require(actual);if(api.abiVersion!==3)throw Error('owned ABI3 required');
 for(const name of ['create','resume','setIRQ','inspect','close'])if(typeof api[name]!=='function')throw Error('owned export '+name);
 image=Object.freeze(api);return image;
}
