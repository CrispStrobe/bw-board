#!/usr/bin/env python3
"""
Compute golden/oracle values for circuit test cases using independent
Python calculations. These values are NOT derived from the bw-board
solver — they are computed from first principles (Ohm's law, KCL, KVL,
diode equations, Norton/Thévenin transforms).

Output: JSON file that the test suite reads and asserts against.
"""

import json
import math

oracles = []

def add(name, circuit, expected):
    oracles.append({"name": name, "circuit": circuit, "expected": expected})

# ─── 1. Voltage dividers ──────────────────────────────────────────────────

for r1, r2 in [(1000, 1000), (1000, 2000), (1000, 3000), (2200, 4700),
               (10000, 10000), (470, 10000), (100, 900)]:
    vcc = 5.0
    v_mid = vcc * r2 / (r1 + r2)
    i = vcc / (r1 + r2)
    add(f"divider_{r1}_{r2}", {
        "type": "voltage_divider", "vcc": vcc, "r1": r1, "r2": r2
    }, {
        "v_mid": round(v_mid, 6),
        "current_mA": round(i * 1000, 6),
    })

# ─── 2. LED circuits ─────────────────────────────────────────────────────

for r, vf, label in [(220, 2.0, "red_220"), (330, 2.0, "red_330"),
                      (1000, 2.0, "red_1k"), (470, 3.2, "blue_470"),
                      (1000, 3.2, "blue_1k"), (100, 1.8, "ir_100")]:
    vcc = 5.0
    rd = 10  # dynamic resistance
    r_pin = 25  # pushpull pin Rth
    i = (vcc - vf) / (r + rd + r_pin)
    brightness = min(1.0, i / 0.020)
    add(f"led_{label}", {
        "type": "led_circuit", "vcc": vcc, "r": r, "vf": vf,
        "rd": rd, "r_pin": r_pin
    }, {
        "current_mA": round(i * 1000, 6),
        "brightness": round(brightness, 6),
    })

# ─── 3. Active-low vs active-high LED (the core lesson) ──────────────────

vcc = 5.0
r = 1000
vf = 2.0
rd = 10
r_strong = 25
r_quasi_pullup = 21700

# Active-low: VCC → R → LED → pin(quasi, low)
i_active_low = (vcc - vf) / (r + rd + r_strong)
add("active_low_quasi_sink", {
    "type": "active_low_led", "mode": "quasi", "drive": "low"
}, {
    "current_mA": round(i_active_low * 1000, 6),
    "brightness": round(min(1.0, i_active_low / 0.020), 6),
})

# Active-low: VCC → R → LED → pin(quasi, high) — LED off
# Both sides at VCC: VCC through R(1k), pin at VCC through 21.7kΩ
# Norton: I = VCC/R = 5/1000 = 5mA from VCC, I = VCC/21700 from pin
# But both pull toward VCC, so net current through LED ≈ 0
add("active_low_quasi_source", {
    "type": "active_low_led", "mode": "quasi", "drive": "high"
}, {
    "current_mA": 0.0,
    "brightness": 0.0,
})

# Naive wiring: pin(quasi, high) → R → LED → GND
i_naive_quasi = (vcc - vf) / (r_quasi_pullup + r + rd)
add("naive_wiring_quasi_high", {
    "type": "naive_led", "mode": "quasi", "drive": "high"
}, {
    "current_mA": round(i_naive_quasi * 1000, 6),
    "brightness": round(min(1.0, i_naive_quasi / 0.020), 6),
})

# Naive wiring: pin(pushpull, high) → R → LED → GND
i_naive_pp = (vcc - vf) / (r_strong + r + rd)
add("naive_wiring_pushpull_high", {
    "type": "naive_led", "mode": "pushpull", "drive": "high"
}, {
    "current_mA": round(i_naive_pp * 1000, 6),
    "brightness": round(min(1.0, i_naive_pp / 0.020), 6),
})

# ─── 4. Parallel resistors ───────────────────────────────────────────────

for r_vals in [(1000, 1000), (1000, 2000), (1000, 1000, 1000),
               (470, 1000, 2200)]:
    r_eq = 1.0 / sum(1.0/r for r in r_vals)
    vcc = 5.0
    i_total = vcc / r_eq
    add(f"parallel_{'_'.join(str(r) for r in r_vals)}", {
        "type": "parallel_resistors", "vcc": vcc, "resistors": list(r_vals)
    }, {
        "r_equivalent": round(r_eq, 6),
        "total_current_mA": round(i_total * 1000, 6),
    })

# ─── 5. RC time constant ─────────────────────────────────────────────────

for r, c in [(10000, 0.0001), (1000, 0.001), (100000, 0.000001)]:
    rc = r * c
    vcc = 5.0
    for t_rc_mult in [0.1, 0.5, 1.0, 2.0, 5.0]:
        t = rc * t_rc_mult
        v = vcc * (1 - math.exp(-t / rc))
        add(f"rc_{r}_{c}_at_{t_rc_mult}RC", {
            "type": "rc_charge", "vcc": vcc, "r": r, "c": c,
            "t_seconds": t, "t_rc_multiples": t_rc_mult
        }, {
            "voltage": round(v, 6),
            "rc_seconds": round(rc, 9),
        })

# ─── 6. Wheatstone bridge ────────────────────────────────────────────────

for r1, r2, r3, r4 in [(1000, 1000, 1000, 1000),
                         (1000, 1000, 1000, 2000),
                         (1000, 2000, 3000, 4000)]:
    vcc = 5.0
    v_a = vcc * r3 / (r1 + r3)
    v_b = vcc * r4 / (r2 + r4)
    v_bridge = v_a - v_b
    add(f"wheatstone_{r1}_{r2}_{r3}_{r4}", {
        "type": "wheatstone", "vcc": vcc,
        "r1": r1, "r2": r2, "r3": r3, "r4": r4
    }, {
        "v_a": round(v_a, 6),
        "v_b": round(v_b, 6),
        "v_bridge": round(v_bridge, 6),
        "balanced": abs(v_bridge) < 0.001,
    })

# ─── 7. Thévenin equivalents ─────────────────────────────────────────────

for mode, drive, vth, rth in [
    ("quasi", "low", 0, 25),
    ("quasi", "high", 5.0, 21700),
    ("pushpull", "low", 0, 25),
    ("pushpull", "high", 5.0, 25),
]:
    add(f"thevenin_{mode}_{drive}", {
        "type": "pin_thevenin", "mode": mode, "drive": drive, "vcc": 5.0
    }, {
        "vth": vth,
        "rth": rth,
    })

# ─── 8. Norton combination (multiple sources to one node) ────────────────

# VCC(5V) → R1(1k) → node ← R2(2k) ← GND, node → R3(3k) → GND
# Norton: I = 5/1000 = 5mA from VCC, G = 1/1000 + 1/2000 + 1/3000
g_total = 1/1000 + 1/2000 + 1/3000
i_total_n = 5.0/1000
v_node = i_total_n / g_total
add("norton_3_source", {
    "type": "norton_combination",
    "sources": [
        {"v": 5.0, "r": 1000},
        {"v": 0.0, "r": 2000},
        {"v": 0.0, "r": 3000},
    ]
}, {
    "v_node": round(v_node, 6),
    "g_total": round(g_total, 9),
})

# ─── 9. Potentiometer ────────────────────────────────────────────────────

for pos in [0.0, 0.25, 0.5, 0.75, 1.0]:
    vcc = 5.0
    v_wiper = vcc * pos
    add(f"pot_{pos}", {
        "type": "potentiometer", "vcc": vcc, "position": pos
    }, {
        "v_wiper": round(v_wiper, 6),
    })

# ─── 10. PWM brightness ──────────────────────────────────────────────────

steady_brightness = (5.0 - 2.0) / (1000 + 10 + 25) / 0.020
for duty in [0.1, 0.25, 0.5, 0.75, 0.9, 1.0]:
    b = duty * steady_brightness
    add(f"pwm_duty_{int(duty*100)}", {
        "type": "pwm_brightness", "duty": duty,
        "vcc": 5.0, "r": 1000, "vf": 2.0
    }, {
        "brightness": round(min(1.0, b), 6),
        "steady_brightness": round(steady_brightness, 6),
    })

# ─── Output ──────────────────────────────────────────────────────────────

output = {
    "generator": "compute_oracles.py",
    "note": "Computed independently from bw-board solver. Do not regenerate from solver output.",
    "oracle_count": len(oracles),
    "oracles": oracles,
}

with open("test/golden/oracles.json", "w") as f:
    json.dump(output, f, indent=2)

print(f"Generated {len(oracles)} oracle values → test/golden/oracles.json")
