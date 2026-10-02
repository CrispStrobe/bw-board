import {createHash} from 'node:crypto';
import {loadHotNative} from '../bochs-cpu3-native-hot-direct/loader.mjs';
import {HotDirectBoardFacade} from '../bochs-cpu3-native-hot-direct/board.mjs';
import {hotNativeProfile} from '../bochs-cpu3-native-hot-direct/profile.mjs';
import {installPackedScalar} from './packed-scalar.mjs';
export function loadPackedHotNative(path,expectedSha256,rom){
 const native=loadHotNative(path,expectedSha256,rom);
 return Object.freeze({...native,create(configuration,actualRom,board,capture){
  if(!(board instanceof HotDirectBoardFacade))throw Error('packed scalar requires actual bounded hot board facade');
  if(!(actualRom instanceof Uint8Array)||actualRom.length!==65536||createHash('sha256').update(actualRom).digest('hex')!==hotNativeProfile.romSha256)throw Error('packed scalar requires authenticated hot ROM');
  installPackedScalar(board);return native.create(configuration,actualRom,board,capture);
 }});
}
