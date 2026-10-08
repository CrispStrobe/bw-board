"""Synthetic-only parser refusals; never executes the xv6 probe."""
import copy
import hashlib
import json
import sys
import tempfile
from pathlib import Path

from profile import load, strict_json, summarize


def frame(name, url):
    return {'functionName': name, 'scriptId': '7', 'url': url,
            'lineNumber': 2, 'columnNumber': 4}


def check():
    with tempfile.TemporaryDirectory(prefix='rollback-profile-control-') as temporary:
        root = Path(temporary)
        scripts = root / 'scripts'
        scripts.mkdir()
        cpu = root / 'src/experimental/i80386.js'
        cpu.parent.mkdir(parents=True)
        cpu.write_bytes(b'owned cpu source\n')
        generated = scripts / 'probe-xv6-stock-rollback-profile.mjs'
        generated.write_bytes(b'owned generated probe\n')
        inventory = {'../src/experimental/i80386.js':
                     hashlib.sha256(cpu.read_bytes()).hexdigest()}
        generated_sha = hashlib.sha256(generated.read_bytes()).hexdigest()
        baseline = {'head': {'callFrame': frame('(root)', ''), 'selfSize': 0,
                             'id': 1, 'children': [
                                 {'callFrame': frame('_snapshotInstruction', cpu.as_uri()),
                                  'selfSize': 32768, 'id': 2, 'children': []}]},
                    'samples': [{'size': 32768, 'nodeId': 2, 'ordinal': 1}]}
        path = root / 'profile.json'

        def write(value):
            path.write_text(json.dumps(value), encoding='utf-8')

        def rejects(value, reason):
            write(value)
            try:
                load(path)
            except ValueError as error:
                assert reason in str(error), (reason, str(error))
            else:
                raise AssertionError('accepted malformed heap profile: ' + reason)

        write(baseline)
        result = summarize(path, root, inventory, generated_sha)
        assert result['sampleCount'] == 1
        assert result['buckets']['authenticated_cpu_js']['sampledBytes'] == 32768
        assert result['locations'][0]['sourceRole'] == '../src/experimental/i80386.js'
        assert sum(item['sampledBytes'] for item in result['buckets'].values()) == 32768
        for mutate, reason in (
            (lambda p: p['head']['children'][0].update(id=1), 'unique bounded heap node ID'),
            (lambda p: p['samples'][0].update(nodeId=99), 'sample references heap node'),
            (lambda p: p['samples'][0].update(size=-1), 'positive bounded sample size'),
            (lambda p: p['samples'][0].update(size=0), 'positive bounded sample size'),
            (lambda p: p['samples'][0].update(size=1 << 40), 'positive bounded sample size'),
            (lambda p: p['samples'].append({'size': 1, 'nodeId': 2, 'ordinal': 1}),
             'ordered bounded sample ordinal'),
            (lambda p: p['head']['callFrame'].update(url=7), 'bounded frame URL'),
        ):
            case = copy.deepcopy(baseline)
            mutate(case)
            rejects(case, reason)
        for raw, reason in (
            ('{"head":{},"head":{},"samples":[]}', 'duplicate heap profile JSON key'),
            ('{"head":{},"samples":1e999}', 'nonfinite heap profile number'),
            ('{"head":{},"samples":NaN}', 'nonfinite heap profile constant'),
        ):
            try:
                strict_json(raw)
            except ValueError as error:
                assert reason in str(error)
            else:
                raise AssertionError('accepted malformed raw JSON')
        write(baseline)
        cpu.write_bytes(b'mutated cpu source\n')
        try:
            summarize(path, root, inventory, generated_sha)
        except ValueError as error:
            assert 'authenticated source role bytes' in str(error)
        else:
            raise AssertionError('accepted mutated source role')
        print('rollback heap profile controls PASS')


if __name__ == '__main__':
    assert len(sys.argv) == 1
    check()
