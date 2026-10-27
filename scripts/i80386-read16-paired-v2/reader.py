"""Standalone reader for a read16 paired-v2 original packet.

Stdlib only; imports nothing from the producer. Expected values are derived
here from the authored loop and the declared device constants, never from any
child's output:

Architecture (10,000,000 retirements = 2,000,000 five-op loops, n >= 16):
  AX = 0xfffe, BX = word[0x2000] = 0xffff, IP = 0, cpu.cycles = 10,000,000,
  machine charges = 6 * 10,000,000 (declared functionalInstructionCycles 6),
  IF clear, zero interrupts delivered.
Devices (fixture clockHz 16,000,000; deferred chip debt is capped by the wake
horizon at clockHz/1000 = 16,000 clocks):
  machineCycles = setup + 60,000,000; 1 <= deadline <= 16,000, 6 <= debt <= deadline+5;
  applied = machineCycles - debt; CGA cycles == applied;
  CGA frame = round(16e6/60) = 266,667, total lines 262, active 200 ->
  active clocks round(266,667*200/262) = 203,563; vretrace lasts 63,104 clocks
  > 16,000, so every rising edge is sampled: frameCount =
  floor((applied - 203,563) / 266,667) + 1, lastVretrace = applied % 266,667 >= 203,563.
  PIT fraction in [0, 1). No authored I/O: PIT counter mode/rw/reload/gate,
  PIC IMR/ISR/vector base, RTC register B and the 8042 command byte equal the
  child's own fresh pre-step setup observation.
Exact PIT fraction, RTC phases and keyboard progression are recorded, not
asserted: their floating-point/flush-order recurrences are not independently
derived here.

Usage: reader.py ORIGINAL.json  -> prints verdict JSON; exit 0 only if admitted.
"""
import base64
import hashlib
import json
import statistics
import sys

STEPS = 10_000_000
CLOCK_HZ = 16_000_000
HORIZON = CLOCK_HZ // 1000
FRAME = round(CLOCK_HZ / 60)
ACTIVE = round(FRAME * 200 / 262)
ORDERS = ('AB', 'BA', 'AB', 'BA', 'BA', 'AB', 'BA')
SCHEDULES = {
    'capfit': [(0, 'capfit', None, 'A'), (1, 'capfit', None, 'B')],
    'paired': [(i, 'warmup', None, a) for i, a in enumerate('ABAB')]
              + [(4 + p * 2 + i, 'measured', p, a) for p, o in enumerate(ORDERS) for i, a in enumerate(o)],
}
GATE = {'cpuMedianMin': 1.03, 'cpuEveryGreaterThan': 1.0, 'wallMedianMax': 1.02}
CAPFIT_MAX_WALL = 30.0   # predeclared: half the 60 s child deadline
assert FRAME - ACTIVE > HORIZON + 6  # every retrace edge is sampled despite batching
LIMITS = {'cpu.max': '100000 100000', 'memory.max': '1073741824', 'memory.swap.max': '0', 'pids.max': '64'}


class Refusal(ValueError):
    pass


def need(value, reason):
    if not value:
        raise Refusal(reason)


def golden_architecture():
    # Closed form after n loops: AX = 2^n*(AX0+2) - 2 (mod 2^16); BX = word = AX_(n-1) + 1.
    loops = STEPS // 5
    need(STEPS % 5 == 0, 'whole loops')
    outcomes = set()
    for ax0 in range(65536):
        ax = (pow(2, loops, 65536) * (ax0 + 2) - 2) % 65536
        prev = (pow(2, loops - 1, 65536) * (ax0 + 2) - 2) % 65536
        outcomes.add((ax, (prev + 1) % 65536))
    need(len(outcomes) == 1, 'saturated tuple')
    ax, bx = outcomes.pop()
    return {'ax': ax, 'bx': bx, 'ip': 0, 'word': bx}


def check_child(record, rows_sha, host_cpu):
    need(record['usage']['exitCode'] == 0 and not record['usage']['timedOut'] and record['usage']['primary'] is None, 'child exit')
    need(base64.b64decode(record['stderrBase64']) == b'', 'child stderr')
    for side in ('before', 'after'):
        position = record[side]
        need(position['limits'] == LIMITS, 'child limits')
        need(position['affinity'] == [host_cpu], 'child CPU')
        need(all(position['memoryEvents'].get(k, 0) == 0 for k in ('max', 'oom', 'oom_kill')), 'memory events')
    out = json.loads(base64.b64decode(record['stdoutBase64']))
    need(out['schema'] == 'bw.read16-paired-v2-child.v1' and out['arm'] == record['arm'], 'child identity')
    need(out['sourceRowsSha256'] == rows_sha, 'child source rows')
    need(out['warmupSteps'] == 25000 and out['warmupDoesNotContributeToMeasuredState'] is True and out['physical386TimingCalibrated'] is False, 'warmup contract')
    sem, setup = out['semantic'], out['setup']
    need(sem['steps'] == STEPS and sem['cpuCycles'] == STEPS and sem['charges'] == 6 * STEPS, 'retirements/charges')
    need(sem['state'] == golden_architecture(), 'architectural golden')
    need(sem['ifEnabled'] is False and sem['interrupts'] == 0, 'no interrupts')
    need(setup['steps'] == 0 and setup['cpuCycles'] == 0, 'fresh setup observation')
    d, s = sem['devices'], setup['devices']
    # Power-on reset charges a few clocks before the first step; goldens are
    # relative to this child's own fresh setup, which must itself be settled.
    need(s['debt'] == 0 and s['appliedClocks'] == s['machineCycles'] == s['cga']['cycles'] < ACTIVE and s['cga']['frameCount'] == 0, 'settled setup')
    need(d['machineCycles'] == s['machineCycles'] + 6 * STEPS, 'machine cycles')
    # A due flush happens at the start of the NEXT step, so after the final
    # 6-clock step the debt may reach deadline + 5.
    need(1 <= d['deadline'] <= HORIZON and 6 <= d['debt'] <= d['deadline'] + 5, 'debt/deadline bound')
    applied = d['machineCycles'] - d['debt']
    need(d['appliedClocks'] == applied and d['cga']['cycles'] == applied, 'applied clocks')
    need(d['cga']['frameCount'] == (applied - ACTIVE) // FRAME + 1, 'CGA frame count golden')
    need(d['cga']['lastVretrace'] == (1 if applied % FRAME >= ACTIVE else 0), 'CGA retrace golden')
    need(0 <= d['pitFraction'] < 1, 'PIT fraction range')
    strip = lambda cs: [{k: c[k] for k in ('mode', 'rw', 'reload', 'gate')} for c in cs]
    need(strip(d['pitCounters']) == strip(s['pitCounters']), 'PIT no-I/O invariant')
    pic = lambda ps: [{k: p[k] for k in ('imr', 'isr', 'vectorBase')} for p in ps]
    need(pic(d['pics']) == pic(s['pics']), 'PIC no-I/O invariant')
    need(d['rtc']['registerB'] == s['rtc']['registerB'], 'RTC register B invariant')
    need(d['keyboard']['commandByte'] == s['keyboard']['commandByte'], '8042 command byte invariant')
    return out


def read(packet):
    need(packet['schema'] == 'bw.read16-paired-v2-original.v1' and packet['mode'] in SCHEDULES, 'packet schema')
    need(packet['failure'] is None, 'producer failure: ' + json.dumps(packet['failure'])[:512])
    request = base64.b64decode(packet['request']['base64'])
    need(hashlib.sha256(request).hexdigest() == packet['request']['sha256'], 'request bytes')
    req = json.loads(request)
    need(packet['mode'] in req['modes'], 'mode admitted')
    need(packet['arms'] == req['arms'], 'arm heads/trees')
    need(packet['context'].get('GITHUB_RUN_ID') and packet['context'].get('GITHUB_WORKFLOW_SHA'), 'hosted context')
    host = packet['host']
    w = host['witness']
    need(all(w['cpuinfo'].get(k) for k in ('vendor_id', 'cpu family', 'model', 'model name', 'stepping')), 'host CPU witness')
    need(w['node']['version'] == req['nodeVersion'] and w['node']['sha256'] and w['node']['bytes'] > 0, 'Node witness')
    need(host['cgroup']['limits'] == LIMITS, 'host limits')
    cpu = host['cgroup']['affinity']
    need(len(cpu) == 1 and w['selectedCpu'] == cpu[0], 'selected CPU')
    schedule = SCHEDULES[packet['mode']]
    children = packet['children']
    need([(c['sequence'], c['phase'], c['pair'], c['arm']) for c in children] == [tuple(x) for x in schedule], 'schedule order/count')
    for c in children:
        check_child(c, req['sourceRowsSha256'], cpu[0])
    verdict = {'schema': 'bw.read16-paired-v2-verdict.v1', 'mode': packet['mode'], 'admitted': True,
               'host': {'cpu': {k: w['cpuinfo'][k] for k in ('vendor_id', 'cpu family', 'model', 'model name', 'stepping')},
                        'node': w['node']['version'], 'image': w['image']},
               'children': [{'sequence': c['sequence'], 'arm': c['arm'], 'phase': c['phase'], 'pair': c['pair'],
                             'cpuSeconds': c['usage']['cpuSeconds'], 'wallSeconds': c['usage']['wallSeconds'],
                             'maxRSSKiB': c['usage']['maxRSSKiB']} for c in children]}
    if packet['mode'] == 'capfit':
        walls = [c['usage']['wallSeconds'] for c in children]
        verdict['capfit'] = {'maxWallSeconds': max(walls), 'limit': CAPFIT_MAX_WALL, 'pass': max(walls) <= CAPFIT_MAX_WALL}
        return verdict
    pairs = {}
    for c in children:
        if c['phase'] == 'measured':
            pairs.setdefault(c['pair'], {})[c['arm']] = c['usage']
    cpu_ratios = [pairs[i]['A']['cpuSeconds'] / pairs[i]['B']['cpuSeconds'] for i in range(7)]
    wall_ratios = [pairs[i]['B']['wallSeconds'] / pairs[i]['A']['wallSeconds'] for i in range(7)]
    cpu_median, wall_median = statistics.median(cpu_ratios), statistics.median(wall_ratios)
    verdict['gate'] = {'criteria': GATE, 'cpuRatiosAoverB': cpu_ratios, 'cpuMedian': cpu_median, 'cpuMin': min(cpu_ratios),
                       'wallRatiosBoverA': wall_ratios, 'wallMedian': wall_median,
                       'cpuMedianPass': cpu_median >= GATE['cpuMedianMin'],
                       'cpuEveryPass': min(cpu_ratios) > GATE['cpuEveryGreaterThan'],
                       'wallMedianPass': wall_median <= GATE['wallMedianMax']}
    g = verdict['gate']
    g['pass'] = g['cpuMedianPass'] and g['cpuEveryPass'] and g['wallMedianPass']
    return verdict


def main():
    need(len(sys.argv) == 2, 'usage: reader.py ORIGINAL.json')
    with open(sys.argv[1], 'rb') as f:
        raw = f.read()
    try:
        verdict = read(json.loads(raw))
        verdict['originalSha256'] = hashlib.sha256(raw).hexdigest()
    except (Refusal, KeyError, TypeError, ValueError) as error:
        print(json.dumps({'admitted': False, 'refusal': str(error)[:1024], 'originalSha256': hashlib.sha256(raw).hexdigest()}))
        sys.exit(1)
    print(json.dumps(verdict, indent=1))


if __name__ == '__main__':
    main()
