; CP/M 2.2 BIOS for bw-board Z80Machine (SEARLE-style)
; Console: MC6850 ACIA at ports $80/$81
; Disk: host-side RAM disk via ports $10-$15
;
; Written for the bw-board project (MIT).

MSIZE   EQU     64
CCP     EQU     (MSIZE-7)*1024          ; E400h
BDOSE   EQU     CCP + 0806h             ; EC06h
NSECTS  EQU     44                      ; CCP+BDOS = 0x1600 bytes / 128

; MC6850 ports
ACIACTL EQU     80h
ACIADT  EQU     81h

; Disk I/O ports (host-side RAM-disk controller)
DSKDRV  EQU     10h
DSKTRK  EQU     11h
DSKSEC  EQU     12h
DSKDMAL EQU     13h
DSKDMAH EQU     14h
DSKCMD  EQU     15h                     ; OUT 0=read, 1=write; IN=result

        ORG     0FA00h

; === BIOS jump table (17 entries) ===
        JP      CBOOT
        JP      WBOOT
        JP      BCONST
        JP      BCONIN
        JP      BCONOUT
        JP      BLIST
        JP      BPUNCH
        JP      BREADER
        JP      BHOME
        JP      BSELDSK
        JP      BSETTRK
        JP      BSETSEC
        JP      BSETDMA
        JP      BREAD
        JP      BWRITE
        JP      BPRSTAT
        JP      BSECTRN

; === Cold boot ===
CBOOT:  DI
        LD      SP,80h
        LD      A,03h                   ; MC6850 master reset
        OUT     (ACIACTL),A
        LD      A,15h                   ; 8N1, divide-by-16, no IRQ
        OUT     (ACIACTL),A
        XOR     A
        LD      (4),A                   ; current drive = A:
        JP      GOCPM

; === Warm boot ===
WBOOT:  DI
        LD      SP,80h
        ; Reload CCP+BDOS from system tracks (drive A:, tracks 0-1)
        XOR     A
        OUT     (DSKDRV),A              ; drive A:
        LD      C,0                     ; track
        LD      D,1                     ; sector (1-based physical)
        LD      HL,CCP                  ; DMA destination
        LD      B,NSECTS
WBLP:   PUSH    BC
        PUSH    DE
        PUSH    HL
        LD      A,C
        OUT     (DSKTRK),A
        LD      A,D
        OUT     (DSKSEC),A
        LD      A,L
        OUT     (DSKDMAL),A
        LD      A,H
        OUT     (DSKDMAH),A
        XOR     A
        OUT     (DSKCMD),A              ; read sector
        IN      A,(DSKCMD)
        POP     HL
        POP     DE
        POP     BC
        OR      A
        JP      NZ,WBOOT                ; retry on error
        ; Advance DMA by 128
        PUSH    BC
        LD      BC,128
        ADD     HL,BC
        POP     BC
        ; Advance sector
        INC     D
        LD      A,D
        CP      27                      ; > 26 sectors/track?
        JP      C,WBSK
        LD      D,1                     ; wrap to sector 1
        INC     C                       ; next track
WBSK:   DJNZ    WBLP
        ; fall through

; === Set up page zero and enter CCP ===
GOCPM:  LD      A,0C3h                  ; JP opcode
        LD      (0),A
        LD      HL,WBOOT
        LD      (1),HL                  ; 0000: JP WBOOT
        LD      (5),A
        LD      HL,BDOSE
        LD      (6),HL                  ; 0005: JP BDOS
        LD      BC,80h
        CALL    BSETDMA                 ; default DMA
        EI
        LD      A,(4)                   ; current drive
        LD      C,A
        JP      CCP                     ; enter CCP

; === Console status ===
BCONST: IN      A,(ACIACTL)
        AND     01h                     ; RDRF
        RET     Z                       ; 0 = no char
        LD      A,0FFh
        RET                             ; FF = char ready

; === Console input (blocking) ===
BCONIN: IN      A,(ACIACTL)
        AND     01h
        JP      Z,BCONIN               ; spin until char
        IN      A,(ACIADT)
        AND     7Fh                     ; strip parity
        RET

; === Console output (char in C) ===
BCONOUT:IN      A,(ACIACTL)
        AND     02h                     ; TDRE
        JP      Z,BCONOUT              ; wait (always ready in model)
        LD      A,C
        OUT     (ACIADT),A
        RET

; === List / punch / reader stubs ===
BLIST:  LD      A,C
        OUT     (ACIADT),A              ; echo to console
        RET
BPUNCH: RET
BREADER:LD      A,1Ah                   ; ^Z = EOF
        RET

; === Disk: home ===
BHOME:  LD      C,0
        ; fall through to SETTRK

; === Disk: set track (BC) ===
BSETTRK:LD      A,C
        LD      (TRKNO),A
        RET

; === Disk: select disk (C=drive, returns HL=DPH or 0) ===
BSELDSK:LD      HL,0
        LD      A,C
        OR      A                       ; only drive A:
        RET     NZ
        LD      HL,DPH0
        RET

; === Disk: set sector (BC, already translated via SECTRN) ===
BSETSEC:LD      A,C
        LD      (SECNO),A
        RET

; === Disk: set DMA (BC) ===
BSETDMA:LD      A,C
        LD      (DMALO),A
        LD      A,B
        LD      (DMAHI),A
        RET

; === Disk: read sector → DMA ===
BREAD:  CALL    DSKIO_SETUP
        XOR     A                       ; 0 = read
        OUT     (DSKCMD),A
        IN      A,(DSKCMD)              ; result: 0=ok
        RET

; === Disk: write sector from DMA ===
BWRITE: CALL    DSKIO_SETUP
        LD      A,1                     ; 1 = write
        OUT     (DSKCMD),A
        IN      A,(DSKCMD)              ; result: 0=ok
        RET

; helper: push drive/track/sector/DMA to ports
DSKIO_SETUP:
        XOR     A
        OUT     (DSKDRV),A              ; always drive A:
        LD      A,(TRKNO)
        OUT     (DSKTRK),A
        LD      A,(SECNO)
        OUT     (DSKSEC),A
        LD      A,(DMALO)
        OUT     (DSKDMAL),A
        LD      A,(DMAHI)
        OUT     (DSKDMAH),A
        RET

; === Printer status ===
BPRSTAT:XOR     A                       ; not ready
        RET

; === Sector translation (logical in BC, table in DE → result in HL) ===
; Standard CP/M SECTRN: if DE=0 return BC unchanged, else index table.
BSECTRN:LD      A,D
        OR      E
        LD      H,B
        LD      L,C
        RET     Z                       ; no table → 1:1
        EX      DE,HL                   ; HL = table base
        ADD     HL,BC                   ; HL = table + logical sector
        LD      L,(HL)
        LD      H,0
        RET

; === Sector translation table: logical 0..25 → physical 1..26 ===
; (BDOS sector numbers are 0-based; physical are 1-based for our disk)
XLTTBL: DEFB    1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13
        DEFB    14,15,16,17,18,19,20,21,22,23,24,25,26

; === Data area ===
TRKNO:  DEFB    0
SECNO:  DEFB    0
DMALO:  DEFB    80h
DMAHI:  DEFB    0

; Disk Parameter Header, drive A:
DPH0:   DEFW    XLTTBL                  ; XLT (sector translation table)
        DEFW    0,0,0                   ; scratch
        DEFW    DIRBUF                  ; directory buffer
        DEFW    DPB0                    ; DPB pointer
        DEFW    CSV0                    ; check vector
        DEFW    ALV0                    ; alloc vector

; Disk Parameter Block (8" single-density style)
; 26 spt, 1K blocks, 243 blocks, 64 dir entries, 2 reserved tracks
DPB0:   DEFW    26                      ; SPT
        DEFB    3                       ; BSH
        DEFB    7                       ; BLM
        DEFB    0                       ; EXM
        DEFW    242                     ; DSM (blocks 0..242)
        DEFW    63                      ; DRM (64 entries)
        DEFB    0C0h                    ; AL0
        DEFB    0                       ; AL1
        DEFW    16                      ; CKS
        DEFW    2                       ; OFS (reserved tracks)

DIRBUF: DEFS    128
CSV0:   DEFS    16
ALV0:   DEFS    31

        END
