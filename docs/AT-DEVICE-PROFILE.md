# Bounded IBM AT device profile

`PCAT80286` is an opt-in machine configuration. It adds two cascaded 8259As,
an exact-port 8042 subset at `60h`/`64h`, and a deterministic MC146818 subset
at `70h`/`71h`. The default machines and the XT 8255 keyboard path are
unchanged. This profile does not claim an AT BIOS, disks, DMA cascade, a full
keyboard protocol, or CPU reset.

The 8042 implements command-byte commands `20h`/`60h`, keyboard disable/enable
`ADh`/`AEh`, controller self-test `AAh`, interface test `ABh`, and output-port
commands `D0h`/`D1h`. Host `keyIn()` injects set-1 bytes. Only keyboard-tagged
queue entries assert IRQ1, and command-byte bit 0 gates that IRQ. Writes are
consumed synchronously, so status IBF is clear while a command awaits its data.
Output-port bit 0 low is refused because CPU reset is not implemented.

The slave PIC drives master IR2. An interrupt acknowledge consumes both
cascade levels and returns the slave vector; software must EOI slave and
master. The bounded topology accepts one slave and does not implement special
fully nested or buffered cascade modes.

The RTC starts at a configured Unix second and advances only with machine
cycles. It supports binary/BCD and 12/24-hour reads, SET freeze, UIP, periodic,
update, and alarm flags. Status C flags latch whether or not their enables are
set; enabled flags drive slave IRQ0 (AT IRQ8), and reading C clears them. Date
writes, square wave, daylight-saving adjustment, unsupported divider modes,
and rates 1/2 are refused. Port 70 bit 7 masks delivery of a pending NMI; an
edge stays pending until unmasked.

The controller behavior follows the IBM 5170 Technical Reference (March 1984),
pages 1-40 through 1-44. The device models are deliberately synchronous and
bounded rather than firmware-complete.
