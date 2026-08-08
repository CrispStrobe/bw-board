#!/usr/bin/env python3
"""
ngspice oracles for diode I-V characteristics — compare our
piecewise and Shockley models against SPICE.
"""

import subprocess, json, re, os, tempfile

results = []

def run_op(name, netlist, nodes):
    full = netlist + '\n.op\n.end\n'
    with tempfile.NamedTemporaryFile(mode='w', suffix='.cir', delete=False) as f:
        f.write(full); cirfile = f.name
    try:
        proc = subprocess.run(['ngspice', '-b', cirfile],
                              capture_output=True, text=True, timeout=10)
        measured = {}
        for node in nodes:
            m = re.search(rf'^\s+{re.escape(node)}\s+([-+]?\d[\d.eE+-]*)',
                          proc.stdout, re.MULTILINE | re.IGNORECASE)
            if m: measured[f'v_{node}'] = float(m.group(1))
        for line in proc.stdout.split('\n'):
            m = re.match(r'^\s+([\w#]+)\s+([-+]?\d[\d.eE+-]*)', line)
            if m and 'branch' in m.group(1):
                measured[m.group(1)] = float(m.group(2))
        results.append({"name": name, "measured": measured})
    except Exception as e:
        results.append({"name": name, "error": str(e)})
    finally:
        os.unlink(cirfile)

# ─── LED at various resistor values ─────────────────────────────────────

for r in [100, 220, 330, 470, 680, 1000, 2200, 4700, 10000]:
    run_op(f"led_red_{r}",
        f"Red LED R={r}\n"
        f"V1 vcc 0 5\n"
        f"R1 vcc anode {r}\n"
        f"D1 anode 0 LEDM\n"
        f".model LEDM D(IS=1e-20 N=1.8 RS=10)\n",
        ['anode'])

# ─── LED at 3.3V supply ─────────────────────────────────────────────────

for r in [220, 470, 1000]:
    run_op(f"led_red_{r}_3v3",
        f"Red LED R={r} at 3.3V\n"
        f"V1 vcc 0 3.3\n"
        f"R1 vcc anode {r}\n"
        f"D1 anode 0 LEDM\n"
        f".model LEDM D(IS=1e-20 N=1.8 RS=10)\n",
        ['anode'])

# ─── Blue LED (higher Vf) ───────────────────────────────────────────────

for r in [220, 470, 1000]:
    run_op(f"led_blue_{r}",
        f"Blue LED R={r}\n"
        f"V1 vcc 0 5\n"
        f"R1 vcc anode {r}\n"
        f"D1 anode 0 LEDBL\n"
        f".model LEDBL D(IS=1e-30 N=2.0 RS=10)\n",
        ['anode'])

# ─── Silicon diode (1N4148-like) ────────────────────────────────────────

for r in [100, 1000, 10000]:
    run_op(f"si_diode_{r}",
        f"Silicon diode R={r}\n"
        f"V1 vcc 0 5\n"
        f"R1 vcc anode {r}\n"
        f"D1 anode 0 D1N4148\n"
        f".model D1N4148 D(IS=2.52e-9 RS=0.568 N=1.752 BV=100 IBV=100u)\n",
        ['anode'])

# ─── Two LEDs in series at various VCC ──────────────────────────────────

for vcc in [5.0, 3.3, 7.0]:
    run_op(f"two_leds_series_{vcc}V",
        f"Two LEDs series at {vcc}V\n"
        f"V1 vcc 0 {vcc}\n"
        f"R1 vcc a1 1000\n"
        f"D1 a1 mid LEDM\n"
        f"D2 mid 0 LEDM\n"
        f".model LEDM D(IS=1e-20 N=1.8 RS=10)\n",
        ['a1', 'mid'])

# ─── RC at more time points ─────────────────────────────────────────────

import math
rc_r, rc_c = 10000, 1e-4
rc = rc_r * rc_c  # 1.0 seconds

for mult in [0.1, 0.2, 0.5, 0.7, 1.0, 1.5, 2.0, 3.0, 5.0]:
    t = rc * mult
    netlist = (
        f"RC at {mult}RC\n"
        f"V1 vcc 0 5\n"
        f"R1 vcc cap {rc_r}\n"
        f"C1 cap 0 {rc_c} ic=0\n"
        f".tran {t/100} {t} uic\n"
        f".print tran v(cap)\n"
        f".end\n"
    )
    with tempfile.NamedTemporaryFile(mode='w', suffix='.cir', delete=False) as f:
        f.write(netlist); cirfile = f.name
    try:
        proc = subprocess.run(['ngspice', '-b', cirfile],
                              capture_output=True, text=True, timeout=10)
        lines = [l for l in proc.stdout.split('\n') if re.match(r'^\s*\d+\s', l)]
        if lines:
            parts = lines[-1].split()
            results.append({
                "name": f"rc_at_{mult}RC",
                "measured": {"v_cap": float(parts[2]), "t": float(parts[1])},
            })
    except Exception as e:
        results.append({"name": f"rc_at_{mult}RC", "error": str(e)})
    finally:
        os.unlink(cirfile)

# ─── Output ──────────────────────────────────────────────────────────────

output = {
    "generator": "run_ngspice_diode.py",
    "tool": "ngspice-42",
    "result_count": len(results),
    "results": results,
}

with open("test/golden/ngspice_diode.json", "w") as f:
    json.dump(output, f, indent=2)

passed = sum(1 for r in results if 'measured' in r and r['measured'])
print(f"Diode/RC ngspice: {passed}/{len(results)} measured")
for r in results:
    m = r.get('measured', {})
    if m:
        vals = ', '.join(f'{k}={v:.4f}' for k,v in m.items() if isinstance(v, float))
        print(f"  {r['name']}: {vals}")
