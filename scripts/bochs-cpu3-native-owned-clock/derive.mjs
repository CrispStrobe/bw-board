import {createHash} from 'node:crypto';
export const sha256=b=>createHash('sha256').update(b).digest('hex');
export function authenticated(bytes,sha,label){if(sha256(bytes)!==sha)throw Error('owned ABI3 pinned '+label+' changed');return bytes.toString();}
export function replacement(source,old,next,label){if(source.split(old).length!==2)throw Error('owned ABI3 exact seam '+label);return source.replace(old,next);}
