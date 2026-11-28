#!/usr/bin/env python3
"""
Full-carrier ngspice reference for the Meissner (tickler) transmitter of
sb3-creator's lab-meissner-squegg bench, with its linked receiver.

WHY. bw-board never puts the ~800 kHz carrier into its transient solve: the
tank lives in an envelope band (src/radio.js) and the DC solve sees only the
rectified currents. Whether that coupled envelope/DC trajectory is right
cannot be settled by refining one half of it. This script integrates the
CARRIER ITSELF in ngspice (no envelope, no describing functions), with the
circuit values bw-board uses for the bench, and checks the answer against
step, method, tolerance, start state and transistor-model changes.

THE CIRCUIT (values as bw-board resolves them; source lines named):
  * ferrite_coil, src/radio.js FERRITE_DEFAULTS / ferriteWindings: main
    winding 250 uH (tap unconnected, so one winding a-b), coupling winding
    c1-c2 = 250 uH * couplingRatio^2 = 0.1 uH, couplingK 0.9. Loss Q = 120
    as Z = jwL(1 - j/Q) (src/ac.js 'coupled_inductors'): series wL/Q at the
    tank frequency.
  * tuning_cap: 10 pF + 490 pF * position (tuningCapFarads), 0.3 -> 157 pF
    transmitter, 0.309 -> 161.41 pF receiver.
  * link (linkTo, distanceM 0.5): k = (0.1 / 0.5)^3 = 0.008 between the main
    windings (LINK_RADIUS_M ferrite_coil 0.1).
  * potentiometer 1 MOhm at 0.3, wiper-b open: R(a-wiper) = 0.7 MOhm
    (stampPotentiometer). slide_switch: 0.1 Ohm on the selected leg, the
    other open (src/devices/misc-parts.js).
  * npn beta 100: Q_DEFAULT (src/parts-library.js) Is 1e-14, Bf 100, with
    the RF view's Cjc 4 pF and fT 300 MHz (Tf = 1/(2 pi fT)) from
    RadioFrontEnd._snapshot. (bw-board's generic transistor is a piecewise
    knee in its DC solve; the Shockley card is the physical part.)
  * 1N34A: Is 2e-7, N 1.3, Rs 5 (parts-library). Crystal earphone: 100 Ohm
    + 10 nF, 10 MOhm leak (src/transducers.js).

CASES. 'sq': the slow emitter bypass (1 uF switched in, sbig = 0); 'steady':
without it; 'rev': the coupling winding reversed (sa = sb = 1). The
observation window is the sb3 scenario's (6-9 ms after power-on; the
squegging case's settle).

Run:  python test/golden/run_ngspice_meissner.py [--quick]
Writes test/golden/ngspice_meissner_squegg.json (summary only; the raw
traces are hundreds of MB and are not kept). Needs ngspice (47 measured).
"""

import json, math, os, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'ngspice_meissner_squegg.json')

QD = 'Is=1e-14 Bf=100 Br=1 Cjc=4p Tf=0.5305n'


def tuning(pos):
    return 10e-12 + 490e-12 * pos


def netlist(out, case='sq', tmax='10n', tstep='20n', tstop='12m', method='gear', reltol='1e-4',
            qmodel=QD, start='zero'):
    ct, cr = tuning(0.3), tuning(0.309)
    esr = lambda c: (1 / math.sqrt(250e-6 * c)) * 250e-6 / 120
    if case == 'rev':
        sw = 'Rsa base c2 0.1\nRsb x c1 0.1'
    else:
        sw = 'Rsa base c1 0.1\nRsb x c2 0.1'
    big = 'Rsw e eb 0.1\nCbig eb 0 1u' if case == 'sq' else '* small bypass only'
    lic = ' IC=1u' if start == 'zero' else ''
    uic = ' uic' if start in ('zero', 'squeg-entry') else ''
    extra = ''
    if start == 'op-kick':
        extra = 'Ikick vcc coll PULSE(0 1m 10u 1n 1n 20n 1)\n'
    if start == 'squeg-entry':
        # The state the envelope engine enters each of its bursts from: the
        # tank quiet, the bias capacitor pulled below cut-off.
        extra = '.ic v(x)=-0.4 v(e)=0.12 v(coll)=9 v(base)=-0.4\n'
    return f"""* lab-meissner-squegg, full carrier (bw-board test/golden/run_ngspice_meissner.py)
V1 vcc 0 9
{extra}L1 vcc l1m 250u{lic}
R1 l1m coll {esr(ct)}
Ct vcc coll {ct}
L2 c1 l2m 0.1u
R2 l2m c2 0.044
L3 0 l3m 250u
R3 l3m rx {esr(cr)}
Cr rx 0 {cr}
K12 L1 L2 0.9
K13 L1 L3 0.008
Q1 coll base e QD
.model QD NPN({qmodel})
{sw}
Rbb wiper x 10k
Rpot vcc wiper 700k
Cb x 0 4.7n
Re e 0 1k
Ce e 0 1n
{big}
D1 rx det D34
.model D34 D(Is=2e-7 N=1.3 Rs=5)
Cd det 0 2.2n
Rd det 0 47k
Resr det epm 100
Cep epm 0 10n
Rleak det 0 10meg
.options method={method} reltol={reltol} abstol=1e-12 vntol=1e-7 interp
.tran {tstep} {tstop} 0 {tmax}{uic}
.control
set wr_singlescale
set wr_vecnames
run
wrdata {out} v(coll) v(e) v(x) v(det)
quit
.endc
.end
"""


def analyse(path, t0, t1):
    """Carrier envelope (half the swing over each 1.3 us window), bias nodes, detector."""
    env, ve, vx, det = [], [], [], []
    win, wstart, lo, hi = 1.3e-6, None, None, None
    with open(path) as f:
        next(f)
        for line in f:
            t, vc, e, x, d = map(float, line.split())
            if wstart is None or t >= wstart + win:
                if lo is not None and wstart >= t0 and wstart + win <= t1:
                    env.append((wstart, (hi - lo) / 2))
                wstart, lo, hi = t, vc, vc
            else:
                lo, hi = min(lo, vc), max(hi, vc)
            if t0 <= t <= t1:
                ve.append(e); vx.append(x); det.append(d)
    a = [v for _, v in env]
    thr = 0.5 * max(a)
    # A burst is a rise through half the largest swing; a tank that never
    # swings (below 50 mV) has none, whatever its numerical noise does.
    bursts = 0 if max(a) < 0.05 else sum(1 for i in range(1, len(a)) if a[i] >= thr > a[i - 1])
    return {
        'envelopeMinV': min(a), 'envelopeMaxV': max(a), 'burstsPerSecond': bursts / (t1 - t0),
        'emitterV': [min(ve), max(ve)], 'biasNodeV': [min(vx), max(vx)], 'detectorV': [min(det), max(det)],
    }


CASES = [
    # name, case, kwargs, window (s)
    ('sq gear 20 ns', 'sq', {'tmax': '20n'}, (6e-3, 9e-3)),
    ('sq gear 10 ns', 'sq', {}, (6e-3, 9e-3)),
    ('sq trap 10 ns', 'sq', {'method': 'trap'}, (6e-3, 9e-3)),
    ('sq gear 5 ns reltol 1e-5', 'sq', {'tmax': '5n', 'tstep': '10n', 'reltol': '1e-5'}, (6e-3, 9e-3)),
    ('sq from the operating point, kicked', 'sq', {'start': 'op-kick'}, (6e-3, 9e-3)),
    ('sq from the squeg-entry state', 'sq', {'start': 'squeg-entry', 'tstop': '8m'}, (6e-3, 8e-3)),
    ('sq transistor Is 1e-13, Vaf 100, Rb 50', 'sq', {'qmodel': 'Is=1e-13 Bf=100 Br=1 Cjc=4p Tf=0.5305n Vaf=100 Rb=50'}, (6e-3, 9e-3)),
    ('steady (small bypass) gear 10 ns', 'steady', {'tstop': '25m'}, (22e-3, 25e-3)),
    ('rev gear 10 ns', 'rev', {'tstop': '8m'}, (5e-3, 8e-3)),
]


def main():
    quick = '--quick' in sys.argv
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, case, kw, (t0, t1) in CASES:
            if quick and name not in ('sq gear 10 ns', 'rev gear 10 ns'):
                continue
            dat = os.path.join(tmp, 'out.dat')
            cir = os.path.join(tmp, 'c.cir')
            with open(cir, 'w') as f:
                f.write(netlist(dat, case, **kw))
            t = time.time()
            p = subprocess.run(['ngspice', '-b', cir], capture_output=True, text=True)
            if p.returncode != 0:
                results.append({'name': name, 'error': p.stderr[-2000:]})
                continue
            r = {'name': name, 'case': case, 'settings': kw, 'windowMs': [t0 * 1e3, t1 * 1e3],
                 **analyse(dat, t0, t1), 'seconds': round(time.time() - t, 1)}
            print(json.dumps(r))
            results.append(r)
    ver = subprocess.run(['ngspice', '-v'], capture_output=True, text=True).stdout.strip().splitlines()
    doc = {'generator': 'test/golden/run_ngspice_meissner.py', 'ngspice': [v for v in ver if 'ngspice' in v][:1],
           'results': results}
    if not quick:
        with open(OUT, 'w') as f:
            json.dump(doc, f, indent=1)
            f.write('\n')


if __name__ == '__main__':
    main()
