/** H5 changes only internal scalar argument construction in authenticated H4. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {derivePackedScalarNapi} from '../bochs-cpu3-native-hot-packed-scalar/napi.mjs';
export const h4GeneratorSha256='62ae4a4371e9446136dac60c8bcc63b2abf29d2eb9445e0092ac16e2d4621123';
export const h4GeneratedNapiSha256='b57a3cea1f5f5eea2092401f8dba3041eb0bc0d19551bf4273e66ad7372c60cb';
export const argumentDeclaration=String.raw`napi_value args[4]={number(op),nullptr,nullptr,nullptr},r,ab;size_t argc=1;
 if(op==2){args[1]=number(a);argc=2;}else if(op==3){args[1]=number(a);args[2]=number(b);args[3]=number(c);argc=4;}`;
export function derivePackedArgsNapi(){
 const sha=b=>createHash('sha256').update(b).digest('hex');
 if(sha(readFileSync(new URL('../bochs-cpu3-native-hot-packed-scalar/napi.mjs',import.meta.url)))!==h4GeneratorSha256)throw Error('H4 generator source changed');
 let source=derivePackedScalarNapi().toString();if(sha(source)!==h4GeneratedNapiSha256)throw Error('H4 generated NAPI changed');
 const once=(old,value)=>{if(source.split(old).length!==2)throw Error('conditional argument seam changed');source=source.replace(old,value);};
 once('napi_value args[4]={number(op),number(a),number(b),number(c)},r,ab;',argumentDeclaration);
 once('op>=1&&op<=4&&call("packedScalar",4,args,&r)','op>=1&&op<=4&&call("packedScalar",argc,args,&r)');
 return Buffer.from('/* H5 conditional scalar arguments only; H4 host protocol unchanged. */\n'+source);
}
