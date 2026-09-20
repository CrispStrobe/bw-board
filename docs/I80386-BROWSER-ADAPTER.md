# Experimental 80386 browser adapter

`createDebugTarget('i80386', opts)` is the browser-facing entry point for the
opt-in AT machine. It returns the same `{ target, adapter }` shape as the other
debug targets. The target exposes `video()` and `sendScancode()` so the existing
`VdpScreen` in the circuits/widgets/code surface can render the guest VGA frame
and route IBM PC set-1 keyboard events. `MediaPanel` receives its slots from
`describeMedia('i80386')` and can load BIOS, VGA ROM, ATA/floppy bytes, and a
DOSBox config.

The profile remains explicitly experimental. No production machine default is
changed, and checkpoint support is still refused by the 386 machine until its
architectural state is covered.

DOSBox configs are handled declaratively by `parseDosboxConfig()` and
`resolveDosboxMedia()`. `mount` of a host directory is reported as a refusal;
`imgmount` and `boot` names resolve only against files the host supplied. The
browser never executes `autoexec` commands.
