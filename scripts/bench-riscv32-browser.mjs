#!/usr/bin/env node
/**
 * The RISC-V bench workloads in headless Chromium: the same
 * scripts/riscv-bench/workloads.mjs as the Node bench, loaded as ES modules
 * from a throwaway local HTTP server, timed with performance.now() in the page.
 *
 *   PLAYWRIGHT_DIR=/path/with/node_modules RV_BENCH_DIR=... XV6_KERNEL=... XV6_FS=... \
 *       node scripts/bench-riscv32-browser.mjs [workload...]
 *
 * RV_SRC=DIR serves another tree's src/ (its core) in place of this one's.
 * Playwright is not a bw-board dependency: PLAYWRIGHT_DIR names a directory
 * whose node_modules has it (e.g. a brickwright-lite checkout).
 */
import {createServer} from 'node:http';
import {readFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve, join, extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pwDir = process.env.PLAYWRIGHT_DIR;
if (!pwDir) { console.error('set PLAYWRIGHT_DIR to a directory whose node_modules has playwright'); process.exit(2); }
const {chromium} = createRequire(join(pwDir, 'package.json'))('playwright');
const workloads = process.argv.slice(2).length ? process.argv.slice(2) : ['alu', 'coremark', 'dhrystone', 'xv6'];

// Files the page may fetch, by URL path: the repo tree, plus /input/<name>.
const inputs = {
    coremark: process.env.RV_BENCH_DIR && join(process.env.RV_BENCH_DIR, 'coremark-ecall.elf'),
    dhrystone: process.env.RV_BENCH_DIR && join(process.env.RV_BENCH_DIR, 'dhrystone-ecall.elf'),
    kernel: process.env.XV6_KERNEL, fs: process.env.XV6_FS,
    linuxImage: process.env.LINUX_IMAGE, linuxInitrd: process.env.LINUX_INITRD,
};
const TYPES = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html'};
const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file;
    if (url === '/') { res.writeHead(200, {'content-type': 'text/html'}); res.end('<!doctype html><title>rv bench</title>'); return; }
    if (url.startsWith('/input/')) file = inputs[url.slice(7)];
    else if (url.startsWith('/src/') && process.env.RV_SRC) file = join(resolve(process.env.RV_SRC), url.slice(5));
    else file = join(root, url);
    if (!file || !existsSync(file) || url.includes('..')) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'content-type': TYPES[extname(file)] || 'application/octet-stream'});
    res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({headless: true});
const page = await browser.newPage();
await page.goto(base + '/');
console.log(`Chromium ${browser.version()}`);
for (const w of workloads) {
    if (w === 'linux' && !(inputs.linuxImage && inputs.linuxInitrd)) { console.log('linux: skipped (LINUX_IMAGE / LINUX_INITRD not set)'); continue; }
    const r = await page.evaluate(async w => {
        const {RiscV32Machine} = await import('/src/riscv32-machine.js');
        const W = await import('/scripts/riscv-bench/workloads.mjs');
        const bytes = async n => new Uint8Array(await (await fetch('/input/' + n)).arrayBuffer());
        if (w === 'alu') { const {assembleRiscv} = await import('/src/riscv-asm.js'); return W.runAlu(RiscV32Machine, assembleRiscv); }
        if (w === 'coremark' || w === 'dhrystone') { const x = W.runBareElf(RiscV32Machine, await bytes(w)); delete x.output; return x; }
        if (w === 'xv6') return W.runXv6(RiscV32Machine, await bytes('kernel'), await bytes('fs'));
        if (w === 'linux') {
            const {bootLinux} = await import('/src/riscv32-linux.js');
            return W.runLinux(RiscV32Machine, bootLinux, await bytes('linuxImage'), await bytes('linuxInitrd'));
        }
        throw new Error('unknown workload ' + w);
    }, w);
    console.log(`${w}: ${r.instructions} instructions in ${r.seconds.toFixed(2)} s = ${(r.instructions / r.seconds / 1e6).toFixed(2)} MIPS (chromium)`);
}
await browser.close();
server.close();
