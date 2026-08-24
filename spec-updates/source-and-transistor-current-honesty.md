# Source and transistor current honesty (2026-08-24)

Three related fixes, all found or provoked by the EXPECTED-quantities
gate (sb3-creator `fix/expected-quantities`), which adjudicates every
numeric claim in every EXPECTED.md against a measurement. Its census
had to DECLINE two whole classes of measurand by name; this update
makes both classes trustworthy.

## 1. `vsource` honors `rInternal`

The stamp gains the classic series term: V(pos) − V(neg) − rInt·I =
volts (`A[row][row] = −rInt`). With `rInternal` absent nothing changes —
the source stays ideal.

Why it matters: the UI resolves the legacy kind `battery` to `vsource`
("same physics, older word" — only true at zero internal resistance),
so every gallery bench that set `battery.rInternal` solved with an
IDEAL source: eight benches and the four German source-resistance
lessons (pc77–pc80), whose documents teach exactly the
loaded-terminal-voltage effect their sim then refused to show. The
bw-board `battery` DEVICE always honored rInternal (the
referenced-drives oracle pins it); the gap was this stamp — reachable
by every consumer that doesn't register power devices.

AC: the SWEPT source now stamps the same series term. A NON-swept
source's net stays AC ground, which ignores its rInternal — at the
0.5–2 Ω the gallery uses that error is far below lesson resolution
(stated bound, not an oversight).

## 2. Saturated PNP: the E-B junction is stamped again

`stampPNP`'s saturated early-return sat ABOVE the E-B junction stamp —
a botched mirror of `stampNPN`, where the clamp correctly replaces
only the VCCS. A saturated PNP therefore had NO base junction: the
base floated to 0 V through gmin, the base resistor carried nothing,
and the solve converged with vEB = 5 V — off which the branch-current
extraction read 430 mA "into" a base whose entire drive path measured
0.43 mA (pc32-pnp-high-side, switch closed; the gate's census case).

The junction now stamps in every region; saturation replaces only the
VCCS with the Vce clamp, exactly as the NPN always did. On pc32 this
moves the solved bench from (base 0 V, rb 0 mA, supply 2.772 mA) to
(base 4.3043 V, rb 0.430 mA, supply 3.202 mA) — the numbers the
document teaches.

## 3. Branch-current extraction is KCL-consistent for FETs too

The MOSFET extraction reported the saturation square law k·vov²
unconditionally. In TRIODE the stamp is a channel resistor
gOn = 2K·max(vov, 0.05), so k·vov² is what the VCCS would DEMAND, not
what the channel passes — the same lesson the BJT extraction already
recorded for its saturation clamp. The extraction now reads the region
map and reports gOn·vds in triode.

Sign correction that rode along: a conducting PMOS's drain extraction
reported +id INTO the drain. Physical current enters at the source and
leaves at the drain, so into-source = +id, into-drain = −id (the
convention every other extraction uses). No oracle pinned the old
sign; the new one is pinned here.

## Oracles (same commit, test/source-honesty.test.mjs)

1. 9 V vsource, rInternal 2 Ω, 10 Ω load → terminal 7.5000 V exactly;
   the same bench without rInternal reads 9.0000 (ideal preserved).
2. AC: swept source rInternal 100 Ω into a 100 Ω load → |V| = 0.5000
   flat (pure resistive divider at every frequency).
3. pc32-pnp-high-side, switch closed: base 4.3043 V; the extracted
   base current EQUALS the base resistor's independently-computed
   branch current (cross-PART agreement, not self-reference); KCL sum
   at the transistor 0; supply 3.202 mA.
4. NMOS switch driven into triode: extracted drain current equals the
   load resistor's branch current; KCL at the FET 0.
5. PMOS high-side conducting: into-source positive, into-drain
   negative, magnitudes equal to the load current.
