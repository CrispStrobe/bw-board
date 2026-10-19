import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),root='/tmp/labwired-same-host-20261003.R0T0cC';
for(const script of ['verify-edge-eligibility-bool-tail-hosted.mjs','start-edge-eligibility-bool-tail-evaluation.mjs']) {
 const task=exec('node',[root+'/'+script],{timeout:24*60*60*1000,maxBuffer:8*1024*1024});
 task.child.stdout.pipe(process.stdout);task.child.stderr.pipe(process.stderr);
 await task;
}
