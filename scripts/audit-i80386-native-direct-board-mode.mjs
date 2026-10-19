/** One audit process per mode bounds live report memory; never executes a guest. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertCaptureModeParity,assertNativeTraceParity} from './audit-i80386-native-direct-board-adapter.mjs';
const options=JSON.parse(readFileSync(process.argv[2],'utf8'));
const captured=JSON.parse(readFileSync(options.paths.true.report,'utf8'));
let uncaptured=JSON.parse(readFileSync(options.paths.false.report,'utf8'));
assertCaptureModeParity(captured,uncaptured);
uncaptured=null; // Drop the capture-off checkpoints before admitting FIFO data.
if(options.fifoCapture){
 const fifo=JSON.parse(readFileSync(options.fifoCapture,'utf8'));
 const arm=fifo.arms[options.mode];
 assertNativeTraceParity(readFileSync(options.paths.true.stderr,'utf8'),arm.raw.stderr,{direct:captured,fifo:arm});
}
const hashes={};for(const [capture,files] of Object.entries(options.paths))for(const [kind,path] of Object.entries(files))hashes[`${capture}:${kind}`]={path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};
writeFileSync(options.receipt,JSON.stringify({mode:options.mode,captureModeParity:true,directVsFifoParity:!!options.fifoCapture,scope:options.fifoCapture?'raw native trace and full callback board comparison':'capture mode comparison only',callbackCount:captured.callbacks.length,artifacts:hashes}));
