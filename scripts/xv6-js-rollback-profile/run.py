#!/usr/bin/env python3
"""Hosted-only three-child stock xv6 heap-sampling diagnostic."""
import argparse
import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

from source import QUALIFIED, identity, need

HERE = Path(__file__).resolve().parent
GENERATED = 'scripts/probe-xv6-stock-rollback-profile.mjs'
SCHEDULE = (('reference', False), ('sample-1', True), ('sample-2', True))


def sha(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        while block := stream.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def generated_only(root, digest):
    path = root / GENERATED
    info = path.lstat()
    need(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= 4 * 1024 * 1024 and
         sha(path) == digest, 'exact generated sibling')
    status = subprocess.check_output(['git', '-C', str(root), 'status',
                                     '--porcelain', '--untracked-files=all'], text=True)
    need(status == '?? ' + GENERATED + '\n', 'only generated sibling in qualified checkout')


def semantic_gate(baseline, candidate):
    need(type(candidate) is dict and candidate == baseline,
         'guest semantic projection differs')


def snapshot_failure_if_admitted(accepted, output):
    if accepted is not None:
        accepted.snapshot_inventory(output)


def main():
    parser = argparse.ArgumentParser()
    for arg in ('harness', 'qualified', 'image-dir', 'output'):
        parser.add_argument('--' + arg, required=True, type=Path)
    parser.add_argument('--gc-support', required=True, type=Path)
    parser.add_argument('--head', required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(mode=0o700, exist_ok=False)
    completed = []
    accepted = None
    try:
        harness = args.harness.resolve(strict=True)
        qualified = args.qualified.resolve(strict=True)
        before = identity(harness, args.head, qualified)
        need(not subprocess.check_output(['git', '-C', str(qualified), 'status',
                                          '--porcelain', '--untracked-files=all']),
             'qualified source dirty before derivative')
        sys.path.insert(0, str(qualified / 'scripts/xv6-js-acceptance'))
        import run as accepted
        from policy import sha256_json, validate_report
        parser_module = load_module(HERE / 'profile.py', 'rollback_heap_parser')
        media = accepted.check_media(qualified, args.image_dir.resolve(strict=True))
        accepted.ordinary_file(args.image_dir / 'kernel', 20 * 1024 * 1024)
        support = accepted.load_json(args.gc_support.resolve(strict=True), 65536)
        need(support.get('schema') == 'bw.xv6-js-rollback-gc-support.v2' and
             support.get('requestedProduction') == {
                 'samplingInterval': 131072,
                 'includeObjectsCollectedByMinorGC': True,
                 'includeObjectsCollectedByMajorGC': True} and
             support.get('bothFlagsIndependentlyObserved') is True and
             type(support.get('cases')) is list and
             [item.get('name') for item in support['cases'] if type(item) is dict] ==
             ['minor-baseline', 'minor-enabled', 'major-baseline', 'major-enabled'] and
             len(support['cases']) == 4 and
             all(type(item.get('allocatedObjects')) is int and
                 item['allocatedObjects'] == item.get('collectedObjects') and
                 item['allocatedObjects'] > 0 for item in support['cases']) and
             [item.get('collectedCallsiteSamplePresent') for item in support['cases']] ==
             [False, True, False, True] and
             [item.get('requested') for item in support['cases']] == [
                 {'samplingInterval': 131072},
                 {'samplingInterval': 131072,
                  'includeObjectsCollectedByMinorGC': True},
                 {'samplingInterval': 131072},
                 {'samplingInterval': 131072,
                  'includeObjectsCollectedByMajorGC': True}] and
             support['cases'][1].get('minorGcEvents', 0) > 0 and
             support['cases'][1].get('majorGcEvents') == 0 and
             support['cases'][3].get('majorGcEvents', 0) > 0,
             'unverified hosted collected-object sampling')
        support_sha = sha(args.gc_support)
        source_inventory = accepted.expected_source_inventory(qualified, QUALIFIED)
        generated = qualified / GENERATED
        derivative = json.loads(subprocess.check_output([
            'node', str(harness / 'scripts/xv6-js-rollback-profile/derive.mjs'),
            str(qualified), str(generated)], text=True))
        generated_only(qualified, derivative['generatedSha256'])
        accepted.write_json(output / 'binding.json', {
            'schema': 'bw.xv6-js-rollback-binding.v1',
            'harness': before, 'qualifiedHead': QUALIFIED,
            'qualifiedSourceSha256': sha256_json(source_inventory),
            'qualifiedSourceEntries': len(source_inventory),
            'derivative': derivative, 'mediaSha256': media,
            'gcSupportSha256': support_sha, 'gcSupport': support,
            'kernelSha256': sha(args.image_dir / 'kernel'),
            'hostBefore': accepted.host_metadata(),
            'workload': {'profile': '4m', 'command': 'forktest\r',
                         'firmware': 'bochs', 'stepLimit': 40000000,
                         'unprofiledReferences': 1, 'sampledChildren': 2,
                         'heapSamplingInterval': 131072,
                         'includeObjectsCollectedByMinorGC': True,
                         'includeObjectsCollectedByMajorGC': True}})
        baseline = None
        raw_baseline = None
        summaries = []
        for name, sampled in SCHEDULE:
            child = output / name
            generated_only(qualified, derivative['generatedSha256'])
            env = accepted.clean_child_env(args.image_dir.resolve(strict=True), 'ordinary')
            if sampled:
                env['XV6_ROLLBACK_HEAP_PROFILE_OUT'] = str(child / 'heap-profile.json')
            script = GENERATED if sampled else 'scripts/probe-xv6-stock.mjs'
            metrics = accepted.run_bounded(
                ['node', '--max-old-space-size=768', script],
                qualified, env, child, 'ordinary')
            report = accepted.load_json(child / 'stdout.json')
            projection = validate_report(report, 'ordinary', QUALIFIED, media)
            need(report['sourceSha256'] == source_inventory,
                 'reported source inventory differs')
            accepted.check_source_inventory(qualified, source_inventory)
            if baseline is None:
                baseline, raw_baseline = projection, report
            semantic_gate(baseline, projection)
            if sampled:
                summary = parser_module.summarize(child / 'heap-profile.json',
                                                  qualified, source_inventory,
                                                  derivative['generatedSha256'])
                accepted.write_json(child / 'profile-summary.json', summary)
                summaries.append({'child': name, 'summary': summary})
            accepted.write_json(child / 'admission.json', {
                'child': name, 'sampled': sampled,
                'semanticSha256': sha256_json(projection), 'metrics': metrics,
                'reportSha256': sha(child / 'stdout.json'),
                'rawProfileSha256': sha(child / 'heap-profile.json') if sampled else None})
            completed.append({'child': name, 'semanticSha256': sha256_json(projection)})
        need(len(completed) == 3 and len(summaries) == 2 and raw_baseline is not None,
             'complete three-child diagnostic')
        need(accepted.expected_source_inventory(qualified, QUALIFIED) == source_inventory,
             'qualified source changed')
        need(identity(harness, args.head, qualified) == before, 'harness changed')
        need(sha(args.gc_support) == support_sha, 'GC support receipt changed')
        generated_only(qualified, derivative['generatedSha256'])
        accepted.write_json(output / 'result.json', {
            'schema': 'bw.xv6-js-rollback-diagnostic.v1',
            'result': 'SEMANTIC_PASS',
            'scope': 'three-child allocation-sampling diagnostic; no speed comparison',
            'semanticSha256': sha256_json(baseline),
            'completedChildren': completed, 'sampleSummaries': summaries,
            'hostAfter': accepted.host_metadata()})
        accepted.snapshot_inventory(output)
        print(json.dumps({'result': 'SEMANTIC_PASS', 'children': 3, 'profiles': 2}))
    except BaseException as error:
        try:
            (output / 'failure.json').write_text(json.dumps({
                'type': type(error).__name__, 'message': str(error),
                'completedChildren': completed}) + '\n')
        except Exception:
            pass
        try:
            snapshot_failure_if_admitted(accepted, output)
        except Exception:
            pass
        raise


if __name__ == '__main__':
    main()
