# Resync test INCONCLUSIVE — `-inject` may not deliver bytes to firmware

## Status

The idle-timeout resync test (`serial-debug-e2e.test.js`) is INCONCLUSIVE.
Zero UART TX bytes were observed across 20ms and 100ms runs. The firmware
never produces a reply to injected bytes via `stc12_trace -inject`.

The previous "PASS" (`a551258`) was a **false positive** — assertions
matched hex digits in PC trace addresses, not UART TX data. Corrected
in `9f69af9`.

## What was excluded

**(b) Insufficient run time**: tested at 100ms (5× original). The firmware
sits in a tight polling loop at PC 0x0053-0x0054 and never breaks out.
More time does not change the result.

## Live hypothesis

**(a) `-inject` and `-S out=` may not interact correctly in `stc12_trace`.**
The `-inject` flag (a81091e) schedules byte delivery to the UART RX path.
The `-S uart=0,out=FILE` captures TX output. But 0 bytes were captured even
for a valid HELLO frame sent without any torn-frame preamble.

This is ucsim-stc's binary. They are frozen on the weekly limit until Aug 15.

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

The firmware loops at 0x0053-0x0054. Either the injected bytes are not
reaching SBUF/RI, or the UART interrupt is not configured in this mode.

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
