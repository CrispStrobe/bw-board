#!/usr/bin/env node
/* Build the unmodified SMP xv6 kernel against the BIOS-compatible 4MiB RAM profile. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const source = path.resolve(process.env.XV6_SRC ?? '/tmp/xv6-public');
const output = path.resolve(process.env.XV6_STOCK_4M_OUT ?? '/tmp/xv6-stock-4m');
fs.rmSync(output, {recursive: true, force: true}); fs.cpSync(source, output, {recursive: true});
const file = path.join(output, 'memlayout.h');
const text = fs.readFileSync(file, 'utf8');
if (!text.includes('#define PHYSTOP 0xE000000')) throw new Error('PHYSTOP anchor missing');
fs.writeFileSync(file, text.replace('#define PHYSTOP 0xE000000', '#define PHYSTOP 0x400000'));
const flags = '-fno-pic -static -fno-builtin -fno-strict-aliasing -O2 -Wall -MD -ggdb -m32 -fno-omit-frame-pointer -fno-stack-protector -fno-pie -no-pie -Wno-error=array-bounds';
execFileSync('make', ['clean'], {cwd: output, stdio: 'inherit'});
execFileSync('make', ['TOOLPREFIX=', 'QEMU=true', `CFLAGS=${flags}`, '-j2'], {cwd: output, stdio: 'inherit'});
const sha = execFileSync('sha256sum', ['xv6.img'], {cwd: output, encoding: 'utf8'}).split(/\s/)[0];
let revision = null; try { revision = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(); } catch {}
const receipt = {schema: 'astra.xv6-stock-4m-build.v1', source, sourceRevision: revision, output, image: 'xv6.img', imageSha256: sha, phystop: '0x400000', stockSmp: true};
fs.writeFileSync(path.join(output, 'bw-xv6-stock-4m-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`); console.log(JSON.stringify(receipt, null, 2));
