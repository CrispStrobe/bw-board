import assert from 'node:assert/strict';
import {parentPort,workerData} from 'node:worker_threads';
import {createOwnedProvider} from '/tmp/bw-board-386-native-owned-clock-20261002/scripts/bochs-cpu3-native-owned-clock/provider.mjs';
import {loadOwnedNative} from '/tmp/bw-board-386-native-owned-clock-20261002/scripts/bochs-cpu3-native-owned-clock/loader.mjs';
const p=createOwnedProvider(),n=loadOwnedNative(workerData.input.addon,workerData.input.sha256);let effects=0;
const callbacks={...p.callbacks,clockTransfer(...a){effects++;return p.callbacks.clockTransfer(...a);}};
assert.throws(()=>n.create(workerData.input.configuration,p.rom,callbacks,false));assert.equal(effects,0);parentPort.postMessage({secondDenied:true});
