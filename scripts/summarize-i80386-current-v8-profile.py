#!/usr/bin/env python3
"""Disjoint V8 CPU self-sample counts for a current-source 386 profile.

These source-function bins are diagnostic lower bounds when V8 inlines calls;
they are not operation timings or a promise that all samples are removable.
"""

import collections
import json
import pathlib
import sys


def summarize(path):
    profile = json.loads(pathlib.Path(path).read_text())
    nodes = {node['id']: node for node in profile['nodes']}
    functions = collections.Counter()
    for node_id in profile['samples']:
        frame = nodes[node_id]['callFrame']
        url = frame['url'].rsplit('/', 1)[-1]
        functions[(url, frame['functionName'] or '<anonymous>')] += 1
    total = len(profile['samples'])
    direct_fetch_decode_names = ('_fetch8', '_fetchN', '_decodeEA')
    direct_fetch_decode = {
        name: functions[('i80386.js', name)] for name in direct_fetch_decode_names
    }
    ordinary_cpu = sum(count for (url, _), count in functions.items()
                       if url == 'i80386.js')
    return {
        'schema': 'bw.i80386-current-v8-functions.v1',
        'totalSelfSamples': total,
        'ordinaryCpuSelfSamples': ordinary_cpu,
        'directFetchDecodeSelfSamples': direct_fetch_decode,
        'directFetchDecodeTotal': sum(direct_fetch_decode.values()),
        'topFunctions': [
            {'url': url, 'function': name, 'selfSamples': count}
            for (url, name), count in functions.most_common(30)
        ],
    }


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: summarize-i80386-current-v8-profile.py FILE.cpuprofile')
    print(json.dumps(summarize(sys.argv[1]), indent=2))
