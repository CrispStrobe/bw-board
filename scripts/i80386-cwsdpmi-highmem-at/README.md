# Owned high-linear-memory and timer AT gate

This is a separate source checkpoint for the
[owned DJGPP client](../i80386-cwsdpmi-highmem-timer/client.c). Its QEMU
`pc`/486/4 MiB control reached the finite result in the
[public QEMU result](https://github.com/CrispStrobe/bw-board/blob/34f096ed37cf335ea3dca7b4bc58f3ee2dec02b2/docs/I80386-DPMI-HIGHMEM-QEMU-RESULTS.md).
This AT gate has no hosted result
until its dedicated exact-head workflow runs and its original packet is audited.
The older client, QEMU gate, AT completion gate, CPU, BIOS, VGA, media and
compiler helpers remain byte-exact at inherited source `6ec767b5`.

A fresh compiler receipt, executable, map, client source and initial media
must match each other and the reviewed QEMU candidate hashes. The binder
requires the complete `main` and nine DPMI wrapper code spans, including
`__dpmi_get_segment_base_address` from `d0006.o` and
`__dpmi_get_segment_limit` from `dpmi_lsl.o`. The latter is an `LSL` readback,
not an `INT 31h` service. At the synchronous protected-mode main cut, the
reader copies ordinary RAM once and retains the strict whole `.text` result.
Only a private ticket from an unchanged strict mismatch can authorize the
separately named exact ten-role owned-code result. It does not mask or relabel
the changed runtime selector slots, or prove main's first instruction executes
next.

On the same machine, ordinary steps then require source-owned accepted Set-1
scans for `RUNHT.BAT`, strict canonical HTOUT diagnostic bytes, exact zero-exit
marker, a fresh current C: prompt, two separated complete disk observations,
and a pre-VERIFY disk/screen fence. A separately accepted `VERIFYHT.BAT`
command must produce the exact return marker, durable command echo and later
current C: prompt, again with two separated disk observations. Initial four
result files must be absent. At main entry HTOUT may be absent or exactly
empty because shell redirection creates or truncates it before launching the
client; the other three remain absent. The predeclared limits are 120 million
steps and 640 seconds of synchronous scenario wall time; every failure retains
bounded phase/progress and available CPU, memory, disk, keyboard and screen
observations. The public artifact contains only reports and notices, not EXE,
ROM, media, RAM or toolchain bytes.

Passing this gate would establish this finite client's **linear** address
above 1 MiB, a
nonwrapping requested 4,096-byte span, exact selector base/4,095 limit
readback, 256-byte checksum and observed 1–36 tick modulo-day advance within
262,144 calls. It does not prove physical placement above 1 MiB under the
4 MiB mapped AT profile, `INT 31h` frame/IRET ownership, calibrated timer
accuracy, general application compatibility or RTx. CPU/device profile and
firmware differ from QEMU. Pure controls are model and source admission only;
they do not constitute a guest run.
