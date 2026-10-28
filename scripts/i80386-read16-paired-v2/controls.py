"""Manufactured-packet controls for reader.py. No child, guest or benchmark runs.

Every values here is SYNTHETIC and explicitly labelled so; a passing control is
evidence that the reader bites, not a measurement. Usage: controls.py
"""
import base64
import copy
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reader  # noqa: E402

LIMITS = reader.LIMITS
ROWS_SHA = 'synthetic-rows-' + '0' * 49


def device(cycles, debt, deadline, cga_cycles):
    return {'machineCycles': cycles, 'debt': debt, 'deadline': deadline, 'appliedClocks': cycles - debt, 'pitFraction': 0.25,
            'pitCounters': [{'mode': 0, 'rw': 0, 'reload': 0, 'ce': 0, 'out': 0, 'armed': False, 'nullCount': True, 'gate': 1}] * 3,
            'pics': [{'irr': 0, 'isr': 0, 'imr': 0, 'vectorBase': 8, 'intActive': False}, {'irr': 0, 'isr': 0, 'imr': 0, 'vectorBase': 112, 'intActive': False}],
            'rtc': {'cyclePhase': 0, 'periodicPhase': 0, 'registerB': 2, 'registerC': 0},
            'cga': {'cycles': cga_cycles, 'frameCount': 0 if cga_cycles < reader.ACTIVE else (cga_cycles - reader.ACTIVE) // reader.FRAME + 1,
                    'lastVretrace': 1 if cga_cycles % reader.FRAME >= reader.ACTIVE else 0},
            'keyboard': {'commandByte': 0x45, 'queue': [], 'scheduled': 0}}


def child_stdout(arm):
    final = device(4 + 60_000_000, 10, 16000, 4 + 60_000_000 - 10)
    sem = {'schema': 'bw.at-profile-child.v1', 'kind': 'at', 'steps': 10_000_000, 'charges': 60_000_000, 'cpuCycles': 10_000_000,
           'state': {'ax': 0xfffe, 'bx': 0xffff, 'ip': 0, 'word': 0xffff}, 'ifEnabled': False, 'interrupts': 0, 'devices': final}
    setup = dict(sem, steps=0, charges=0, cpuCycles=0, state={'ax': 0, 'bx': 0, 'ip': 0, 'word': 0}, devices=device(4, 0, 16000, 4))
    return {'schema': 'bw.read16-paired-v2-child.v1', 'arm': arm, 'sourceRowsSha256': ROWS_SHA, 'semantic': sem, 'setup': setup,
            'setupNanoseconds': '1', 'executionLoopNanoseconds': '1', 'warmupSteps': 25000,
            'warmupDoesNotContributeToMeasuredState': True, 'physical386TimingCalibrated': False}


def packet(mode='paired', a_cpu=10.4, b_cpu=10.0):
    req = {'schema': 'bw.read16-paired-v2-request.v1', 'modes': ['capfit', 'paired'], 'sourceRowsSha256': ROWS_SHA,
           'arms': {'A': {'head': 'a' * 40, 'tree': 'b' * 40}, 'B': {'head': 'c' * 40, 'tree': 'd' * 40}},
           'nodeVersion': 'v22.0.0', 'nodePath': '/synthetic/node'}
    raw = json.dumps(req).encode()
    position = {'cgroup': 'synthetic.service', 'limits': dict(LIMITS), 'affinity': [1], 'pidsCurrent': 2, 'memoryEvents': {'max': 0, 'oom': 0, 'oom_kill': 0}}
    children = []
    for sequence, phase, pair, arm in reader.SCHEDULES[mode]:
        cpu = a_cpu if arm == 'A' else b_cpu
        children.append({'sequence': sequence, 'phase': phase, 'pair': pair, 'arm': arm,
                         'stdoutBase64': base64.b64encode(json.dumps(child_stdout(arm)).encode()).decode(), 'stderrBase64': '',
                         'usage': {'exitCode': 0, 'reaped': True, 'timedOut': False, 'cpuSeconds': cpu, 'wallSeconds': cpu + 0.1,
                                   'userSeconds': cpu, 'systemSeconds': 0.0, 'maxRSSKiB': 1, 'primary': None, 'secondary': []},
                         'before': copy.deepcopy(position), 'after': copy.deepcopy(position)})
    return {'schema': 'bw.read16-paired-v2-original.v1', 'mode': mode, 'synthetic': True,
            'request': {'base64': base64.b64encode(raw).decode(), 'sha256': hashlib.sha256(raw).hexdigest()},
            'arms': req['arms'], 'harness': None, 'context': {'GITHUB_RUN_ID': '1', 'GITHUB_WORKFLOW_SHA': 'e' * 40},
            'host': {'witness': {'selectedCpu': 1, 'cpuinfo': {'vendor_id': 'Synthetic', 'cpu family': '1', 'model': '1', 'model name': 'Synthetic', 'stepping': '1'},
                                 'uname': {}, 'image': {}, 'node': {'path': '/synthetic/node', 'version': 'v22.0.0', 'bytes': 1, 'sha256': 'f' * 64}, 'python': '3'},
                     'cgroup': copy.deepcopy(position)},
            'children': children, 'failure': None}


def stdout_edit(p, index, fn):
    c = p['children'][index]
    out = json.loads(base64.b64decode(c['stdoutBase64']))
    fn(out)
    c['stdoutBase64'] = base64.b64encode(json.dumps(out).encode()).decode()


def mutants():
    def m(name, fn, mode='paired'):
        p = packet(mode)
        fn(p)
        return name, p
    yield m('changed architectural golden', lambda p: stdout_edit(p, 5, lambda o: o['semantic']['state'].update(ax=0x7ffe)))
    yield m('short retirements', lambda p: stdout_edit(p, 6, lambda o: o['semantic'].update(steps=1_000_000)))
    yield m('frame count off by one', lambda p: stdout_edit(p, 7, lambda o: o['semantic']['devices']['cga'].update(frameCount=o['semantic']['devices']['cga']['frameCount'] + 1)))
    yield m('machine cycles drift', lambda p: stdout_edit(p, 8, lambda o: o['semantic']['devices'].update(machineCycles=o['semantic']['devices']['machineCycles'] + 6)))
    yield m('debt beyond horizon', lambda p: stdout_edit(p, 9, lambda o: o['semantic']['devices'].update(debt=20000, appliedClocks=o['semantic']['devices']['machineCycles'] - 20000)))
    yield m('PIT reprogrammed', lambda p: stdout_edit(p, 10, lambda o: o['semantic']['devices']['pitCounters'][0].update(mode=2)))
    yield m('PIC ISR leaked', lambda p: stdout_edit(p, 11, lambda o: o['semantic']['devices']['pics'][0].update(isr=1)))
    yield m('interrupt delivered', lambda p: stdout_edit(p, 12, lambda o: o['semantic'].update(interrupts=1)))
    yield m('warm state leaked', lambda p: stdout_edit(p, 13, lambda o: o.update(warmupDoesNotContributeToMeasuredState=False)))
    yield m('unsettled setup', lambda p: stdout_edit(p, 14, lambda o: o['setup']['devices'].update(debt=6)))
    yield m('swapped arms', lambda p: stdout_edit(p, 4, lambda o: o.update(arm='B')))
    yield m('wrong source rows', lambda p: stdout_edit(p, 15, lambda o: o.update(sourceRowsSha256='x')))
    yield m('order changed', lambda p: p['children'][4].update(arm='B') or p['children'][5].update(arm='A'))
    yield m('child missing', lambda p: p['children'].pop())
    yield m('timeout', lambda p: p['children'][16]['usage'].update(timedOut=True))
    yield m('stderr bytes', lambda p: p['children'][3].update(stderrBase64=base64.b64encode(b'x').decode()))
    yield m('producer failure', lambda p: p.update(failure={'phase': 'capture'}))
    yield m('wrong quota', lambda p: p['children'][2]['before']['limits'].update({'cpu.max': '200000 100000'}))
    yield m('swap allowed', lambda p: p['host']['cgroup']['limits'].update({'memory.swap.max': 'max'}))
    yield m('CPU migrated', lambda p: p['children'][17]['after'].update(affinity=[2]))
    yield m('OOM event', lambda p: p['children'][1]['after']['memoryEvents'].update(oom=1))
    yield m('missing CPU model', lambda p: p['host']['witness']['cpuinfo'].update({'model name': None}))
    yield m('wrong Node', lambda p: p['host']['witness']['node'].update(version='v20.0.0'))
    yield m('request bytes substituted', lambda p: p['request'].update(sha256='0' * 64))
    yield m('arm head substituted', lambda p: p['arms']['A'].update(head='9' * 40))


def main():
    results = []
    good = reader.read(packet())
    assert good['admitted'] and good['gate']['pass'], 'synthetic passing packet must pass'
    results.append(('synthetic pass', 'admitted+gate pass'))
    cap = reader.read(packet('capfit'))
    assert cap['capfit']['pass'], 'synthetic capfit'
    results.append(('synthetic capfit', 'pass'))
    # Gate controls: these are admitted packets whose gate must FAIL.
    for name, kwargs in (('median below 1.03', {'a_cpu': 10.2}), ('B slower', {'a_cpu': 9.0}), ('equal arms', {'a_cpu': 10.0})):
        v = reader.read(packet(**kwargs))
        assert v['admitted'] and not v['gate']['pass'], name
        results.append((name, 'gate FAIL as required'))
    p = packet()  # one failing pair among good ones must fail "every > 1"
    for c in p['children']:
        if c['pair'] == 3:
            c['usage']['cpuSeconds'] = 10.0 if c['arm'] == 'A' else 10.5
    v = reader.read(p)
    assert v['gate']['cpuMedianPass'] and not v['gate']['cpuEveryPass'] and not v['gate']['pass'], 'one failing pair'
    results.append(('one failing pair', 'gate FAIL as required'))
    p = packet()  # wall regression only
    for c in p['children']:
        if c['arm'] == 'B':
            c['usage']['wallSeconds'] = 11.0
    v = reader.read(p)
    assert v['gate']['cpuMedianPass'] and not v['gate']['wallMedianPass'] and not v['gate']['pass'], 'wall gate'
    results.append(('wall regression', 'gate FAIL as required'))
    p = packet('capfit')
    p['children'][1]['usage']['wallSeconds'] = 31.0
    assert not reader.read(p)['capfit']['pass'], 'capfit over limit'
    results.append(('capfit over limit', 'FAIL as required'))
    for name, p in mutants():
        try:
            reader.read(p)
        except (reader.Refusal, KeyError, TypeError, ValueError) as error:
            results.append((name, 'refused: ' + str(error)[:80]))
            continue
        raise AssertionError('mutant admitted: ' + name)
    for name, outcome in results:
        print('%-28s %s' % (name, outcome))
    print('controls: %d PASS (synthetic, not a measurement)' % len(results))


if __name__ == '__main__':
    main()
