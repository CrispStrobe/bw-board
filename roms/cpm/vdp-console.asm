; TMS9918A text console for the Brickwright CP/M BIOS (MIT).
; Ports 98h (data) and 99h (control). The 40x24 text name table is at
; 0000h, with ASCII patterns at 0800h. Serial I/O remains on the MC6850.
VDPDATA EQU     098h
VDPCTL  EQU     099h

VDP_INIT:
        IN      A,(VDPCTL)       ; discard an incomplete control pair
        LD      HL,VDP_REGS
        LD      B,8
        LD      C,80h
VDP_INIT_REG:
        LD      A,(HL)
        OUT     (VDPCTL),A
        LD      A,C
        OUT     (VDPCTL),A
        INC     HL
        INC     C
        DJNZ    VDP_INIT_REG
        LD      HL,0900h          ; ASCII space is pattern 32
        CALL    VDP_WRITE
        LD      HL,VDP_FONT
        LD      DE,VDP_FONT_END-VDP_FONT
VDP_INIT_FONT:
        LD      A,(HL)
        OUT     (VDPDATA),A
        INC     HL
        DEC     DE
        LD      A,D
        OR      E
        JR      NZ,VDP_INIT_FONT
        CALL    VDP_CLEAR
        LD      A,0D0h           ; enable display, text mode, IRQ disabled
        OUT     (VDPCTL),A
        LD      A,81h
        OUT     (VDPCTL),A
        RET
VDP_REGS:
        DEFB    0,90h,0,0,1,0,0,0F1h

VDP_CHAR:
        PUSH    BC
        PUSH    DE
        PUSH    HL
        CALL    VDP_CHAR_IMPL
        POP     HL
        POP     DE
        POP     BC
        RET
VDP_CHAR_IMPL:
        CP      13
        JR      Z,VDP_CR
        CP      10
        JR      Z,VDP_LF
        CP      12
        JR      Z,VDP_CLEAR
        LD      HL,VDP_COL
        CP      8
        JR      Z,VDP_BS
        CP      32
        RET     C
        CP      127
        RET     NC
        CALL    VDP_ADDRESS
        CALL    VDP_WRITE
        LD      A,C
        OUT     (VDPDATA),A
        LD      HL,VDP_COL
        INC     (HL)
        LD      A,(HL)
        CP      40
        RET     C
        LD      (HL),0
VDP_LF:
        LD      HL,(VDP_ROW)
        LD      DE,40
        ADD     HL,DE
        LD      A,H
        CP      03h
        JR      C,VDP_SAVE_ROW
        LD      A,L
        CP      0C0h
        JR      C,VDP_SAVE_ROW
        LD      HL,40            ; copy the existing name table up one line
        LD      DE,0
        LD      BC,920
VDP_SCROLL:
        LD      A,L
        OUT     (VDPCTL),A
        LD      A,H
        OUT     (VDPCTL),A
        IN      A,(VDPDATA)
        PUSH    AF
        EX      DE,HL
        CALL    VDP_WRITE
        EX      DE,HL
        POP     AF
        OUT     (VDPDATA),A
        INC     HL
        INC     DE
        DEC     BC
        LD      A,B
        OR      C
        JR      NZ,VDP_SCROLL
        LD      HL,920
        CALL    VDP_WRITE
        LD      BC,40
        CALL    VDP_BLANK
        LD      HL,920
VDP_SAVE_ROW:
        LD      (VDP_ROW),HL
        RET
VDP_CR:
        XOR     A
        LD      (VDP_COL),A
        RET
VDP_BS:
        LD      A,(HL)
        OR      A
        RET     Z
        DEC     (HL)
        RET
VDP_CLEAR:
        LD      HL,0
        LD      (VDP_ROW),HL
        LD      (VDP_COL),HL      ; high byte occupies VDP_CLEAR_PAD
        CALL    VDP_WRITE
        LD      BC,960
VDP_BLANK:
        LD      A,32
        OUT     (VDPDATA),A
        DEC     BC
        LD      A,B
        OR      C
        JR      NZ,VDP_BLANK
        RET
VDP_ADDRESS:
        LD      E,(HL)
        LD      D,0
        LD      HL,(VDP_ROW)
        ADD     HL,DE
        RET
VDP_WRITE:
        LD      A,L
        OUT     (VDPCTL),A
        LD      A,H
        OR      40h
        OUT     (VDPCTL),A
        RET
VDP_ROW:
        DEFW    0
VDP_COL:
        DEFB    0
VDP_CLEAR_PAD:
        DEFB    0
VDP_FONT:
        INCBIN  "vdp-font.bin"
VDP_FONT_END:
