#!/usr/bin/env python3
"""Portable representative x86 dispatcher measurements (Linux/macOS, Python 3, Node)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import statistics
import subprocess
import time

ARMS = ['ordinary', 'dispatch', 'candidate']
METRICS = ['wholeCpuSeconds', 'wholeWallSeconds',
           'executionCpuSeconds', 'executionWallSeconds']


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()


def source(root):
    # Include ignored files in this refusal: any extra runtime input breaks binding.
    untracked = git(root, 'ls-files', '--others', '--', 'src', 'wasm')
    if untracked:
        raise RuntimeError('untracked src/wasm files are not admitted: ' + untracked)
    # Commit and complete tracked source delta bind dirty checkouts too.
    diff = subprocess.check_output(['git', '-C', str(root), 'diff', '--binary',
                                    'HEAD', '--', 'src', 'wasm'])
    relevant = [root / 'src/experimental/i80386-native-dispatch.js',
                root / 'src/experimental/i80386-at-machine.js',
                root / 'src/experimental/i80386.js',
                root / 'wasm/i80386-ram-bridge.wasm',
                root / 'wasm/i80386-block-spike.wasm']
    return {'directory': str(root), 'commit': git(root, 'rev-parse', 'HEAD'),
            'tree': git(root, 'rev-parse', 'HEAD^{tree}'),
            'sourceDiffSha256': hashlib.sha256(diff).hexdigest(),
            'sourceDiff': diff.decode(),
            'criticalHashes': {str(p.relative_to(root)): hashlib.sha256(
                p.read_bytes()).hexdigest() for p in relevant}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True, type=Path)
    parser.add_argument('--candidate', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--workload', choices=['all', 'register', 'indexed-memory'], default='all')
    parser.add_argument('--samples', type=int, default=7, help='measured rounds per workload')
    parser.add_argument('--warmup-rounds', type=int, default=2)
    parser.add_argument('--steps', type=int, default=9999999, help='positive multiple of three')
    parser.add_argument('--warmup-steps', type=int, default=25000)
    parser.add_argument('--timeout', type=float, default=30)
    parser.add_argument('--node', default='node')
    args = parser.parse_args()
    if args.samples < 1 or args.warmup_rounds < 0 or args.steps <= 0 or args.steps % 3 or args.warmup_steps < 0 or args.timeout <= 0:
        parser.error('invalid count or bound; --steps must be a positive multiple of three')
    base, candidate, out = args.base.resolve(), args.candidate.resolve(), args.out.resolve()
    # Refuse overwriting retained originals.
    out.mkdir(parents=True, exist_ok=False)
    child = Path(__file__).resolve().with_name('child.mjs')
    sources = {'base': source(base), 'candidate': source(candidate)}
    metadata = {'schema': 'x86-representative-portable.v1', 'sources': sources,
                'config': {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()},
                'node': subprocess.check_output([args.node, '--version'], text=True).strip(),
                'logicalCpus': os.cpu_count(),
                'affinity': sorted(os.sched_getaffinity(0)) if hasattr(os, 'sched_getaffinity') else None,
                'loadBefore': os.getloadavg(), 'cpuIsolated': False,
                'physicalTimingCalibrated': False, 'historicalXv6Workload': False,
                'defaultAdoption': False,
                'harnessHashes': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                                  for p in [Path(__file__).resolve(), child]}}
    if Path('/proc/cpuinfo').exists():
        metadata['cpuModel'] = next((x.split(':', 1)[1].strip() for x in
            Path('/proc/cpuinfo').read_text().splitlines() if x.startswith('model name')), None)
    write(out / 'metadata.json', metadata)
    workloads = ['register', 'indexed-memory'] if args.workload == 'all' else [args.workload]
    summaries = {}
    for workload in workloads:
        directory = out / workload
        directory.mkdir()
        samples, reference = [], None
        for round_index in range(args.samples + args.warmup_rounds):
            # Preserve the original series schedule for default rounds 0..8.
            schedules = [ARMS, ARMS[::-1], ARMS, ARMS[::-1], ARMS[1:] + ARMS[:1],
                         ARMS[::-1], ARMS, ARMS[1:] + ARMS[:1], ARMS[::-1]]
            for arm in schedules[round_index % len(schedules)]:
                root = candidate if arm == 'candidate' else base
                prefix = directory / f'round-{round_index}-{arm}'
                before = resource.getrusage(resource.RUSAGE_CHILDREN)
                start = time.monotonic()
                with prefix.with_suffix('.stdout').open('w') as stdout, prefix.with_suffix('.stderr').open('w') as stderr:
                    result = subprocess.run([args.node, str(child), str(root), arm, workload,
                        str(args.steps), str(args.warmup_steps)], cwd=root,
                        stdout=stdout, stderr=stderr, timeout=args.timeout)
                wall = time.monotonic() - start
                after = resource.getrusage(resource.RUSAGE_CHILDREN)
                if result.returncode:
                    raise RuntimeError(f'{workload}/{arm} exited {result.returncode}; raw files retained')
                report = json.loads(prefix.with_suffix('.stdout').read_text())
                row = {'round': round_index, 'measured': round_index >= args.warmup_rounds,
                       'wholeCpuSeconds': after.ru_utime + after.ru_stime - before.ru_utime - before.ru_stime,
                       'wholeWallSeconds': wall, **report}
                samples.append(row)
                write(directory / 'samples.json', samples)
                if reference is None:
                    reference = report['semantic']
                if report['semantic'] != reference:
                    raise RuntimeError(f'{workload}/{arm} correctness mismatch; raw samples retained')
                if report['steps'] != args.steps or report['semantic']['retired'] != args.steps:
                    raise RuntimeError('retirement count mismatch')
                print(workload, round_index, arm, f"CPU={row['wholeCpuSeconds']:.6f}",
                      f"wall={wall:.6f}", flush=True)
        means = {arm: {key: statistics.mean(s[key] for s in samples if s['measured'] and s['arm'] == arm)
                       for key in METRICS} for arm in ARMS}
        summary = {'children': len(samples), 'semanticEquality': True, 'means': means,
            'ratios': {key: {'dispatchOverOrdinary': means['dispatch'][key] / means['ordinary'][key],
                            'candidateOverDispatch': means['candidate'][key] / means['dispatch'][key]}
                       for key in METRICS},
            'favorableCandidatePairs': {key: sum(
                next(s[key] for s in samples if s['round'] == r and s['arm'] == 'candidate') <
                next(s[key] for s in samples if s['round'] == r and s['arm'] == 'dispatch')
                for r in range(args.warmup_rounds, args.warmup_rounds + args.samples)) for key in METRICS}}
        write(directory / 'summary.json', summary)
        summaries[workload] = summary
    if source(base) != sources['base'] or source(candidate) != sources['candidate']:
        raise RuntimeError('source drift during benchmark; samples not qualified')
    write(out / 'summary.json', {'sourceStable': True, 'loadAfter': os.getloadavg(),
                                 'workloads': summaries})
    write(out / 'inventory.json', {str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest()
                                  for p in sorted(out.rglob('*')) if p.is_file()})
    print(json.dumps(summaries, indent=2))


if __name__ == '__main__':
    main()
