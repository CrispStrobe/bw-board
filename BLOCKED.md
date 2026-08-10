# BLOCKED.md — bw-board items waiting on external work

## ~~vsource current-limit (power supply CC mode)~~ RESOLVED

Implemented in `e060978`. `vsource` now accepts `params.iLimit` — CV→CC
transition iterates in the NR loop.

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
