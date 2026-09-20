# Experimental VGA memory pipeline

`src/experimental/vga-memory.js` implements the CPU-visible VGA memory
pipeline behind the register latches in `src/vga-card.js`. The explicit
experimental 386 VGA AT profile connects it at A0000h through BFFFFh while
the register file remains the single owner of VGA ports. Other machine
profiles are unchanged.

The implementation follows IBM's *Personal System/2 Hardware Interface
Technical Reference — Video Subsystems*, September 1992, section 2, “VGA
Function.” In particular, the Memory Mode register and map routing are on
pages 2-51 through 2-52; the graphics-controller Set/Reset, Enable Set/Reset,
Color Compare, Data Rotate, Read Map Select, Graphics Mode, Miscellaneous,
Color Don't Care, and Bit Mask registers are on pages 2-77 through 2-86. The
primary scan used during implementation is archived at:

<https://ardent-tool.com/docs/pdf/42G2193_PS2_Hardware_Interface_Technical_Reference_Video_Subsystems_Sep92.pdf>

The modeled contract is:

- four independent 64 KiB memory maps and four byte latches;
- A0000h 128 KiB, A0000h 64 KiB, B0000h 32 KiB, and B8000h 32 KiB aperture
  selections from graphics-controller register 6;
- sequential planar and chain-4 addressing, plus independent sequencer write
  parity, graphics-mode read-map routing, and graphics-miscellaneous A0
  substitution controls for odd/even access;
- map-mask write selection and read-map selection;
- read mode 0 and per-pixel color comparison in read mode 1;
- write modes 0 through 3, including rotation, logical operations, set/reset,
  enable set/reset, bit masking, and persistent read latches.

`read(physicalAddress)` returns `null` and `write(physicalAddress, byte)`
returns `false` when the current aperture does not decode the address. A
decoded write returns `true`, including when the map mask suppresses every
plane. Reads load all four latches before selecting or comparing their result;
writes do not implicitly refresh them. That distinction is required by write
mode 1 and masked raster operations.

The sequencer Extended Memory bit selects a 16 KiB or 64 KiB address range in
each map, representing 64 KiB or 256 KiB total VGA RAM. The 128 KiB aperture
therefore aliases addresses beyond the enabled per-map range. Chain-4 consumes
A1:A0 as the map number and clears those bits from the literal CPU plane
address; it does not compact higher address bits. CRTC/display fetch packing
is a separate rendering concern. Graphics-controller register 6 currently
suppresses CPU A0 in the bounded odd/even route without itself choosing a
read map or restricting write maps. The hardware's higher-address
substitution into that route is not yet modeled, so this is not evidence for
the entire 128 KiB odd/even aperture. Register 5
independently uses A0 to select the odd/even read map, while sequencer register
4 independently restricts writes to the odd or even pair. Mixed settings are
modeled because VGA font-plane access intentionally programs these controls
differently.

The module owns CPU-memory decode, so it also honors the Miscellaneous Output
RAM Enable bit: with that bit clear, reads and writes are reported as
undecoded. A future machine integration must not add a second conflicting RAM
enable policy.

This module does not interpret CRTC or attribute-controller display fetches,
render pixels, arbitrate CPU and display memory cycles, model snow/timing, or
model VGA ROM shadow-write chipset behavior. It also does not yet model VGA
write buffering or vendor extensions. The existing mode-13h renderer remains
a separate linear renderer and is not evidence for Mode X, Windows, or Doom.

The external firmware input is SeaVGABIOS/SeaBIOS release 1.16.3 at
commit `a6ed6b701f0a57db0569ab98b0661c12a6ec3ff8`; the local build produced
`/tmp/astra-seavgabios-source/out/vgabios.bin`. The source-bound board probe
executes its option POST, observes the installed C000h INT 10h vector, and
then runs a host-installed real-mode diagnostic guest. That guest requests
mode 13h through INT 10h, verifies BDA mode 13h and chain-4 register state,
and round-trips two bytes through A0000h. This proves the bounded firmware
service and CPU-memory path; it is not a complete AT boot, pixel-rendering,
Mode X, Windows, or Doom graphics result.
