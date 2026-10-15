# Subscribed free-guest diagnostic

This finite diagnostic compares the unchanged ordinary `machine.step` xv6 filesystem recipe with and without the dedicated 386 debugger subscription. The pinned MIT guest uses the existing 4 MiB memory build profile; the instruction budget is separately 30 million. Neither the observer nor the target supplies a replacement scheduler.

`reader.py --source-preload OUTPUT` checks source before any hosted Node imports. `--admit OUTPUT` checks the closed 78-role probe hash inventory and separate qualification roles against the selected Git HEAD and live bytes before Node imports the guest. It admits the fixed Node 22.23.3 executable/version and records guest inputs and Node bytes again after execution. Firmware bytes and notices also join tracked Git bytes. `--execute control` and `--execute observed` use that absolute executable with a fixed environment, retain stdout up to 4 MiB and stderr up to 64 KiB during capture, and preserve the first failure, deadline, EOF, exit and owned-child reap facts. Per-child timeout is 600 seconds with TERM then a five-second grace before KILL; a timeout never becomes successful merely because cleanup reaps the child. The inventory includes statically discovered optional roles; it is not a claim that every listed module executes. `--packet DIRECTORY` reads retained originals, independently reconstructs instruction before-state, and requires complete control/observed report equality, both original empty stderrs and successful closed execution records. Captured runtime byte identities join source admission; all direct architectural after-fields must be present. This is finite observation and source consistency, not independent authentication of runtime acquisition or official Actions metadata. Root workflow selection remains external trust, not self-authenticated authority.

The observer starts at the first protected, non-VM, cached-32-bit CPL3 boundary, retains at most 64 instruction and 1024 memory events, and closes its subscription. IRQ delivery can change privilege before the wrapped CPU instruction: only reconstructed actual instruction before-state receives CPL3 credit. Event timestamps retain their source-defined meaning and are not asserted to mark the end of the AT board step. RAM and VGA planes are hashed only around the two explicit nonmutating debugger reads.

Tiny authored controls:

```sh
node --test test/i80386-debug-guest-observer.test.mjs
/usr/bin/python3 -I -B scripts/i80386-debug-guest/reader.py --controls
```

Six authored observer tests include an actual ordinary LAPIC IRQ-before-instruction and real IRET return. Eleven reader/capture test methods include a complete manufactured packet, fourteen source/runtime/media/boundary/register/capture mutations, six execution-result mutations and mocked timeout/dual-error cleanup. These manufactured packets provide no guest qualification.

No full guest was run locally. Hosted execution awaits the exact combined adopted CPU and reviewed debugger source closure. This does not qualify an installed GUI, checkpoint restore, arbitrary OS compatibility or physical timing.
