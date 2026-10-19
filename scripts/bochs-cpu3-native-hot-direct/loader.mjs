import {createHash} from 'node:crypto';
import {loadDirectNative} from '../bochs-cpu3-native-direct-board-adapter/loader.mjs';
import {hotNativeProfile as profile} from './profile.mjs';
export function loadHotNative(path,actualArtifactSha256,rom){
 if(!(rom instanceof Uint8Array)||rom.length!==65536||createHash('sha256').update(rom).digest('hex')!==profile.romSha256)throw Error('authenticated hot ROM required before native load');
 return loadDirectNative(path,actualArtifactSha256);
}
