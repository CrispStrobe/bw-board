# Experimental AT extended memory and A20

`I8086Machine` keeps its existing 1 MiB memory and direct address path by
default. An opt-in machine can set `memoryBytes` from 1 MiB through 16 MiB and
add `a20: {controller: '8042', enabled: false}`. Regions and memory-mapped I/O
remain raw physical ranges and must fit that geometry.
Configuring more memory does not give an 8086 or 80186 more address pins: those
CPU variants still generate only 20-bit physical addresses. The real-mode 286
can reach its HMA window, and the experimental protected backend can generate
the wider addresses needed by the owned high-memory guest.

CPU addresses pass through the A20 policy. When disabled, the policy clears
address bit 20; it does not mask the address to 20 bits, so bit
21 and higher remain intact. Byte access, instruction fetch, guarded RAM word
access, ROM, MMIO and video aliases all see the translated address. Host
`loadRom` addresses are raw physical addresses and bypass the gate so a host
can prepare low and extended memory independently.

DMA remains on its existing raw physical callbacks, matching the original AT
schematic's CPU-address-line gate. The existing 8237/page-latch model retains
its prior address width; this work does not claim a complete AT DMA subsystem.

The optional controller decodes exactly ports 60h and 64h. It implements only
the original IBM AT 8042 output-port operations D0 (read output port) and D1
(write output port); output-port bit 1 controls A20. It does not claim keyboard
operation, CPU reset, self-test, or command-byte support. Unsupported commands
and data writes without a pending D1 are refused. D0 also refuses to overwrite
a full output buffer. A D1 data byte with output-port bit 0 clear is refused
before changing A20 because that requests an unsupported CPU reset. A configured device window
covering 60h or 64h is rejected instead of silently replacing either device;
port 61h remains available for the speaker/PPI. Port 92h fast A20 is not part
of this original-AT profile.

The port meanings follow the IBM *Personal Computer AT Technical Reference*
(March 1984), pages 1-40 and 1-42 through 1-44: status bit 1 is input-buffer
full, D0 reads the output port, D1 makes the next 60h write the output port,
output bit 1 drives gate A20, and output bit 0 drives system reset. This model
consumes input synchronously, so status bit 1 stays clear, and it refuses a
bit-0-low output value because CPU reset pulses are outside this subset.

Reset preserves RAM and restores the configured initial A20 state while
clearing pending controller input and output. Memory geometry, the initial
gate configuration, and CPU backend participate in checkpoint topology. A
default CPU checkpoint also carries the live gate, output port, pending D1,
and queued D0 byte and validates all of them before mutation.

`cpuBackend: 'protected286-experimental'` is restricted to variant `80286`.
It uses the same machine bus and deliberately skips the raw-RAM word shortcut,
because that shortcut cannot enforce protected segment limits and permissions.
Machine checkpoints refuse this backend until the machine codec covers its
hidden descriptor caches, MSW, GDTR and IDTR. This option is an experimental
owned-guest path, not a full PC/AT platform claim.

`machine.reset()` is a host lifecycle operation. It restores the configured
gate/controller state; it does not claim to model the AT's 286 reset vector or
an 8042/FE hardware reset pulse.
