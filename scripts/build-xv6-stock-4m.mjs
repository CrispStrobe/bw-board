#!/usr/bin/env node
/* Build pinned stock SMP xv6 for the 4 MiB or ROM-safe 15 MiB AT profile. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const source = path.resolve(process.env.XV6_SRC ?? '/tmp/xv6-public');
const phystop = process.env.XV6_PHYSTOP ?? '0x400000';
if (!['0x400000', '0xE00000'].includes(phystop))
  throw new Error('XV6_PHYSTOP must be 0x400000 or 0xE00000');
const profile = phystop === '0x400000' ? '4m' : '14m';
const output = path.resolve(process.env.XV6_STOCK_OUT ??
  (profile === '4m' ? process.env.XV6_STOCK_4M_OUT : undefined) ?? `/tmp/xv6-stock-${profile}`);
const revision = 'eeb7b415dbcb12cc362d0783e41c3d1f44066b17';
if (execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim() !== revision)
  throw new Error(`xv6 source must be at pinned revision ${revision}`);
fs.rmSync(output, {recursive: true, force: true}); fs.mkdirSync(output, {recursive: true});
const archive = execFileSync('git', ['-C', source, 'archive', '--format=tar', revision], {maxBuffer: 32 * 1024 * 1024});
execFileSync('tar', ['-xf', '-', '-C', output], {input: archive});
const file = path.join(output, 'memlayout.h');
const text = fs.readFileSync(file, 'utf8');
if (!text.includes('#define PHYSTOP 0xE000000')) throw new Error('PHYSTOP anchor missing');
fs.writeFileSync(file, text.replace('#define PHYSTOP 0xE000000', `#define PHYSTOP ${phystop}`));
const flags = '-fno-pic -static -fno-builtin -fno-strict-aliasing -O2 -Wall -MD -ggdb -m32 -march=i386 -fno-omit-frame-pointer -fno-stack-protector -fno-pie -no-pie -Wno-error=array-bounds';
execFileSync('make', ['clean'], {cwd: output, stdio: 'inherit'});
execFileSync('make', ['TOOLPREFIX=', 'QEMU=true', `CFLAGS=${flags}`, '-j2', 'xv6.img', 'fs.img'], {cwd: output, stdio: 'inherit'});
const sha = execFileSync('sha256sum', ['xv6.img'], {cwd: output, encoding: 'utf8'}).split(/\s/)[0];
const fsSha = execFileSync('sha256sum', ['fs.img'], {cwd: output, encoding: 'utf8'}).split(/\s/)[0];
const receipt = {schema: 'astra.xv6-stock-build.v2', source, sourceRevision: revision, output, image: 'xv6.img', imageSha256: sha, filesystemImage: 'fs.img', filesystemImageSha256: fsSha, phystop, profile, stockSmp: true};
fs.writeFileSync(path.join(output, `bw-xv6-stock-${profile}-receipt.json`), `${JSON.stringify(receipt, null, 2)}\n`); console.log(JSON.stringify(receipt, null, 2));
