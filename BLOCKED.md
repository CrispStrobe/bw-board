# BLOCKED.md — bw-board items waiting on external work

## vsource current-limit (power supply CC mode)

**Blocked on:** mna.js change (coordinator owns mna.js)

**What:** A power supply that clamps output when current exceeds the set limit
(CV → CC mode transition). Requires the MNA solver to detect when branch current
exceeds `iLimit` and switch the stamp from voltage source to current source.

**Spec filed:** `spec-updates/vsource-current-limit.md`

**Interim workaround available:** A device-registry `power_supply` approximates it
with rTh = volts/iLimit (linear sag instead of flat + clamp). Electrically wrong
for partial loads but prevents infinite current into a short.

**Consumer:** target inventory requires "power supply source (settable V + current
limit)" for the function generator / bench PSU instrument panel.

---

## Headless live end-to-end tests (engineering bar class 4)

**Blocked on:** Playwright browser install (hundreds of MB, violates fleet memory rule
while other agents run on this VPS — `free -m` shows <1.2GB available).

**What:** Drive the real UI, assert on a rendered voltage/brightness, assert no
`pageerror`. The 4th engineering bar test class from HANDOVER §8.

**Workaround:** None — this test class requires a browser. Defer until the fleet
shrinks or memory is available. Check `~/.cache/ms-playwright` before installing.

---

*Last updated: 2026-08-09*
