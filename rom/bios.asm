;=============================================================================
; bw-board 8086 BIOS -- a system ROM for the i8086 tier, written from scratch.
;
; WHY THIS FILE EXISTS AT ALL.
;
; The tier runs real 1982-83 Microsoft binaries (CHKDSK, COMP, SETCLOCK,
; DEBUG) but only because a JavaScript layer hand-feeds them their services.
; That is a program runner, not a computer. A computer starts by fetching an
; instruction from FFFF:0000 and ends up executing a boot sector it read off
; a disk itself, and everything between those two points is this file.
;
; It is OURS, from the documented interface outward, and it had to be. Every
; open-source PC BIOS is GPL-3 (GLaBIOS, skiselev/8088_bios); this project
; ships under BSD-3, so adopting one is not available. What IS available is
; the interface: the interrupt numbers, the AH function codes, the register
; conventions and the BIOS-data-area layout are facts about a published
; interface, not anybody's expression of it. No code, no table and no string
; here was taken from any existing BIOS. Where a table's VALUES could have
; been copied -- the CGA mode-control byte per video mode, the keyboard
; translation tables -- they are derived in the comments from the bit
; meanings and the key legends instead, so the derivation is the evidence.
;
;-----------------------------------------------------------------------------
; PLACEMENT. This ROM is built for physical F0000h-FFFFFh: the F000 segment,
; 64K, the place a system BIOS lives and the only place from which the reset
; fetch at FFFF:0000 can be satisfied. Every interrupt vector this ROM
; installs points into F000, and so does forty years of software that pokes
; around up there.
;
; That address used to be contested -- src/i8086-dos.js kept its interrupt
; trap page at F000:0000 -- and is not any more: the trap page moved to D000
; (DEFAULT_TRAP_SEG in that file) so that a real BIOS could live where a real
; BIOS lives. A machine can now carry both this ROM and the DOS layer; they
; occupy different regions.
;
; THE MACHINE THIS ROM ASSUMES is the PC/XT-shaped one -- PCXT8086 in
; src/i8086-machine.js -- because that is the port map real DOS binaries were
; compiled against:
;
;   8259 PIC   20h-21h     IRQ0 = timer, IRQ1 = keyboard
;   8254 PIT   40h-43h     counter 0 drives IRQ0, counter 2 drives the speaker
;   8255 PPI   60h-63h     port A = keyboard scancode latch, port B = control
;   CGA        3D0h-3DFh   3D4h/3D5h CRTC index/data, 3D8h mode, 3DAh status
;   text page  B8000h      80x25, two bytes per cell
;
; It needs one region the standard configs do NOT declare: RAM (or a video
; device) at B8000h. PCXT8086 stops its RAM at 9FFFFh and the CGA card model
; carries no framebuffer, so on that config every character this ROM writes
; goes into open bus and vanishes silently. The test config adds it.
;
;-----------------------------------------------------------------------------
; WHAT IS IMPLEMENTED
;
;   POST      IVT, BIOS data area at 0040:0000, stack, 8259/8254/8255/CGA
;             init, banner, then INT 19h.
;   INT 10h   00 set mode -- text 0-3 and 7, CGA graphics 4/5/6, and VGA 13h
;             on a machine that has a VGA: each one programs its card's
;             registers and its CRTC, sets the BDA geometry and clears the
;             aperture. 01 cursor shape, 02 set cursor, 03 get cursor,
;             05 set active page, 06/07 scroll a window, 08 read char+attr,
;             09 write char+attr, 0A write char, 0B set palette/background,
;             0C write pixel (with the XOR flag), 0D read pixel, 0E teletype,
;             0F get mode.
;   INT 11h   equipment word.        INT 12h   memory size.
;   INT 16h   00 read key, 01 peek, 02 shift flags (10/11/12 aliased).
;   INT 09h   keyboard IRQ: XT acknowledge strobe, shift/lock state, US
;             layout translation, ring-buffer insert, Ctrl-Alt-Del.
;   INT 08h   timer IRQ: 0040:006C tick count, 24-hour rollover, INT 1Ch.
;   INT 1Ah   00 read ticks, 01 set ticks.
;   INT 13h   00 reset, 02 read, 03 write, 04 verify -- driven through a
;             real uPD765 at 3F0h-3F7h with an 8237 moving the bytes on DMA
;             channel 2. 01 last status, 08 drive parameters and 15h drive
;             type are answered from configuration.
;   INT 0Eh   IRQ6, the floppy controller: sets bit 7 of 0040:003E and issues
;             the end-of-interrupt. The disk driver waits on that bit.
;   INT 19h   bootstrap: read cylinder 0 head 0 sector 1 to 0000:7C00 through
;             INT 13h, check the 55AAh signature, and jump there.
;   INT 05h/15h/17h/18h/1Bh/1Ch  present, and each says what it does not do.
;
; WHAT IS NOT IMPLEMENTED, stated rather than left to be discovered
;
;   * FORMAT (INT 13h AH=05h). The controller models FORMAT TRACK and the
;     diskette parameter table already carries the two bytes it needs, but
;     nothing in this tier formats a disk -- the images are built by
;     scripts/build-dos-image.mjs -- so the service is absent rather than
;     written and never exercised.
;   * A second floppy drive, and any drive that is not 360K. The equipment
;     word declares one, AH=08h answers for one, and AH=02h on DL=1 returns
;     "timed out" rather than pretending. The geometry comes from the
;     diskette parameter table, so a different format is a table away -- but
;     the table is not chosen by probing the medium, and this ROM never
;     writes the data-rate register at 3F7h, which a 1.2M drive needs.
;   * Multi-track reads ACROSS A CYLINDER. The command sets MT, so a
;     transfer runs on from head 0 to head 1 of the same cylinder; the
;     controller stops at the end of that cylinder and the caller has to ask
;     again for the next one. That is what the hardware does and every DOS
;     block driver already splits its requests this way.
;   * CHARACTERS IN A GRAPHICS MODE. AH=09h, 0Ah and 0Eh write two-byte text
;     cells to B8000h whatever the mode is. In modes 4/5/6 those bytes are
;     pixels, so text drawn on a graphics screen comes out as noise instead
;     of as glyphs. A real BIOS rasterises an 8x8 font into the bitmap, and
;     that font is the missing piece: there is no character generator in this
;     ROM, and INT 1Fh (the pointer to the high 128 characters' bitmaps) is
;     not installed either. Graphics programs that draw their own text -- the
;     usual case -- are unaffected.
;   * AH=13h write string, AH=10h palette registers, and the EGA/VGA modes
;     0Dh-12h. Those four are bit planes behind the sequencer's latches,
;     which is a different machine from either card here.
;   * ADAPTER DETECTION. Mode 13h writes the VGA register file whether or not
;     there is a VGA in the machine; on a CGA-only box those writes land in
;     open bus and the mode set is a no-op that still records 13h at 40:49h.
;     Nothing probes for the card, and no config this repository ships
;     declares one -- `kind: 'vga'` exists in src/i8086-machine.js and only
;     tests use it.
;   * The 6845 CRTC is written but not modelled. R0-R13 are programmed for
;     each of the three rasters and the cursor registers 0Ah/0Bh and 0Eh/0Fh
;     exactly as the hardware wants; CGACard ignores every register but
;     3D8h/3D9h, so on THIS machine the hardware cursor is invisible and the
;     timings go nowhere. (VGACard does latch 3D4h/3D5h, which is what makes
;     the CRTC programming testable at all.) The BIOS-data-area cursor is the
;     real one and it is correct.
;   * The speaker. BEL (07h) through the teletype call is swallowed, not
;     sounded; the PIT counter-2 / port-61h gate is wired on the machine but
;     no BIOS service exposes it.
;   * INT 14h serial. There is no 8250 in the XT config -- the tier's UARTs
;     live at other ports on other configs -- so inventing a port map for it
;     would be worse than its absence.
;   * INT 17h printer answers "timed out" without touching a port, which is
;     the truth: the equipment word reports no printer.
;   * A real-time clock. INT 1Ah AH=02h/04h and up return CF=1; the tick
;     count is the only clock, and it starts at zero on every reset.
;   * A memory sizing walk, a ROM checksum test, and option-ROM scanning at
;     C000-EFFF. The memory size is declared, not measured.
;   * No AT-era anything: no INT 15h services, no extended keyboard codes, no
;     INT 13h AH=41h+ extensions.
;
;-----------------------------------------------------------------------------
; ASSEMBLER NOTES (src/i8086-asm.js, MASM subset). Two constructs it cannot
; express are worked around here rather than avoided; both are called out at
; the site as well.
;
;   1. `JMP FAR PTR label` needs a NAMED SEGMENT and emits a relocation, and
;      a flat image cannot carry a relocation, so the assembler refuses it.
;      Every far jump in this file -- the reset vector and the jump to the
;      boot sector -- is hand-encoded as `db 0EAh` / `dw offset` / `dw seg`.
;      That is what a linker would have emitted anyway.
;   2. `PUSH imm` is an 80186 instruction and is correctly refused, so
;      constants reach the stack through a register.
;   3. CONDITIONAL JUMPS REACH 127 BYTES and the assembler diagnoses an
;      out-of-range one precisely. The fix used throughout is to invert the
;      condition around a near JMP, or -- in INT 13h, where a chain of them
;      all pointed into code that then grew -- to dispatch with CALL, which
;      is three bytes and reaches the whole segment.
;   4. A PLAIN `JMP` IS NOT ALWAYS NEAR, AND `NEAR PTR` DOES NOT RELIABLY
;      MAKE IT SO. The assembler shrinks a JMP to the two-byte form on the
;      first pass that finds its target within 127 bytes and the decision is
;      sticky, so a jump that fitted before a routine grew is stranded by
;      the routine growing -- and the error names the jump rather than what
;      moved. `JMP NEAR PTR label` is the documented cure and works in
;      isolation, but not here: the shrink decisions are filed under a
;      counter that a shrunk JMP advances twice and an unshrunk one advances
;      once, so once any JMP changes its mind the later decisions are read
;      out of the wrong slots. Reported to the assembler lane. Until it is
;      fixed, the way to be sure is not to need the long jump: the exits in
;      INT 13h are reached by RET and the driver's own branches are local.
;
; Built by scripts/build-bios.mjs, which refuses an image that does not end
; in a valid reset vector.
;=============================================================================

;-----------------------------------------------------------------------------
; Where this ROM lives, and the two addresses the hardware fixes for us.
;-----------------------------------------------------------------------------
ROM_SEG     equ 0F000h          ; the segment this image is loaded at
BOOT_SEG    equ 0000h           ; the boot sector's segment
BOOT_OFF    equ 7C00h           ; ...and its offset. Also the BIOS stack top:
                                ; the stack grows DOWN from here and the boot
                                ; sector grows UP, so they never meet.
VID_COLOR   equ 0B800h          ; CGA text page, and the graphics aperture of
                                ; modes 4/5/6 -- the same 16K seen two ways
VID_MONO    equ 0B000h          ; MDA/Hercules text page (mode 7)
VID_VGA     equ 0A000h          ; the 64K VGA aperture mode 13h is linear in

; The CGA graphics geometry, named once so the plot routine and the mode
; setter cannot disagree about it.
CGA_BANK    equ 2000h           ; distance from the even-scanline bank to the
                                ; odd one. THE INTERLEAVE: row y is NOT at
                                ; y*80, it is at (y >> 1)*80 + (y & 1)*2000h.
CGA_STRIDE  equ 80              ; bytes per scan line -- 320 pixels at two bits
                                ; and 640 at one bit both land on eighty

;-----------------------------------------------------------------------------
; The XT port map. Ports, not memory: IN/OUT decode on a separate bus.
;-----------------------------------------------------------------------------
PORT_PIC    equ 20h             ; 8259 command / status
PORT_PICMSK equ 21h             ; 8259 data (ICW2/ICW4/OCW1 mask)
PORT_PIT0   equ 40h             ; 8254 counter 0 -- the 18.2 Hz tick
PORT_PIT2   equ 42h             ; 8254 counter 2 -- the speaker tone
PORT_PITCTL equ 43h             ; 8254 control word
PORT_KBDATA equ 60h             ; 8255 port A: the last scancode
PORT_KBCTL  equ 61h             ; 8255 port B: bit 7 clears the latch
PORT_PPIC   equ 62h             ; 8255 port C: configuration switches
PORT_PPICTL equ 63h             ; 8255 control word
PORT_CRTC   equ 3D4h            ; 6845 index register (data at 3D5h)
PORT_CGAMOD equ 3D8h            ; CGA mode control
PORT_CGACOL equ 3D9h            ; CGA colour select
PORT_CGASTAT equ 3DAh           ; CGA/VGA input status 1. Reading it also
                                ; resets the VGA attribute controller's
                                ; index/data flip-flop, which is the ONLY
                                ; documented way to re-synchronise it.

; The VGA register file, for mode 13h. Everything below 3D0h belongs to it
; alone; 3D4h/3D5h are shared with the 6845's index/data pair by design, and
; the misc output register's bit 0 is what puts them at 3Dxh rather than 3Bxh.
PORT_VGA_ATTR equ 3C0h          ; attribute controller: ONE port, index and
                                ; data alternating under a flip-flop
PORT_VGA_MISC equ 3C2h          ; miscellaneous output (write; 3CCh reads)
PORT_VGA_SEQI equ 3C4h          ; sequencer index (data at 3C5h)
PORT_VGA_DACW equ 3C8h          ; DAC write index (data at 3C9h, R-G-B each)
PORT_VGA_DACD equ 3C9h          ; DAC data: three SIX-BIT values per entry
PORT_VGA_GCI  equ 3CEh          ; graphics controller index (data at 3CFh)

; The uPD765 floppy card. The window is 3F0h-3F7h and only four of the eight
; addresses are decoded on an XT card: 3F0h, 3F1h, 3F3h and 3F6h answer
; nothing and float high, so a driver that probes them reads 0FFh and must
; not believe it. The DOR is WRITE ONLY here -- the AT can read it back, this
; card cannot -- which is why every DOR value in this file is composed from
; scratch instead of read-modify-written.
PORT_FDC_DOR  equ 3F2h          ; drive select, motor enables, /RESET, DMA gate
PORT_FDC_MSR  equ 3F4h          ; main status register (read only)
PORT_FDC_DATA equ 3F5h          ; the command/result FIFO, both directions
PORT_FDC_DIR  equ 3F7h          ; read: disk change in bit 7; write: data rate

; The 8237 DMA controller at 00h-0Fh, and the channel the floppy owns.
; Channel 2 is not a choice: it is which DRQ/DACK pair the XT's floppy card
; is wired to.
PORT_DMA_ADDR equ 04h           ; channel 2 current address (two halves)
PORT_DMA_CNT  equ 05h           ; channel 2 word count   (two halves)
PORT_DMA_STATUS equ 08h         ; read: terminal count in bits 0-3, DREQ in 4-7.
                                ; READING IT CLEARS THE TC BITS, so exactly
                                ; one place in this ROM may touch it.
PORT_DMA_MASK equ 0Ah           ; single mask bit: bits 0-1 channel, bit 2 set
PORT_DMA_MODE equ 0Bh           ; mode register
PORT_DMA_FF   equ 0Ch           ; clear the first/last flip-flop
; A16-A19 do NOT come from the 8237. They come from a separate four-bit latch
; whose ports follow the XT's wiring rather than the channel numbers:
; 87h = channel 0, 83h = channel 1, 81h = channel 2, 82h = channel 3.
PORT_DMA_PAGE equ 81h           ; channel 2's page latch

; Digital output register bits, 3F2h.
DOR_NRESET  equ 04h             ; ACTIVE LOW: 0 holds the controller in reset
DOR_DMAEN   equ 08h             ; gates DRQ and IRQ onto the bus
DOR_MOTOR0  equ 10h             ; drive 0's motor; one bit per drive upwards

; Main status register bits, 3F4h. RQM and DIO are the whole handshake.
MSR_RQM     equ 80h             ; the data register is ready for a transfer
MSR_DIO     equ 40h             ; 1 = controller -> host, 0 = host -> controller
MSR_NDM     equ 20h             ; a non-DMA execution phase is under way
MSR_CB      equ 10h             ; a command is under way

; 8237 mode bytes for channel 2. Bits 6-7 select SINGLE (the floppy's mode:
; the bus is released after every byte), bit 5 clear increments the address,
; bit 4 clear disables autoinitialise, bits 2-3 are the direction and bits
; 0-1 the channel. The direction words are the DMA controller's, not the
; disk's: they say what the 8237 does to MEMORY.
DMA_TO_MEM  equ 46h             ; write to memory -- a disk READ
DMA_FROM_MEM equ 4Ah            ; read from memory -- a disk WRITE
DMA_VERIFY  equ 42h             ; neither: the counters run, no bus cycle
DMA_MASK2   equ 06h             ; mask channel 2   (channel 2, bit 2 set)
DMA_UNMASK2 equ 02h             ; unmask channel 2 (channel 2, bit 2 clear)

; uPD765 commands. Bit 6 (MFM) says double density, which every PC format is;
; bit 7 (MT, multi-track) lets a transfer run on from head 0 to head 1 of the
; same cylinder, and bit 5 (SK) skips deleted-data marks.
FDC_SPECIFY equ 03h
FDC_SENSEI  equ 08h             ; SENSE INTERRUPT STATUS
FDC_RECAL   equ 07h             ; RECALIBRATE
FDC_SEEK    equ 0Fh
FDC_READ    equ 0E6h            ; MT + MFM + SK + READ DATA
FDC_WRITE   equ 0C5h            ; MT + MFM + WRITE DATA

; How long the driver waits, and for what.
;   FD_POLLS is a count of polls, not a time. It is deliberately NOT
;   measured against the tick counter: the tick only advances if IRQ0 is
;   being delivered, and a driver that waits for a controller by watching a
;   clock that may not be running turns a dead controller into a hung
;   machine. That is also why it is the bound on the spin-up wait's inner
;   loop, which DOES watch the clock -- it gives up if the clock is stopped.
;
;   16384 is chosen against the two things it has to be between. A uPD765
;   raises RQM between command bytes in microseconds, so any four-figure
;   number is generous for the handshake; and one 18.2 Hz tick is a few
;   hundred times round the spin-up loop, so it has to be comfortably more
;   than that or a running clock would look stopped.
FD_POLLS    equ 4000h           ; 16384 times round a LOOP
FD_BUSY     equ 0FFh            ; motor countdown held here DURING an access,
                                ; so it cannot expire mid-transfer

EOI         equ 20h             ; the 8259's non-specific end-of-interrupt

;-----------------------------------------------------------------------------
; The BIOS data area at 0040:0000. These offsets are interface, not choice:
; DOS and every program compiled for a PC reads them directly.
;-----------------------------------------------------------------------------
BDA_SEG      equ 0040h
BDA_COM1     equ 0000h          ; four serial port base addresses (all zero)
BDA_LPT1     equ 0008h          ; four parallel port base addresses (all zero)
BDA_EQUIP    equ 0010h          ; equipment word, what INT 11h returns
BDA_MEMSZ    equ 0013h          ; conventional memory in KB, what INT 12h returns
BDA_KBFLAG   equ 0017h          ; shift/lock state, what INT 16h AH=02h returns
BDA_KBFLAG2  equ 0018h          ; the "key is physically down" half
BDA_KBHEAD   equ 001Ah          ; ring buffer head: the next key to be READ
BDA_KBTAIL   equ 001Ch          ; ring buffer tail: where the next key is WRITTEN
BDA_KBBUF    equ 001Eh          ; 32 bytes = 16 entries of (ascii, scancode)
BDA_SEEKSTAT equ 003Eh          ; bit 7 = the FDC has interrupted; bits 0-3 =
                                ; that drive's head has been recalibrated;
                                ; bit 4 = the controller has been reset and
                                ; SPECIFYed. Bits 0-3 and 7 are the documented
                                ; layout; bit 4 is in the three bits nothing
                                ; else uses, and it is what lets AH=00h leave
                                ; the controller initialised without also
                                ; claiming to know where any head is.
SEEK_READY  equ 10h             ; ...that bit, by name
BDA_MOTORSTAT equ 003Fh         ; bits 0-3 = that drive's motor is running
BDA_MOTORCNT equ 0040h          ; floppy motor-off countdown, in ticks
BDA_DISKSTAT equ 0041h          ; last INT 13h status, what AH=01h returns
BDA_FDCRESULT equ 0042h         ; the seven result-phase bytes of the last
                                ; controller command, ST0 first
BDA_MODE     equ 0049h          ; current video mode
BDA_COLS     equ 004Ah          ; text columns on screen (word)
BDA_PAGELEN  equ 004Ch          ; bytes per display page (word)
BDA_PAGEOFF  equ 004Eh          ; byte offset of the ACTIVE page (word)
BDA_CURPOS   equ 0050h          ; 8 words: cursor (col, row) for pages 0-7
BDA_CUREND   equ 0060h          ; cursor ending scan line
BDA_CURSTART equ 0061h          ; cursor starting scan line
BDA_ACTPAGE  equ 0062h          ; active display page
BDA_CRTCPORT equ 0063h          ; CRTC index port (word) -- 3D4h here
BDA_MODEREG  equ 0065h          ; last value written to the CGA mode register
BDA_PALETTE  equ 0066h          ; last value written to the colour register
BDA_TICKS    equ 006Ch          ; 32-bit tick count since midnight
BDA_TICKOVF  equ 0070h          ; set when the tick count rolled past 24 hours
BDA_BREAK    equ 0071h          ; bit 7 set when Ctrl-Break was seen
BDA_RESETFLG equ 0072h          ; 1234h = warm boot, skip the memory test
BDA_KBSTART  equ 0080h          ; ring buffer start offset (1Eh)
BDA_KBEND    equ 0082h          ; ring buffer end offset, EXCLUSIVE (3Eh)

; DRIVE 0'S MEDIA TYPE, as d_media probed it -- 0090h is the byte a real BIOS
; uses for drive 0's media state, and this is the same idea with fewer bits.
; AH=00h clears it, so a reset is how software asks for a fresh probe.
BDA_MEDIA    equ 0090h
MEDIA_UNKNOWN equ 0             ; not probed yet, or a reset asked for another
MEDIA_PROBING equ 0FFh          ; d_media is running RIGHT NOW. It calls the
                                ; transfer path and the transfer path calls
                                ; it, so this is what stops the recursion: the
                                ; nested call sees a type that is not UNKNOWN
                                ; and returns without probing.
MEDIA_360K   equ 1              ; 9 sectors, 40 cylinders
MEDIA_12M    equ 2              ; 15 sectors, 80 cylinders -- DECLARED, NOT
                                ; MEASURED: no image in this tier is 1.2M, so
                                ; the table exists and the detection branch is
                                ; written, and neither has ever read a disk.
MEDIA_144M   equ 3              ; 18 sectors, 80 cylinders

; The equipment word, bit by bit, since it is assembled here and not probed:
;   bit 0    a diskette drive is present
;   bits 4-5 initial video mode: 10b = 80x25 colour
;   bits 6-7 (number of diskette drives) - 1 = 00b = one drive
EQUIP_WORD  equ 0021h
MEM_KB      equ 640             ; conventional memory, declared not measured

; Keyboard shift-state bits in 0040:0017, as INT 16h AH=02h hands them back.
KF_RSHIFT   equ 01h
KF_LSHIFT   equ 02h
KF_CTRL     equ 04h
KF_ALT      equ 08h
KF_SCROLL   equ 10h
KF_NUM      equ 20h
KF_CAPS     equ 40h
KF_INSERT   equ 80h

; Flag bits, for reaching into the FLAGS word the CPU pushed. See below.
FL_CF       equ 0001h
FL_ZF       equ 0040h
FL_NOT_CF   equ 0FFFEh
FL_NOT_ZF   equ 0FFBFh

; INT 13h status codes, the subset this ROM can actually produce. Each one is
; reachable: the driver below decodes ST0/ST1/ST2 into them and every branch
; names the controller bit it came from.
DSK_OK      equ 00h
DSK_BADCMD  equ 01h             ; function not supported, or a nonsense request
DSK_BADMARK equ 02h             ; no address mark: ST1 bit 0
DSK_WRPROT  equ 03h             ; write protected: ST1 bit 1
DSK_NOTFOUND equ 04h            ; sector not found: ST1 bit 2
DSK_DMAOVER equ 08h             ; the transfer overran: ST1 bit 4
DSK_BOUNDARY equ 09h            ; the transfer would cross a 64K DMA page
DSK_BADCRC  equ 10h             ; CRC error in the data field: ST1 bit 5
DSK_CTRLFAIL equ 20h            ; controller failure -- it said something this
                                ; driver cannot account for
DSK_SEEKFAIL equ 40h            ; the head is not where it was told to go
DSK_TIMEOUT equ 80h             ; drive did not respond at all

;-----------------------------------------------------------------------------
; THE INTERRUPT FRAME.
;
; Every service here starts with PUSHALL and ends with POPALL, so BP addresses
; one uniform frame: nine saved registers, then the IP, CS and FLAGS the CPU
; itself pushed when it took the interrupt.
;
; WHY A FRAME AND NOT ad-hoc pushes: a service returns values in registers
; that were saved on entry, and it returns CF and ZF in FLAGS. IRET RELOADS
; FLAGS FROM THE STACK. This is the single thing a naive BIOS gets wrong and
; keeps getting wrong: `clc` before `iret` does nothing at all, because the
; IRET throws that carry away and restores the caller's. INT 16h AH=01h ("is
; a key waiting?") answers in ZF and INT 13h answers in CF, and the only way
; to answer is to edit the pushed FLAGS word in place before returning.
; Returning a value in AX has the same shape: write it to [bp+F_AX], because
; POPALL is about to overwrite the register.
;-----------------------------------------------------------------------------
F_AX  equ 0
F_AL  equ 0
F_AH  equ 1
F_BX  equ 2
F_BL  equ 2
F_BH  equ 3
F_CX  equ 4
F_CL  equ 4
F_CH  equ 5
F_DX  equ 6
F_DL  equ 6
F_DH  equ 7
F_BP  equ 8
F_SI  equ 10
F_DI  equ 12
F_ES  equ 14
F_DS  equ 16
F_IP  equ 18
F_CS  equ 20
F_FL  equ 22

PUSHALL MACRO
    push ds
    push es
    push di
    push si
    push bp
    push dx
    push cx
    push bx
    push ax
    mov  bp, sp
ENDM

POPALL MACRO
    pop  ax
    pop  bx
    pop  cx
    pop  dx
    pop  bp
    pop  si
    pop  di
    pop  es
    pop  ds
ENDM

    ORG 0

;=============================================================================
; F000:0000 -- the identification block.
;
; This is the kilobyte the DOS layer's trap page wants. Nothing here is
; executed; it is put first so that a hex dump of the image, or of the top of
; a machine's memory, says what it is looking at.
;=============================================================================
rom_id      db 'bw-board 8086 BIOS', 0
rom_ver     db 'v0.1', 0
rom_note    db 'BSD-3, written from the documented interface. No BIOS code copied.', 0
            db 0

;=============================================================================
; POWER-ON SELF TEST.
;
; Reached from the reset vector at FFFF:0000, which is the last thing in this
; image. Interrupts are off and nothing about the machine is known -- there is
; no stack, DS is not ours, and the interrupt vector table is whatever the
; RAM powered up holding.
;=============================================================================
post:
    cli
    cld

    ; A stack before anything else, because everything else can push. SS and
    ; SP are loaded back to back on purpose: the 8086 inhibits interrupts for
    ; one instruction after a segment-register load precisely so that this
    ; pair cannot be interrupted with SS updated and SP not. Interrupts are
    ; masked here anyway; the habit is the point.
    xor  ax, ax
    mov  ss, ax
    mov  sp, BOOT_OFF
    mov  ds, ax
    mov  es, ax

    ;-- the interrupt vector table -------------------------------------------
    ; Point all 256 vectors at a handler that does nothing but IRET, THEN
    ; overwrite the ones we implement. Doing it in that order is what makes a
    ; stray INT 4Fh harmless instead of a jump into uninitialised RAM.
    xor  di, di
    mov  dx, offset int_ignore
    mov  bx, ROM_SEG
    mov  cx, 256
post_ivt1:
    mov  ax, dx
    stosw
    mov  ax, bx
    stosw
    loop post_ivt1

    ; Now the real handlers, from a table of (vector, offset) pairs.
    mov  si, offset ivt_table
post_ivt2:
    mov  ax, cs:[si]
    cmp  ax, 0FFFFh
    je   post_ivt3
    mov  di, ax
    shl  di, 1
    shl  di, 1                  ; vector n lives at 0000:(n*4)
    mov  ax, cs:[si+2]
    stosw
    mov  ax, ROM_SEG
    stosw
    add  si, 4
    jmp  post_ivt2
post_ivt3:

    ; INT 1Eh is NOT a handler. It is a far POINTER to the diskette parameter
    ; table, which DOS and the BIOS both read. Installing an IRET there --
    ; which is what a loop over "all the vectors we know" would do -- hands
    ; the floppy driver two bytes of opcode as its step rate.
    mov  di, 1Eh*4
    mov  ax, offset dpt
    stosw
    mov  ax, ROM_SEG
    stosw

    ;-- the BIOS data area ---------------------------------------------------
    mov  ax, BDA_SEG
    mov  es, ax
    xor  di, di
    mov  cx, 128
    xor  ax, ax
    rep  stosw                  ; 256 bytes of zero, so every field we do not
                                ; set reads as absent rather than as garbage
    mov  ds, ax                 ; ...careful: AX is zero here
    mov  ax, BDA_SEG
    mov  ds, ax

    mov  word ptr [BDA_EQUIP], EQUIP_WORD
    mov  word ptr [BDA_MEMSZ], MEM_KB
    mov  word ptr [BDA_KBHEAD], BDA_KBBUF
    mov  word ptr [BDA_KBTAIL], BDA_KBBUF
    mov  word ptr [BDA_KBSTART], BDA_KBBUF
    mov  word ptr [BDA_KBEND], BDA_KBBUF+32
    mov  word ptr [BDA_CRTCPORT], PORT_CRTC
    mov  byte ptr [BDA_CUREND], 7       ; a two-line block cursor on the
    mov  byte ptr [BDA_CURSTART], 6     ; bottom scan lines of an 8-line cell

    ;-- the 8259 interrupt controller ---------------------------------------
    ; ICW1 13h: bit 4 starts the sequence, bit 1 (SNGL) says there is no
    ; second PIC so no ICW3 follows, bit 0 says an ICW4 does.
    ; ICW2 08h: IRQ0 becomes INT 08h, IRQ1 INT 09h, ... IRQ7 INT 0Fh.
    ; ICW4 09h: 8086 mode (bit 0) and buffered master (bit 3).
    mov  al, 13h
    out  PORT_PIC, al
    mov  al, 08h
    out  PORT_PICMSK, al
    mov  al, 09h
    out  PORT_PICMSK, al
    ; Unmask the timer, the keyboard and the floppy controller; mask
    ; everything with no handler. A masked line is not a dropped one: it
    ; stays asserted and is taken as soon as it is unmasked, which is why
    ; leaving unused lines unmasked with no EOI-issuing handler wedges the
    ; controller on the first spurious edge.
    ;   0BCh = 1011_1100: bits 0, 1 and 6 clear -> IRQ0, IRQ1 and IRQ6 open.
    ; IRQ6 is the floppy's, and it is unmasked at POST rather than around
    ; each access on purpose: the disk driver waits on an interrupt, and a
    ; line unmasked only while somebody is waiting drops the interrupt that
    ; arrives a moment early -- which a controller whose commands complete
    ; fast does constantly.
    mov  al, 0BCh
    out  PORT_PICMSK, al

    ;-- the 8254 timer -------------------------------------------------------
    ; Counter 0, both bytes, mode 3 (square wave), binary: control word 36h.
    ; A reload of 0 means 65536, giving 1193182/65536 = 18.2065 Hz, which is
    ; where the famous tick rate comes from -- it is not a chosen number, it
    ; is the crystal divided by the widest counter.
    mov  al, 36h
    out  PORT_PITCTL, al
    xor  al, al
    out  PORT_PIT0, al
    out  PORT_PIT0, al

    ;-- the 8255 -------------------------------------------------------------
    ; Control word 99h: mode 0 throughout, port A input (the keyboard
    ; scancode latch), port B output (the keyboard clear strobe and the
    ; speaker gate), port C input (the configuration switches).
    mov  al, 99h
    out  PORT_PPICTL, al
    xor  al, al
    out  PORT_KBCTL, al         ; strobe low, speaker off

    ;-- video ---------------------------------------------------------------
    mov  ax, 0003h              ; AH=00h set mode, AL=03h 80x25 colour text
    int  10h

    mov  si, offset msg_banner
    call puts

    sti                         ; from here on the timer ticks and keys arrive
    int  19h                    ; ...and the machine tries to boot itself

    ; INT 19h does not return when it succeeds. If it does, there is nothing
    ; left to try.
post_dead:
    hlt
    jmp  post_dead

;=============================================================================
; INT 08h -- IRQ0, the timer tick, 18.2065 times a second.
;=============================================================================
int08:
    push ds
    push ax
    mov  ax, BDA_SEG
    mov  ds, ax

    ; The count is 32 bits and the low word is incremented FIRST; ADC then
    ; carries into the high word. Incrementing the high word on a compare
    ; against zero, which is the version that looks simpler, loses a tick
    ; every 65536.
    add  word ptr [BDA_TICKS], 1
    adc  word ptr [BDA_TICKS+2], 0

    ; 24 hours at 18.2065 Hz is 1573040 ticks = 0018_00B0h. At that point the
    ; count wraps and a flag says it did, which is how a program that only
    ; reads the clock occasionally can tell midnight passed.
    mov  ax, [BDA_TICKS+2]
    cmp  ax, 0018h
    jb   int08_notmid
    ja   int08_midnight
    cmp  word ptr [BDA_TICKS], 00B0h
    jb   int08_notmid
int08_midnight:
    mov  word ptr [BDA_TICKS], 0
    mov  word ptr [BDA_TICKS+2], 0
    mov  byte ptr [BDA_TICKOVF], 1
int08_notmid:

    ; The floppy motor timeout. The disk driver loads 0040:0040 with the
    ; diskette parameter table's motor-off delay when it finishes an access;
    ; this counts it down and, at zero, actually STOPS THE MOTOR through the
    ; digital output register.
    ;
    ; The switch-off is the half that is easy to leave out, and leaving it
    ; out is invisible: the countdown expires, nothing happens, the motor
    ; runs for ever -- and because 0040:003F then still says the motor is
    ; up, the spin-up wait on every later access is skipped too. Two
    ; behaviours lost to one missing OUT, neither of which reports anything.
    ;
    ; The DOR value written here keeps the controller out of reset and the
    ; DMA gate open, because a motor timeout is not a reset: the next
    ; command must not have to re-SPECIFY.
    cmp  byte ptr [BDA_MOTORCNT], 0
    je   int08_nomotor
    dec  byte ptr [BDA_MOTORCNT]
    jnz  int08_nomotor
    push dx
    mov  byte ptr [BDA_MOTORSTAT], 0
    mov  al, DOR_NRESET+DOR_DMAEN
    mov  dx, PORT_FDC_DOR
    out  dx, al
    pop  dx
int08_nomotor:

    ; EOI BEFORE the user hook, not after. INT 1Ch belongs to whoever hooked
    ; it and may take as long as it likes; holding the in-service bit across
    ; it blocks every other interrupt for the duration.
    mov  al, EOI
    out  PORT_PIC, al
    sti
    int  1Ch

    pop  ax
    pop  ds
    iret

;=============================================================================
; INT 1Ch -- the user timer hook. A real BIOS calls this and does nothing
; else with it; a program that wants a tick hooks HERE rather than INT 08h so
; it does not have to know about the PIC.
;=============================================================================
int1c:
    iret

;=============================================================================
; INT 0Eh -- IRQ6, the floppy disk controller.
;
; ALL IT DOES IS SAY THAT IT HAPPENED, and that is the whole design. The
; uPD765 interrupts at the end of a seek, a recalibrate and every data
; command, and the driver that issued the command is the only code that
; knows what to do about it -- so the handler sets one bit and gets out of
; the way. Bit 7 of 0040:003E is that bit, and `fd_waitint` below is the
; other end of it.
;
; THE END-OF-INTERRUPT IS NOT OPTIONAL AND IT IS NOT COSMETIC. Without it
; IRQ6 stays in service at the 8259, which blocks IRQ6 and everything below
; it -- including nothing, since IRQ6 is nearly the lowest, but the in-service
; bit never clears and the SECOND disk access never gets its interrupt. One
; read works, every read after it times out, and the first read is what a
; test would have checked.
;=============================================================================
int0e:
    push ax
    push ds
    mov  ax, BDA_SEG
    mov  ds, ax
    or   byte ptr [BDA_SEEKSTAT], 80h
    mov  al, EOI
    out  PORT_PIC, al
    pop  ds
    pop  ax
    iret

;=============================================================================
; INT 09h -- IRQ1, a key changed state.
;
; The XT keyboard is not a chip in this tree: port 60h is the 8255's port A,
; which latches the last byte the keyboard shifted in, and bit 7 of port B is
; the line that clears the latch. That is the whole hardware interface, and it
; is why this handler starts by reading before it acknowledges: the strobe
; releases the latch, so reading afterwards reads nothing.
;=============================================================================
int09:
    PUSHALL
    cld
    mov  ax, BDA_SEG
    mov  ds, ax

    in   al, PORT_KBDATA
    mov  ah, al                 ; hold the scancode across the acknowledge
    in   al, PORT_KBCTL
    or   al, 80h
    out  PORT_KBCTL, al         ; strobe high: clear the latch
    and  al, 7Fh
    out  PORT_KBCTL, al         ; and back low, ready for the next byte
    mov  al, ah                 ; AL = the scancode again

    ; A break code is the make code with bit 7 set. Only the modifiers care.
    ;
    ; ASSEMBLER / 8086 NOTE: the 8086 has ONLY the 8-bit-displacement
    ; conditional jump, so `jnz k9_break` cannot reach a label 200-odd bytes
    ; away. The jump over an unconditional jump is what MASM makes you write
    ; too; this assembler will promote it for you with { longJumps: true },
    ; and doing that would make this ROM refuse to assemble under MASM. It
    ; appears a few more times below for the same reason.
    test al, 80h
    jz   k9_make
    jmp  k9_break
k9_make:

    ;-- make codes ----------------------------------------------------------
    cmp  al, 2Ah
    jne  k9_m1
    or   byte ptr [BDA_KBFLAG], KF_LSHIFT
    jmp  k9_done
k9_m1:
    cmp  al, 36h
    jne  k9_m2
    or   byte ptr [BDA_KBFLAG], KF_RSHIFT
    jmp  k9_done
k9_m2:
    cmp  al, 1Dh
    jne  k9_m3
    or   byte ptr [BDA_KBFLAG], KF_CTRL
    jmp  k9_done
k9_m3:
    cmp  al, 38h
    jne  k9_m4
    or   byte ptr [BDA_KBFLAG], KF_ALT
    jmp  k9_done
k9_m4:
    cmp  al, 3Ah
    jne  k9_m5
    xor  byte ptr [BDA_KBFLAG], KF_CAPS     ; the locks TOGGLE on make and
    jmp  k9_done                            ; ignore break entirely
k9_m5:
    cmp  al, 45h
    jne  k9_m6
    xor  byte ptr [BDA_KBFLAG], KF_NUM
    jmp  k9_done
k9_m6:
    cmp  al, 46h
    jne  k9_m7
    xor  byte ptr [BDA_KBFLAG], KF_SCROLL
    jmp  k9_done
k9_m7:
    ; Ctrl-Alt-Del: the three-finger salute is decided HERE, in the keyboard
    ; interrupt, which is why it works when the machine is otherwise wedged.
    cmp  al, 53h                            ; Del on the numeric pad
    jne  k9_trans
    mov  ah, [BDA_KBFLAG]
    and  ah, KF_CTRL+KF_ALT
    cmp  ah, KF_CTRL+KF_ALT
    jne  k9_trans
    mov  word ptr [BDA_RESETFLG], 1234h     ; "warm boot" for anyone who looks
    mov  al, EOI
    out  PORT_PIC, al
    jmp  post

k9_trans:
    ; Translate. Above the last translatable scancode the key has no ASCII at
    ; all -- the function keys, the cursor pad -- and the documented answer is
    ; AL=0 with the scancode in AH, which is exactly what a program reads to
    ; tell F1 from the letter it would otherwise be confused with.
    cmp  al, KBD_LAST
    ja   k9_extended
    cmp  al, 0
    je   k9_drop

    mov  bl, al                 ; keep the scancode
    mov  bh, 0
    dec  bx                     ; the tables are indexed from scancode 01h
    mov  ah, [BDA_KBFLAG]
    test ah, KF_LSHIFT+KF_RSHIFT
    jnz  k9_shifted
    mov  al, cs:kbd_lower[bx]
    jmp  k9_caps
k9_shifted:
    mov  al, cs:kbd_upper[bx]
k9_caps:
    or   al, al
    jz   k9_drop                ; a modifier key of its own: nothing to insert

    ; Caps Lock inverts the shift decision for LETTERS ONLY. Applying it to
    ; the whole keyboard is the classic mistake and turns Caps Lock into a
    ; second Shift, so a locked keyboard types '!' for '1'.
    test byte ptr [BDA_KBFLAG], KF_CAPS
    jz   k9_ctrl
    cmp  al, 'a'
    jb   k9_capsup
    cmp  al, 'z'
    ja   k9_ctrl
    sub  al, 20h
    jmp  k9_ctrl
k9_capsup:
    cmp  al, 'A'
    jb   k9_ctrl
    cmp  al, 'Z'
    ja   k9_ctrl
    add  al, 20h

k9_ctrl:
    ; Ctrl clears bits 6 and 5, which is not a lookup but the actual
    ; definition of a control character: Ctrl-A is 01h because 'A' is 41h.
    test byte ptr [BDA_KBFLAG], KF_CTRL
    jz   k9_insert
    cmp  al, 40h
    jb   k9_insert
    cmp  al, 7Ah
    ja   k9_insert
    and  al, 1Fh

k9_insert:
    mov  ah, bl                 ; AH = scancode, AL = ASCII
    inc  ah                     ; ...undo the table bias
    call kbd_push
    jmp  k9_done

    ; A trampoline, only because the conditional jumps above cannot reach the
    ; exit from here. See the note at the top of this handler.
k9_drop:
    jmp  k9_done

k9_extended:
    mov  ah, al                 ; scancode in AH
    mov  al, 0                  ; no ASCII: F-keys, cursor pad, keypad
    call kbd_push
    jmp  k9_done

k9_break:
    and  al, 7Fh
    cmp  al, 2Ah
    jne  k9_b1
    and  byte ptr [BDA_KBFLAG], 0FFh-KF_LSHIFT
    jmp  k9_done
k9_b1:
    cmp  al, 36h
    jne  k9_b2
    and  byte ptr [BDA_KBFLAG], 0FFh-KF_RSHIFT
    jmp  k9_done
k9_b2:
    cmp  al, 1Dh
    jne  k9_b3
    and  byte ptr [BDA_KBFLAG], 0FFh-KF_CTRL
    jmp  k9_done
k9_b3:
    cmp  al, 38h
    jne  k9_done
    and  byte ptr [BDA_KBFLAG], 0FFh-KF_ALT

k9_done:
    mov  al, EOI
    out  PORT_PIC, al
    POPALL
    iret

;-----------------------------------------------------------------------------
; kbd_push -- AL = ASCII, AH = scancode. DS must be the BDA.
;
; THE BUFFER HOLDS FIFTEEN KEYS, NOT SIXTEEN, and that is not an off-by-one.
; head == tail is the only cheap way to say "empty"; if the tail were allowed
; to catch the head the two states would be identical and a full buffer would
; read as an empty one. One slot stays unused so the difference survives.
;-----------------------------------------------------------------------------
kbd_push proc near
    push bx
    push cx
    mov  bx, [BDA_KBTAIL]
    mov  cx, bx
    add  cx, 2
    cmp  cx, [BDA_KBEND]
    jb   kpush1
    mov  cx, [BDA_KBSTART]      ; wrap
kpush1:
    cmp  cx, [BDA_KBHEAD]
    je   kpush2                 ; full: the key is dropped, as on real hardware
    mov  [bx], ax
    mov  [BDA_KBTAIL], cx
kpush2:
    pop  cx
    pop  bx
    ret
kbd_push endp

;-----------------------------------------------------------------------------
; kbd_pop -- CF=1 and nothing else if the buffer is empty, otherwise CF=0 and
; AX = (scancode:ascii) with the head advanced. DS must be the BDA.
;
; The head is moved with interrupts off. INT 09h writes the tail from an
; interrupt that can land between the read and the write of the head, and a
; torn update here loses or repeats a key -- rarely, and only under typing,
; which is the worst kind of bug to go looking for later.
;-----------------------------------------------------------------------------
kbd_pop proc near
    push bx
    cli
    mov  bx, [BDA_KBHEAD]
    cmp  bx, [BDA_KBTAIL]
    je   kpop_empty
    mov  ax, [bx]
    add  bx, 2
    cmp  bx, [BDA_KBEND]
    jb   kpop1
    mov  bx, [BDA_KBSTART]
kpop1:
    mov  [BDA_KBHEAD], bx
    sti
    clc
    pop  bx
    ret
kpop_empty:
    sti
    stc
    pop  bx
    ret
kbd_pop endp

;=============================================================================
; INT 16h -- keyboard services.
;=============================================================================
int16:
    PUSHALL
    sti                         ; a key may still be arriving; do not lock it out
    mov  ax, BDA_SEG
    mov  ds, ax
    mov  ax, [bp+F_AX]

    ; AH=10h/11h/12h are the AT's "enhanced" calls. They differ from 00h/01h/
    ; 02h only in returning the extended keys this keyboard does not have, so
    ; they are aliased rather than refused -- a program that asks for the
    ; enhanced call and is told "no such function" simply hangs.
    cmp  ah, 10h
    jb   k16_dispatch
    cmp  ah, 12h
    ja   k16_exit
    sub  ah, 10h
k16_dispatch:
    cmp  ah, 0
    je   k16_read
    cmp  ah, 1
    je   k16_peek
    cmp  ah, 2
    je   k16_shift
    jmp  k16_exit               ; unknown function: return, as a real BIOS does

k16_read:
    ; Block until a key arrives. HLT rather than a spin: the CPU stops until
    ; the next interrupt of any kind, which on this machine is the timer 18
    ; times a second, so the loop costs nothing. A machine with NO interrupt
    ; source at all stops here forever -- correctly, because there is then
    ; nothing that could ever produce a key.
    call kbd_pop
    jnc  k16_got
    sti
    hlt
    jmp  k16_read
k16_got:
    mov  [bp+F_AX], ax
    jmp  k16_exit

k16_peek:
    ; Answers in ZF, and ZF lives in the FLAGS word the CPU pushed. See the
    ; frame comment: `or ax,ax` here would set ZF and IRET would throw it away.
    cli
    mov  bx, [BDA_KBHEAD]
    cmp  bx, [BDA_KBTAIL]
    je   k16_none
    mov  ax, [bx]
    mov  [bp+F_AX], ax
    and  word ptr [bp+F_FL], FL_NOT_ZF      ; ZF=0: a key is waiting
    sti
    jmp  k16_exit
k16_none:
    or   word ptr [bp+F_FL], FL_ZF          ; ZF=1: nothing waiting
    sti
    jmp  k16_exit

k16_shift:
    mov  al, [BDA_KBFLAG]
    mov  [bp+F_AL], al

k16_exit:
    POPALL
    iret

;=============================================================================
; INT 11h -- the equipment list. INT 12h -- memory size in KB.
;
; Both are one word out of the BIOS data area, and both matter far out of
; proportion to their size: DOS calls INT 12h to find the top of memory
; before it does anything else.
;=============================================================================
int11:
    PUSHALL
    mov  ax, BDA_SEG
    mov  ds, ax
    mov  ax, [BDA_EQUIP]
    mov  [bp+F_AX], ax
    POPALL
    iret

int12:
    PUSHALL
    mov  ax, BDA_SEG
    mov  ds, ax
    mov  ax, [BDA_MEMSZ]
    mov  [bp+F_AX], ax
    POPALL
    iret

;=============================================================================
; INT 1Ah -- time of day, over the tick count at 0040:006C.
;=============================================================================
int1a:
    PUSHALL
    mov  ax, BDA_SEG
    mov  ds, ax
    mov  ax, [bp+F_AX]
    cmp  ah, 0
    je   t1a_read
    cmp  ah, 1
    je   t1a_set
    ; AH=02h and up are the AT's real-time clock. There is no RTC chip on
    ; this machine, so they are refused rather than answered with a fiction.
    or   word ptr [bp+F_FL], FL_CF
    jmp  t1a_exit

t1a_read:
    ; CX:DX = the 32-bit count, AL = the rollover flag, WHICH IS CLEARED BY
    ; READING IT. That is the contract: the flag means "midnight passed since
    ; you last asked", so leaving it set would make every later read claim a
    ; new day. Reading it under CLI keeps a tick landing mid-read from
    ; splitting the high and low words across a carry.
    cli
    mov  dx, [BDA_TICKS]
    mov  cx, [BDA_TICKS+2]
    mov  al, [BDA_TICKOVF]
    mov  byte ptr [BDA_TICKOVF], 0
    sti
    mov  [bp+F_CX], cx
    mov  [bp+F_DX], dx
    mov  [bp+F_AL], al
    jmp  t1a_exit

t1a_set:
    cli
    mov  cx, [bp+F_CX]
    mov  dx, [bp+F_DX]
    mov  [BDA_TICKS], dx
    mov  [BDA_TICKS+2], cx
    mov  byte ptr [BDA_TICKOVF], 0
    sti

t1a_exit:
    POPALL
    iret

;=============================================================================
; INT 10h -- video.
;
; Everything goes through the text buffer at B8000h (B0000h in mode 7) as two
; bytes per cell, character then attribute. The cursor is a BIOS-data-area
; variable per page; the 6845 is programmed to match, which on this machine
; goes nowhere but is what the hardware wants.
;=============================================================================
int10:
    PUSHALL
    cld
    mov  ax, BDA_SEG
    mov  ds, ax
    mov  ax, [bp+F_AX]
    mov  bx, [bp+F_BX]
    mov  cx, [bp+F_CX]
    mov  dx, [bp+F_DX]
    mov  si, offset v_table
    jmp  dispatch

v_exit:
    POPALL
    iret

;-----------------------------------------------------------------------------
; dispatch -- CS:SI is a table of (db function, dw handler) triples ending
; with (db 0FFh, dw default). AH selects. Jumps; never returns.
;
; A jump table indexed by AH would be faster and is what a BIOS with a
; contiguous function range would use. The ranges here are not contiguous
; (00h-0Fh with holes, then 13h), so a table indexed by function number would
; be mostly padding pointing at the default.
;-----------------------------------------------------------------------------
dispatch proc near
disp_scan:
    cmp  ah, cs:[si]
    je   disp_take
    cmp  byte ptr cs:[si], 0FFh
    je   disp_take
    add  si, 3
    jmp  disp_scan
disp_take:
    jmp  word ptr cs:[si+1]
dispatch endp

v_table:
    db 00h
    dw v_setmode
    db 01h
    dw v_curshape
    db 02h
    dw v_setcur
    db 03h
    dw v_getcur
    db 05h
    dw v_setpage
    db 06h
    dw v_scrollup
    db 07h
    dw v_scrolldn
    db 08h
    dw v_readcell
    db 09h
    dw v_writecell
    db 0Ah
    dw v_writechar
    db 0Bh
    dw v_setpalette
    db 0Ch
    dw v_writepix
    db 0Dh
    dw v_readpix
    db 0Eh
    dw v_teletype
    db 0Fh
    dw v_getmode
    db 0FFh
    dw v_exit                   ; unimplemented function: return quietly

;-----------------------------------------------------------------------------
; AH=00h -- set the video mode. AL = mode.
;-----------------------------------------------------------------------------
v_setmode:
    ; Bit 7 of AL is "do not clear the buffer". It is honoured, because a
    ; program that re-selects the mode it is already in to reset the palette
    ; does not expect its screen to go blank.
    mov  ah, al
    and  ah, 80h                ; AH != 0 means keep the buffer
    and  al, 7Fh
    mov  [BDA_MODE], al

    ; THE GEOMETRY IS THE SAME QUANTITY IN BOTH KINDS OF MODE, which is why
    ; one table covers them. A CGA graphics mode is still measured in
    ; character cells eight pixels wide -- 320 pixels IS forty columns and
    ; 640 IS eighty -- and DOS-era code reads 0040:004Ah expecting exactly
    ; that, because it is what positions text on a graphics screen.
    ;
    ; The page length is the aperture a mode occupies, rounded up to a
    ; paragraph-friendly boundary: 40x25x2 = 2000 bytes -> 800h, 80x25x2 =
    ; 4000 -> 1000h, and every CGA graphics mode is the whole 16K aperture
    ; (two banks of 8192) -> 4000h. Mode 13h's 64000 bytes are not a "page"
    ; at all -- there is only one -- so it declares zero, and code that
    ; multiplies by it to find page n lands on page 0, which is the only
    ; page there is.
    mov  bl, al
    mov  bh, 0
    cmp  bl, 13h
    jne  vsm_g1
    mov  bl, 8                  ; mode 13h rides the ninth slot of the table
vsm_g1:
    cmp  bl, 8
    jbe  vsm_known
    mov  bl, 3                  ; a mode this ROM does not know: 80x25 text
vsm_known:
    push ax
    mov  al, cs:vid_cols[bx]
    mov  ah, 0
    mov  [BDA_COLS], ax
    shl  bx, 1
    mov  ax, cs:vid_pagelen[bx]
    mov  [BDA_PAGELEN], ax
    pop  ax
    mov  word ptr [BDA_PAGEOFF], 0
    mov  byte ptr [BDA_ACTPAGE], 0

    ; Every page's cursor goes home. Leaving them where the previous mode put
    ; them puts the cursor off the end of a 40-column screen.
    push ax
    push di
    push es
    mov  di, BDA_SEG
    mov  es, di
    mov  di, BDA_CURPOS
    xor  ax, ax
    mov  cx, 8
    rep  stosw
    pop  es
    pop  di
    pop  ax

    ; Mode 13h is not a CGA mode and none of what follows applies to it: a
    ; different card, a different register file, a different aperture.
    cmp  al, 13h
    je   vsm_vga

    ; The CGA mode-control register at 3D8h, built from the bit meanings in
    ; the chip's data sheet rather than copied from anyone's table:
    ;   bit 0  80x25 text     bit 1  graphics      bit 2  monochrome signal
    ;   bit 3  video enable   bit 4  640x200 hi-res gfx   bit 5  blink enable
    mov  bl, al
    mov  bh, 0
    cmp  bl, 6
    ja   vsm_mono
    mov  bl, cs:cga_modes[bx]
    jmp  vsm_setreg
vsm_mono:
    mov  bl, 28h                ; mode 7 and anything odd: enable + blink
vsm_setreg:
    mov  [BDA_MODEREG], bl
    mov  al, bl
    mov  dx, PORT_CGAMOD
    out  dx, al

    ; The colour-select register at 3D9h. Its bits mean different things in
    ; the two graphics families, so the value is chosen per mode rather than
    ; being one constant:
    ;   bits 0-3  in 320x200, the BACKGROUND and border colour; in 640x200,
    ;             the FOREGROUND -- the colour a set bit is drawn in
    ;   bit 4     intensity, applied to the four-colour palette
    ;   bit 5     which four-colour palette: 0 = green/red/brown,
    ;             1 = cyan/magenta/white
    ; 30h is therefore "black background, bright cyan/magenta/white" for the
    ; 320x200 modes and for text, which ignores the register entirely. Mode 6
    ; wants its foreground nibble set instead, so it gets 3Fh: white on black.
    mov  al, 30h
    cmp  byte ptr [BDA_MODE], 6
    jne  vsm_col
    mov  al, 3Fh
vsm_col:
    mov  [BDA_PALETTE], al
    mov  dx, PORT_CGACOL
    out  dx, al

    ; The 6845 itself. Setting 3D8h alone changes how the card INTERPRETS
    ; what it fetches; it does not change the raster, the number of rows, or
    ; how many scan lines a character row is. See crtc_program.
    call crtc_program
    jmp  vsm_cls

vsm_vga:
    call vga_mode13

vsm_cls:
    or   ah, ah
    jnz  vsm_nocls
    ; Clear the whole buffer, not just one page: switching modes leaves the
    ; other pages holding characters in the previous mode's geometry, and a
    ; graphics mode inherits text as a field of confetti.
    ;
    ; BX carries the fill and CX the count, so the three cases differ only in
    ; their three values and the code that stores is written once.
    mov  ax, VID_COLOR
    mov  cx, 8192               ; 16K in words: the whole CGA aperture, which
                                ; in modes 4/5/6 is both interleaved banks
    mov  bx, 0720h              ; blank, light grey on black
    cmp  byte ptr [BDA_MODE], 7
    jne  vsm_c1
    mov  ax, VID_MONO
    jmp  vsm_c3
vsm_c1:
    cmp  byte ptr [BDA_MODE], 13h
    jne  vsm_c2
    mov  ax, VID_VGA
    mov  cx, 32000              ; 320*200 bytes, one per pixel, as words
    xor  bx, bx
    jmp  vsm_c3
vsm_c2:
    cmp  byte ptr [BDA_MODE], 4
    jb   vsm_c3
    cmp  byte ptr [BDA_MODE], 6
    ja   vsm_c3
    xor  bx, bx                 ; a graphics mode: all bits off, not blanks
vsm_c3:
    mov  es, ax
    xor  di, di
    mov  ax, bx
    rep  stosw
vsm_nocls:
    xor  dx, dx
    mov  bh, 0
    call cur_set
    jmp  v_exit

;-----------------------------------------------------------------------------
; AH=01h -- set the cursor shape. CH = start scan line, CL = end scan line.
;-----------------------------------------------------------------------------
v_curshape:
    mov  [BDA_CURSTART], ch
    mov  [BDA_CUREND], cl
    mov  dx, [BDA_CRTCPORT]
    mov  al, 0Ah                ; 6845 R10: cursor start (and the blink bits)
    out  dx, al
    inc  dx
    mov  al, ch
    out  dx, al
    dec  dx
    mov  al, 0Bh                ; 6845 R11: cursor end
    out  dx, al
    inc  dx
    mov  al, cl
    out  dx, al
    jmp  v_exit

;-----------------------------------------------------------------------------
; AH=02h -- set the cursor. DH = row, DL = column, BH = page.
;-----------------------------------------------------------------------------
v_setcur:
    call cur_set
    jmp  v_exit

;-----------------------------------------------------------------------------
; AH=03h -- read the cursor. Returns DH/DL and the shape in CH/CL.
;-----------------------------------------------------------------------------
v_getcur:
    call cur_get
    mov  [bp+F_DX], dx
    mov  ch, [BDA_CURSTART]
    mov  cl, [BDA_CUREND]
    mov  [bp+F_CX], cx
    jmp  v_exit

;-----------------------------------------------------------------------------
; AH=05h -- select the active display page. AL = page.
;-----------------------------------------------------------------------------
v_setpage:
    and  al, 7
    mov  [BDA_ACTPAGE], al
    mov  ah, 0
    mul  word ptr [BDA_PAGELEN]
    mov  [BDA_PAGEOFF], ax
    ; Tell the 6845 where the page starts. R12/R13 are the start address, in
    ; CHARACTERS, so the byte offset is halved.
    shr  ax, 1
    mov  bx, ax
    mov  dx, [BDA_CRTCPORT]
    mov  al, 0Ch
    out  dx, al
    inc  dx
    mov  al, bh
    out  dx, al
    dec  dx
    mov  al, 0Dh
    out  dx, al
    inc  dx
    mov  al, bl
    out  dx, al
    ; The hardware cursor follows the page.
    mov  bh, [BDA_ACTPAGE]
    call cur_get
    call cur_set
    jmp  v_exit

;-----------------------------------------------------------------------------
; AH=0Fh -- report the mode. AL = mode, AH = columns, BH = active page.
;-----------------------------------------------------------------------------
v_getmode:
    mov  al, [BDA_MODE]
    mov  ah, [BDA_COLS]
    mov  [bp+F_AX], ax
    mov  bh, [BDA_ACTPAGE]
    mov  [bp+F_BH], bh
    jmp  v_exit

;-----------------------------------------------------------------------------
; AH=08h -- read the character and attribute under the cursor of page BH.
;-----------------------------------------------------------------------------
v_readcell:
    call cur_get
    call cell_di
    mov  ax, es:[di]
    mov  [bp+F_AX], ax
    jmp  v_exit

;-----------------------------------------------------------------------------
; AH=09h -- write AL with attribute BL, CX times, at the cursor of page BH.
; AH=0Ah -- the same but leaving each cell's existing attribute alone.
;
; Neither advances the cursor. That is the documented behaviour and it is the
; whole reason they exist beside the teletype call: a program painting a menu
; wants to place text without the cursor chasing it.
;-----------------------------------------------------------------------------
v_writecell:
    jcxz v_wc_done
    push cx
    call cur_get
    call cell_di
    pop  cx
    mov  ax, [bp+F_AX]
    mov  ah, [bp+F_BL]          ; AL = character, AH = attribute
    rep  stosw
v_wc_done:
    jmp  v_exit

v_writechar:
    jcxz v_wch_done
    push cx
    call cur_get
    call cell_di
    pop  cx
    mov  ax, [bp+F_AX]
v_wch_loop:
    stosb                       ; character only...
    inc  di                     ; ...and step over the attribute byte
    loop v_wch_loop
v_wch_done:
    jmp  v_exit

;-----------------------------------------------------------------------------
; AH=0Eh -- teletype output. AL = character, BL = colour in graphics modes.
;
; This is the call that prints, and the one whose edges matter. CR, LF and
; backspace are CONTROL, not characters to display; a naive version that
; writes all 256 codes to the buffer prints a musical note for a newline and
; leaves the cursor one cell further right, which is exactly the symptom of
; every first BIOS.
;
; The page used is the ACTIVE one, not BH. That is a deliberate deviation:
; the documented input is BH, but DOS-era .COM programs call 0Eh with BH
; holding whatever was left in it, and honouring that writes their output
; into a page nobody is looking at. There is one visible page on this machine
; and using it is never the wrong answer.
;-----------------------------------------------------------------------------
v_teletype:
    mov  bh, [BDA_ACTPAGE]
    push ax
    call cur_get                ; DH = row, DL = column
    pop  ax

    cmp  al, 0Dh
    je   vtt_cr
    cmp  al, 0Ah
    je   vtt_lf
    cmp  al, 08h
    je   vtt_bs
    cmp  al, 07h
    je   vtt_ret                ; BEL: no speaker driver here. See NOT IMPLEMENTED.

    call cell_di
    stosb                       ; the character; the attribute already there stays
    inc  dl
    mov  cx, [BDA_COLS]
    cmp  dl, cl
    jb   vtt_place
    xor  dl, dl
    jmp  vtt_down

vtt_cr:
    xor  dl, dl
    jmp  vtt_place

vtt_bs:
    or   dl, dl
    jz   vtt_place              ; column 0: a backspace has nowhere to go, and
    dec  dl                     ; wrapping to the previous line is NOT what a
    jmp  vtt_place              ; BIOS does -- DOS does that, above us

vtt_lf:
vtt_down:
    inc  dh
    cmp  dh, 25
    jb   vtt_place
    mov  dh, 24                 ; stay on the last row and move the screen up
    call scroll_screen

vtt_place:
    call cur_set
vtt_ret:
    jmp  v_exit

;-----------------------------------------------------------------------------
; scroll_screen -- one line up, whole screen, current attribute. The teletype
; path's private entry into the general scroll, so that reaching the bottom of
; the screen costs the same code as INT 10h AH=06h.
;-----------------------------------------------------------------------------
scroll_screen proc near
    push ax
    push bx
    push cx
    push dx
    ; AL = one line, AH = the DIRECTION, 0 for up. Not 06h: scroll_common
    ; takes the direction in AH, not the INT 10h function number, and putting
    ; 0601h here scrolled the screen DOWNWARD every time the cursor ran off
    ; the bottom -- which looks like the teletype call losing its output.
    mov  al, 1
    mov  ah, 0
    mov  bh, 07h                ; light grey on black for the new line
    xor  cx, cx                 ; from (0,0)
    mov  dh, 24
    mov  dl, [BDA_COLS]
    dec  dl                     ; ...to the bottom right
    call scroll_common
    pop  dx
    pop  cx
    pop  bx
    pop  ax
    ret
scroll_screen endp

;-----------------------------------------------------------------------------
; AH=06h / AH=07h -- scroll a window.
;
;   AL      lines to move; 0 means BLANK THE WHOLE WINDOW
;   BH      attribute for the lines that come in blank
;   CH, CL  top row, left column      (inclusive)
;   DH, DL  bottom row, right column  (inclusive)
;
; TWO THINGS A NAIVE VERSION GETS WRONG, both of which look like the call did
; nothing:
;   * AL=0 is not "scroll zero lines". It is the documented CLEAR, and it is
;     how essentially every program clears the screen. Treating it literally
;     leaves the display untouched and looks like the write failed.
;   * The rectangle is inclusive at BOTH corners. A one-row window has
;     bottom == top, so the height is bottom-top+1; computing bottom-top
;     gives zero and the scroll silently does nothing.
;
; Locals live on the stack because there is nowhere else: this is ROM, and
; the BIOS data area belongs to the interface. BP is borrowed from the
; interrupt frame for the duration and given back before the exit.
;-----------------------------------------------------------------------------
SC_LINES  equ 0                 ; lines to move
SC_WIDTH  equ 2                 ; cells across the window
SC_ROWS   equ 4                 ; rows down the window
SC_FILL   equ 6                 ; the blank cell: attribute:20h
SC_WIN    equ 8                 ; CL = left column, CH = top row
SC_DIR    equ 10                ; 0 = up, 1 = down
SC_SIZE   equ 12

; The INT 10h entries CALL the worker, because the teletype path calls it too
; and a routine cannot both be fallen into and returned from. Getting this
; wrong is invisible until it runs: the RET pops the top of the caller's
; stack -- here, the interrupt frame -- and returns into it.
v_scrollup:
    mov  ah, 0
    call scroll_common
    jmp  v_exit
v_scrolldn:
    mov  ah, 1
    call scroll_common
    jmp  v_exit

scroll_common proc near
    push bp                     ; the interrupt frame pointer
    sub  sp, SC_SIZE
    mov  bp, sp

    mov  [bp+SC_DIR], ah
    mov  ah, 0
    mov  [bp+SC_LINES], ax
    mov  [bp+SC_WIN], cx
    mov  al, 20h
    mov  ah, bh
    mov  [bp+SC_FILL], ax       ; a blank in the requested attribute
    mov  al, dl
    sub  al, cl
    inc  al                     ; INCLUSIVE: +1
    mov  ah, 0
    mov  [bp+SC_WIDTH], ax
    mov  al, dh
    sub  al, ch
    inc  al
    mov  ah, 0
    mov  [bp+SC_ROWS], ax
    mov  bh, 0                  ; the scroll always acts on page 0's geometry;
                                ; cell_di adds the page offset from BH

    mov  ax, [bp+SC_LINES]
    or   ax, ax
    jz   sc_clearall            ; AL=0: blank the window
    cmp  ax, [bp+SC_ROWS]
    jb   sc_move                ; fewer lines than rows: a real scroll
sc_clearall:
    mov  ax, [bp+SC_ROWS]
    mov  [bp+SC_LINES], ax
    jmp  sc_blank

sc_move:
    mov  cx, [bp+SC_ROWS]
    sub  cx, [bp+SC_LINES]      ; rows that actually move
    cmp  byte ptr [bp+SC_DIR], 0
    jne  sc_down

    ; Up: the top row is overwritten first, so copying downward through the
    ; window can never read a row it has already written.
    mov  dx, [bp+SC_WIN]        ; DH = top row, DL = left column
sc_up_loop:
    push cx
    call cell_di                ; ES:DI = the destination cell
    ; THE DESTINATION GOES ON THE STACK, not into a spare register. It was
    ; BX here once, and BX is where cell_di reads the PAGE NUMBER from: the
    ; moment a row offset grew past 0FFh, BH stopped being zero and the next
    ; call placed the source in page 1, 2 or 5. The screen scrolled anyway,
    ; from the wrong place, which is the worst way for a bug to present.
    push di
    add  dh, [bp+SC_LINES]
    call cell_di                ; ES:DI = the source cell
    mov  si, di
    pop  di
    sub  dh, [bp+SC_LINES]
    push ds
    mov  ax, es
    mov  ds, ax                 ; both ends of the move are in video memory
    mov  cx, [bp+SC_WIDTH]
    rep  movsw
    pop  ds
    inc  dh
    pop  cx
    loop sc_up_loop
    jmp  sc_blank

sc_down:
    ; Down: start at the BOTTOM row for the same reason, mirrored.
    mov  dx, [bp+SC_WIN]
    mov  ax, [bp+SC_ROWS]
    add  dh, al
    dec  dh
sc_dn_loop:
    push cx
    call cell_di
    push di                     ; see the note in the loop above
    sub  dh, [bp+SC_LINES]
    call cell_di
    mov  si, di
    pop  di
    add  dh, [bp+SC_LINES]
    push ds
    mov  ax, es
    mov  ds, ax
    mov  cx, [bp+SC_WIDTH]
    rep  movsw
    pop  ds
    dec  dh
    pop  cx
    loop sc_dn_loop

sc_blank:
    ; Blank the rows that were vacated: the bottom ones when scrolling up,
    ; the top ones when scrolling down.
    mov  cx, [bp+SC_LINES]
    mov  dx, [bp+SC_WIN]
    cmp  byte ptr [bp+SC_DIR], 0
    jne  sc_blank_loop
    mov  ax, [bp+SC_ROWS]
    sub  ax, [bp+SC_LINES]
    add  dh, al
sc_blank_loop:
    push cx
    call cell_di
    mov  cx, [bp+SC_WIDTH]
    mov  ax, [bp+SC_FILL]
    rep  stosw
    inc  dh
    pop  cx
    loop sc_blank_loop

    add  sp, SC_SIZE
    pop  bp                     ; the interrupt frame pointer, back where it was
    ret
scroll_common endp

;=============================================================================
; GRAPHICS.
;
; Three services and four helpers, and the whole thing turns on ONE fact
; about how a CGA stores a picture, stated here once and relied on below.
;
; THE SCAN LINES ARE INTERLEAVED. Video memory in modes 4, 5 and 6 is not a
; picture read top to bottom. EVEN scan lines live in the 8K at B800:0000 and
; ODD ones in the 8K at B800:2000, each bank holding 100 rows of 80 bytes. So
;
;     row y starts at (y >> 1) * 80 + (y & 1) * 2000h
;
; and NOT at y * 80. This is the mistake worth naming, because the wrong
; version still draws: the picture comes out in half-height stripes with half
; of it landing in the 192 unused bytes at the end of each bank, which reads
; as a rendering fault rather than as an addressing one. The layout exists
; because the 6845 in graphics mode scans two lines per character row, and
; IBM wired the row counter's low bit to address line 13 instead of adding an
; adder.
;
; THE BIT PACKING is the second fact. In 320x200 four pixels share a byte at
; two bits each; in 640x200 eight share it at one bit each; in both, the
; LEFTMOST pixel is in the HIGH bits. One pixel is therefore a
; read-modify-write of one byte, never a store.
;
; Mode 13h is neither: 320x200, one byte per pixel, linear from A000:0000, no
; banks and no packing. That is why every game that can choose chooses it.
;=============================================================================

;-----------------------------------------------------------------------------
; gfx_addr -- where a pixel lives.
;
;   in    CX = x, DX = y, DS = the BIOS data area
;   out   CF=0, ES:DI = the byte holding it, CL = how far LEFT a colour must
;         be shifted to reach that pixel's bits, CH = the field's mask at
;         bit 0 (3 in mode 4/5, 1 in mode 6, 0FFh in mode 13h)
;         CF=1 and nothing else disturbed: off screen, or not a mode this
;         ROM plots in
;
; AX, BX and DX come back as they went in, so a caller keeps its colour in AL
; and its coordinates across the call. CH = 0FFh is also how the two plotting
; routines tell a packed pixel from a whole-byte one without asking the mode
; a second time.
;-----------------------------------------------------------------------------
gfx_addr proc near
    push ax
    push bx
    push dx

    ; MODE 13h FIRST, and not for tidiness: it is the short case, and putting
    ; the long CGA one first would put its own tail out of reach of a
    ; conditional jump. One byte per pixel, no banks, so the address is the
    ; plain arithmetic the interleave exists to complicate: y * 320 + x.
    mov  al, [BDA_MODE]
    cmp  al, 13h
    jne  ga_packed
    cmp  dx, 200
    jae  ga_bad
    cmp  cx, 320
    jae  ga_bad
    mov  ax, dx
    mov  bx, 320
    mul  bx                     ; 199*320 + 319 = 63999: still one word
    add  ax, cx
    mov  di, ax
    mov  cl, 0                  ; no shift...
    mov  ch, 0FFh               ; ...and the whole byte is the pixel
    mov  ax, VID_VGA
    jmp  ga_ok

    ; The refusal sits BETWEEN the two paths so that every bounds check in
    ; both of them can reach it with an ordinary conditional jump. Putting it
    ; at the end, where it reads better, puts it 158 bytes from the first
    ; check that needs it -- and an 8086 conditional jump reaches 127.
ga_bad:
    pop  dx
    pop  bx
    pop  ax
    stc
    ret

ga_packed:
    cmp  al, 4
    jb   ga_bad
    cmp  al, 6
    ja   ga_bad
    cmp  dx, 200
    jae  ga_bad

    mov  bx, cx                 ; x, kept whole while DI is built out of y

    ; The row, and THE INTERLEAVE. The bank is bit 0 of y scaled to 2000h;
    ; inside a bank the rows ARE consecutive, so the row number is y >> 1.
    mov  di, dx
    and  di, 1
    mov  cl, 13                 ; 2000h is 1 shifted left thirteen
    shl  di, cl
    shr  dx, 1
    mov  ax, dx
    mov  dl, CGA_STRIDE
    mul  dl                     ; AX = (y >> 1) * 80; 99*80 fits a word easily
    add  di, ax

    mov  ax, bx                 ; x again, about to be divided by the packing
    cmp  byte ptr [BDA_MODE], 6
    je   ga_hires

    ; 320x200: four pixels to a byte, two bits each. Pixel 0 of a byte is
    ; bits 7-6 and pixel 3 is bits 1-0, so the shift counts DOWN: 6, 4, 2, 0.
    cmp  bx, 320
    jae  ga_bad
    shr  ax, 1
    shr  ax, 1
    add  di, ax
    and  bl, 3
    mov  cl, 3
    sub  cl, bl
    shl  cl, 1                  ; (3 - (x & 3)) * 2
    mov  ch, 3
    jmp  ga_cga

ga_hires:
    ; 640x200: eight pixels to a byte, one bit each, leftmost in bit 7.
    cmp  bx, 640
    jae  ga_bad
    mov  cl, 3
    shr  ax, cl
    add  di, ax
    and  bl, 7
    mov  cl, 7
    sub  cl, bl                 ; 7 - (x & 7)
    mov  ch, 1

ga_cga:
    mov  ax, VID_COLOR
ga_ok:
    mov  es, ax
    pop  dx
    pop  bx
    pop  ax
    clc
    ret
gfx_addr endp

;-----------------------------------------------------------------------------
; AH=0Ch -- write a pixel. AL = colour, CX = x, DX = y, BH = page.
;
; BH IS ACCEPTED AND IGNORED, which is the truth rather than a shortcut: a
; CGA in a graphics mode has exactly one page, because one screen IS the 16K
; aperture. Failing the call when BH is not zero would break every program
; that leaves whatever was in BH there -- which is most of them -- and
; honouring it would need memory the card does not have.
;
; BIT 7 OF AL IS THE XOR FLAG, and it is why this service gets used at all
; instead of a program writing its own bytes. Draw a sprite with XOR, draw it
; again in the same place, and exactly what was underneath comes back; that
; is how everything moved on a CGA. It is not decoration.
;-----------------------------------------------------------------------------
v_writepix:
    call gfx_addr
    jc   v_wp_done
    mov  al, [bp+F_AL]
    ; A 256-COLOUR PIXEL HAS NO ROOM FOR A FLAG. Bit 7 of AL is the XOR flag
    ; in every mode whose pixel is narrower than a byte; in mode 13h it is
    ; colour bit 7, and reading it as a flag would put half the palette out
    ; of reach of this call.
    cmp  ch, 0FFh
    jne  v_wp_field
    mov  es:[di], al
    jmp  v_wp_done
v_wp_field:
    mov  ah, al                 ; the flag rides along in the copy
    and  al, ch                 ; the colour, clipped to the field's width
    shl  al, cl                 ; ...and moved onto this pixel's bits
    test ah, 80h
    jnz  v_wp_xor
    mov  ah, ch
    shl  ah, cl
    not  ah                     ; every bit of the byte EXCEPT this pixel's
    and  ah, es:[di]
    or   al, ah
    mov  es:[di], al
    jmp  v_wp_done
v_wp_xor:
    xor  al, es:[di]
    mov  es:[di], al
v_wp_done:
    jmp  v_exit

;-----------------------------------------------------------------------------
; AH=0Dh -- read a pixel. CX = x, DX = y, BH = page; the colour in AL.
;
; Not here for symmetry. Collision detection on a CGA is reading the pixel a
; sprite is about to move onto and seeing whether anything is already there,
; and a game that cannot do it either does not detect collisions or keeps a
; shadow copy of the screen in memory it has not got. An off-screen
; coordinate reads as 0 rather than failing: the caller asked "is anything
; there", and off the screen there is not.
;-----------------------------------------------------------------------------
v_readpix:
    xor  al, al
    call gfx_addr
    jc   v_rp_done
    mov  al, es:[di]
    shr  al, cl
    and  al, ch
v_rp_done:
    mov  [bp+F_AL], al
    jmp  v_exit

;-----------------------------------------------------------------------------
; AH=0Bh -- set the palette. BH says which half of the colour-select register
; at 3D9h is being written and BL is the value.
;
;   BH=0   BL = the border colour, and in the 320x200 modes the BACKGROUND
;          as well -- they are the same four bits of the same register. Bit 4
;          is the intensity that turns eight colours into sixteen, so a
;          five-bit value passes straight through.
;   BH=1   BL bit 0 chooses between the two four-colour palettes:
;          0 = green/red/brown, 1 = cyan/magenta/white. That is bit 5.
;
; THE OTHER BITS MUST SURVIVE. A program sets the background and then the
; palette, or the other way about, and a service that wrote a whole byte each
; time would undo whichever call came first. So the last value is kept at
; 0040:0066h and edited -- which is also where a program that wants to know
; is entitled to read it, since 3D9h is write-only on the card and a read
; floats.
;-----------------------------------------------------------------------------
v_setpalette:
    mov  al, [BDA_PALETTE]
    or   bh, bh
    jnz  v_sp_palette
    and  al, 0E0h               ; keep bits 5-7, replace the colour field
    mov  ah, bl
    and  ah, 1Fh
    or   al, ah
    jmp  v_sp_out
v_sp_palette:
    and  al, 0DFh               ; clear bit 5...
    test bl, 1
    jz   v_sp_out
    or   al, 20h                ; ...and set it only for palette 1
v_sp_out:
    mov  [BDA_PALETTE], al
    mov  dx, PORT_CGACOL
    out  dx, al
    jmp  v_exit

;-----------------------------------------------------------------------------
; crtc_program -- load the 6845 with the timings the mode in the BDA needs.
;
; WHY THIS IS NOT OPTIONAL even though 3D8h already said "graphics". The
; mode-control register only tells the card how to INTERPRET the bytes it
; fetches. How many character rows there are, how many scan lines each one
; is, and where the sync pulses fall are the CRTC's, and a 6845 still holding
; the previous mode's numbers displays the new mode's memory through the old
; mode's raster. Going from 80x25 text to 320x200 without this leaves the
; card fetching 25 rows of 8 scan lines out of a buffer that is 100 rows
; of 2.
;
; THE VALUES ARE ARITHMETIC, not a table anyone wrote down. The dot clock is
; 14.318 MHz and every mode has to come out at the same 15.7 kHz line rate
; and 60 Hz frame rate, which fixes them:
;
;   80-column text  8 dots per character at the full dot clock = 1.79 MHz,
;                   and 1.79 MHz / 15.7 kHz = 114 character times to a line,
;                   80 of them displayed. R0 holds total-1, so 113.
;   40-column text  the dot clock is halved first, so a character time is
;                   twice as long and 57 of them fill a line. R0 = 56.
;   graphics        320 pixels is 40 character times of that same halved
;                   clock, so the horizontal half of the graphics row IS the
;                   40-column half. 640x200 uses the SAME timings and fetches
;                   two bytes per character time rather than one, which is
;                   exactly what 3D8h bit 4 switches -- which is why there is
;                   no fourth row in the table.
;
;   vertically      262 scan lines at 15.7 kHz gives 59.9 Hz. Text spends
;                   them as 32 rows of 8 lines (R4=31, R9=7) plus a six-line
;                   adjust (R5=6); graphics as 128 rows of 2 (R4=127, R9=1)
;                   plus the same six. Of those, 25 rows and 100 rows are
;                   displayed (R6) -- 200 scan lines either way.
;
;   R1 = displayed characters, R2/R3 = where the horizontal sync starts and
;   how wide it is, R7 = where the vertical sync starts, R8 = interlace (off),
;   R10/R11 = the cursor's scan lines.
;
; R12 and R13 are the display start address and are zeroed here, because a
; mode set puts the screen back at the beginning of the aperture. R14 and R15
; are the cursor address and belong to cur_set, which runs a moment later.
;
; On THIS machine CGACard decodes 3D8h and 3D9h and discards everything else,
; so these twenty-eight OUTs land in a decoded window that ignores them. They
; are here because they are what the hardware needs, and because a ROM that
; writes only the registers its emulator happens to model is a ROM that stops
; working on the next emulator.
;-----------------------------------------------------------------------------
crtc_program proc near
    push ax
    push bx
    push dx
    push si
    mov  al, [BDA_MODE]
    mov  si, offset crtc_gfx
    cmp  al, 4
    jb   cp_text
    cmp  al, 6
    jbe  cp_go
cp_text:
    mov  si, offset crtc_text40
    cmp  al, 2
    jb   cp_go                  ; modes 0 and 1 are the 40-column raster
    mov  si, offset crtc_text80 ; 2, 3, 7 and anything unknown: 80 columns
cp_go:
    mov  dx, [BDA_CRTCPORT]
    xor  bx, bx
cp_loop:
    mov  al, bl
    out  dx, al                 ; the index register at 3D4h...
    inc  dx
    mov  al, cs:[si+bx]
    out  dx, al                 ; ...and the data register at 3D5h
    dec  dx
    inc  bl
    cmp  bl, 14
    jb   cp_loop
    pop  si
    pop  dx
    pop  bx
    pop  ax
    ret
crtc_program endp

;-----------------------------------------------------------------------------
; vga_mode13 -- put a VGA into 320x200 with 256 colours.
;
; A VGA is not a CGA with more colours; it is a different card with five
; register files behind index/data port pairs, and mode 13h is a particular
; setting of four of them. THREE BITS do the actual work and everything else
; is timing:
;
;   sequencer 04h bit 3   CHAIN-4. Video memory is four byte-wide planes and
;                         normally the CPU sees all four at one address.
;                         Chain-4 routes address bits 0-1 to the plane select
;                         instead, so consecutive addresses land in
;                         consecutive planes and 64000 bytes read back as one
;                         flat array. THIS is what makes mode 13h linear.
;   graphics  06h bit 0   graphics rather than alphanumeric; bits 3-2 = 01
;                         put the aperture at A0000h for 64K.
;   attribute 10h bit 6   8-bit colour: one byte IS one DAC index, instead of
;                         four planes contributing one bit each to a
;                         four-bit attribute.
;
; Chain-4 without 8-bit colour is a sixteen-colour planar mode; 8-bit colour
; without chain-4 is what Mode X was built out of. Only both together are 13h.
;
; THE ATTRIBUTE CONTROLLER IS ONE PORT DOING TWO JOBS and an internal
; flip-flop decides which. Reading the status register at 3DAh forces it back
; to the index phase, and that read is not a formality: the flip-flop cannot
; be read, so it is the only way to know which phase the port is in. Skip it
; and every index is written as data and every value as an index.
;
; ON A MACHINE WITH NO VGA all of this lands in open bus and mode 13h is a
; no-op that leaves BDA_MODE saying 13h. That is the honest outcome -- this
; ROM does not probe for the card, and pretending 13h worked on a CGA would
; be worse than a mode set that quietly did nothing.
;-----------------------------------------------------------------------------
vga_mode13 proc near
    push ax
    push bx
    push cx
    push dx
    push si

    ; Miscellaneous output. Bit 0 puts the CRTC at 3D4h (colour) rather than
    ; 3B4h (mono), bit 1 lets the CPU reach display memory at all, bits 3-2
    ; select the 25.175 MHz dot clock, bit 5 picks the high 64K page for
    ; odd/even addressing, and bits 7-6 set the sync polarities that tell a
    ; monitor this is the 400-line timing.
    mov  dx, PORT_VGA_MISC
    mov  al, 63h
    out  dx, al

    mov  si, offset vga13_seq
    mov  dx, PORT_VGA_SEQI
    mov  cx, 5
    call vga_regs

    mov  si, offset vga13_gc
    mov  dx, PORT_VGA_GCI
    mov  cx, 9
    call vga_regs

    ; The CRTC. Its index/data pair is at 3D4h/3D5h -- the same ports the
    ; 6845 answers on, and deliberately so: an EGA and a VGA had to look
    ; enough like a CGA for software that was already written to find them.
    ;
    ; REGISTER 11h HAS TO BE UNLOCKED FIRST. Its bit 7 write-protects
    ; registers 0-7, and the value the table loads into it SETS that bit --
    ; so the second call to this routine would silently fail to change the
    ; horizontal timings if the lock were not cleared before the pass.
    mov  dx, [BDA_CRTCPORT]
    mov  al, 11h
    out  dx, al
    inc  dx
    xor  al, al
    out  dx, al
    dec  dx
    mov  si, offset vga13_crtc
    mov  cx, 25
    call vga_regs

    ; The attribute controller: read 3DAh to force the index phase, then
    ; index and data alternate through the SINGLE port at 3C0h.
    mov  dx, PORT_CGASTAT
    in   al, dx
    mov  si, offset vga13_attr
    mov  dx, PORT_VGA_ATTR
    xor  bx, bx
vm13_attr:
    mov  al, bl
    out  dx, al                 ; the index...
    mov  al, cs:[si+bx]
    out  dx, al                 ; ...and its data, same port, next phase
    inc  bl
    cmp  bl, 21                 ; 00h-0Fh the palette, then 10h-14h
    jb   vm13_attr

    ; Now let the screen come on. Bit 5 of a 3C0h INDEX write is the
    ; palette-address-source bit: clear, the CPU owns the palette and the
    ; display is blanked; set, the display owns it. Every attribute write
    ; above ran with it clear, which is why they had to come first.
    mov  al, 20h
    out  dx, al

    call vga_dac

    pop  si
    pop  dx
    pop  cx
    pop  bx
    pop  ax
    ret
vga_mode13 endp

;-----------------------------------------------------------------------------
; vga_regs -- CS:SI is CX bytes for the index/data pair at DX and DX+1,
; written as registers 0, 1, 2, ... in order. Preserves everything.
;-----------------------------------------------------------------------------
vga_regs proc near
    push ax
    push bx
    push cx
    push dx
    xor  bx, bx
vr_loop:
    mov  al, bl
    out  dx, al
    inc  dx
    mov  al, cs:[si+bx]
    out  dx, al
    dec  dx
    inc  bx
    loop vr_loop
    pop  dx
    pop  cx
    pop  bx
    pop  ax
    ret
vga_regs endp

;-----------------------------------------------------------------------------
; vga_dac -- load the 256-entry palette that mode 13h starts with.
;
; WHY THE ROM HAS TO DO THIS AT ALL. A VGA's DAC powers up holding zeros, and
; zero is black. A mode-13h program that draws its picture and never touches
; 3C8h -- which is most of them, because the default table is the one the
; artwork was drawn against -- gets a black screen on a card nobody
; initialised. The default palette is not a nicety; it is part of what
; setting the mode MEANS.
;
; THE TABLE IS GENERATED, NOT STORED, and that is the honest way round: 768
; bytes of listed numbers would be somebody's table copied, whereas the
; structure is three plain descriptions that reproduce every entry exactly.
;
;   00h-0Fh  the sixteen CGA colours, straight out of the RGBI bits. Red is
;            bit 2, green bit 1, blue bit 0, and bit 3 is intensity: a
;            channel is 42 when its own bit is set, plus 21 when intensity
;            is, so the four combinations are 0, 21, 42 and 63. Entry 6 ALONE
;            is the exception -- its green is pulled down to 21 to make brown
;            instead of olive, a correction IBM's monitor made in hardware
;            and the DAC table bakes in. Entry 0Eh is plain yellow and must
;            NOT get it.
;   10h-1Fh  sixteen greys. The steps widen towards white because the ramp is
;            perceptual rather than linear, so there is no formula and the
;            levels are listed. Sixteen numbers are a measurement.
;   20h-F7h  216 colours = 3 brightness levels x 3 saturations x a walk round
;            the hue wheel in 6 sextants of 4 steps. Inside a sextant one
;            channel sits at the high value, one at the low, and the third
;            ramps between them in quarters -- rising in three of the six and
;            falling in the other three, which is what closes the circle.
;   F8h-FFh  black: the eight entries nobody ever defined.
;
; Values are SIX BITS WIDE because that is a DAC register's width. The card
; stores what the hardware stores, so nothing here is scaled.
;-----------------------------------------------------------------------------
vga_dac proc near
    push ax
    push bx
    push cx
    push dx
    push si
    push di

    mov  dx, PORT_VGA_DACW
    xor  al, al
    out  dx, al                 ; start at entry 0; the index self-increments
    mov  dx, PORT_VGA_DACD      ; ...after every third byte, so from here on
                                ; the palette is just a stream of bytes

    ; ---- 00h-0Fh: the sixteen RGBI colours -------------------------------
    xor  bx, bx
vd_cga:
    mov  al, 0
    test bl, 4
    jz   vd_r1
    mov  al, 42
vd_r1:
    test bl, 8
    jz   vd_r2
    add  al, 21
vd_r2:
    out  dx, al                 ; red

    mov  al, 0
    test bl, 2
    jz   vd_g1
    mov  al, 42
vd_g1:
    test bl, 8
    jz   vd_g2
    add  al, 21
vd_g2:
    cmp  bl, 6
    jne  vd_g3
    mov  al, 21                 ; THE BROWN FIX, and entry 6 only
vd_g3:
    out  dx, al                 ; green

    mov  al, 0
    test bl, 1
    jz   vd_b1
    mov  al, 42
vd_b1:
    test bl, 8
    jz   vd_b2
    add  al, 21
vd_b2:
    out  dx, al                 ; blue

    inc  bl
    cmp  bl, 16
    jb   vd_cga

    ; ---- 10h-1Fh: the sixteen greys --------------------------------------
    mov  si, offset vga_greys
    xor  bx, bx
vd_grey:
    mov  al, cs:[si+bx]
    out  dx, al
    out  dx, al
    out  dx, al                 ; a grey is the same value three times
    inc  bl
    cmp  bl, 16
    jb   vd_grey

    ; ---- 20h-F7h: three brightness levels of the hue wheel ----------------
    mov  bl, 63
    call vga_block
    mov  bl, 28
    call vga_block
    mov  bl, 16
    call vga_block

    ; ---- F8h-FFh: the eight entries nobody defined ------------------------
    mov  cx, 24
    xor  al, al
vd_black:
    out  dx, al
    loop vd_black

    pop  di
    pop  si
    pop  dx
    pop  cx
    pop  bx
    pop  ax
    ret
vga_dac endp

;-----------------------------------------------------------------------------
; vga_block -- the 72 entries of one brightness level. BL = the high value,
; DX = 3C9h. Three saturations, six sextants, four steps.
;
; The three saturations are the high value with the low one at 0, at a half,
; and at five sevenths. That last looks arbitrary and is not: 63*5/7 is
; exactly 45, 28*5/7 exactly 20, and 16*5/7 floors to 11, which are the three
; levels' pale variants.
;-----------------------------------------------------------------------------
vga_block proc near
    push ax
    push bx
    push cx
    push si
    push di
    xor  di, di                 ; which of the three saturations
vb_sat:
    or   di, di
    jz   vb_lo0
    cmp  di, 1
    je   vb_lo1
    mov  al, bl                 ; five sevenths of the high value
    mov  ah, 0
    mov  cl, 5
    mul  cl
    mov  cl, 7
    div  cl                     ; AL = quotient, AH = remainder: a floor
    mov  bh, al
    jmp  vb_have
vb_lo1:
    mov  bh, bl
    shr  bh, 1                  ; half
    jmp  vb_have
vb_lo0:
    mov  bh, 0                  ; fully saturated
vb_have:
    xor  cx, cx                 ; CL = sextant, CH = the step within it
vb_sx:
    mov  ch, 0
vb_k:
    mov  si, offset vga_sextants
    mov  al, cl
    mov  ah, 3                  ; three channel specs per sextant
    mul  ah
    add  si, ax
    mov  al, cs:[si]
    call vga_chan
    out  dx, al                 ; red
    mov  al, cs:[si+1]
    call vga_chan
    out  dx, al                 ; green
    mov  al, cs:[si+2]
    call vga_chan
    out  dx, al                 ; blue
    inc  ch
    cmp  ch, 4
    jb   vb_k
    inc  cl
    cmp  cl, 6
    jb   vb_sx
    inc  di
    cmp  di, 3
    jb   vb_sat
    pop  di
    pop  si
    pop  cx
    pop  bx
    pop  ax
    ret
vga_block endp

;-----------------------------------------------------------------------------
; vga_chan -- one channel of one hue-wheel entry. AL = the spec (0 = sit at
; the low value, 1 = sit at the high one, 2 = rise, 3 = fall), BL = high,
; BH = low, CH = the step 0-3. Returns the six-bit value in AL.
;
; THE ROUNDING IS HALF-DOWN and that is not an aesthetic choice: it is what
; makes the 0-to-63 ramp come out 0, 16, 31, 47, 63 and the 45-to-63 one 45,
; 49, 54, 58, 63. Ordinary round-half-up gets the second wrong and
; round-half-to-even gets the first; adding 3 before shifting right by 3 gets
; both, because it rounds .5 down and everything above it up.
;-----------------------------------------------------------------------------
vga_chan proc near
    push bx
    push cx
    push dx
    or   al, al
    jnz  vc_hi
    mov  al, bh                 ; spec 0: sit at the low value
    jmp  vc_done
vc_hi:
    cmp  al, 1
    jne  vc_ramp
    mov  al, bl                 ; spec 1: sit at the high value
    jmp  vc_done
vc_ramp:
    push ax                     ; the spec, 2 or 3, wanted again below
    mov  al, bl
    sub  al, bh
    mov  ah, 0                  ; AX = hi - lo, at most 63
    mov  cl, ch
    mov  ch, 0                  ; CX = the step, 0-3
    mul  cx                     ; AX = (hi - lo) * k, at most 189
    shl  ax, 1
    add  ax, 3
    mov  cl, 3
    shr  ax, cl                 ; ((hi - lo) * k * 2 + 3) >> 3
    add  al, bh                 ; ...+ lo: the rising ramp
    pop  cx                     ; the spec, back in CL
    cmp  cl, 2
    je   vc_done
    ; Falling is the same walk mirrored: hi - (ramp - lo), which is
    ; hi + lo - ramp and cannot overflow a byte at these values.
    mov  ah, al
    mov  al, bl
    add  al, bh
    sub  al, ah
vc_done:
    pop  dx
    pop  cx
    pop  bx
    ret
vga_chan endp

;-----------------------------------------------------------------------------
; cur_get -- BH = page in, DH = row / DL = column out. DS must be the BDA.
; cur_set -- the same registers in, and the 6845 is told about it.
;-----------------------------------------------------------------------------
cur_get proc near
    push ax
    push bx
    mov  bl, bh
    and  bl, 7                  ; eight cursor slots, so eight pages
    mov  bh, 0
    shl  bx, 1
    add  bx, BDA_CURPOS
    mov  dx, [bx]
    pop  bx
    pop  ax
    ret
cur_get endp

cur_set proc near
    push ax
    push bx
    mov  bl, bh
    and  bl, 7
    mov  bh, 0
    shl  bx, 1
    add  bx, BDA_CURPOS
    mov  [bx], dx
    pop  bx
    pop  ax
    call crtc_cursor
    ret
cur_set endp

;-----------------------------------------------------------------------------
; crtc_cursor -- program the 6845's cursor address from DH/DL and the active
; page. R14/R15 hold a CHARACTER address, not a byte address.
;
; CGACard models 3D8h and 3D9h and nothing else, so on this machine these
; four OUTs land in a decoded window that discards them. They are here
; because they are what the hardware needs and because leaving them out would
; make this ROM wrong on a machine whose CRTC is modelled.
;-----------------------------------------------------------------------------
crtc_cursor proc near
    push ax
    push bx
    push cx
    push dx
    mov  al, dh
    mul  byte ptr [BDA_COLS]
    mov  dh, 0
    add  ax, dx                 ; AX = row*columns + column
    mov  bx, [BDA_PAGEOFF]
    shr  bx, 1                  ; bytes to characters
    add  bx, ax
    mov  dx, [BDA_CRTCPORT]
    mov  al, 0Eh                ; R14: cursor address high
    out  dx, al
    inc  dx
    mov  al, bh
    out  dx, al
    dec  dx
    mov  al, 0Fh                ; R15: cursor address low
    out  dx, al
    inc  dx
    mov  al, bl
    out  dx, al
    pop  dx
    pop  cx
    pop  bx
    pop  ax
    ret
crtc_cursor endp

;-----------------------------------------------------------------------------
; cell_di -- BH = page, DH = row, DL = column in; ES:DI = that cell out.
; Everything else is preserved, which is what lets the scroll call it twice
; in a row to get a source and a destination.
;-----------------------------------------------------------------------------
cell_di proc near
    push ax
    push bx
    push dx
    mov  ax, VID_COLOR
    cmp  byte ptr [BDA_MODE], 7
    jne  cd_colour
    mov  ax, VID_MONO           ; mode 7 is the monochrome adapter's page
cd_colour:
    mov  es, ax
    mov  al, dh
    mul  byte ptr [BDA_COLS]    ; row * columns; 24*80 fits a word comfortably
    mov  dh, 0
    add  ax, dx                 ; + column
    shl  ax, 1                  ; two bytes per cell: character and attribute
    mov  di, ax
    mov  al, bh
    and  al, 7
    mov  ah, 0
    mul  word ptr [BDA_PAGELEN]
    add  di, ax                 ; + the page's base
    pop  dx
    pop  bx
    pop  ax
    ret
cell_di endp

;-----------------------------------------------------------------------------
; puts -- CS:SI is a NUL-terminated string; print it through the teletype
; call. Going through INT 10h rather than writing the buffer directly means
; the banner scrolls and wraps like anything else, and it exercises the
; service at the earliest possible moment.
;-----------------------------------------------------------------------------
puts proc near
    push ax
    push bx
    push si
puts_loop:
    mov  al, cs:[si]
    inc  si
    or   al, al
    jz   puts_done
    mov  ah, 0Eh
    mov  bx, 0007h
    int  10h
    jmp  puts_loop
puts_done:
    pop  si
    pop  bx
    pop  ax
    ret
puts endp

;=============================================================================
; INT 13h -- disk services.
;
; THE ENTRY POINTS AND THE REGISTER CONVENTIONS ARE REAL. The transfer is not.
;
;   AH=00h  reset the disk system            DL = drive
;   AH=01h  last status                      -> AL = status
;   AH=02h  read sectors    AL = count, CH = cylinder, CL = sector (1-based!),
;                           DH = head, DL = drive, ES:BX = buffer
;   AH=03h  write sectors   same registers
;   AH=04h  verify sectors  same registers, no buffer
;   AH=08h  drive parameters  -> CH/CL/DH/DL and ES:DI -> the parameter table
;   AH=15h  drive type        -> AH = type
;
; Every one returns CF=0 and AH=00h on success, CF=1 and AH=status on
; failure -- in the caller's FLAGS, which means editing the pushed word.
;
; SECTOR NUMBERS START AT ONE and cylinder/head start at zero. That asymmetry
; is not a typo in the documentation; it is the CHS convention, and reading
; the boot sector as sector 0 gets a "sector not found" from real hardware and
; silence from a naive emulator.
;=============================================================================
int13:
    PUSHALL
    sti
    cld
    mov  ax, BDA_SEG
    mov  ds, ax
    mov  ax, [bp+F_AX]
    ; The default answer, set before the dispatch so that a function which
    ; succeeds need say nothing at all and a function with its OWN return
    ; value in AH (AH=15h) can simply overwrite it.
    mov  byte ptr [bp+F_AH], DSK_OK

    ; EVERY FUNCTION IS A NEAR CALL AND EVERY FUNCTION RETURNS ITS STATUS IN
    ; AL, so there is exactly one exit, exactly one place that writes
    ; 0040:0041, and exactly one place that decides the caller's carry.
    ;
    ; It is written this way for a second reason as well. The dispatch used
    ; to be a chain of conditional jumps straight into the handlers, and an
    ; 8086 conditional jump reaches 127 bytes: adding the floppy driver put
    ; every one of those targets out of range at once, and the assembler's
    ; JMP-shrinking is sticky enough that widening them back is not reliable
    ; (see ASSEMBLER NOTES at the top of this file). A CALL is three bytes
    ; and reaches the whole segment, always. So the layout of this file
    ; cannot strand its own control flow again.
    call d_dispatch
    call d_setstat
    POPALL
    iret

;-----------------------------------------------------------------------------
; d_dispatch -- AH selects; AL comes back holding the status byte.
;-----------------------------------------------------------------------------
d_dispatch proc near
    cmp  ah, 00h
    jne  dd_01
    call d_reset
    ret
dd_01:
    cmp  ah, 01h
    jne  dd_02
    call d_status
    ret
dd_02:
    cmp  ah, 02h
    jne  dd_03
    call d_read
    ret
dd_03:
    cmp  ah, 03h
    jne  dd_04
    call d_write
    ret
dd_04:
    cmp  ah, 04h
    jne  dd_08
    call d_verify
    ret
dd_08:
    cmp  ah, 08h
    jne  dd_15
    call d_params
    ret
dd_15:
    cmp  ah, 15h
    jne  dd_none
    call d_type
    ret
dd_none:
    mov  al, DSK_BADCMD
    ret
d_dispatch endp

;-----------------------------------------------------------------------------
; d_setstat -- AL = the status the function produced.
;
; 0040:0041 IS WRITTEN ON EVERY COMPLETION, success included. AH=01h returns
; that byte and nothing else, so a driver that only records failures leaves
; the previous failure standing after a successful read and the caller that
; asks "did that work?" is told about an operation two calls ago. Recording
; the zero is the whole reason the field can be believed.
;
; AH is written only on a FAILURE. On success it holds whatever the function
; put there -- AH=15h's drive type, and DSK_OK for everything else, which the
; entry code above has already stored.
;-----------------------------------------------------------------------------
d_setstat proc near
    mov  [BDA_DISKSTAT], al
    or   al, al
    jz   d_ss_ok
    mov  [bp+F_AH], al
    or   word ptr [bp+F_FL], FL_CF
    ret
d_ss_ok:
    ; AH is NOT touched here. It already holds DSK_OK from the entry code,
    ; or the drive type AH=15h put there, and overwriting it would take that
    ; answer away from the one function whose answer it is.
    and  word ptr [bp+F_FL], FL_NOT_CF
    ret
d_setstat endp

;-----------------------------------------------------------------------------
; AH=01h -- the status of the last operation.
;
; Answerable without touching hardware: it is the byte the last call left
; behind. Writing it straight back through d_setstat is deliberate and is not
; a no-op -- it is what makes the carry flag agree with the byte, so
; `int 13h` with AH=01h answers in CF the way every other function does.
;-----------------------------------------------------------------------------
d_status proc near
    mov  al, [BDA_DISKSTAT]
    mov  [bp+F_AL], al
    ret
d_status endp

;-----------------------------------------------------------------------------
; AH=02h/03h/04h -- read, write and verify.
;
; Each loads SI with the pair of command bytes that distinguishes it: the
; uPD765 opcode in the high half, the 8237 mode byte in the low half. Those
; two bytes are the ONLY difference between the three, because the only thing
; that differs between reading, writing and verifying a sector is which way
; the DMA controller points.
;
; AL comes back from fd_xfer holding the status; the caller's own AL, the
; sector count, is left in the frame untouched, which is what AL means on
; return. On a FAILURE this driver does not reduce it to a partial count:
; working one out means differencing the result phase's CHS against the
; request across head and cylinder boundaries, and every caller in sight
; retries the whole request rather than resuming it.
;-----------------------------------------------------------------------------
; dpt_byte -- read one field of the diskette parameter table THROUGH INT 1Eh.
;
; AL = the field index on entry, that field's value on exit. EVERYTHING ELSE
; IS PRESERVED, because the callers need it: the motor-start read sits next to
; a live BH, and the one in fdx_fail sits between `mov ah, al` and `mov al,
; ah` with the status parked in AH. Flags are not preserved and no caller
; carries any across the read the way it used to be written.
;
; WHY THIS EXISTS. The driver read cs:[dpt+N] -- the ROM's OWN copy -- at
; eleven sites, while the table header claimed that a program hooking INT 1Eh
; "really does change what the controller is told". THAT WAS FALSE: POST wrote
; the vector once and nothing ever read it back, so an operating system that
; hooked it was ignored. Now the claim is true, which is what lets d_media
; publish a table for the medium actually in the drive -- and lets a guest
; overrule that choice, which is the whole point of the vector.
;-----------------------------------------------------------------------------
dpt_byte proc near
    push ds
    push si
    push bx
    xor  bh, bh
    mov  bl, al                 ; BX = the field index
    xor  si, si
    mov  ds, si                 ; DS = 0000, the interrupt vector table
    mov  si, [0078h]            ; 1Eh*4: the table's offset...
    add  si, bx
    mov  bx, [007Ah]            ; ...and its segment, read while DS is STILL 0
    mov  ds, bx
    mov  al, [si]
    pop  bx
    pop  si
    pop  ds
    ret
dpt_byte endp

;-----------------------------------------------------------------------------
; dpt_set -- point INT 1Eh at one of this ROM's tables. AX = its offset.
; Written with STOSW because that is how POST installs the vector and it is
; the addressing this assembler is known to take.
;-----------------------------------------------------------------------------
dpt_set proc near
    push es
    push di
    push ax
    xor  di, di
    mov  es, di
    mov  di, 78h
    stosw                       ; the offset, already in AX
    mov  ax, ROM_SEG
    stosw
    pop  ax
    pop  di
    pop  es
    ret
dpt_set endp

;-----------------------------------------------------------------------------
; d_media -- work out what is in the drive, once, and publish its table.
;
; THE BUG THIS FIXES. The ROM had ONE table and it described a 360K disk, so
; EOT was 9. EOT is the last sector the controller will transfer before it
; decides the track has ended, and the driver sets MT, so at EOT the chip
; switches to the other head. On a 1.44M floppy a two-sector read at sector 9
; therefore returned sector 9 and then HEAD 1'S SECTOR 1, with CF clear and
; AH=00 -- the controller did exactly what it was told. ELKS's kernel loaded
; with every second sector wrong. See ROADMAP E6.8.8b.
;
; IT PROBES WITH VERIFY, NOT READ. The 8237 runs in verify mode, drives no bus
; cycle, and never writes ES:BX -- so this needs no scratch buffer anywhere in
; low memory and cannot corrupt anything if the guess is wrong. All three
; attempts are made with the 1.44M table published, because EOT has to be high
; enough to NAME sector 18 before the controller will look for it.
;
; NINE SECTORS IS REPORTED AS 360K AND MAY BE A 720K DISK. Telling them apart
; needs a seek to cylinder 40, which on a 40-cylinder drive is a seek to a
; track that is not there; the only thing it would buy is AH=08h's cylinder
; count, and every transfer is already correct without it.
;
; PRECEDENCE: this runs ONCE, and software that hooks INT 1Eh afterwards wins,
; because dpt_byte reads through the vector. The BIOS does not re-point behind
; a guest's back. AH=00h clears BDA_MEDIA, so a reset is how to ask again.
;-----------------------------------------------------------------------------
d_media proc near
    ; Both refusals RETURN where they stand rather than jumping to a shared
    ; exit at the bottom: the probe below is longer than the 127 bytes a
    ; conditional jump reaches, and the assembler says so precisely. See
    ; ASSEMBLER NOTES 3 at the top of this file.
    cmp  byte ptr [BDA_MEDIA], MEDIA_UNKNOWN
    je   dmed_probe
    ret
dmed_probe:
    mov  al, [bp+F_DL]
    test al, 80h
    jz   dmed_go
    ret                         ; a fixed disk has no diskette table
dmed_go:
    mov  byte ptr [BDA_MEDIA], MEDIA_PROBING  ; before the first nested call

    mov  ax, [bp+F_AX]          ; the caller's request, put back before return
    push ax
    mov  ax, [bp+F_CX]
    push ax
    mov  ax, [bp+F_DX]
    push ax

    mov  ax, offset dpt144
    call dpt_set
    mov  byte ptr [bp+F_AL], 1  ; one sector, cylinder 0, head 0
    mov  byte ptr [bp+F_CH], 0
    mov  byte ptr [bp+F_DH], 0
    mov  byte ptr [bp+F_CL], 18
    call d_verify
    jnc  dmed_144
    mov  byte ptr [bp+F_CL], 15
    call d_verify
    jnc  dmed_12m

    mov  ax, offset dpt         ; nine sectors, or nothing readable at all
    call dpt_set
    mov  byte ptr [BDA_MEDIA], MEDIA_360K
    jmp  dmed_done
dmed_12m:
    mov  ax, offset dpt12m
    call dpt_set
    mov  byte ptr [BDA_MEDIA], MEDIA_12M
    jmp  dmed_done
dmed_144:
    mov  byte ptr [BDA_MEDIA], MEDIA_144M
dmed_done:
    pop  ax
    mov  [bp+F_DX], ax
    pop  ax
    mov  [bp+F_CX], ax
    pop  ax
    mov  [bp+F_AX], ax
    ret
d_media endp

;-----------------------------------------------------------------------------
d_read proc near
    mov  ah, FDC_READ
    mov  al, DMA_TO_MEM
    mov  si, ax
    call fd_xfer
    ret
d_read endp

d_write proc near
    mov  ah, FDC_WRITE
    mov  al, DMA_FROM_MEM
    mov  si, ax
    call fd_xfer
    ret
d_write endp

d_verify proc near
    ; The controller really does READ the sectors; the 8237 is put in verify
    ; mode, where it runs its counters and drives no bus cycle at all, so
    ; ES:BX is never written and never even read. What that proves is that
    ; the sectors EXIST and are addressable at the CHS given.
    ;
    ; It does not prove they are intact. A real controller checks each data
    ; field's CRC and reports it in ST1; src/upd765.js computes no CRC and
    ; says so, so ST1's data-error bit can never set here and a verify of a
    ; corrupt sector passes. fd_status still tests for that bit: this driver
    ; is written against the chip, not against the model of it.
    mov  ah, FDC_READ
    mov  al, DMA_VERIFY
    mov  si, ax
    call fd_xfer
    ret
d_verify endp

;-----------------------------------------------------------------------------
; AH=00h -- reset the disk system.
;
; The real thing: a pulse on the controller's reset line, the four
; ready-change statuses it owes the host afterwards drained, and SPECIFY
; reloaded -- a reset clears the timings AND the non-DMA bit.
;
; IT DOES NOT RECALIBRATE, and the reason is the motor. A drive whose spindle
; is stopped cannot step its head anywhere, and a reset is not an access:
; nothing here has started a motor or waited for one to come up to speed. So
; the reset records that every head's position is now unknown -- fd_reset
; clears the per-drive bits in 0040:003E -- and the next transfer homes them
; with the motor running, which is where the wait for it already lives.
;
; That is also what the real BIOS does, for the same reason, and it is why
; 0040:003E has one bit per drive rather than a single flag.
;-----------------------------------------------------------------------------
d_reset proc near
    mov  dl, [bp+F_DL]
    test dl, 80h
    jnz  dr_nohd
    mov  byte ptr [BDA_MEDIA], MEDIA_UNKNOWN    ; probe the medium again
    call fd_reset
    jc   dr_out
    xor  al, al
dr_out:
    ret
dr_nohd:
    mov  al, DSK_BADCMD
    ret
d_reset endp

;-----------------------------------------------------------------------------
; AH=08h -- drive parameters. Configuration, not controller traffic, so it is
; answered from the diskette parameter table rather than from the drive. The
; geometry is the 360K five-and-a-quarter format the equipment word implies:
; 40 cylinders, 2 heads, 9 sectors per track.
;   CH = last cylinder number (39)
;   CL = sectors per track in bits 0-5, cylinder bits 8-9 in bits 6-7
;   DH = last head number (1)
;   DL = number of drives attached
;   ES:DI -> the diskette parameter table
;-----------------------------------------------------------------------------
d_params proc near
    cmp  byte ptr [bp+F_DL], 80h
    jae  dp_nohd
    ; The cylinder count is the one number the table has no field for, so it
    ; comes from the detected type. AH=08h does NOT probe: it stays
    ; configuration rather than controller traffic, and answers what the BIOS
    ; currently believes -- 360K until a transfer has looked.
    mov  al, 39
    cmp  byte ptr [BDA_MEDIA], MEDIA_360K
    jbe  dp_cyl
    mov  al, 79
dp_cyl:
    mov  [bp+F_CH], al
    mov  al, 4
    call dpt_byte           ; the same EOT the driver sends the
    mov  [bp+F_CL], al                  ; controller, so they cannot drift
    mov  byte ptr [bp+F_DH], 1
    mov  byte ptr [bp+F_DL], 1
    mov  word ptr [bp+F_ES], ROM_SEG
    mov  word ptr [bp+F_DI], offset dpt
    xor  al, al
    ret
dp_nohd:
    ; A hard disk was asked about. There is no fixed disk of any kind, and
    ; saying so is a service: a program that gets a plausible geometry back
    ; goes on to read a disk that does not exist.
    mov  byte ptr [bp+F_DL], 0
    mov  al, DSK_BADCMD
    ret
d_params endp

;-----------------------------------------------------------------------------
; AH=15h -- drive type. 00h no drive, 01h floppy without a change line, 02h
; floppy with one, 03h fixed disk. One drive at DL=0, nothing else.
;
; 01h and not 02h, even though 3F7h answers the change line here: the XT card
; this ROM is written for does not decode 3F7h at all (src/upd765.js models
; the AT behaviour and says so), so claiming a change line would promise a
; caller something the card cannot deliver.
;-----------------------------------------------------------------------------
d_type proc near
    cmp  byte ptr [bp+F_DL], 0
    jne  dt_none
    mov  byte ptr [bp+F_AH], 01h
    xor  al, al
    ret
dt_none:
    mov  byte ptr [bp+F_AH], 00h
    xor  al, al
    ret
d_type endp

;=============================================================================
;
;   T H E   F L O P P Y   D R I V E R
;
; A uPD765 on an XT card at 3F0h-3F7h, an 8237 at 00h-0Fh with its page latch
; at 80h-8Fh, and DMA channel 2 between them. This is the code the header of
; this file used to call HOLE: FDC.
;
;-----------------------------------------------------------------------------
; THE HANDSHAKE IS THE DRIVER. Everything else here is bookkeeping.
;
; Firmware never "calls" this controller. It watches two bits of the main
; status register at 3F4h and lets them say what to do next: RQM means the
; data register is ready for one byte, DIO means which way that byte goes --
; set is controller-to-host, clear is host-to-controller. BOTH have to agree
; with the access about to be made, BEFORE it is made.
;
; Getting it wrong does not fault. Writing 3F5h while the controller is
; talking is dropped on the floor by the silicon; reading it while the
; controller is listening returns the bus pull-ups, 0FFh, and advances
; nothing. Neither reports anything anywhere. The command that comes out
; wrong is the NEXT one, whose first byte was swallowed as the tail of this
; one -- which is why a floppy driver that skips the poll works until it
; doesn't, and why the failure never points at the place that caused it.
;
; So every single byte in either direction goes through fd_send or fd_recv,
; and the result phase is drained to the end through fd_results.
;
;-----------------------------------------------------------------------------
; WHY THIS IS A DMA DRIVER AND NOT A PIO ONE.
;
; The chip supports both. The non-DMA mode selected by the ND bit of SPECIFY
; raises RQM in the execution phase and lets the CPU move all 512 bytes
; through 3F5h itself, which needs no 8237 at all -- and an XT does not do
; that, because the CPU cannot keep up with a 250 kbit/s data stream while
; also servicing the timer. The 8237 exists for exactly this transfer.
;
; So SPECIFY here sends ND=0 (from the diskette parameter table's second
; byte), the 8237's channel 2 is programmed before the command goes out, and
; the CPU does nothing during the execution phase except wait for IRQ6.
;
; THE MACHINE MUST HAVE BOTH CHIPS WIRED TOGETHER. On a machine whose FDC
; config does not name an 8237, src/upd765.js falls back to non-DMA mode on
; its own: the execution phase then raises RQM and waits for a host that is
; not coming, no interrupt is ever generated, and this driver times out and
; resets the controller. That is the correct failure -- it is visible, it is
; bounded, and it names itself as a timeout rather than hanging the machine.
;
;-----------------------------------------------------------------------------
; ALL OF THESE ROUTINES ASSUME DS = 0040h, the BIOS data area, because they
; are only ever reached from INT 13h and INT 13h sets it. They clobber AX
; freely and return their status in AL with CF; INT 13h's own frame holds
; everything the caller gave us.
;=============================================================================

;-----------------------------------------------------------------------------
; fd_send -- hand one byte to the controller. AL = the byte.
; Returns CF=1 if the controller never became ready to take it.
;-----------------------------------------------------------------------------
fd_send proc near
    push ax
    push cx
    push dx
    mov  ah, al                 ; the byte, out of the way of the poll
    mov  dx, PORT_FDC_MSR
    mov  cx, FD_POLLS
fdsnd_poll:
    in   al, dx
    and  al, MSR_RQM+MSR_DIO
    cmp  al, MSR_RQM            ; ready, AND facing host -> controller
    je   fdsnd_go
    loop fdsnd_poll
    stc
    jmp  fdsnd_out
fdsnd_go:
    mov  al, ah
    mov  dx, PORT_FDC_DATA
    out  dx, al
    clc
fdsnd_out:
    ; POP does not touch the flags, so the carry set above survives this.
    pop  dx
    pop  cx
    pop  ax
    ret
fd_send endp

;-----------------------------------------------------------------------------
; fd_results -- drain the result phase into 0040:0042.
;
; EVERY RESULT BYTE MUST BE READ. The controller stays busy -- CB set, no new
; command accepted -- until the host has taken the last one. A driver that
; reads the three status registers and walks away does not break the command
; it just issued; it breaks the NEXT one, whose first byte is consumed as the
; tail of this result phase. The symptom appears one operation later, in a
; different function, and looks like anything but this.
;
; The length is not assumed. Bytes are taken for as long as the main status
; register says the controller is still talking, and NDM is included in the
; test so that a non-DMA execution phase -- which also shows RQM and DIO --
; cannot be mistaken for a result phase and read as status. Seven is the
; longest result any command used here has, and it is the cap.
;
; Returns CF=1 if the controller is STILL busy afterwards, which means it is
; holding bytes nobody asked for.
;-----------------------------------------------------------------------------
fd_results proc near
    push ax
    push bx
    push cx
    push dx
    ; Zero the block first. A short result phase would otherwise leave the
    ; PREVIOUS command's bytes in place, and a caller decoding ST1 would be
    ; decoding a status that belongs to something else -- most likely a
    ; success, since the last thing to run was probably fine.
    mov  bx, BDA_FDCRESULT
    mov  cx, 7
    xor  al, al
fdres_clear:
    mov  [bx], al
    inc  bx
    loop fdres_clear

    mov  bx, BDA_FDCRESULT
    mov  cx, 7
fdres_loop:
    mov  dx, PORT_FDC_MSR
    in   al, dx
    and  al, MSR_CB+MSR_NDM+MSR_RQM+MSR_DIO
    cmp  al, MSR_CB+MSR_RQM+MSR_DIO
    jne  fdres_drained
    mov  dx, PORT_FDC_DATA
    in   al, dx
    mov  [bx], al
    inc  bx
    loop fdres_loop
fdres_drained:
    mov  dx, PORT_FDC_MSR
    in   al, dx
    test al, MSR_CB
    jnz  fdres_stuck
    clc
    jmp  fdres_out
fdres_stuck:
    stc
fdres_out:
    pop  dx
    pop  cx
    pop  bx
    pop  ax
    ret
fd_results endp

;-----------------------------------------------------------------------------
; fd_armint / fd_waitint -- the two halves of waiting for IRQ6.
;
; The flag is cleared BEFORE the command is issued, not after it completes.
; Clearing it on arrival would be a race with a controller that answered
; before the driver got back to look, which -- since a command here finishes
; inside the OUT that delivers its last byte -- is every single time.
;
; fd_waitint returns CF=1 if the interrupt never came. It counts polls, not
; ticks: the tick only advances if IRQ0 is being delivered, and waiting for a
; dead controller by watching a clock that may also be dead turns a bounded
; failure into a hung machine.
;-----------------------------------------------------------------------------
fd_armint proc near
    and  byte ptr [BDA_SEEKSTAT], 7Fh
    ret
fd_armint endp

fd_waitint proc near
    push cx
    mov  cx, FD_POLLS
fdwi_poll:
    test byte ptr [BDA_SEEKSTAT], 80h
    jnz  fdwi_got
    loop fdwi_poll
    stc
    jmp  fdwi_out
fdwi_got:
    and  byte ptr [BDA_SEEKSTAT], 7Fh
    clc
fdwi_out:
    pop  cx
    ret
fd_waitint endp

;-----------------------------------------------------------------------------
; fd_select -- drive select, motor on, controller awake, DMA and IRQ gated.
; DL = drive.
;
; The digital output register is WRITE ONLY on an XT card: reading 3F2h gets
; the floating bus, 0FFh. So the byte is composed from scratch every time.
; A driver that reads it, sets one bit and writes it back turns on all four
; motors, selects drive 3 and holds the controller in reset -- and does it
; without a single error anywhere.
;
; BIT 3 IS THE ONE THAT IS FORGOTTEN. It gates both DRQ and the interrupt
; onto the bus. With it clear the 8237 never sees a request, the transfer
; overruns, and IRQ6 never arrives.
;-----------------------------------------------------------------------------
fd_select proc near
    push ax
    push cx
    push dx
    mov  cl, dl
    and  cl, 3
    mov  al, DOR_MOTOR0
    shl  al, cl                 ; this drive's motor enable
    or   al, cl                 ; ...and the select lines pointing at it
    or   al, DOR_NRESET+DOR_DMAEN
    mov  dx, PORT_FDC_DOR
    out  dx, al
    pop  dx
    pop  cx
    pop  ax
    ret
fd_select endp

;-----------------------------------------------------------------------------
; fd_spinup -- wait for the motor to reach speed. DL = drive.
;
; The delay comes from the diskette parameter table's motor-start byte, which
; is in EIGHTHS OF A SECOND. The only clock here is the 18.2065 Hz tick, so
; ticks = eighths * 18.2065 / 8, near enough eighths*2 + 1.
;
; WHY WAIT AT ALL. src/upd765.js models no spin-up, no rotational latency and
; no index pulse: a read from a drive whose motor is off SUCCEEDS there. So
; the only thing this wait can do on this machine is cost time. It is here
; because a driver that works only because the model is instant documents
; nothing about the hardware it claims to drive -- and because the motor-off
; countdown in INT 08h is one half of a pair whose other half is this. Remove
; the wait and the countdown is decoration.
;
; It is SKIPPED when the motor was already running, which is the same test
; real hardware makes and is why a run of reads pays for it once.
;
; THE CLOCK MIGHT NOT BE RUNNING. The loop gives up if the tick count does
; not change at all within a bounded number of polls, rather than waiting
; forever on a machine whose only fault is having no 8254.
;-----------------------------------------------------------------------------
fd_spinup proc near
    push ax
    push bx
    push cx
    push dx
    push si
    mov  cl, dl
    and  cl, 3
    mov  bh, 1
    shl  bh, cl                 ; this drive's bit in 0040:003F
    test [BDA_MOTORSTAT], bh
    jnz  fdsu_out               ; already up to speed
    or   [BDA_MOTORSTAT], bh

    mov  al, 10
    call dpt_byte           ; motor start time, in eighths of a second
    xor  ah, ah
    shl  ax, 1
    inc  ax
    add  ax, [BDA_TICKS]
    mov  bx, ax                 ; the tick to stop at
fdsu_wait:
    mov  si, [BDA_TICKS]
    mov  cx, FD_POLLS
fdsu_poll:
    mov  ax, [BDA_TICKS]
    cmp  ax, si
    jne  fdsu_moved
    loop fdsu_poll
    jmp  fdsu_out               ; the clock is stopped: do not hang on it
fdsu_moved:
    sub  ax, bx                 ; signed, because the counts are close
    js   fdsu_wait
fdsu_out:
    pop  si
    pop  dx
    pop  cx
    pop  bx
    pop  ax
    ret
fd_spinup endp

;-----------------------------------------------------------------------------
; fd_reset -- pulse the controller's reset line and put it back to work.
; DL = drive. Returns CF=1 with a status in AL.
;
; COMING OUT OF RESET THE CHIP OWES THE HOST FOUR ANSWERS. It raises its
; interrupt once and then queues a ready-change status per drive -- C0h, C1h,
; C2h, C3h -- to be collected by four SENSE INTERRUPT STATUS commands. Sense
; it once and three stay queued; the next command's SENSE INTERRUPT then
; reports a stale drive's status instead of its own, and the seek that
; follows is validated against the wrong answer.
;
; SPECIFY HAS TO FOLLOW. A reset clears the step-rate and head timings and,
; more importantly, the ND bit -- so a controller that has just been reset
; would run its next execution phase in non-DMA mode with nobody moving the
; bytes. The values come from the diskette parameter table so that INT 1Eh
; and the controller cannot drift apart.
;-----------------------------------------------------------------------------
fd_reset proc near
    push bx
    push cx
    push dx
    mov  bl, dl
    and  bl, 3

    ; Everything drops: motors, select lines and the DMA gate. Nothing that
    ; was true about the controller is true afterwards, so the software's
    ; idea of it is cleared to match rather than left to be discovered wrong.
    mov  byte ptr [BDA_MOTORSTAT], 0
    mov  byte ptr [BDA_SEEKSTAT], 0
    mov  byte ptr [BDA_MOTORCNT], 0
    call fd_armint
    mov  dx, PORT_FDC_DOR
    xor  al, al
    out  dx, al
    ; ...and back out of reset, drive selected, DRQ and IRQ gated on. The
    ; chip raises IRQ6 as it comes out. Motors stay off: a reset is not an
    ; access, and 0040:003F above now agrees.
    mov  al, bl
    or   al, DOR_NRESET+DOR_DMAEN
    out  dx, al
    call fd_waitint
    jc   fdrst_dead

    mov  cx, 4
fdrst_sense:
    mov  al, FDC_SENSEI
    call fd_send
    jc   fdrst_dead
    call fd_results             ; two bytes: ST0 and the present cylinder
    jc   fdrst_dead
    loop fdrst_sense

    mov  al, FDC_SPECIFY
    call fd_send
    jc   fdrst_dead
    mov  al, 0
    call dpt_byte           ; step rate and head unload time
    call fd_send
    jc   fdrst_dead
    mov  al, 1
    call dpt_byte           ; head load time, and ND in bit 0 -- CLEAR,
    call fd_send                ; which is what puts the execution phase on
    jc   fdrst_dead             ; the 8237 instead of on the CPU
    ; SPECIFY has NO result phase and raises NO interrupt. Draining one here
    ; would take the first byte of whatever command comes next.
    ;
    ; The controller is now initialised, and that is recorded separately from
    ; where the heads are -- which is still unknown, and deliberately so.
    or   byte ptr [BDA_SEEKSTAT], SEEK_READY
    clc
    jmp  fdrst_out
fdrst_dead:
    mov  al, DSK_TIMEOUT
    stc
fdrst_out:
    pop  dx
    pop  cx
    pop  bx
    ret
fd_reset endp

;-----------------------------------------------------------------------------
; fd_recal -- step the head to track 0. DL = drive. CF=1 with AL = status.
;
; RECALIBRATE gives up after 77 step pulses. That is a fact about the chip
; and not about the drive: a head parked past cylinder 77 comes only part of
; the way home and reports EQUIPMENT CHECK. Forty-cylinder media cannot get
; there, so one pass is enough here -- an 80-track drive needs two, and that
; is the whole reason BIOSes for those issue it twice.
;
; THERE IS NO RESULT PHASE. The host has to ask with SENSE INTERRUPT STATUS,
; and that ask is also what clears the drive's seek-mode bit in the main
; status register. Skip it and MSR bit 0 stays set for the rest of time.
;-----------------------------------------------------------------------------
fd_recal proc near
    push bx
    push cx
    call fd_armint
    mov  al, FDC_RECAL
    call fd_send
    jc   fdrc_dead
    mov  al, dl
    and  al, 3
    call fd_send
    jc   fdrc_dead
    call fd_waitint
    jc   fdrc_dead
    mov  al, FDC_SENSEI
    call fd_send
    jc   fdrc_dead
    call fd_results
    jc   fdrc_dead

    mov  al, [BDA_FDCRESULT]    ; ST0
    test al, 0C0h               ; interrupt code: 00 is a normal completion
    jnz  fdrc_bad
    test al, 20h                ; SE, seek end -- set by any completed seek
    jz   fdrc_bad
    ; The head is now known to be at cylinder 0, which is the only thing that
    ; makes the SEEK after it mean anything.
    mov  cl, dl
    and  cl, 3
    mov  bl, 1
    shl  bl, cl
    or   [BDA_SEEKSTAT], bl
    clc
    jmp  fdrc_out
fdrc_bad:
    mov  al, DSK_SEEKFAIL
    stc
    jmp  fdrc_out
fdrc_dead:
    mov  al, DSK_TIMEOUT
    stc
fdrc_out:
    pop  cx
    pop  bx
    ret
fd_recal endp

;-----------------------------------------------------------------------------
; fd_seek -- move the head. DL = drive, DH = head, CH = cylinder.
; CF=1 with AL = status.
;
; THE CONTROLLER DOES NOT SEEK FOR A READ. READ DATA compares the C in its
; command against the ID field under the head and fails with no-data plus
; wrong-cylinder if they differ; it does not helpfully step there. So this
; is not an optimisation that can be skipped when the cylinder "looks right".
;
; PCN IS CHECKED. The second result byte of SENSE INTERRUPT STATUS is the
; chip's own step counter. If it does not agree with the cylinder that was
; asked for, the head is not where this driver thinks it is -- and the read
; that follows would come off the wrong track and report a perfectly normal
; status, because from the controller's point of view nothing went wrong.
;-----------------------------------------------------------------------------
fd_seek proc near
    push cx
    call fd_armint
    mov  al, FDC_SEEK
    call fd_send
    jc   fdsk_dead
    ; HDS: head in bit 2, drive in bits 0-1.
    mov  al, dh
    and  al, 1
    shl  al, 1
    shl  al, 1
    mov  ah, dl
    and  ah, 3
    or   al, ah
    call fd_send
    jc   fdsk_dead
    mov  al, ch                 ; NCN, the cylinder to step to
    call fd_send
    jc   fdsk_dead
    call fd_waitint
    jc   fdsk_dead
    mov  al, FDC_SENSEI
    call fd_send
    jc   fdsk_dead
    call fd_results
    jc   fdsk_dead

    mov  al, [BDA_FDCRESULT]    ; ST0
    test al, 0C0h
    jnz  fdsk_bad
    test al, 20h                ; SE
    jz   fdsk_bad
    mov  al, [BDA_FDCRESULT+1]  ; PCN
    cmp  al, ch
    jne  fdsk_bad
    clc
    jmp  fdsk_out
fdsk_bad:
    mov  al, DSK_SEEKFAIL
    stc
    jmp  fdsk_out
fdsk_dead:
    mov  al, DSK_TIMEOUT
    stc
fdsk_out:
    pop  cx
    ret
fd_seek endp

;-----------------------------------------------------------------------------
; fd_status -- decode ST0/ST1/ST2 into the status byte INT 13h returns.
; CF=0 and AL=0 on a normal completion, else CF=1 and AL = the code.
;
; THE ORDER OF THE TESTS IS THE ORDER OF SPECIFICITY. ST0 only says THAT the
; command ended abnormally; ST1 and ST2 say what happened. Decoding ST0 first
; would report a write-protected disk, a missing sector and a CRC error as
; the same failure, and the caller would retry all three.
;-----------------------------------------------------------------------------
fd_status proc near
    mov  al, [BDA_FDCRESULT]    ; ST0
    test al, 0C0h
    jz   fdst_ok
    ; ST0 bit 3: the drive never came ready. On this machine that means the
    ; drive is empty -- see the note in src/upd765.js about the XT strapping
    ; READY permanently active, which this model deliberately does not do.
    test al, 08h
    jnz  fdst_timeout

    mov  al, [BDA_FDCRESULT+1]  ; ST1
    test al, 02h                ; NW, not writable
    jnz  fdst_wrprot
    ; DE and MA below are decoded from the DATASHEET, not from what
    ; src/upd765.js can produce. That model computes no CRC, so it can never
    ; set DE, and it only sets MA together with ST0's not-ready bit, which is
    ; caught above -- so on THIS machine neither branch is reachable through
    ; the controller. They are still here, and they are still tested (by
    ; staging result bytes and calling this routine directly), because the
    ; driver is written against the chip: a model that grows a CRC layer, or
    ; a real uPD765, sets both, and a driver that folded them into
    ; "controller failure" would then report a scratched disk as broken
    ; hardware.
    test al, 20h                ; DE, CRC error in an ID or data field
    jnz  fdst_crc
    test al, 10h                ; OR, the host or the 8237 did not keep up
    jnz  fdst_overrun
    test al, 04h                ; ND, the sector was not on the track
    jnz  fdst_notfound
    test al, 01h                ; MA, no address mark at all
    jnz  fdst_badmark
    ; ST1 bit 7, EN: the controller ran off the end of the cylinder without
    ; ever being told to stop. It is not a fault of the medium, and it has
    ; exactly two causes. Either the caller asked for more sectors than
    ; remain on the cylinder -- a uPD765 stops at the last sector of a
    ; cylinder and will not step to the next one, which is why every DOS
    ; block driver, ours included, splits its requests -- or the DMA byte
    ; count and the sector count disagreed so terminal count never arrived,
    ; which is a bug in this file. Neither is a disk error, and reporting one
    ; would send the caller to look at the disk.
    test al, 80h
    jnz  fdst_ctrl
    ; ST2 holds nothing ST1 has not already covered for the commands issued
    ; here, so anything still set is unaccounted for and says so rather than
    ; being given the nearest plausible code.
fdst_ctrl:
    mov  al, DSK_CTRLFAIL
    jmp  fdst_bad
fdst_timeout:
    mov  al, DSK_TIMEOUT
    jmp  fdst_bad
fdst_wrprot:
    mov  al, DSK_WRPROT
    jmp  fdst_bad
fdst_crc:
    mov  al, DSK_BADCRC
    jmp  fdst_bad
fdst_overrun:
    mov  al, DSK_DMAOVER
    jmp  fdst_bad
fdst_notfound:
    mov  al, DSK_NOTFOUND
    jmp  fdst_bad
fdst_badmark:
    mov  al, DSK_BADMARK
fdst_bad:
    stc
    ret
fdst_ok:
    mov  al, DSK_OK
    clc
    ret
fd_status endp

;-----------------------------------------------------------------------------
; fd_xfer -- read, write or verify sectors. The whole of INT 13h AH=02h/03h/04h.
;
; ENTRY  SI  = the uPD765 opcode in the high half, the 8237 mode byte in the
;              low half. Those two bytes are the ONLY difference between the
;              three functions.
;        BP  = INT 13h's frame, holding the caller's AL/CH/CL/DH/DL/ES/BX.
;        DS  = 0040h.
; EXIT   CF=0, or CF=1 with the status in AL.
;-----------------------------------------------------------------------------
fd_xfer proc near
    jmp  fdx_begin

    ; The three refusals that happen BEFORE anything is touched -- no port
    ; written, no motor started, no controller state disturbed. They sit at
    ; the top of the routine because that is where their callers are and an
    ; 8086 conditional jump reaches 127 bytes.
fdx_badcmd:
    mov  al, DSK_BADCMD
    stc
    ret
fdx_notready:
    mov  al, DSK_TIMEOUT
    stc
    ret
fdx_boundary:
    mov  al, DSK_BOUNDARY
    stc
    ret

fdx_begin:
    ;-- what the controller cannot be asked -------------------------------
    mov  al, [bp+F_DL]
    test al, 80h
    jnz  fdx_badcmd             ; a fixed disk. There is not one, and AH=08h
                                ; already said so; inventing a geometry here
                                ; would send the caller off to read it.
    and  al, 3
    jnz  fdx_notready           ; drive 1-3: the equipment word says one drive
    mov  al, [bp+F_AL]
    or   al, al
    jz   fdx_badcmd             ; a transfer of no sectors is not a transfer

    ;-- the physical address the 8237 will drive --------------------------
    ; It is ES*16+BX, twenty bits split across two chips that CANNOT CARRY
    ; INTO ONE ANOTHER: sixteen in the 8237's own counter and four in a
    ; separate latch. So it is worked out here the way the hardware puts it
    ; together -- a page and an offset, concatenated, never added.
    mov  ax, [bp+F_ES]
    mov  dx, ax
    mov  cl, 4
    shl  ax, cl                 ; the low sixteen bits of ES*16
    mov  cl, 12
    shr  dx, cl                 ; ...and its top four: bits 16-19 of ES*16 are
                                ; bits 12-15 of ES, which is TWELVE places
                                ; right and not four. Four is the shift that
                                ; makes the address, not the shift that
                                ; extracts the page out of it, and getting it
                                ; wrong puts a page number of ES>>4 in the
                                ; latch -- pointing the transfer at a random
                                ; megabyte while the offset stays right.
    add  ax, [bp+F_BX]
    adc  dx, 0                  ; the carry BX makes belongs to the PAGE, and
                                ; this is the only place it is ever allowed to
                                ; cross between them

    ;-- the byte count, and the 64K boundary ------------------------------
    ; The 8237's word count register is N-1: programming 511 moves 512 bytes.
    mov  bl, [bp+F_AL]
    xor  bh, bh
    cmp  bx, 128
    ja   fdx_boundary           ; over 64K cannot be one transfer at all
    mov  cl, 9
    shl  bx, cl                 ; sectors * 512. 128 sectors wraps to 0...
    dec  bx                     ; ...and 0-1 is FFFFh, which is right: 65536

    ; THE ERRATUM THIS REFUSES. The 8237 increments SIXTEEN bits and stops.
    ; FFFFh+1 is 0000h in the SAME page, because there is no wire from the
    ; counter to the page latch to carry on. A transfer that runs off the end
    ; of a page therefore wraps to the BOTTOM of that page and overwrites
    ; what it has just put there -- with no error from the 8237, no error
    ; from the controller, and a normal-looking result phase. The caller gets
    ; a buffer holding the tail of its read where the head should be.
    ;
    ; Refusing is the documented answer and it is the only one available: the
    ; hardware cannot be told to do anything else. AH=09h means exactly this
    ; and nothing else, so a caller that wants the transfer splits it and
    ; asks again.
    mov  di, ax
    add  di, bx
    jc   fdx_boundary

    ;-- only NOW is the medium worth probing ------------------------------
    ; d_media runs a transfer of its own, so it cannot go any earlier: every
    ; refusal above this line is documented to cost nothing to undo, and
    ; test/bios-fdc.test.mjs proves it by watching the 8237's count register
    ; across a request that straddles a page. Probing from the dispatcher
    ; programmed the channel before the boundary refusal and broke exactly
    ; that assertion -- which is the test doing its job.
    ;
    ; The nested transfer clobbers the address, the count and the command
    ; bytes in SI, all of which are already worked out, so they go on the
    ; stack around it.
    push ax
    push bx
    push dx
    push si
    call d_media
    pop  si
    pop  dx
    pop  bx
    pop  ax

    ;-- arm the 8237 BEFORE the controller is told to start ---------------
    ; The uPD765 starts asserting DRQ inside the OUT that delivers the last
    ; byte of READ DATA. If the channel is not armed by then, the first byte
    ; of the sector is requested from a masked channel, the request is
    ; refused, and the controller takes the refusal for terminal count and
    ; ends the command normally having moved nothing at all.
    ;
    ; The channel is MASKED while it is reprogrammed, and that is not
    ; tidiness either: the address and the count are each written as two
    ; halves sequenced by ONE flip-flop shared by the entire chip, so a
    ; request serviced between the halves would run at half an address.
    mov  di, ax                 ; the offset, out of the way of the port writes
    mov  al, DMA_MASK2
    out  PORT_DMA_MASK, al
    xor  al, al
    out  PORT_DMA_FF, al        ; resynchronise the shared flip-flop. Every
                                ; real driver does this and it is why: the
                                ; flip-flop is chip-wide, and whatever touched
                                ; a 16-bit register last may have left it
                                ; pointing at the high half.
    mov  ax, si
    out  PORT_DMA_MODE, al      ; the mode byte -- SI's low half
    mov  ax, di
    out  PORT_DMA_ADDR, al      ; address, low half...
    mov  al, ah
    out  PORT_DMA_ADDR, al      ; ...then high, sequenced by the flip-flop
    mov  al, dl
    out  PORT_DMA_PAGE, al      ; A16-A19, in the latch with no carry in
    mov  ax, bx
    out  PORT_DMA_CNT, al
    mov  al, ah
    out  PORT_DMA_CNT, al
    mov  al, DMA_UNMASK2
    out  PORT_DMA_MASK, al

    ;-- the drive ---------------------------------------------------------
    mov  dl, [bp+F_DL]
    and  dl, 3
    mov  cl, dl
    mov  bl, 1
    shl  bl, cl                 ; this drive's bit in 0040:003E

    ; A DRIVE THAT IS NOT MARKED HOMED MEANS THE CONTROLLER IS NOT KNOWN
    ; EITHER, and the reset here is for the controller, not the head.
    ;
    ; The chip powers up held in reset by a DOR of zero. The FIRST write that
    ; raises bit 2 takes it out, and a uPD765 leaving reset raises IRQ6 once
    ; and then queues FOUR ready-change statuses -- one per drive -- waiting
    ; to be collected. Until they are collected the interrupt request stays
    ; asserted, and an asserted line produces no further EDGE: the 8259 is
    ; edge triggered, so the recalibrate that follows completes, raises
    ; nothing the PIC can see, and the driver waits for an interrupt that has
    ; in a real sense already happened. One timeout, on the first access, on
    ; a machine where everything is wired correctly.
    ;
    ; So the controller gets its own bit, and this is the check on it. It is
    ; separate from the per-drive homed bits because the two facts are
    ; separate: AH=00h leaves the controller initialised and every head's
    ; position unknown, and conflating them would make an explicit reset
    ; cause a second one on the very next read.
    ;
    ; The reset is done BEFORE the motor starts, so that its own clearing of
    ; 0040:003F cannot throw away a spin-up that has just been paid for.
    test byte ptr [BDA_SEEKSTAT], SEEK_READY
    jnz  fdx_awake
    call fd_reset
    jnc  fdx_awake
fdx_giveup:
    ; fd_reset, fd_recal and fd_seek have already put their status in AL. The
    ; near JMP is the jump-range fix again; the countdown is restarted on the
    ; way out so a failed access leaves the motor on a timer, not on for ever.
    jmp  fdx_fail
fdx_awake:

    ; The motor countdown is pinned at its maximum for the duration. INT 08h
    ; decrements it every tick and switches the motor OFF at zero, and a
    ; countdown left over from the previous access can expire in the middle
    ; of this one -- stopping the spindle mid-transfer, for no reason a
    ; single line of this routine would show.
    mov  byte ptr [BDA_MOTORCNT], FD_BUSY
    mov  dl, [bp+F_DL]
    and  dl, 3
    call fd_select
    call fd_spinup

    ; And now the head. SEEK is relative to the chip's count of the steps it
    ; has issued, not to anything it can measure, so until the head has been
    ; driven onto the track-0 sensor once the chip's count means nothing.
    mov  dl, [bp+F_DL]
    and  dl, 3
    mov  cl, dl
    mov  bl, 1
    shl  bl, cl
    test [BDA_SEEKSTAT], bl
    jnz  fdx_homed
    call fd_recal
    jc   fdx_giveup
fdx_homed:

    mov  ch, [bp+F_CH]          ; cylinder
    mov  dh, [bp+F_DH]          ; head
    mov  dl, [bp+F_DL]
    and  dl, 3
    call fd_seek
    jc   fdx_giveup

    ;-- the command -------------------------------------------------------
    ; Nine bytes, every one of them through the RQM/DIO handshake. A
    ; controller that stops answering part way through leaves the FIFO
    ; holding half a command, so every send is checked -- and they all land
    ; here first, because eleven checks spread over sixty bytes of code
    ; cannot all reach one exit that is further than 127 bytes away.
    call fd_armint
    jmp  fdx_cmd
fdx_lost:
    jmp  fdx_dead
fdx_cmd:
    mov  ax, si
    mov  al, ah                 ; the uPD765 opcode -- SI's high half
    call fd_send
    jc   fdx_lost
    mov  al, [bp+F_DH]          ; HDS: head in bit 2, drive in bits 0-1
    and  al, 1
    shl  al, 1
    shl  al, 1
    mov  ah, [bp+F_DL]
    and  ah, 3
    or   al, ah
    call fd_send
    jc   fdx_lost
    mov  al, [bp+F_CH]          ; C -- the cylinder in the ID field
    call fd_send
    jc   fdx_lost
    mov  al, [bp+F_DH]          ; H -- and it must agree with HDS above, or
    and  al, 1                  ; the ID field will not match
    call fd_send
    jc   fdx_lost
    mov  al, [bp+F_CL]          ; R -- SECTORS ARE 1-BASED. Bits 6-7 of CL are
    and  al, 3Fh                ; the cylinder's high bits on a hard disk;
    call fd_send                ; a forty-cylinder floppy cannot reach them.
    jc   fdx_lost
    mov  al, 3
    call dpt_byte           ; N -- the size code, 2 = 512 bytes
    call fd_send
    jc   fdx_lost
    mov  al, 4
    call dpt_byte           ; EOT -- the last sector number on a track.
    call fd_send                ; The controller stops here if terminal count
    jc   fdx_lost               ; never arrives, and says so with ST1 bit 7.
    mov  al, 5
    call dpt_byte           ; GPL -- the gap between sectors
    call fd_send
    jc   fdx_lost
    mov  al, 6
    call dpt_byte           ; DTL -- only meaningful when N is zero
    call fd_send
    jc   fdx_lost

    ;-- the execution phase -----------------------------------------------
    ; Nothing to do. The controller asserts DRQ, the 8237 moves each byte
    ; between the disk and memory, and terminal count -- the borrow out of
    ; the word counter -- reaches the controller's TC pin and ends the
    ; command. The CPU's only job is to wait for IRQ6 and then read the
    ; result phase, which is the entire argument for using DMA.
    call fd_waitint
    jc   fdx_lost
    call fd_results
    jc   fdx_lost

    ;-- and afterwards ----------------------------------------------------
    ; The countdown starts NOW, not before: it measures how long the motor
    ; keeps spinning after the drive goes idle. A second access inside the
    ; window finds the motor already up and skips the spin-up wait.
    mov  al, 2
    call dpt_byte
    mov  [BDA_MOTORCNT], al
    call fd_status
    jc   fdx_ret                ; the controller has already named a failure

    ;-- and the check no IBM BIOS makes -----------------------------------
    ; THE CONTROLLER CAN REPORT A PERFECTLY NORMAL COMPLETION FOR A TRANSFER
    ; IN WHICH NOTHING MOVED. It happens whenever the DMA channel is not
    ; really armed -- masked, mis-programmed, or wired to nothing: the first
    ; DRQ is refused, the uPD765 takes that refusal for terminal count, and
    ; ends the command normally. ST0, ST1 and ST2 are all zero. The only
    ; trace in the result phase is the sector number it would have done
    ; NEXT, which is the one it started on rather than the one after it --
    ; and no driver anywhere reads that byte.
    ;
    ; So the caller would get CF=0, AH=00h, and a buffer still holding
    ; whatever was in it before. A boot sector made of stale RAM. This is
    ; the worst failure mode a disk driver has, because every layer above
    ; it has been told the read worked.
    ;
    ; THE 8237 KNOWS. Bit 2 of its status register is channel 2's
    ; terminal-count latch: set by the borrow out of the word counter, which
    ; only happens if the counter actually ran. A transfer that moved
    ; nothing leaves it clear.
    ;
    ; The read CLEARS the latch, which is why this is the only place in the
    ; ROM that touches port 08h. AH=08h is the documented "DMA overrun"
    ; status and this is one: the transfer did not complete.
    in   al, PORT_DMA_STATUS
    test al, 04h
    jz   fdx_nomove
    xor  al, al
fdx_ret:
    ret
fdx_nomove:
    mov  al, DSK_DMAOVER
    stc
    ret

fdx_dead:
    ; The controller stopped answering part way through a command. It is now
    ; holding an unknown number of bytes of a command or a result phase, and
    ; the NEXT call would be read as their continuation. So the reset here is
    ; not housekeeping: it is what makes the next call mean anything at all.
    mov  al, 2
    call dpt_byte
    mov  [BDA_MOTORCNT], al
    mov  dl, [bp+F_DL]
    call fd_reset
    mov  al, DSK_TIMEOUT
    stc
    ret
fdx_fail:
    ; fd_recal and fd_seek have already put their status in AL.
    mov  ah, al
    mov  al, 2
    call dpt_byte
    mov  [BDA_MOTORCNT], al
    mov  al, ah
    stc
    ret
fd_xfer endp

;=============================================================================
; INT 19h -- bootstrap. The point of the whole exercise.
;
; Read cylinder 0, head 0, sector 1 of drive 0 into 0000:7C00, check that it
; ends in 55AAh, and jump to it. Nothing else: the boot sector is on its own
; from the first instruction, and everything it needs -- DL, the stack, DS and
; ES -- has to be right before the jump because it cannot ask afterwards.
;
; THE SIGNATURE CHECK IS NOT OPTIONAL. Without it a blank or data disk is
; "booted" and 512 bytes of whatever executes; the two-byte marker is the only
; thing standing between a formatted disk and a runaway.
;=============================================================================
int19:
    cli
    xor  ax, ax
    mov  ss, ax
    mov  sp, BOOT_OFF           ; the stack grows down from under the sector
    mov  ds, ax
    mov  es, ax
    sti

    mov  cx, 3                  ; three attempts, resetting in between --
                                ; a cold drive misses its first read often
                                ; enough that one attempt is a bug
boot_try:
    push cx
    mov  ax, 0201h              ; AH=02h read, AL=1 sector
    mov  cx, 0001h              ; CH=cylinder 0, CL=sector 1 (SECTORS ARE 1-BASED)
    mov  dx, 0000h              ; DH=head 0, DL=drive 0
    xor  bx, bx
    mov  es, bx
    mov  bx, BOOT_OFF           ; ES:BX = 0000:7C00
    int  13h
    pop  cx
    jnc  boot_loaded

    push cx                     ; failed: reset the disk system and try again
    xor  ax, ax
    xor  dx, dx
    int  13h
    pop  cx
    loop boot_try
    jmp  boot_none

boot_loaded:
    xor  ax, ax
    mov  es, ax
    cmp  word ptr es:[BOOT_OFF+510], 0AA55h
    jne  boot_nosig

    ; Hand over. DL carries the drive booted from -- DOS's own boot sector
    ; reads it and gets it wrong at its peril -- and DS/ES are zero.
    xor  ax, ax
    mov  ds, ax
    mov  es, ax
    mov  dl, 0
    ; ASSEMBLER WORKAROUND: `jmp far ptr` needs a named segment and emits a
    ; relocation a flat ROM image cannot carry, so the far jump is the three
    ; words a linker would have produced. EA = JMP FAR, then offset, then
    ; segment: 0000:7C00.
    db   0EAh
    dw   BOOT_OFF
    dw   BOOT_SEG

boot_nosig:
    mov  si, offset msg_nosig
    jmp  boot_stop
boot_none:
    mov  si, offset msg_nodisk
boot_stop:
    call puts
    ; A real BIOS calls INT 18h here to reach the ROM BASIC that is not on
    ; this machine either. Doing it anyway keeps the vector meaningful and
    ; gives anything that hooked INT 18h its chance.
    int  18h
boot_halt:
    sti                         ; leave interrupts ON: Ctrl-Alt-Del still works
    hlt
    jmp  boot_halt

;=============================================================================
; The small services, each of which is honest about being small.
;=============================================================================

; INT 05h -- print screen. Nothing here can print. Returning is correct
; behaviour for a machine with no printer; hanging or faulting is not.
int05:
    iret

; INT 15h -- the cassette interface, and on later machines everything else.
; AH=86h means "function not supported", which is the answer to all of it.
int15:
    PUSHALL
    mov  byte ptr [bp+F_AH], 86h
    or   word ptr [bp+F_FL], FL_CF
    POPALL
    iret

; INT 17h -- printer. The equipment word reports no parallel port, so the
; honest status is a timeout, and no port is touched to discover it.
int17:
    PUSHALL
    mov  byte ptr [bp+F_AH], 01h        ; bit 0 = timed out
    POPALL
    iret

; INT 18h -- what to do when there is nothing to boot. On an IBM machine this
; entered the BASIC in ROM. There is no ROM BASIC here and there will not be.
int18:
    mov  si, offset msg_nobasic
    call puts
int18_halt:
    sti
    hlt
    jmp  int18_halt

; INT 1Bh -- the Ctrl-Break hook. The keyboard handler does not raise it yet
; (Ctrl-Break is a scancode pair this keyboard interface cannot distinguish),
; so this exists to be hooked, not to be called.
int1b:
    iret

; The vector every unimplemented interrupt points at. An IRET and nothing
; else: a stray INT must be survivable, because the alternative is executing
; whatever the RAM at 0000:0000 powered up holding.
int_ignore:
    iret

;=============================================================================
; Tables and text.
;=============================================================================

; Which vectors get a real handler. Everything not here IRETs.
ivt_table:
    dw 05h
    dw int05
    dw 08h
    dw int08
    dw 09h
    dw int09
    dw 0Eh
    dw int0e
    dw 10h
    dw int10
    dw 11h
    dw int11
    dw 12h
    dw int12
    dw 13h
    dw int13
    dw 15h
    dw int15
    dw 16h
    dw int16
    dw 17h
    dw int17
    dw 18h
    dw int18
    dw 19h
    dw int19
    dw 1Ah
    dw int1a
    dw 1Bh
    dw int1b
    dw 1Ch
    dw int1c
    dw 0FFFFh                   ; end of table
    dw 0

; The CGA mode-control byte for modes 0-6, DERIVED from the register's bit
; assignments (see AH=00h above), not transcribed:
;   0  40x25 grey text : enable + blink + monochrome signal   = 08+20+04 = 2Ch
;   1  40x25 colour    : enable + blink                       = 08+20    = 28h
;   2  80x25 grey text : the above plus 80-column             = 2C+01    = 2Dh
;   3  80x25 colour    : enable + blink + 80-column           = 28+01    = 29h
;   4  320x200 colour  : enable + graphics                    = 08+02    = 0Ah
;   5  320x200 grey    : enable + graphics + monochrome       = 0A+04    = 0Eh
;   6  640x200 mono    : enable + graphics + hi-res + mono    = 0E+10    = 1Eh
cga_modes:
    db 2Ch, 28h, 2Dh, 29h, 0Ah, 0Eh, 1Eh

; The geometry of each mode, indexed by mode number, with mode 13h folded
; into the ninth slot because it is the only mode above 7 this ROM sets.
; See v_setmode for where the numbers come from; they are the same quantity
; in a text mode and a graphics one, because a CGA graphics screen is still
; measured in eight-pixel character cells.
vid_cols:
    db 40, 40, 80, 80, 40, 40, 80, 80, 40
vid_pagelen:
    dw 0800h, 0800h, 1000h, 1000h, 4000h, 4000h, 4000h, 1000h, 0000h

; The 6845's registers R0-R13 for the three rasters this ROM produces. The
; derivation of every number is in the crtc_program header; the shape is
;   R0 h total-1   R1 h displayed   R2 h sync pos   R3 h sync width
;   R4 v total-1   R5 v adjust      R6 v displayed  R7 v sync pos
;   R8 interlace   R9 max scan line R10/R11 cursor start/end
;   R12/R13 display start address, high then low
crtc_text40:
    db 56, 40, 45, 10
    db 31, 6, 25, 28
    db 2, 7, 6, 7
    db 0, 0
crtc_text80:
    db 113, 80, 90, 10
    db 31, 6, 25, 28
    db 2, 7, 6, 7
    db 0, 0
crtc_gfx:
    db 56, 40, 45, 10
    db 127, 6, 100, 112         ; 128 rows of TWO scan lines, 100 displayed
    db 2, 1, 6, 7               ; R9 = 1: a character row is two lines, which
    db 0, 0                     ; is the whole reason the banks interleave

; ---- mode 13h, the VGA register file ---------------------------------------
;
; Sequencer SR0-SR4. SR0 = 3 releases both reset bits; SR1 = 1 is the 8-dot
; character clock; SR2 = 0Fh enables writes to all four planes, which chain-4
; needs because consecutive bytes land in different ones; SR3 selects a
; character map and is meaningless in graphics; SR4 = 0Eh is bit 1 (more than
; 64K of memory), bit 2 (odd/even addressing OFF) and bit 3 (CHAIN-4 ON).
vga13_seq:
    db 03h, 01h, 0Fh, 00h, 0Eh

; Graphics controller GR0-GR8. The set/reset, colour-compare, rotate and
; read-map registers (0-4) all mean "do nothing to the byte on its way
; through", which is what a linear mode wants. GR5 = 40h is bit 6, the
; 256-colour shift; GR6 = 05h is bit 0 (graphics, not alphanumeric) with
; bits 3-2 = 01 putting the aperture at A0000h for 64K; GR7 = 0Fh compares
; all four planes and GR8 = 0FFh writes every bit of the byte.
vga13_gc:
    db 00h, 00h, 00h, 00h, 00h, 40h, 05h, 0Fh, 0FFh

; CRTC R0-R18h. The dot clock is 25.175 MHz and the raster is the 720x400
; text raster reused: 100 character times of 8 dots to a line (R0 holds
; total-5, so 5Fh) of which 80 are displayed (R1 holds displayed-1, 4Fh),
; giving 31.5 kHz; 449 lines to a frame (R6 holds total-2 = 447 = 1BFh, whose
; ninth bit is in the overflow register R7) giving 70 Hz. R9 = 41h makes a
; character row TWO scan lines, which is how 200 rows of pixels fill 400
; lines. R13h = 28h is the offset: 40 words, and chain-4 multiplies that by
; the four planes to make the 320 bytes of one row. R11h's bit 7
; write-protects R0-R7, which is why vga_mode13 clears it before this pass.
; The rest are the blanking and retrace edges of that same raster.
vga13_crtc:
    db 5Fh, 4Fh, 50h, 82h, 54h, 80h, 0BFh, 1Fh
    db 00h, 41h, 00h, 00h, 00h, 00h, 00h, 00h
    db 9Ch, 8Eh, 8Fh, 28h, 40h, 96h, 0B9h, 0A3h
    db 0FFh

; Attribute controller AR0-AR14h. The sixteen palette entries are the
; identity, because in 8-bit colour they are bypassed entirely and leaving
; them meaningful costs nothing. AR10h = 41h is bit 0 (graphics) and bit 6
; (8-BIT COLOUR) -- the second of the three bits that make this mode 13h.
; AR11h is the overscan colour, AR12h enables all four planes for display,
; AR13h is horizontal pixel panning and AR14h the colour-select high bits.
vga13_attr:
    db 00h, 01h, 02h, 03h, 04h, 05h, 06h, 07h
    db 08h, 09h, 0Ah, 0Bh, 0Ch, 0Dh, 0Eh, 0Fh
    db 41h, 00h, 0Fh, 00h, 00h

; The sixteen grey levels of DAC entries 10h-1Fh, six bits each. Perceptual,
; not linear -- the steps widen from 5 to 7 as they approach white -- so
; there is no expression to derive them from and they are listed.
vga_greys:
    db 0, 5, 8, 11, 14, 17, 20, 24
    db 28, 32, 36, 40, 45, 50, 56, 63

; The six sextants of the hue wheel, as three channel specifications each:
; 0 = sit at the low value, 1 = sit at the high one, 2 = rise across the four
; steps, 3 = fall. Exactly one channel moves in each sextant, which is what
; makes the walk a circle and not a zigzag.
vga_sextants:
    db 2, 0, 1                  ; blue    -> magenta: red rising
    db 1, 0, 3                  ; magenta -> red:     blue falling
    db 1, 2, 0                  ; red     -> yellow:  green rising
    db 3, 1, 0                  ; yellow  -> green:   red falling
    db 0, 1, 2                  ; green   -> cyan:    blue rising
    db 0, 3, 1                  ; cyan    -> blue:    green falling

; The DEFAULT diskette parameter table, and the one INT 1Eh points at until a
; transfer has looked at the disk. These are uPD765 timing parameters and a
; geometry, and they are OURS -- chosen to be right for a 360K drive, not
; copied from anybody. Two more tables follow it for 1.2M and 1.44M, and
; d_media publishes whichever matches the medium; see its header for why one
; hardcoded EOT was a bug rather than a limitation.
;
; THE DRIVER READS THIS TABLE; IT DOES NOT CARRY ITS OWN COPY -- and that was
; not true when this paragraph was first written. The driver read cs:[dpt+N]
; at eleven sites, so the sentence below about hooking INT 1Eh described a
; contract the code did not implement. It reads through the vector now
; (dpt_byte), which is what makes the rest of this true. Bytes 0 and 1
; are sent verbatim as SPECIFY's two parameter bytes, and bytes 3, 4, 5 and 6
; are sent verbatim as READ DATA's N, EOT, GPL and DTL. AH=08h answers with
; byte 4 as its sectors-per-track. So the table is not documentation of what
; the driver does -- it is the thing the driver does it with, and a program
; that hooks INT 1Eh to point at its own table (which is how software has
; always changed the step rate) really does change what the controller is
; told. The one number NOT taken from here is the cylinder count in AH=08h,
; because the table has no field for it.
;
; BYTE 1 BIT 0 IS THE NON-DMA BIT AND IT MUST STAY CLEAR. Setting it puts the
; execution phase on the CPU, and nothing in this ROM moves data bytes
; through 3F5h -- a transfer would raise RQM and wait for a host that never
; comes. The value 02h is head-load-time 1 with ND clear.
dpt:
    db 0DFh                     ; step rate 3ms, head unload 240ms
    db 002h                     ; head load 4ms, and ND CLEAR: DMA execution
    db 025h                     ; motor-off delay, in ticks (37 = about 2s)
    db 002h                     ; bytes per sector code: 2 = 512
    db 9                        ; EOT: last sector on a track
    db 02Ah                     ; gap length between sectors
    db 0FFh                     ; data transfer length when the size code is 0
    db 050h                     ; gap length used when formatting
    db 0F6h                     ; the byte a format writes into the data field
    db 15                       ; head settling time, in milliseconds
    db 8                        ; motor spin-up time, in eighths of a second.
                                ; A 5.25-inch spindle really does need about
                                ; a second, and fd_spinup really does wait
                                ; for it -- see the note there about why a
                                ; wait the model does not need is here.

; 1.2M and 1.44M. They differ from the 360K table above in EOT -- the whole
; point -- and in the two gap lengths, which are shorter because fifteen or
; eighteen sectors have to fit on the same circumference. The timing bytes are
; the same, and byte 1 keeps ND clear for the reason the header gives.
dpt12m:
    db 0DFh, 002h, 025h, 002h
    db 15                       ; EOT: fifteen sectors on a 1.2M track
    db 01Bh                     ; GPL for a read
    db 0FFh
    db 054h                     ; GPL for a format
    db 0F6h, 15, 8
dpt144:
    db 0DFh, 002h, 025h, 002h
    db 18                       ; EOT: eighteen. This byte is the bug fix.
    db 01Bh                     ; GPL for a read
    db 0FFh
    db 06Ch                     ; GPL for a format
    db 0F6h, 15, 8

;-----------------------------------------------------------------------------
; Keyboard translation, US layout, scancodes 01h through 39h.
;
; These are the KEY LEGENDS of an XT keyboard read off in scancode order --
; the layout of the keys, which is a fact about the keyboard and not about
; anybody's ROM. Above 39h a key has no ASCII at all and INT 09h returns the
; scancode with AL=0, which is how a program tells F1 from anything else.
;-----------------------------------------------------------------------------
KBD_LAST equ 39h

kbd_lower:
    db 1Bh                                  ; 01  Esc
    db '1234567890'                         ; 02-0B
    db 2Dh, 3Dh, 08h, 09h                   ; 0C - 0D = 0E BS 0F Tab
    db 'qwertyuiop'                         ; 10-19
    db 5Bh, 5Dh, 0Dh, 00h                   ; 1A [ 1B ] 1C Enter 1D Ctrl
    db 'asdfghjkl'                          ; 1E-26
    db 3Bh, 27h, 60h, 00h, 5Ch              ; 27 ; 28 ' 29 ` 2A LShift 2B \
    db 'zxcvbnm'                            ; 2C-32
    db 2Ch, 2Eh, 2Fh, 00h, 2Ah, 00h, 20h    ; 33 , 34 . 35 / 36 RShift
                                            ; 37 keypad * 38 Alt 39 Space
kbd_upper:
    db 1Bh                                  ; 01  Esc
    db 21h, 40h, 23h, 24h, 25h              ; 02-06  ! @ # $ %
    db 5Eh, 26h, 2Ah, 28h, 29h              ; 07-0B  ^ & * ( )
    db 5Fh, 2Bh, 08h, 09h                   ; 0C _ 0D + 0E BS 0F Tab
    db 'QWERTYUIOP'                         ; 10-19
    db 7Bh, 7Dh, 0Dh, 00h                   ; 1A { 1B } 1C Enter 1D Ctrl
    db 'ASDFGHJKL'                          ; 1E-26
    db 3Ah, 22h, 7Eh, 00h, 7Ch              ; 27 : 28 " 29 ~ 2A LShift 2B |
    db 'ZXCVBNM'                            ; 2C-32
    db 3Ch, 3Eh, 3Fh, 00h, 2Ah, 00h, 20h    ; 33 < 34 > 35 ? 36 RShift
                                            ; 37 keypad * 38 Alt 39 Space

msg_banner:
    db 'bw-board 8086 BIOS v0.1', 0Dh, 0Ah
    db '640K OK', 0Dh, 0Ah, 0
msg_nodisk:
    db 0Dh, 0Ah, 'No disk controller: drive A did not answer', 0Dh, 0Ah, 0
msg_nosig:
    db 0Dh, 0Ah, 'Not a boot disk: no 55AA signature', 0Dh, 0Ah, 0
msg_nobasic:
    db 0Dh, 0Ah, 'No ROM BASIC. Halted.', 0Dh, 0Ah, 0

;=============================================================================
; THE RESET VECTOR, and the last sixteen bytes of the megabyte.
;
; The 8086 comes out of reset with CS=FFFF and IP=0000, so it fetches from
; physical FFFF0h -- sixteen bytes below the top of the address space. There
; is room for exactly one instruction there, which is why every ROM for one of
; these ends in a far jump and why the ROM has to be at the top of the space.
;
; ASSEMBLER WORKAROUND: hand-encoded, for the same reason as the boot jump.
; EA is JMP FAR with an immediate segment:offset, low word first.
;=============================================================================
    ORG 0FFF0h
reset_vector:
    db   0EAh
    dw   offset post
    dw   ROM_SEG

    ; FFFF:0005 is where a BIOS's release date has lived since 1981, in
    ; MM/DD/YY, and software really does read it. Ours, and true.
    db   '09/03/26'

    ; FFFF:000D is the one byte in this block with no assigned meaning; the
    ; ORG puts the last two where they belong rather than wherever counting
    ; the date string happened to land, which is the kind of arithmetic that
    ; is wrong once and then wrong forever.
    ORG  0FFFEh

    ; FFFF:000E is the model byte. FEh is the value that says "PC/XT class",
    ; which is what this machine is; FFFF:000F is a checksum byte in ROMs
    ; that check themselves. This one does not, and says so with a zero.
    db   0FEh
    db   000h

END
