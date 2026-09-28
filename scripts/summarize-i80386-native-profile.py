#!/usr/bin/env python3
"""Disjoint self-sample bins for a Node --cpu-prof native xv6 run.

The bins are source-position attribution, not exclusive operation timing:
V8 can inline window checks and state copies into a caller's `run` frame.
"""

import collections
import json
import pathlib
import sys


def bucket(frame):
    name = frame['functionName']
    url = frame['url'].rsplit('/', 1)[-1]
    if url == 'i80386-native-dispatch.js':
        return 'dispatcher_mixed'
    if url == 'i80386-native-byte-block.js':
        if name == 'run':
            return 'native_runner_mixed'
        if name == 'isI80386NativeByteBlockValid':
            return 'block_validation_direct'
        if name in ('decode', 'decodeI80386NativeByteBlock'):
            return 'native_decode_direct'
        return 'native_runner_other'
    if url in ('i80386-read-window.js', 'i80386-write-window.js'):
        return 'window_validation_direct'
    if url == 'i80386-block-spike.js':
        if name in ('setCpuState', 'copyStateToCpu'):
            return 'cpu_state_copy_direct'
        if name == 'setProgram':
            return 'set_program_direct'
        if name == 'run':
            return 'wasm_call_wrapper_direct'
        return 'block_spike_other'
    if 'i80386-block-spike.wasm' in url:
        return 'wasm_execution'
    if url == 'i80386.js':
        return 'ordinary_cpu_core'
    if url in ('i80386-at-machine.js', 'i8086-machine.js') or url in (
        'vga-memory.js', 'vga-card.js', 'ata16.js', 'i8254.js',
        'mc146818.js', 'at-8042-a20.js', 'i8259.js', 'upd765.js',
        'i80386-ram-bridge.js'):
        return 'board_and_devices'
    return 'other_host_runtime'


def main(path):
    profile = json.loads(pathlib.Path(path).read_text())
    nodes = {node['id']: node for node in profile['nodes']}
    bins = collections.Counter()
    for node_id in profile['samples']:
        bins[bucket(nodes[node_id]['callFrame'])] += 1
    total = len(profile['samples'])
    report = {
        'schema': 'bw.i80386-native-profile-self-samples.v1',
        'totalSamples': total,
        'durationMicroseconds': profile['endTime'] - profile['startTime'],
        'disjointSelfSamples': dict(sorted(bins.items())),
        'entryMixedEnvelopeSamples': bins['dispatcher_mixed'] +
            bins['native_runner_mixed'],
        'entryMixedEnvelopePercent': round(100 * (
            bins['dispatcher_mixed'] + bins['native_runner_mixed']) / total, 3),
        'directProgramStateRunSamples': bins['set_program_direct'] +
            bins['cpu_state_copy_direct'] + bins['wasm_call_wrapper_direct'] +
            bins['wasm_execution'],
    }
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: summarize-i80386-native-profile.py FILE.cpuprofile')
    main(sys.argv[1])
