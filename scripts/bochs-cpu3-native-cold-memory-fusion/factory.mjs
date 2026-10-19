/** No caller-controlled board/config/hooks or expected-ledger authority. */
import assert from 'node:assert/strict';
import {createOwnedColdBiosProvider} from '../bochs-cpu3-native-cold-bios/board-provider.mjs';
import {memoryFusionCallbacks} from './provider.mjs';
export function createOwnedMemoryFusionProvider(...args){
 assert.equal(args.length,0,'fixed private fusion factory');
 const held=createOwnedColdBiosProvider(),fusion=memoryFusionCallbacks(held);
 return Object.freeze({...held,callbacks:fusion.callbacks,bridgeEntryCounts:fusion.entryCounts});
}
