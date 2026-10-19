; IO.SYS -- the OEM I/O system for MS-DOS 2.0 on the bw-board 8086 tier.
;
; WHY THIS FILE EXISTS AT ALL. The microsoft/MS-DOS MIT release ships
; MSDOS.SYS, COMMAND.COM and SYSINIT.OBJ, and it does NOT ship an IO.SYS.
; That is not an omission: in MS-DOS 2.x the kernel and the I/O system are
; two separate products. Microsoft wrote the kernel and published the
; interface it expects (SYSINIT.DOC, DEVDRIV.DOC); the hardware maker wrote
; IO.SYS against that interface and linked SYSINIT.OBJ behind it. So this
; file is the part the OEM always had to supply, written from the two
; documents rather than recovered from anybody's binary.
;
; WHAT HARDWARE THIS TARGETS, AND WHY IT IS NOT THE FLOPPY CONTROLLER. The
; uPD765 and the 8237 for this board are being built by other people and are
; not ready. `src/i8086-dos.js` already has a working INT 13h -- reset, read,
; write, drive parameters, over a supplied image with a declared geometry --
; and a loadBoot() that puts a sector at 0000:7C00 the way a BIOS does. The
; block driver below therefore talks to INT 13h, exactly as an IBM-compatible
; OEM BIOS did, and NOT to any controller register. When the real controller
; lands, the only thing that changes is what services INT 13h: this file does
; not have to move at all. That is the point of aiming at the BIOS interface
; rather than at the ports.
;
; ASSEMBLER. This is written for src/i8086-asm.js, a MASM subset. Places
; where the subset bit are marked "ASM-LIMIT" and are listed in the build
; script's header too, since they are useful to whoever owns the assembler.
;
; THE FILE IS TWO ASSEMBLY UNITS IN ONE SOURCE. Everything up to BIOS_END is
; the resident BIOS at IO.SYS offset 0. Everything after the second ORG is
; the SYSINIT *message* module: SYSINIT.OBJ has BADOPM/CRLFM/BADSIZ/BADLD/
; BADCOM/SYSSIZE as EXTERNALS, and in Microsoft's own build they come from
; SYSIMES.ASM, which is part of SYSINITSEG -- not part of the BIOS segment.
; So they are assembled at the offset SYSINITSEG's own image ends, and the
; build script drops the linked SYSINIT.OBJ into the hole between the two.
; The strings are Microsoft's, from v2.0/source/SYSIMES.ASM (MIT).
;
; MEMORY MAP THIS FILE ASSUMES (all values below are checked by the builder):
;
;   0000:0600  IO.SYS            BIOSSEG      0060h, 2000h bytes on disk
;   0000:1600  SYSINITSEG        0160h        inside IO.SYS, para aligned
;   0000:1600  the DOS, moved    FINAL_DOS_LOCATION  (SYSINIT relocates
;                                              itself to high memory first,
;                                              so this overlays the SYSINIT
;                                              image and nothing else)
;   0000:2600  MSDOS.SYS as read CURRENT_DOS_LOCATION 0260h
;   0000:7C00  the boot sector, dead by then
;   9F84:0000  SYSINIT, after it relocates itself below MEMORY_SIZE

BIOSSEG     EQU 0060h       ; where the boot sector loads IO.SYS
BIOSIZ      EQU 1000h       ; bytes reserved for the RESIDENT BIOS
BIOSIZS     EQU 0100h       ; ... the same, in paragraphs
SYSINITSEG  EQU BIOSSEG+BIOSIZS ; where SYSINIT's segment begins, inside IO.SYS
SI_SEGLEN   EQU 0746h       ; SYSINITSEG length contributed by SYSINIT.OBJ.
                            ; The builder ASSERTS this against the OBJ's
                            ; SEGDEF, so a different SYSINIT.OBJ fails loudly
                            ; instead of landing the messages in the wrong
                            ; place.
IOSYSIZ     EQU 2000h       ; IO.SYS size on disk: a whole number of 1024-byte
                            ; clusters, so MSDOS.SYS begins on a paragraph
                            ; boundary when the two are read contiguously.
IOSYSIZS    EQU 0200h       ; ... in paragraphs
DOSCUR      EQU BIOSSEG+IOSYSIZS    ; MSDOS.SYS where the boot sector leaves it
DOSFIN      EQU BIOSSEG+BIOSIZS     ; and where SYSINIT is to move it -- on top
                            ; of SYSINIT's own image, which by then has
                            ; relocated itself to the top of memory
MEMSIZE     EQU 0A000h      ; RAM in paragraphs = 640K. Set explicitly so
                            ; SYSINIT does NOT run its write-read-back memory
                            ; scan, which would walk off the end of a machine
                            ; whose RAM stops at BFFFF and take open bus for
                            ; memory.

; --- offsets of SYSINIT's public variables inside SYSINITSEG ---------------
; From SYSINIT.DOC, and confirmed against SYSINIT.OBJ's PUBDEF records by the
; builder, which refuses to build if any of them has moved.
SI_CURDOS   EQU 0005h       ; CURRENT_DOS_LOCATION  WORD
SI_FINDOS   EQU 0009h       ; FINAL_DOS_LOCATION    WORD
SI_DEVLIST  EQU 000Bh       ; DEVICE_LIST           DWORD
SI_MEMSIZ   EQU 000Fh       ; MEMORY_SIZE           WORD
SI_DEFDRV   EQU 0011h       ; DEFAULT_DRIVE         BYTE
SI_BUFFERS  EQU 0012h       ; BUFFERS               BYTE
SI_FILES    EQU 0013h       ; FILES                 BYTE

; --- static request header, DEVDRIV.DOC ------------------------------------
R_CMDLEN    EQU 0           ; BYTE  length of this request structure
R_UNIT      EQU 1           ; BYTE  sub-unit (block devices only)
R_CMD       EQU 2           ; BYTE  command code
R_STATUS    EQU 3           ; WORD  status
                            ; 5..12 are the two DWORD queue links
R_MEDIA     EQU 13          ; BYTE  media descriptor
R_TRANS     EQU 14          ; DWORD transfer address
R_COUNT     EQU 18          ; WORD  sector / byte count
R_START     EQU 20          ; WORD  first block
; INIT (command 0) reuses the tail differently:
R_UNITS     EQU 13          ; BYTE  number of units    (set by the driver)
R_BREAK     EQU 14          ; DWORD break address      (set by the driver)
R_BPBPTR    EQU 18          ; DWORD pointer to the BPB pointer array
; MEDIA CHECK (1):
R_MEDRET    EQU 14          ; BYTE  -1 changed / 0 don't know / 1 unchanged
; BUILD BPB (2) puts the BPB pointer where INIT puts the BPB array pointer.
; NON DESTRUCTIVE READ (5):
R_PEEK      EQU 13          ; BYTE  the character that would be read

; --- status word bits ------------------------------------------------------
ST_DONE     EQU 0100h
ST_BUSY     EQU 0200h
ST_ERR      EQU 8000h
E_UNKCMD    EQU 8003h       ; unknown command
E_GENFAIL   EQU 800Ch       ; general failure

            ORG 0

; ===========================================================================
; ENTRY. The boot sector jumps to BIOSSEG:0000. Offset 0 is a jump because
; that is the one thing every loader in the family agrees on.
; ===========================================================================
INIT:       jmp     HWINIT

; ===========================================================================
; THE DEVICE LIST.
;
; DEVDRIV.DOC is blunt about the order and it is not negotiable:
;   ->CON->AUX->PRN->CLOCK->(block devices)
; The first four character devices become stdin/stdout/stderr, stdaux,
; stdprn and the date/time source, BY POSITION. Get the order wrong and the
; symptom is not "AUX is broken", it is DOS reading the clock from the
; printer.
;
; The `next` pointers are WORD offset + WORD segment, and the segment has to
; be the literal BIOSSEG: at the moment these are read the DOS has no idea
; where we are.
; ===========================================================================
DEVSTART:
CONDEV:     dw      AUXDEV, BIOSSEG
            dw      8003h           ; char, is current stdin, is current stdout
            dw      STRATEGY
            dw      CON_INT
            db      'CON     '

AUXDEV:     dw      PRNDEV, BIOSSEG
            dw      8000h           ; char
            dw      STRATEGY
            dw      AUX_INT
            db      'AUX     '

PRNDEV:     dw      TIMDEV, BIOSSEG
            dw      8000h           ; char
            dw      STRATEGY
            dw      PRN_INT
            db      'PRN     '

TIMDEV:     dw      DSKDEV, BIOSSEG
            dw      8008h           ; char, is the CLOCK device
            dw      STRATEGY
            dw      TIM_INT
            db      'CLOCK   '

DSKDEV:     dw      -1, -1          ; last in the chain
            dw      0000h           ; block device, IBM format (bit 13 clear,
                                    ; so BUILD BPB is handed the first FAT
                                    ; sector and must not scribble on it)
            dw      STRATEGY
            dw      DSK_INT
DRVMAX:     db      1               ; one unit, which becomes A:
            db      7 dup(0)

; ===========================================================================
; Per-device command tables. Command codes are DEVDRIV.DOC's 0..12.
; ===========================================================================
CONTBL:     dw      EXIT            ;  0 INIT      (resident: nothing to do)
            dw      EXIT            ;  1 media check   (block only)
            dw      EXIT            ;  2 build BPB     (block only)
            dw      CMDERR          ;  3 IOCTL input   (we have no IOCTL bit)
            dw      CON_READ        ;  4 input
            dw      CON_PEEK        ;  5 non-destructive input, no wait
            dw      EXIT            ;  6 input status
            dw      CON_FLSH        ;  7 input flush
            dw      CON_WRIT        ;  8 output
            dw      CON_WRIT        ;  9 output with verify
            dw      EXIT            ; 10 output status
            dw      EXIT            ; 11 output flush
            dw      CMDERR          ; 12 IOCTL output

AUXTBL:     dw      EXIT
            dw      EXIT
            dw      EXIT
            dw      CMDERR
            dw      AUX_READ        ;  4 input  -- nothing is attached
            dw      BUSEXIT         ;  5 peek   -- never a character waiting
            dw      EXIT
            dw      EXIT
            dw      AUX_WRIT        ;  8 output -- accepted and dropped
            dw      AUX_WRIT
            dw      EXIT
            dw      EXIT
            dw      CMDERR

PRNTBL:     dw      EXIT
            dw      EXIT
            dw      EXIT
            dw      CMDERR
            dw      EXIT
            dw      BUSEXIT
            dw      EXIT
            dw      EXIT
            dw      AUX_WRIT        ;  8 output -- accepted and dropped
            dw      AUX_WRIT
            dw      EXIT
            dw      EXIT
            dw      CMDERR

TIMTBL:     dw      EXIT
            dw      EXIT
            dw      EXIT
            dw      CMDERR
            dw      TIM_RED         ;  4 read the date and time (6 bytes)
            dw      BUSEXIT
            dw      EXIT
            dw      EXIT
            dw      TIM_WRT         ;  8 set the date and time (6 bytes)
            dw      TIM_WRT
            dw      EXIT
            dw      EXIT
            dw      CMDERR

DSKTBL:     dw      DSK_INIT        ;  0 INIT
            dw      MEDIAC          ;  1 media check
            dw      GETBPB          ;  2 build BPB
            dw      CMDERR          ;  3 IOCTL input
            dw      DSK_RED         ;  4 read
            dw      BUSEXIT         ;  5 (character only)
            dw      EXIT            ;  6 input status
            dw      EXIT            ;  7 input flush
            dw      DSK_WRT         ;  8 write
            dw      DSK_WRT         ;  9 write with verify (no verify here)
            dw      EXIT            ; 10 output status
            dw      EXIT            ; 11 output flush
            dw      CMDERR          ; 12 IOCTL output

; ===========================================================================
; STRATEGY and INTERRUPT.
;
; DEVDRIV.DOC explains the two entry points at length and then says MS-DOS
; 2.0 does not use them: it calls strategy, then immediately calls interrupt.
; So strategy is exactly what the document says a 2.0 driver should be --
; save the packet pointer -- and every real decision happens in the interrupt
; routine. The comment matters because the shape looks pointlessly indirect
; until you know it was built for a multitasking DOS that never shipped.
; ===========================================================================
PTRSAV:     dd      0               ; ES:BX as strategy was handed it
TBLPTR:     dw      0               ; which command table this call is for

STRATEGY:
            mov     word ptr cs:[PTRSAV], bx
            mov     word ptr cs:[PTRSAV+2], es
            retf

; Each device's interrupt entry names its table and falls into the common
; dispatcher. The table pointer goes to memory, not to a register, because
; nothing may be clobbered before the register save below.
CON_INT:    mov     word ptr cs:[TBLPTR], offset CONTBL
            jmp     short DEVENT
AUX_INT:    mov     word ptr cs:[TBLPTR], offset AUXTBL
            jmp     short DEVENT
PRN_INT:    mov     word ptr cs:[TBLPTR], offset PRNTBL
            jmp     short DEVENT
TIM_INT:    mov     word ptr cs:[TBLPTR], offset TIMTBL
            jmp     short DEVENT
DSK_INT:    mov     word ptr cs:[TBLPTR], offset DSKTBL

DEVENT:
            push    ax
            push    bx
            push    cx
            push    dx
            push    si
            push    di
            push    bp
            push    ds
            push    es
            push    cs
            pop     ds                      ; DS = BIOSSEG for everything below
            les     di, dword ptr [PTRSAV]  ; ES:DI -> the request header
            mov     bl, es:[di+R_CMD]
            xor     bh, bh
            cmp     bx, 12
            jbe     DEVOK
            mov     ax, E_UNKCMD
            jmp     short DEVRET
DEVOK:      shl     bx, 1
            mov     si, [TBLPTR]
            add     si, bx
            mov     si, [si]
            call    si                      ; routines return AX = status bits
DEVRET:
            les     di, dword ptr [PTRSAV]
            or      ax, ST_DONE
            mov     es:[di+R_STATUS], ax
            pop     es
            pop     ds
            pop     bp
            pop     di
            pop     si
            pop     dx
            pop     cx
            pop     bx
            pop     ax
            retf

; --- the trivial replies ---------------------------------------------------
EXIT:       xor     ax, ax
            ret
BUSEXIT:    mov     ax, ST_BUSY             ; "no, nothing is waiting"
            ret
CMDERR:     mov     ax, E_UNKCMD
            ret

; --- helpers ---------------------------------------------------------------
; GETXFR leaves ES:BX at the transfer address and CX at the count. It
; DESTROYS the header pointer in ES, so anything that still needs the header
; reloads it from PTRSAV afterwards -- which is cheap and impossible to get
; subtly wrong, unlike carrying two segment registers around.
GETXFR:     les     di, dword ptr [PTRSAV]
            mov     cx, es:[di+R_COUNT]
            mov     bx, es:[di+R_TRANS]
            mov     ax, es:[di+R_TRANS+2]
            mov     [XFRSEG], ax
            mov     es, ax
            ret

; Report `ax` as the number of items actually transferred.
SETCNT:     push    ax
            les     di, dword ptr [PTRSAV]
            pop     ax
            mov     es:[di+R_COUNT], ax
            ret

; ===========================================================================
; CON. Output is INT 10h teletype, input is INT 16h.
;
; CONIN SPINS when no key is waiting, and that is deliberate. The BIOS layer
; here returns AL=0 immediately from a blocking INT 16h read rather than
; waiting, so a driver that trusted it would feed the DOS an endless stream
; of NULs and COMMAND.COM would fill its line buffer with nothing. Spinning
; is what a real keyboard read does, and "parked in CONIN with a prompt on
; the screen" is exactly the state a booted DOS is supposed to be in.
; ===========================================================================
CONIN:      mov     ah, 1
            int     16h
            jz      CONIN                   ; nothing pending: keep waiting
            mov     ah, 0
            int     16h                     ; AL = the character
            ret

CON_READ:
            call    GETXFR                  ; ES:BX = buffer, CX = count
            mov     [REQCNT], cx
            jcxz    CRDONE
CRLOOP:     push    cx
            push    bx
            call    CONIN
            pop     bx
            pop     cx
            mov     es, [XFRSEG]
            mov     es:[bx], al
            inc     bx
            loop    CRLOOP
CRDONE:     mov     ax, [REQCNT]
            call    SETCNT
            xor     ax, ax
            ret

CON_PEEK:
            mov     ah, 1
            int     16h
            jz      CPNONE
            push    ax
            les     di, dword ptr [PTRSAV]
            pop     ax
            mov     es:[di+R_PEEK], al
            xor     ax, ax
            ret
CPNONE:     mov     ax, ST_BUSY
            ret

CON_FLSH:
            mov     ah, 1
            int     16h
            jz      CFDONE
            mov     ah, 0
            int     16h
            jmp     short CON_FLSH
CFDONE:     xor     ax, ax
            ret

CON_WRIT:
            call    GETXFR                  ; ES:BX = buffer, CX = count
            mov     [REQCNT], cx
            jcxz    CWDONE
CWLOOP:     mov     es, [XFRSEG]
            mov     al, es:[bx]
            push    cx
            push    bx
            mov     ah, 0Eh
            mov     bx, 0007h               ; page 0, light grey
            int     10h
            pop     bx
            pop     cx
            inc     bx
            loop    CWLOOP
CWDONE:     mov     ax, [REQCNT]
            call    SETCNT
            xor     ax, ax
            ret

; ===========================================================================
; AUX and PRN. There is no serial port and no printer on this tier. Rather
; than fail -- which would make DOS report an error every time it opens the
; four standard handles at boot -- these accept everything and report it all
; transferred, and a read returns end-of-file by transferring nothing. That
; is a bit bucket and it is stated as one; it is not a claim that a UART is
; being emulated.
; ===========================================================================
AUX_READ:   xor     ax, ax
            call    SETCNT                  ; nothing read: end of file
            xor     ax, ax
            ret

AUX_WRIT:   les     di, dword ptr [PTRSAV]
            mov     ax, es:[di+R_COUNT]     ; ... all of it, into the bucket
            call    SETCNT
            xor     ax, ax
            ret

; ===========================================================================
; CLOCK. Six bytes, in the order DEVDRIV.DOC gives: WORD days since 1-1-80,
; then minutes, hours, hundredths, seconds -- which is AX, CL, CH, DL, DH of
; the old 1.25 date and time calls, and the order surprises everyone once.
;
; The time comes from INT 1Ah, which counts 18.2065 Hz ticks. Dividing by 18
; rather than by 18.2065 runs the clock about 1.1% fast; the alternative is
; a 32-bit multiply-and-shift for a value nothing in this tier measures.
; Stated rather than hidden.
; ===========================================================================
TIM_RED:
            call    GETXFR                  ; ES:BX = the six bytes
            mov     ah, 0
            int     1Ah                     ; CX:DX = ticks since midnight
            mov     [TKLO], dx
            mov     ax, cx
            xor     dx, dx
            mov     di, 18
            div     di                      ; AX = high/18, DX = remainder
            mov     ax, [TKLO]
            div     di                      ; DX:AX / 18 -> AX = seconds
            xor     dx, dx
            mov     di, 60
            div     di                      ; AX = minutes, DX = seconds
            mov     [T_SEC], dl
            xor     dx, dx
            div     di                      ; AX = hours, DX = minutes
            mov     [T_MIN], dl
            xor     dx, dx
            mov     di, 24
            div     di                      ; AX = days, DX = hours
            mov     [T_HR], dl
            mov     es, [XFRSEG]
            mov     es:[bx], al             ; days since 1-1-80, low
            mov     es:[bx+1], ah           ; ... high
            mov     al, [T_MIN]
            mov     es:[bx+2], al
            mov     al, [T_HR]
            mov     es:[bx+3], al
            mov     byte ptr es:[bx+4], 0   ; hundredths
            mov     al, [T_SEC]
            mov     es:[bx+5], al
            mov     ax, 6
            call    SETCNT
            xor     ax, ax
            ret

; Setting the clock is accepted and forgotten: there is no writable time
; source behind INT 1Ah on this tier. Reporting success is the right lie --
; reporting failure makes DATE and TIME print an error at every boot.
TIM_WRT:    mov     ax, 6
            call    SETCNT
            xor     ax, ax
            ret

; ===========================================================================
; THE BLOCK DEVICE.
;
; One unit, drive A, a 360K double-sided 9-sector floppy. Everything goes
; through INT 13h -- see the file header for why that and not a uPD765.
;
; ONE SECTOR PER INT 13h CALL. A multi-sector request that crosses a track
; boundary is legal for the service in i8086-dos.js, which converts CHS to a
; linear offset and keeps reading; it is NOT legal for a real controller,
; which stops at the end of the track. Looping a sector at a time costs
; nothing here and means this code does not have to be rewritten when a real
; uPD765 arrives.
; ===========================================================================
BPB360:     dw      512             ; bytes per sector
            db      2               ; sectors per allocation unit
            dw      1               ; reserved sectors (the boot sector)
            db      2               ; number of FATs
            dw      112             ; root directory entries
            dw      720             ; sectors on the volume
            db      0FDh            ; media descriptor: 5.25", 2 sided, 9 spt
            dw      2               ; sectors per FAT
BPBTBL:     dw      offset BPB360   ; one WORD pointer per unit, as DEVDRIV
                                    ; describes -- units that share a format
                                    ; share the block

SPT         EQU     9
HEADS       EQU     2
SPCYL       EQU     18              ; SPT * HEADS

DSK_INIT:
            les     di, dword ptr [PTRSAV]
            mov     byte ptr es:[di+R_UNITS], 1
            mov     word ptr es:[di+R_BREAK], BIOSIZ
            mov     word ptr es:[di+R_BREAK+2], cs
            mov     word ptr es:[di+R_BPBPTR], offset BPBTBL
            mov     word ptr es:[di+R_BPBPTR+2], cs
            xor     ax, ax
            ret

; Media check: there is no door-lock line to read, but there is also no way
; for the media to change under a test, so answering "not changed" is honest
; here and saves the DOS a FAT re-read on every directory access.
MEDIAC:     les     di, dword ptr [PTRSAV]
            mov     byte ptr es:[di+R_MEDRET], 1
            xor     ax, ax
            ret

GETBPB:     les     di, dword ptr [PTRSAV]
            mov     word ptr es:[di+R_BPBPTR], offset BPB360
            mov     word ptr es:[di+R_BPBPTR+2], cs
            xor     ax, ax
            ret

DSK_RED:    mov     byte ptr [DSKOP], 2     ; INT 13h AH=02h, read
            jmp     short DSKIO
DSK_WRT:    mov     byte ptr [DSKOP], 3     ; INT 13h AH=03h, write
DSKIO:
            les     di, dword ptr [PTRSAV]
            mov     al, es:[di+R_UNIT]
            mov     [DSKUNIT], al
            mov     ax, es:[di+R_COUNT]
            mov     [DSKCNT], ax
            mov     ax, es:[di+R_START]
            mov     [DSKLSN], ax
            mov     ax, es:[di+R_TRANS]
            mov     [XFROFF], ax
            mov     ax, es:[di+R_TRANS+2]
            mov     [XFRSEG], ax
            mov     word ptr [DSKDONE], 0
DSKNEXT:
            mov     ax, [DSKDONE]
            cmp     ax, [DSKCNT]
            jb      DSKGO
            jmp     DSKOK           ; ASM-LIMIT-adjacent: JAE could not reach
                                    ; DSKOK across the retry path, so the
                                    ; sense is inverted around a near JMP
                                    ; rather than asking for longJumps
DSKGO:      add     ax, [DSKLSN]
            xor     dx, dx
            mov     bx, SPCYL
            div     bx                      ; AX = cylinder, DX = within it
            mov     ch, al                  ; 40 cylinders: the two high bits
                                            ; of CL stay clear
            mov     ax, dx
            xor     dx, dx
            mov     bx, SPT
            div     bx                      ; AX = head, DX = sector - 1
            mov     dh, al
            mov     cl, dl
            inc     cl                      ; sectors are 1-based on the wire
            mov     dl, [DSKUNIT]
            mov     es, [XFRSEG]
            mov     bx, [XFROFF]
            mov     al, 1                   ; one sector -- see the comment
            mov     ah, [DSKOP]
            int     13h
            jc      DSKRETRY
DSKSTEP:
            add     word ptr [XFROFF], 512
            jnc     DSKNOWRAP
            add     word ptr [XFRSEG], 1000h
DSKNOWRAP:
            inc     word ptr [DSKDONE]
            jmp     DSKNEXT

; One retry after a controller reset, which is what every floppy driver ever
; written does and what a real uPD765 will need. A second failure is reported
; with the count of what DID make it, because the DOS uses that count.
DSKRETRY:
            mov     ah, 0
            mov     dl, [DSKUNIT]
            int     13h                     ; reset
            mov     ax, [DSKDONE]
            add     ax, [DSKLSN]
            xor     dx, dx
            mov     bx, SPCYL
            div     bx
            mov     ch, al
            mov     ax, dx
            xor     dx, dx
            mov     bx, SPT
            div     bx
            mov     dh, al
            mov     cl, dl
            inc     cl
            mov     dl, [DSKUNIT]
            mov     es, [XFRSEG]
            mov     bx, [XFROFF]
            mov     al, 1
            mov     ah, [DSKOP]
            int     13h
            jnc     DSKSTEP
            mov     ax, [DSKDONE]
            call    SETCNT
            mov     ax, E_GENFAIL
            ret
DSKOK:
            mov     ax, [DSKDONE]
            call    SETCNT
            xor     ax, ax
            ret

; ===========================================================================
; RE_INIT. SYSINIT calls this FAR, after the DOS is up, with every register
; to be preserved. SYSINIT.DOC: "If you don't want anything done just set
; this to point at a FAR RET instruction." There is nothing this BIOS wants
; to do at that point, so that is precisely what it is -- and because it runs
; after the DOS has moved, it has to live in the RESIDENT part of the BIOS,
; not in the init code below.
;
; It is also the single most useful observation point in the whole boot: the
; only way to arrive here is for MSDOS.SYS's own DOSINIT to have returned.
; ===========================================================================
RE_INIT:    retf

; ===========================================================================
; INITIALISATION. Everything from here to BIOS_END is used once. It is not
; thrown away -- the resident BIOS is a fixed BIOSIZ bytes and the DOS is
; placed above it -- but nothing below is called again.
; ===========================================================================
HWINIT:
            cli
            mov     ax, BIOSSEG
            mov     ss, ax
            mov     sp, offset INITSTK
            sti
            cld

            ; Hand SYSINIT the five things SYSINIT.DOC says the OEM must set.
            mov     ax, SYSINITSEG
            mov     ds, ax
            mov     word ptr ds:[SI_CURDOS], DOSCUR
            mov     word ptr ds:[SI_FINDOS], DOSFIN
            mov     word ptr ds:[SI_DEVLIST], offset DEVSTART
            mov     word ptr ds:[SI_DEVLIST+2], BIOSSEG
            mov     word ptr ds:[SI_MEMSIZ], MEMSIZE
            ; DEFAULT_DRIVE is left at the 0 SYSINIT.OBJ ships. SYSINIT.DOC
            ; says "drive a=0"; the 2.11 source treats 0 as "don't set it"
            ; and 1 as A. Zero means drive A either way, which is the only
            ; reading both agree on.

            ; JMP FAR PTR SYSINITSEG:0000, hand-assembled.
            ; ASM-LIMIT: `jmp far ptr LABEL` needs a load-time segment and
            ; i8086-asm.js refuses it for a flat image, correctly -- but a
            ; literal seg:off far jump has no such problem and there is no
            ; syntax for one. Three directives say it exactly.
            db      0EAh
            dw      0
            dw      SYSINITSEG

; --- one-time stack, and the scratch the drivers use ------------------------
; The stack lives in the init area on purpose: by the time the DOS has been
; moved, SYSINIT is running on its own stack and this space is dead.
            db      128 dup(0)
INITSTK     LABEL   WORD

XFRSEG:     dw      0
XFROFF:     dw      0
REQCNT:     dw      0
DSKUNIT:    db      0
DSKOP:      db      0
DSKCNT:     dw      0
DSKLSN:     dw      0
DSKDONE:    dw      0
TKLO:       dw      0
T_SEC:      db      0
T_MIN:      db      0
T_HR:       db      0

BIOS_END    LABEL   BYTE

; ===========================================================================
; THE SYSINIT MESSAGE MODULE.
;
; SYSINIT.OBJ declares BADOPM, CRLFM, BADSIZ, BADLD, BADCOM and SYSSIZE as
; EXTERNAL. SYSINIT.DOC does not mention any of them -- it lists only the
; seven variables and RE_INIT -- so the first build against the documented
; interface links with six undefined symbols and no explanation. They come
; from Microsoft's SYSIMES.ASM, which contributes to SYSINITSEG, so their
; offsets have to be measured from SYSINITSEG's base and they have to sit
; immediately after the 1862 bytes SYSINIT.OBJ itself contributes.
;
; SYSSIZE is the one that matters most: it is not a message but the LABEL at
; the very end, and SYSINIT relocates (OFFSET SYSSIZE + 1) bytes of itself to
; the top of memory. Put the messages anywhere else and SYSINIT copies the
; wrong number of bytes to the wrong place and dies without a word.
;
; Strings are verbatim from v2.0/source/SYSIMES.ASM (MIT).
; ===========================================================================
            ORG     BIOSIZ + SI_SEGLEN

BADOPM:     db      13,10,"Unrecognized command in CONFIG.SYS"
CRLFM:      db      13,10,'$'
BADSIZ:     db      13,10,"Sector size too large in file $"
BADLD:      db      13,10,"Bad or missing $"
BADCOM:     db      "Command Interpreter",0
SYSSIZE     LABEL   BYTE

IOSYS_END   LABEL   BYTE

            END
