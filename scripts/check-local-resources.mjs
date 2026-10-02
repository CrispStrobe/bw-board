#!/usr/bin/env node
/** Run immediately before substantial local work; nonzero means defer/offload. */
import {readFileSync, statfsSync} from 'node:fs';
import {availableParallelism, loadavg} from 'node:os';
import {resolve} from 'node:path';
import {memoryAvailable, decideResources, POLICIES} from './lib/local-resource-preflight.mjs';

try {
    const args = process.argv.slice(2), paths = [];
    let kind;
    for (let index = 0; index < args.length; index += 2) {
        const value = args[index + 1];
        if (!value || value.startsWith('--')) throw Error('Use --kind build|benchmark --path DIRECTORY [--path DIRECTORY]');
        if (args[index] === '--kind' && !kind) kind = value;
        else if (args[index] === '--path') paths.push(resolve(value));
        else throw Error('Unknown or repeated option');
    }
    if (!Object.hasOwn(POLICIES, kind) || !paths.length) throw Error('Explicit work kind and all output/temp volume paths required');
    const sample = {capturedAt: new Date().toISOString(), cpus: availableParallelism(), load: loadavg(),
        memoryAvailableBytes: memoryAvailable(readFileSync('/proc/meminfo', 'utf8')),
        disks: paths.map(path => {
            const stat = statfsSync(path, {bigint: true});
            // bavail, not bfree: reserved filesystem blocks are not available to us.
            return {path, availableBytes: Number(stat.bavail * stat.bsize)};
        })};
    const decision = decideResources(sample, kind);
    console.log(JSON.stringify({schema: 'local.resource-preflight.v1', sample, ...decision}, null, 2));
    if (!decision.allowed) process.exitCode = 1;
} catch (error) {
    console.error('Resource preflight refused: ' + error.message);
    process.exitCode = 2;
}
