/** CI scheduling only: retain npm's exact test command and shell file expansion. */
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const script=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts.test;
// The audited package command consists solely of node --test and file patterns.
// Refuse future shell operators/options rather than silently changing selection.
if(typeof script!=='string'||!/^node --test(?: test\/[A-Za-z0-9_.*?/-]+)+$/.test(script))throw Error('CI serial runner: package test command needs an explicit scheduling audit');
const command=script.replace(/^node --test /,'node --test --test-concurrency=1 ');
if(process.argv[2]==='--print-command'&&process.argv.length===3)console.log(command);
else{
 if(process.argv.length!==2)throw Error('CI serial runner: unexpected arguments');
 // npm uses /bin/sh for this package script on the Linux CI runner. Keep its
 // glob expansion and all explicit trailing files, including duplicates.
 const child=spawnSync('/bin/sh',['-c',`exec ${command}`],{cwd:root,env:process.env,stdio:'inherit'});
 if(child.error)throw child.error;
 if(child.signal){process.kill(process.pid,child.signal);}else process.exitCode=child.status??1;
}
