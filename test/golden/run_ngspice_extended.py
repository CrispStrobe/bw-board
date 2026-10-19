#!/usr/bin/env python3
"""
Extended ngspice oracle generation — more circuits, more components.
"""

import subprocess
import json
import re
import os
import tempfile

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

# ─── Thevenin pin models as SPICE sources ────────────────────────────────

# quasi low: 0V through 25Ω → active-low LED circuit
run_op("pin_quasi_low_led",
    "Quasi-bidir pin driving low, active-low LED\n"
    "V1 vcc 0 5\n"
    "R1 vcc anode 1000\n"
    "D1 anode cathode LEDM\n"
    ".model LEDM D(IS=1e-20 N=1.8 RS=10)\n"
    "Rpin cathode 0 25\n",  # quasi low = 0V, 25Ω
    ['anode', 'cathode'])

# quasi high: 5V through 21700Ω → active-high LED circuit
run_op("pin_quasi_high_led",
    "Quasi-bidir pin driving high, active-high (naive) LED\n"
    "Vpin pin_th 0 5\n"
    "Rpin pin_th pin 21700\n"
    "R1 pin anode 1000\n"
    "D1 anode 0 LEDM\n"
    ".model LEDM D(IS=1e-20 N=1.8 RS=10)\n",
    ['pin', 'anode'])

# pushpull high: 5V through 25Ω → active-high LED circuit
run_op("pin_pushpull_high_led",
    "Pushpull pin driving high, active-high LED\n"
    "Vpin pin_th 0 5\n"
    "Rpin pin_th pin 25\n"
    "R1 pin anode 1000\n"
    "D1 anode 0 LEDM\n"
    ".model LEDM D(IS=1e-20 N=1.8 RS=10)\n",
    ['pin', 'anode'])

# ─── Multiple LEDs ──────────────────────────────────────────────────────

run_op("two_leds_parallel",
    "Two LEDs in parallel from VCC\n"
    "V1 vcc 0 5\n"
    "R1 vcc a1 1000\n"
    "R2 vcc a2 1000\n"
    "D1 a1 0 LEDM\n"
    "D2 a2 0 LEDM\n"
    ".model LEDM D(IS=1e-20 N=1.8 RS=10)\n",
    ['a1', 'a2'])

run_op("two_leds_series",
    "Two LEDs in series\n"
    "V1 vcc 0 5\n"
    "R1 vcc a1 1000\n"
    "D1 a1 mid LEDM\n"
    "D2 mid 0 LEDM\n"
    ".model LEDM D(IS=1e-20 N=1.8 RS=10)\n",
    ['a1', 'mid'])

# ─── Voltage dividers with different VCC ────────────────────────────────

for vcc in [3.3, 5.0, 12.0]:
    run_op(f"divider_1k_1k_{vcc}V",
        f"Divider at {vcc}V\n"
        f"V1 vcc 0 {vcc}\n"
        f"R1 vcc mid 1000\n"
        f"R2 mid 0 1000\n",
        ['mid'])

# ─── T and Pi networks ──────────────────────────────────────────────────

run_op("T_network",
    "T network\n"
    "V1 vcc 0 5\n"
    "R1 vcc mid 1000\n"
    "R2 mid out 1000\n"
    "R3 mid 0 2000\n"
    "Rload out 0 10000\n",
    ['mid', 'out'])

run_op("pi_network",
    "Pi network\n"
    "V1 vcc 0 5\n"
    "R1 vcc 0 2000\n"
    "R2 vcc out 1000\n"
    "R3 out 0 2000\n",
    ['out'])

# ─── NPN transistor circuits ────────────────────────────────────────────

run_op("npn_ce_amplifier",
    "NPN common emitter with bias\n"
    "V1 vcc 0 12\n"
    "R1 vcc base 100000\n"
    "R2 base 0 22000\n"
    "Rc vcc collector 4700\n"
    "Re emitter 0 1000\n"
    "Q1 collector base emitter QMOD\n"
    ".model QMOD NPN(BF=200 IS=1e-14)\n",
    ['base', 'collector', 'emitter'])

run_op("npn_emitter_follower",
    "NPN emitter follower\n"
    "V1 vcc 0 5\n"
    "Vin inp 0 2.5\n"
    "Q1 vcc inp emitter QMOD\n"
    "Re emitter 0 1000\n"
    ".model QMOD NPN(BF=100 IS=1e-14)\n",
    ['inp', 'emitter'])

# ─── Zener voltage regulator ────────────────────────────────────────────

run_op("zener_3v3_regulator",
    "3.3V Zener regulator from 5V\n"
    "V1 vcc 0 5\n"
    "R1 vcc out 330\n"
    "D1 0 out ZMOD\n"
    ".model ZMOD D(BV=3.3 IBV=0.005 IS=1e-12)\n",
    ['out'])

run_op("zener_5v1_from_12v",
    "5.1V Zener from 12V\n"
    "V1 vcc 0 12\n"
    "R1 vcc out 1000\n"
    "D1 0 out ZMOD\n"
    ".model ZMOD D(BV=5.1 IBV=0.005 IS=1e-12)\n",
    ['out'])

# ─── MOSFET circuits ────────────────────────────────────────────────────

run_op("nmos_inverter",
    "NMOS inverter\n"
    "V1 vcc 0 5\n"
    "Vin gate 0 5\n"
    "Rd vcc drain 1000\n"
    "M1 drain gate 0 0 NMMOD W=10u L=1u\n"
    ".model NMMOD NMOS(VTO=1.5 KP=0.5)\n",
    ['drain'])

run_op("nmos_inverter_off",
    "NMOS inverter off\n"
    "V1 vcc 0 5\n"
    "Vin gate 0 0\n"
    "Rd vcc drain 1000\n"
    "M1 drain gate 0 0 NMMOD W=10u L=1u\n"
    ".model NMMOD NMOS(VTO=1.5 KP=0.5)\n",
    ['drain'])

# ─── Current divider ────────────────────────────────────────────────────

run_op("current_divider",
    "Current divider: 10mA into two parallel resistors\n"
    "I1 0 node 0.01\n"
    "R1 node 0 1000\n"
    "R2 node 0 2000\n",
    ['node'])

# ─── Multi-node resistor mesh ──────────────────────────────────────────

run_op("resistor_cube_face",
    "4 resistors in a square (one face of resistor cube)\n"
    "V1 a 0 5\n"
    "R1 a b 1000\n"
    "R2 b c 1000\n"
    "R3 c d 1000\n"
    "R4 d a 1000\n"
    "Rload b d 2000\n",
    ['a', 'b', 'c', 'd'])

# ─── Op-amp inverting amplifier ──────────────────────────────────────────

run_op("opamp_inverting",
    "Inverting amplifier gain=-10\n"
    "Vin inp 0 0.5\n"
    "Rin inp inn 1000\n"
    "Rf out inn 10000\n"
    "E1 out 0 0 inn 1000000\n",
    ['out', 'inn'])

# ─── Output ──────────────────────────────────────────────────────────────

output = {
    "generator": "run_ngspice_extended.py",
    "tool": "ngspice-42",
    "result_count": len(results),
    "results": results,
}

with open("test/golden/ngspice_extended.json", "w") as f:
    json.dump(output, f, indent=2)

passed = sum(1 for r in results if 'measured' in r and r['measured'])
failed = sum(1 for r in results if 'error' in r or ('measured' in r and not r['measured']))
print(f"Extended ngspice: {passed} measured, {failed} failed")
for r in results:
    m = r.get('measured', {})
    if m:
        vals = ', '.join(f'{k}={v:.4f}' for k,v in m.items() if isinstance(v, float))
        print(f"  {r['name']}: {vals}")
    elif 'error' in r:
        print(f"  {r['name']}: ERROR {r['error']}")
