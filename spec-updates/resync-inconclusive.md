# Resync test INCONCLUSIVE — `-inject` may not deliver bytes to firmware

## Status

The idle-timeout resync test (`serial-debug-e2e.test.js`) is INCONCLUSIVE.
Zero UART TX bytes were observed across 20ms and 100ms runs. The firmware
never produces a reply to injected bytes via `stc12_trace -inject`.

The previous "PASS" (`a551258`) was a **false positive** — assertions
matched hex digits in PC trace addresses, not UART TX data. Corrected
in `9f69af9`.

## What was excluded

**(b) Insufficient run time**: excluded at 100ms.

**(a) `-inject` does not deliver bytes**: excluded by ucsim-stc `3e9c839` —
`inject_byte` → `input_avail` → `serial.tick` → RI at +83µs → byte in SBUF.

**(c) CORRECTION: firmware never leaves RI poll.** The earlier report
claimed the PC left the polling loop and entered "the handler at 0x003B".
That was wrong on two counts: 0x003B is the PCA vector (interrupt 7),
not the UART handler (0x0023). And the echo program's UART poll is at
0x0069 (`JNB RI,$-3`), not 0x0038. The PC trace shows init completing
and the poll starting, then NO further changes — the inject does not
cause RI to rise during the `run` command.

## Live hypothesis

**(d) The inject does not fire during the `run` command in stc12_trace.**
ucsim-stc `3e9c839` confirmed the inject mechanism works in an
instrumented unit test. But in the actual stc12_trace binary:
- Echo program polls RI at 0x0069 — never breaks out
- No PC change after tick ~72609, even with 200M-tick run
- Inject at 10ms (well past init) does not cause RI to rise
- `-S out=` produces 0 bytes (no TX because no RX was processed)

The firmware is correct (SCON=0x50, EA=1, ES=1, polling RI). The
inject scheduling or dispatch during the `run` loop is the suspect.

This is ucsim-stc's binary.

## Minimal reproduction

```bash
stc12_trace -t STC12 \
  -S uart=0,out=/tmp/tx.bin \
  -inject 10174000,0x7E \
  -inject 10261000,0x00 \
  -inject 10348000,0x01 \
  -inject 10435000,0xFF \
  -e 'run 100000000' \
  stc/build/stc12c5a60s2/10-live-firmware/main.ihx

# Expected: /tmp/tx.bin contains HELLO reply (0x7E ... 0x81 ...)
# Actual:   /tmp/tx.bin is 0 bytes
```

The firmware DOES reach its monitor loop — the trace ends at PC 0x0D9A
(`live-monitor.h:110: sym_read16(0)` = reading `bw_ms` in the monitor
idle loop). The early 0x0053-0x0054 addresses were transient init code
(`mov r6,a` / `mov dpl,r5`), not a vector trap.

The firmware is running and waiting for UART input. The injected bytes
are not triggering the UART handler. Either `-inject` does not set
SBUF/RI in this build, or the UART interrupt configuration in `-t STC12`
mode does not match what the firmware expects.

## What this does NOT affect

The emu8051 e2e test (HELLO/REGS/READ via WASM UART callbacks) remains
valid. That test uses a different transport (in-process callbacks, not
subprocess trace) and produces real replies. The protocol works; the
stc12_trace harness for exercising the resync path does not yet work.

## Standing rule (from this finding)

Two green results in this project have turned out to be measuring something
other than what their readers believed. Both were caught by asking: **what
would this check do if the thing it measures were absent?** If the answer
is "it would still pass", the check needs a positive control.
