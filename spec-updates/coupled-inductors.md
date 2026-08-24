# Coupled inductors — the transformer as an MNA part (E3.4)

New built-in kind `transformer`, terminals `p1, p2, s1, s2` with the
dots at `p1`/`s1` (positive mutual coupling: current into both dots
produces adding flux). It unblocks the power-supply lesson arc
(transformer → rectifier → filter → regulator).

## Parameters

Two spellings, physical and pedagogical:

- `{ l1, l2, k }` — winding self-inductances in henries and the
  coupling coefficient. Explicit values win.
- `{ ratio, lm, k }` — turns ratio n = Np/Ns and the magnetizing
  (primary) inductance; derives `l1 = lm`, `l2 = lm / n²`.
  Defaults: `lm = 10` H (large enough that magnetizing current is a
  small correction at audio/mains frequencies), `k = 0.999`.

`k` must sit in (0, 1): **k = 1 is refused with the reason named** (a
perfectly coupled pair has a singular inductance matrix — the ideal
transformer is the limit, not a member, of this model; model it with k
close to 1), as is k ≤ 0. The refusal is a validation error, not a
solve-time surprise.

## What the model claims

A REAL transformer: finite magnetizing inductance, leakage through
k < 1, lossless windings (no copper resistance — add explicit resistors
for that; stated bound, not an omission by accident). Consequences the
oracles pin:

- At DC each winding is the same 1 mΩ short a lone inductor is, and
  there is NO coupling — di/dt = 0 induces nothing. A DC primary drive
  leaves the secondary at zero. (This is the physics; it is also why
  the mains-lesson story needs AC.)
- At AC midband, |V2/V1| → k/n and |I2/I1| → n·k for a loaded
  secondary; magnetizing current adds to the primary reading.
- Lossless: over any transient, ∫(v1·i1 + v2·i2) dt equals the change
  of stored energy ½(L1·i1² + 2M·i1·i2 + L2·i2²) to integration
  tolerance — the energy-conservation oracle.

## Companion stamps

With L = [[L1, M], [M, L2]], M = k·√(L1·L2), Γ = L⁻¹ =
[[L2, −M], [−M, L1]] / (L1·L2 − M²):

- **BE**:   i(t+h) = i(t) + h·Γ·v(t+h)          → G = h·Γ, Iₙ = i(t)
- **trap**: i(t+h) = i(t) + (h/2)·Γ·(v(t+h)+v(t)) → G = (h/2)·Γ,
            Iₙ = i(t) + (h/2)·Γ·v(t)

G is a full 2×2: each entry G[α][β] stamps the four-node pattern
between port α's terminals and port β's terminals (the α=β entries are
ordinary two-terminal conductances; the α≠β entries are the mutual
coupling). Norton currents enter at the dot terminals. Branch current
sign convention: i_p flows p1→p2, i_s flows s1→s2, matching the lone
inductor's a→b.

State rides the EXISTING inductor maps under the keys `<id>:p` and
`<id>:s` (currents and trap voltages alike), so the adaptive
controller's LTE sees both windings with no controller change, and
save/restore inherits for free.

**AC** (ac.js): admittance Y(ω) = Γ / (jω) — pure susceptance
B = −Γ/ω, stamped with the same four-node pattern into the bordered
real-equivalent system; the α=β entries reduce to the lone inductor's
−1/(ωL).

## Oracles (same commit)

1. 2:1 transfer: ratio 2 driven by a 1 kHz sine, resistive secondary
   load — secondary RMS ≈ half the primary RMS (within the k² and
   magnetizing corrections), secondary current ≈ twice.
2. Energy conservation across that transient (lossless bound above).
3. AC sweep: |V2/V1| at midband ≈ 1/n via acSweep.
4. DC honesty: a DC primary drive leaves the secondary at 0 V and the
   primary winding reading as a short.
5. k = 1 and k = 0 refused at validation with the message naming why.
