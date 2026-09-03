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
;   INT 10h   00 set mode (text 0-3 and 7; 4-6 recorded only), 01 cursor
;             shape, 02 set cursor, 03 get cursor, 05 set active page,
;             06/07 scroll a window, 08 read char+attr, 09 write char+attr,
;             0A write char, 0E teletype, 0F get mode.
;   INT 11h   equipment word.        INT 12h   memory size.
;   INT 16h   00 read key, 01 peek, 02 shift flags (10/11/12 aliased).
;   INT 09h   keyboard IRQ: XT acknowledge strobe, shift/lock state, US
;             layout translation, ring-buffer insert, Ctrl-Alt-Del.
;   INT 08h   timer IRQ: 0040:006C tick count, 24-hour rollover, INT 1Ch.
;   INT 1Ah   00 read ticks, 01 set ticks.
;   INT 13h   ENTRY POINTS and register conventions only -- see HOLE: FDC.
;             01 last status, 08 drive parameters and 15h drive type are
;             answered (they are configuration, not controller traffic).
;   INT 19h   bootstrap: read cylinder 0 head 0 sector 1 to 0000:7C00 through
;             INT 13h, check the 55AAh signature, and jump there.
;   INT 05h/15h/17h/18h/1Bh/1Ch  present, and each says what it does not do.
;
; WHAT IS NOT IMPLEMENTED, stated rather than left to be discovered
;
;   * THE FLOPPY CONTROLLER. src/upd765.js and src/i8237.js both exist now,
;     but src/i8086-machine.js has no chip kind for either, so no machine
;     config can decode 3F0h-3F7h to a controller and an OUT there would
;     vanish into open bus. Every INT 13h path that would move a sector
;     lands on `fdc_hole` below, which returns CF=1 and AH=20h (controller
;     failure). That is the ONE named hole, and it is a wiring hole; the
;     comment there says exactly what fills it.
;   * Graphics. Modes 4/5/6 set the mode byte and the CGA mode register and
;     nothing else; INT 10h AH=0Ch/0Dh (write/read pixel) are absent, so a
;     program that draws gets the do-nothing default return.
;   * The 6845 CRTC is written but not modelled. The cursor registers 0Ah/0Bh
;     and 0Eh/0Fh are programmed exactly as the hardware wants; CGACard
;     ignores every register but 3D8h/3D9h, so on THIS machine the hardware
;     cursor is invisible. The BIOS-data-area cursor is the real one and it
;     is correct.
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
VID_COLOR   equ 0B800h          ; CGA text page
VID_MONO    equ 0B000h          ; MDA/Hercules text page (mode 7)

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
BDA_MOTORCNT equ 0040h          ; floppy motor-off countdown, in ticks
BDA_DISKSTAT equ 0041h          ; last INT 13h status, what AH=01h returns
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

; INT 13h status codes, the subset this ROM can actually produce.
DSK_OK      equ 00h
DSK_BADCMD  equ 01h             ; function not supported
DSK_CTRLFAIL equ 20h            ; controller failure -- what the hole returns
DSK_TIMEOUT equ 80h             ; drive did not respond

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
    ; Unmask the timer and the keyboard, mask everything with no handler. A
    ; masked line is not a dropped one: it stays asserted and is taken as soon
    ; as it is unmasked, which is why leaving unused lines unmasked with no
    ; EOI-issuing handler wedges the controller on the first spurious edge.
    mov  al, 0FCh
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

    ; The floppy motor timeout counts down here. Reaching zero is where a
    ; BIOS turns the motor off through the controller's digital output
    ; register -- see HOLE: FDC. The countdown is kept anyway so that the
    ; behaviour is already correct when the controller arrives.
    cmp  byte ptr [BDA_MOTORCNT], 0
    je   int08_nomotor
    dec  byte ptr [BDA_MOTORCNT]
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

    ; 40-column text is modes 0 and 1; everything else here is 80 columns
    ; wide, including the graphics modes measured in character cells.
    mov  cx, 80
    mov  bx, 1000h              ; 4K per page: 4000 bytes rounded to a boundary
    cmp  al, 2
    jae  vsm_wide
    mov  cx, 40
    mov  bx, 0800h
vsm_wide:
    mov  [BDA_COLS], cx
    mov  [BDA_PAGELEN], bx
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
    mov  al, 30h                ; a plain palette; the colour register is a
    mov  [BDA_PALETTE], al      ; graphics-mode control and text ignores it
    mov  dx, PORT_CGACOL
    out  dx, al

    or   ah, ah
    jnz  vsm_nocls
    ; Clear the whole buffer, not just one page: switching modes leaves the
    ; other pages holding characters in the previous mode's geometry.
    mov  ax, VID_COLOR
    cmp  byte ptr [BDA_MODE], 7
    jne  vsm_c1
    mov  ax, VID_MONO
vsm_c1:
    mov  es, ax
    xor  di, di
    mov  cx, 8192               ; 16K: the whole text aperture
    mov  ax, 0720h              ; blank, light grey on black
    cmp  byte ptr [BDA_MODE], 4
    jb   vsm_c2
    cmp  byte ptr [BDA_MODE], 6
    ja   vsm_c2
    xor  ax, ax                 ; a graphics mode: all bits off, not blanks
vsm_c2:
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
    and  word ptr [bp+F_FL], FL_NOT_CF      ; assume success
    mov  byte ptr [bp+F_AH], DSK_OK

    cmp  ah, 00h
    je   d_reset
    cmp  ah, 01h
    je   d_status
    cmp  ah, 02h
    je   d_needs_fdc
    cmp  ah, 03h
    je   d_needs_fdc
    cmp  ah, 04h
    je   d_needs_fdc
    cmp  ah, 08h
    je   d_params
    cmp  ah, 15h
    je   d_type
    mov  al, DSK_BADCMD
    jmp  d_fail

d_reset:
    ; A reset is controller traffic -- it is a Specify and a Recalibrate down
    ; the FDC's data register -- so it belongs in the hole with the rest.
d_needs_fdc:
    ; Read, write, verify and reset all end here. It is a separate label only
    ; because an 8086 conditional jump reaches 127 bytes and the hole is
    ; further away than that.
    jmp  fdc_hole

d_status:
    ; Answerable without hardware: it is the byte the last call left behind.
    mov  al, [BDA_DISKSTAT]
    mov  [bp+F_AL], al
    jmp  d_exit

d_params:
    ; Configuration, not controller traffic, so this one is answered. The
    ; geometry is the 360K five-and-a-quarter format the equipment word
    ; implies: 40 cylinders, 2 heads, 9 sectors per track.
    ;   CH = last cylinder number (39)
    ;   CL = sectors per track in bits 0-5, cylinder bits 8-9 in bits 6-7
    ;   DH = last head number (1)
    ;   DL = number of drives attached
    ;   ES:DI -> the diskette parameter table
    cmp  byte ptr [bp+F_DL], 80h
    jae  d_nohd
    mov  byte ptr [bp+F_CH], 39
    mov  byte ptr [bp+F_CL], 9
    mov  byte ptr [bp+F_DH], 1
    mov  byte ptr [bp+F_DL], 1
    mov  word ptr [bp+F_ES], ROM_SEG
    mov  word ptr [bp+F_DI], offset dpt
    jmp  d_exit
d_nohd:
    ; A hard disk was asked about. There is no fixed disk of any kind, and
    ; saying so is a service: a program that gets a plausible geometry back
    ; goes on to read a disk that does not exist.
    mov  byte ptr [bp+F_DL], 0
    mov  al, DSK_BADCMD
    jmp  d_fail

d_type:
    ; 00h no drive, 01h floppy without change-line, 02h floppy with,
    ; 03h fixed disk. One drive at DL=0, nothing else.
    cmp  byte ptr [bp+F_DL], 0
    jne  d_type_none
    mov  byte ptr [bp+F_AH], 01h
    jmp  d_exit
d_type_none:
    mov  byte ptr [bp+F_AH], 00h
    jmp  d_exit

;;;===========================================================================
;;;
;;;   H O L E :   F D C
;;;
;;;   The uPD765 floppy disk controller is not driven here. This is the one
;;;   named, documented hole in this ROM, and it is a WIRING hole rather than
;;;   an unwritten-chip one:
;;;
;;;     * src/upd765.js EXISTS and is a real model -- the phase machine, the
;;;       main status register's RQM/DIO bits, ST0-ST3, and a register window
;;;       at 3F0h-3F7h (3F2h DOR, 3F4h MSR, 3F5h data, 3F7h DIR/CCR).
;;;     * src/i8237.js EXISTS and is the DMA half.
;;;     * src/i8086-machine.js KNOWS NEITHER. Its REGS table has no chip kind
;;;       for either one, so no machine config can decode 3F0h-3F7h to the
;;;       controller and an OUT to the data register here would go into the
;;;       same open bus as an OUT to any other undecoded port -- silently.
;;;
;;;   So the ports are deliberately not touched. Poking at addresses nothing
;;;   answers, and then reading FFh back as a status byte, produces a driver
;;;   that hangs in a poll loop with nothing to say why. Refusing by name is
;;;   the better failure until the machine layer can carry the chips.
;;;
;;;   WHAT GOES HERE when it can. Firmware never "calls" this controller; it
;;;   watches two bits of the main status register and lets them say what to
;;;   do next -- RQM that the data register is ready, DIO which way it faces
;;;   -- and hands command bytes through 3F5h one at a time. The sequence is:
;;;   motor on and drive select through the DOR (the 0040:0040 countdown this
;;;   ROM already maintains is the motor-off timer for it), SPECIFY once,
;;;   RECALIBRATE and SEEK, program the DMA channel, then READ DATA, wait for
;;;   IRQ6, and turn the seven result bytes' ST0/ST1/ST2 into the AH status
;;;   this interface returns.
;;;
;;;   TWO THINGS TO GET RIGHT BEFORE ANY OF THAT, both of which fail as a
;;;   hang rather than as an error:
;;;
;;;     1. The 8237's terminal-count output has to reach the uPD765's TC
;;;        input. Without it the controller is never told the transfer is
;;;        over, and it waits for a byte the DMA channel will not send.
;;;     2. The DMA physical address is ES*16+BX and it CAN CROSS A 64K
;;;        BOUNDARY. The 8237 does not carry between its address register and
;;;        its page register, so a transfer that would cross one wraps to the
;;;        bottom of the same 64K and quietly writes over something else. The
;;;        documented answer is to refuse it with AH=09h, and that refusal is
;;;        the classic omission in this routine.
;;;
;;;   Until then: AH=20h, controller failure, CF set. Not "no disk" (AH=80h),
;;;   which would say the drive is empty and invite a retry, and not success
;;;   with a buffer full of zeros, which would make a boot sector out of
;;;   nothing.
;;;
;;;===========================================================================
fdc_hole:
    mov  al, DSK_CTRLFAIL
d_fail:
    mov  [bp+F_AH], al
    mov  [BDA_DISKSTAT], al
    or   word ptr [bp+F_FL], FL_CF
d_exit:
    POPALL
    iret

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

; The diskette parameter table INT 1Eh points at. These are uPD765 timing
; parameters and a geometry, and they are OURS -- placeholders chosen to be
; sane for a 360K drive, not copied. Nothing reads them yet; the floppy
; driver that will is behind HOLE: FDC, and it should revisit every byte.
dpt:
    db 0DFh                     ; step rate 3ms, head unload 240ms
    db 002h                     ; head load 4ms, non-DMA off
    db 025h                     ; motor-off delay, in ticks
    db 002h                     ; bytes per sector code: 2 = 512
    db 9                        ; last sector on a track
    db 02Ah                     ; gap length between sectors
    db 0FFh                     ; data transfer length when the size code is 0
    db 050h                     ; gap length used when formatting
    db 0F6h                     ; the byte a format writes into the data field
    db 15                       ; head settling time, in milliseconds
    db 8                        ; motor spin-up time, in eighths of a second

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
    db 0Dh, 0Ah, 'No disk controller: INT 13h is a stub (see HOLE: FDC)', 0Dh, 0Ah, 0
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
