import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const HELD_NAPI_SHA='052dfe2d8bbcf37b2abd621dbd78c5f2078026f34cb02fa1afd40ee1c9cb15ac';
export const PROGRESS_PROFILE='bw.cold-native.compact-progress.v1';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function deriveCompactProgressNapi(){
 const base=readFileSync(new URL('./held-napi.cc',import.meta.url));if(hash(base)!==HELD_NAPI_SHA)throw Error('held NAPI hash');let s=base.toString();const edits=[];
 const replace=(old,next,label)=>{if(s.split(old).length-1!==1)throw Error('seam '+label);s=s.replace(old,next);edits.push({old,next,count:1,label});};
 replace('napi_value invoke(napi_env e,napi_callback_info info){',readFileSync(new URL('./progress.inc',import.meta.url),'utf8')+'\nnapi_value invoke(napi_env e,napi_callback_info info){','new progress helpers');
 replace('if(strcmp(op,"close")==0){','if(strcmp(op,"resumeProgress")==0)return resume_progress(argc,argv);if(strcmp(op,"close")==0){','new op after held allowed guard');
 replace('napi_value init(napi_env e,napi_value exports){','napi_value init(napi_env e,napi_value exports){napi_value progressProfile;if(!ok(napi_create_string_utf8(e,"'+PROGRESS_PROFILE+'",NAPI_AUTO_LENGTH,&progressProfile))||!ok(napi_set_named_property(e,exports,"progressExportProfile",progressProfile)))return nullptr;','distinct export profile');
 replace('{"create","resume","setIRQ","inspect","close"}','{"create","resume","resumeProgress","setIRQ","inspect","close"}','new fixed export');
 let inverse=s;for(const e of [...edits].reverse()){if(inverse.split(e.next).length-1!==1)throw Error('inverse '+e.label);inverse=inverse.replace(e.next,e.old);}if(hash(inverse)!==HELD_NAPI_SHA)throw Error('full inverse');
 return {bytes:Buffer.from(s),baseSha256:HELD_NAPI_SHA,progressExportProfile:PROGRESS_PROFILE,edits};
}
