#!/usr/bin/env node
/* Build a deliberately labelled one-CPU xv6 image for the PIC-only AT profile.
 * The stock MIT tree remains untouched; this is a diagnostic guest variant,
 * not evidence that the unmodified SMP kernel has booted. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const source = path.resolve(process.env.XV6_SRC ?? '/tmp/xv6-public');
const output = path.resolve(process.env.XV6_UP_OUT ?? '/tmp/xv6-up');
fs.rmSync(output, {recursive: true, force: true});
fs.cpSync(source, output, {recursive: true});
const replace = (file, from, to) => {
  const name = path.join(output, file);
  const text = fs.readFileSync(name, 'utf8');
  if (!text.includes(from)) throw new Error(`xv6 UP patch anchor missing: ${file}`);
  fs.writeFileSync(name, text.replace(from, to));
};
replace('main.c',
  '  mpinit();        // detect other processors\n  lapicinit();     // interrupt controller',
  '  #ifdef BW_XV6_UP\n  ncpu = 1; cpus[0].apicid = 0;\n  #else\n  mpinit();        // detect other processors\n  lapicinit();     // interrupt controller\n  #endif');
replace('main.c',
  '  ioapicinit();    // another interrupt controller',
  '  #ifndef BW_XV6_UP\n  ioapicinit();    // another interrupt controller\n  #endif');
replace('main.c',
  '  startothers();   // start other processors',
  '  #ifndef BW_XV6_UP\n  startothers();   // start other processors\n  #endif');
replace('ioapic.c',
  'void\nioapicenable(int irq, int cpunum)\n{',
  'void\nioapicenable(int irq, int cpunum)\n{\n  #ifdef BW_XV6_UP\n  return;\n  #endif');
const flags = '-DBW_XV6_UP -fno-pic -static -fno-builtin -fno-strict-aliasing -O2 -Wall -MD -ggdb -m32 -fno-omit-frame-pointer -fno-stack-protector -fno-pie -no-pie -Wno-error=array-bounds';
execFileSync('make', ['clean'], {cwd: output, stdio: 'inherit'});
execFileSync('make', ['TOOLPREFIX=', 'QEMU=true', `CFLAGS=${flags}`, '-j2'], {cwd: output, stdio: 'inherit'});
const sha = execFileSync('sha256sum', ['xv6.img'], {cwd: output, encoding: 'utf8'}).split(/\s/)[0];
let revision = null;
try { revision = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(); } catch {}
const receipt = {schema: 'astra.xv6-up-build.v1', source, sourceRevision: revision,
  output, image: 'xv6.img', imageSha256: sha, define: 'BW_XV6_UP', stockSmpAcceptance: false};
fs.writeFileSync(path.join(output, 'bw-xv6-up-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
