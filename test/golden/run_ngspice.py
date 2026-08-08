#!/usr/bin/env python3
"""
Run ngspice on test circuits and capture the results as golden values.
These are the ground truth from an industry-standard SPICE simulator.
"""

import subprocess
import json
import re
import os
import tempfile

results = []

def run_spice(name, netlist, measurements):
    """Run a SPICE netlist and extract measurements."""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.cir', delete=False) as f:
        f.write(netlist)
        f.flush()
        cirfile = f.name

    try:
        proc = subprocess.run(
            ['ngspice', '-b', '-o', '/dev/null', cirfile],
            capture_output=True, text=True, timeout=10
        )
        output = proc.stdout + proc.stderr

        # Parse .print output lines
        measured = {}
        for key, pattern in measurements.items():
            m = re.search(pattern, output)
            if m:
                measured[key] = float(m.group(1))
            else:
                # Try parsing from raw output
                for line in output.split('\n'):
                    if key.lower() in line.lower():
                        nums = re.findall(r'[-+]?\d*\.?\d+[eE]?[-+]?\d*', line)
                        if nums:
                            measured[key] = float(nums[-1])

        results.append({
            "name": name,
            "source": "ngspice-42",
            "measured": measured,
        })
        return measured
    except Exception as e:
        results.append({"name": name, "source": "ngspice-42", "error": str(e)})
        return {}
    finally:
        os.unlink(cirfile)


def run_spice_op(name, netlist, nodes):
    """Run operating point analysis and extract node voltages."""
    full = netlist + '\n.op\n.end\n'

    with tempfile.NamedTemporaryFile(mode='w', suffix='.cir', delete=False) as f:
        f.write(full)
        f.flush()
        cirfile = f.name

    try:
        proc = subprocess.run(
            ['ngspice', '-b', cirfile],
            capture_output=True, text=True, timeout=10
        )
        output = proc.stdout

        measured = {}
        for node in nodes:
            # ngspice .op output: tab-indented "node  voltage"
            pattern = rf'^\s+{re.escape(node)}\s+([-+]?\d*\.?\d+[eE][-+]?\d+|[-+]?\d+\.?\d*)'
            m = re.search(pattern, output, re.MULTILINE | re.IGNORECASE)
            if m:
                measured[f'v_{node}'] = float(m.group(1))

        # Also extract branch currents
        for line in output.split('\n'):
            m = re.match(r'^\s+([\w#]+)\s+([-+]?\d*\.?\d+[eE][-+]?\d+)', line)
            if m and 'branch' in m.group(1):
                measured[m.group(1)] = float(m.group(2))

        results.append({"name": name, "source": "ngspice-42", "measured": measured})
        return measured
    except Exception as e:
        results.append({"name": name, "source": "ngspice-42", "error": str(e)})
        return {}
    finally:
        os.unlink(cirfile)


# ─── Test circuits ─────────────────────────────────────────────────────────

# 1. Voltage dividers
for r1, r2 in [(1000, 1000), (1000, 2000), (1000, 3000), (2200, 4700),
               (10000, 10000), (470, 10000)]:
    run_spice_op(f"divider_{r1}_{r2}",
        f"Voltage divider {r1}/{r2}\n"
        f"V1 vcc 0 5\n"
        f"R1 vcc mid {r1}\n"
        f"R2 mid 0 {r2}\n",
        ['mid'])

# 2. LED circuits (diode model: D1N4148-like with modified Vf)
for r, vf_name in [(220, 'red'), (1000, 'red'), (470, 'blue')]:
    is_val = {'red': '1e-20', 'blue': '1e-30'}[vf_name]
    n_val = {'red': '1.8', 'blue': '2.0'}[vf_name]
    run_spice_op(f"led_{vf_name}_{r}",
        f"LED circuit {vf_name} R={r}\n"
        f"V1 vcc 0 5\n"
        f"R1 vcc anode {r}\n"
        f"D1 anode 0 LEDMODEL\n"
        f".model LEDMODEL D(IS={is_val} N={n_val} RS=10)\n",
        ['anode'])

# 3. Resistor networks
run_spice_op("parallel_1k_1k",
    "Parallel 1k/1k\n"
    "V1 vcc 0 5\n"
    "R1 vcc 0 1000\n"
    "R2 vcc 0 1000\n",
    ['vcc'])

# 4. Series chain
run_spice_op("series_1k_1k_1k",
    "Series 1k chain\n"
    "V1 vcc 0 5\n"
    "R1 vcc n1 1000\n"
    "R2 n1 n2 1000\n"
    "R3 n2 0 1000\n",
    ['n1', 'n2'])

# 5. Wheatstone bridge
for r1, r2, r3, r4 in [(1000, 1000, 1000, 1000),
                         (1000, 1000, 1000, 2000),
                         (1000, 2000, 3000, 4000)]:
    run_spice_op(f"wheatstone_{r1}_{r2}_{r3}_{r4}",
        f"Wheatstone bridge\n"
        f"V1 vcc 0 5\n"
        f"R1 vcc na {r1}\n"
        f"R2 vcc nb {r2}\n"
        f"R3 na 0 {r3}\n"
        f"R4 nb 0 {r4}\n",
        ['na', 'nb'])

# 6. NPN transistor switch
run_spice_op("npn_switch",
    "NPN switch\n"
    "V1 vcc 0 5\n"
    "V2 vbase 0 5\n"
    "Rload vcc collector 1000\n"
    "Rbase vbase base 10000\n"
    "Q1 collector base 0 NPNMOD\n"
    ".model NPNMOD NPN(BF=100 IS=1e-14)\n",
    ['collector', 'base'])

# 7. NMOS switch
run_spice_op("nmos_switch",
    "NMOS switch\n"
    "V1 vcc 0 5\n"
    "V2 gate 0 5\n"
    "Rload vcc drain 1000\n"
    "M1 drain gate 0 0 NMOSMOD W=1u L=1u\n"
    ".model NMOSMOD NMOS(VTO=2 KP=0.5)\n",
    ['drain'])

# 8. Op-amp non-inverting
run_spice_op("opamp_noninvert",
    "Op-amp non-inverting gain=10\n"
    "V1 inp 0 0.5\n"
    "E1 out 0 inp inn 1000000\n"
    "Rf out inn 9000\n"
    "Rg inn 0 1000\n",
    ['out', 'inn', 'inp'])

# 9. RC transient at specific time points
for rc_r, rc_c in [(10000, 1e-4)]:
    rc = rc_r * rc_c
    for mult in [1.0, 2.0, 5.0]:
        t = rc * mult
        netlist = (
            f"RC charge R={rc_r} C={rc_c}\n"
            f"V1 vcc 0 5\n"
            f"R1 vcc cap {rc_r}\n"
            f"C1 cap 0 {rc_c} ic=0\n"
            f".tran {t/100} {t} uic\n"
            f".print tran v(cap)\n"
            f".end\n"
        )
        with tempfile.NamedTemporaryFile(mode='w', suffix='.cir', delete=False) as f:
            f.write(netlist)
            f.flush()
            cirfile = f.name
        try:
            proc = subprocess.run(['ngspice', '-b', cirfile],
                                  capture_output=True, text=True, timeout=10)
            # Parse the last data line (closest to target time)
            lines = [l for l in proc.stdout.split('\n')
                     if re.match(r'^\s*\d+\s', l)]
            if lines:
                parts = lines[-1].split()
                t_actual = float(parts[1])
                v_cap = float(parts[2])
                results.append({
                    "name": f"rc_{rc_r}_{rc_c}_at_{mult}RC",
                    "source": "ngspice-42",
                    "measured": {"v_cap": v_cap, "t_actual": t_actual},
                })
            else:
                results.append({
                    "name": f"rc_{rc_r}_{rc_c}_at_{mult}RC",
                    "source": "ngspice-42",
                    "error": "no data lines"
                })
        except Exception as e:
            results.append({
                "name": f"rc_{rc_r}_{rc_c}_at_{mult}RC",
                "source": "ngspice-42",
                "error": str(e)
            })
        finally:
            os.unlink(cirfile)

# 10. Current source
run_spice_op("isource_2mA",
    "Current source\n"
    "I1 0 node 0.002\n"
    "R1 node 0 1000\n",
    ['node'])

# ─── Output ──────────────────────────────────────────────────────────────

output = {
    "generator": "run_ngspice.py",
    "tool": "ngspice-42",
    "note": "Ground truth from industry-standard SPICE simulator",
    "result_count": len(results),
    "results": results,
}

with open("test/golden/ngspice_oracles.json", "w") as f:
    json.dump(output, f, indent=2)

passed = sum(1 for r in results if 'measured' in r and r['measured'])
failed = sum(1 for r in results if 'error' in r or ('measured' in r and not r['measured']))
print(f"ngspice: {passed} circuits measured, {failed} failed → test/golden/ngspice_oracles.json")
