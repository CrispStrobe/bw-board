; SPDX-License-Identifier: MIT
; Independently implemented KIM-1 keypad, fixed-rate terminal and paper tape.
.setcpu "6502"

KbdA     = $1740
KbdDA    = $1741
KbdB     = $1742
KbdDB    = $1743

SavedLo  = $EF
SavedHi  = $F0
SavedP   = $F1
SavedSP  = $F2
SavedA   = $F3
SavedY   = $F4
SavedX   = $F5
TapeLo   = $F6
TapeHi   = $F7
DataByte = $F9
AddrLo   = $FA
AddrHi   = $FB

EditMode = $17C0
HeldKey  = $17C1
Device   = $17C2
RawChar  = $17C3
EntryLo  = $17C4
EntryHi  = $17C5
HaveHex  = $17C6
ShiftReg = $17C7
HalfHex  = $17C8
SumLo    = $17C9
SumHi    = $17CA
Records  = $17CB
RecordsH = $17CC
ByteCount= $17CD
LastBlock= $17CE
LedVal   = $17CF

DumpEnd  = $17F7
SoftNmi  = $17FA
SoftIrq  = $17FE

TTYIdle = $1F
KeyIdle = $3F
NoKey   = 21

.export MonitorNmi, MonitorWarm, HexOut, GetChar, InitIo, OutChar
.export AnyKey, ScanAddress, ScanBytes, IncrementAddress, GetKey

.segment "NMI"
MonitorNmi:
    jmp SaveInterrupt

.segment "STARTUP"
Reset:
    sei
    cld
    ldx #$FF
    txs
    lda #0
    ldx #$0C
@clear:
    sta SavedLo,x
    dex
    bpl @clear
    sta EditMode
    lda #$24
    sta SavedP
    stx SavedSP
    lda #NoKey
    sta HeldKey
    jsr SetSoftVectors
    jsr InitIo
    lda KbdA
    and #1
    sta Device
    bne @keypad
    jsr GetChar
    jmp TerminalStart
@keypad:
    jmp PanelLoop

.segment "WARM"
MonitorWarm:
    jmp ResumeMonitor

.segment "PANEL"
SetSoftVectors:
    lda SoftNmi
    ora SoftNmi+1
    bne @irq
    lda #<MonitorNmi
    sta SoftNmi
    lda #>MonitorNmi
    sta SoftNmi+1
@irq:
    lda SoftIrq
    ora SoftIrq+1
    bne @done
    lda #<MonitorNmi
    sta SoftIrq
    lda #>MonitorNmi
    sta SoftIrq+1
@done:
    rts

NmiVector:
    jmp (SoftNmi)
IrqVector:
    jmp (SoftIrq)

SaveInterrupt:
    sta SavedA
    sty SavedY
    stx SavedX
    pla
    sta SavedP
    pla
    sta SavedLo
    sta AddrLo
    pla
    sta SavedHi
    sta AddrHi
    tsx
    stx SavedSP
    cld
    lda #0
    sta EditMode
    jsr InitIo
    jmp ResumeMonitor

ResumeMonitor:
    cld
    lda Device
    beq @terminal
    jmp PanelLoop
@terminal:
    jmp TerminalStart

RunAddress:
    ldx SavedSP
    txs
    lda AddrHi
    pha
    lda AddrLo
    pha
    lda SavedP
    pha
    ldy SavedY
    ldx SavedX
    lda SavedA
    rti

PanelLoop:
    jsr ScanAddress
    jsr GetKey
    cmp #NoKey
    bne @keyPresent
    sta HeldKey
    jmp PanelLoop
@keyPresent:
    ldx HeldKey
    cpx #NoKey
    bne PanelLoop
    sta HeldKey
    cmp #16
    bcs @function
    ldx EditMode
    bne @memory
    ldx #4
@rollAddress:
    asl AddrLo
    rol AddrHi
    dex
    bne @rollAddress
    ora AddrLo
    sta AddrLo
    jmp PanelLoop
@memory:
    sta LedVal
    ldy #0
    lda (AddrLo),y
    asl a
    asl a
    asl a
    asl a
    ora LedVal
    sta (AddrLo),y
    jmp PanelLoop
@function:
    cmp #16
    bne @data
    lda #0
    sta EditMode
    jmp PanelLoop
@data:
    cmp #17
    bne @advance
    lda #1
    sta EditMode
    jmp PanelLoop
@advance:
    cmp #18
    bne @go
    jsr IncrementAddress
    jmp PanelLoop
@go:
    cmp #19
    beq RunAddress
    lda SavedLo
    sta AddrLo
    lda SavedHi
    sta AddrHi
    lda #0
    sta EditMode
    jmp PanelLoop

ReadMatrix:
    php
    cld
    lda #0
    sta KbdDA
    ldy #$21
    ldx #0
@row:
    sty KbdB
    lda KbdA
    eor #$7F
    and #$7F
    bne @column
    txa
    clc
    adc #7
    tax
    iny
    iny
    cpy #$27
    bne @row
    beq @done
@nextColumn:
    inx
@column:
    asl a
    bpl @nextColumn
@done:
    lda #KeyIdle
    sta KbdB
    plp
    txa
    rts

.segment "HEXOUT"
HexOut:
    jmp SendNibble

.segment "GETCH"
GetChar:
    jmp ReceiveChar

.segment "PANEL"
ReceiveChar:
    txa
    pha
    tya
    pha
    lda #TTYIdle
    sta KbdB
    ldx #8
@start:
    bit KbdA
    bmi @start
    jsr HalfBit
@sample:
    jsr FullBit
    lda KbdA
    asl a
    ror ShiftReg
    dex
    bne @sample
    jsr FullBit
    pla
    tay
    pla
    tax
    lda ShiftReg
    and #$7F
    rts

.segment "IO"
InitIo:
    jmp PrepareIo

.segment "IOBODY"
PrepareIo:
    lda #0
    sta KbdDA
    lda #KeyIdle
    sta KbdB
    sta KbdDB
    rts

.segment "OUTCH"
OutChar:
    jmp TransmitChar

.segment "TX"
TransmitChar:
    pha
    sta ShiftReg
    txa
    pha
    tya
    pha
    ldx #8
    lda #TTYIdle-1
    sta KbdB
    jsr FullBit
@bit:
    lsr ShiftReg
    lda #TTYIdle-1
    bcc @send
    ora #1
@send:
    sta KbdB
    jsr FullBit
    dex
    bne @bit
    lda #TTYIdle
    sta KbdB
    jsr FullBit
    pla
    tay
    pla
    tax
    pla
    rts

; At 1 MHz, one serial bit spans approximately 3333 cycles.
; Keep each delay loop physically within one page.
FullBit:
    txa
    pha
    ldy #3
@outer:
    ldx #218
@inner:
    dex
    bne @inner
    dey
    bne @outer
    pla
    tax
    rts

HalfBit:
    txa
    pha
    ldy #2
@outer:
    ldx #163
@inner:
    dex
    bne @inner
    dey
    bne @outer
    pla
    tax
    rts

.segment "AK"
AnyKey:
    jmp CheckMatrix

.segment "UTIL"
CheckMatrix:
    jsr GetKey
    cmp #NoKey
    beq @no
    lda #1
    rts
@no:
    lda #0
    rts

.segment "SCAND"
ScanAddress:
    jmp RefreshAddress

.segment "SCANDS"
ScanBytes:
    jmp RefreshBytes

.segment "SEGMENTS7"
HexSegments:
    .byte $3F,$06,$5B,$4F,$66,$6D,$7D,$07
    .byte $7F,$6F,$77,$7C,$39,$5E,$79,$71

.segment "INCPTR"
IncrementAddress:
    inc AddrLo
    bne @done
    inc AddrHi
@done:
    rts

.segment "GETKEY"
GetKey:
    jmp ReadMatrix

.segment "DISPLAY"
RefreshAddress:
    pha
    tya
    pha
    ldy #0
    lda (AddrLo),y
    sta DataByte
    pla
    tay
    pla
RefreshBytes:
    pha
    txa
    pha
    tya
    pha
    lda #$7F
    sta KbdDA
    ldx #2
@next:
    lda DataByte,x
    lsr a
    lsr a
    lsr a
    lsr a
    ldy FirstDigit,x
    jsr RefreshDigit
    lda DataByte,x
    and #$0F
    ldy SecondDigit,x
    jsr RefreshDigit
    dex
    bpl @next
    lda #KeyIdle
    sta KbdB
    pla
    tay
    pla
    tax
    pla
    rts

RefreshDigit:
    sty LedVal
    pha
    lda #KeyIdle
    sta KbdB
    pla
    tay
    lda HexSegments,y
    sta KbdA
    lda LedVal
    sta KbdB
    ldy #28
@delay:
    dey
    bne @delay
    rts

FirstDigit:
    .byte $31,$2D,$29
SecondDigit:
    .byte $33,$2F,$2B

.segment "VECTORS"
    .word NmiVector, Reset, IrqVector

; The board has no audio cassette signal path. Keep both entry slots
; available and return to the monitor if entered from the front panel.
.segment "CASSETTE_0"
    jmp ResumeMonitor

.segment "CASSETTE_1"
    jmp ResumeMonitor

.segment "TEXT"
TerminalStart:
    lda #13
    jsr OutChar
    lda #10
    jsr OutChar
    lda #'K'
    jsr OutChar
    lda #'I'
    jsr OutChar
    lda #'M'
    jsr OutChar
    lda #'>'
    jsr OutChar
TerminalClear:
    lda #0
    sta HaveHex
    sta EntryLo
    sta EntryHi
TerminalLoop:
    jsr GetChar
    sta RawChar
    jsr AsciiHex
    bcc @command
    ldx #4
@roll:
    asl EntryLo
    rol EntryHi
    dex
    bne @roll
    ora EntryLo
    sta EntryLo
    lda #1
    sta HaveHex
    jmp TerminalLoop
@command:
    lda RawChar
    cmp #$7F
    beq TerminalStart
    cmp #' '
    beq TerminalSelect
    cmp #'.'
    beq TerminalWrite
    cmp #'+'
    beq TerminalNext
    cmp #13
    beq TerminalNext
    cmp #'-'
    beq TerminalPrevious
    cmp #10
    beq TerminalPrevious
    and #$DF
    cmp #'G'
    beq TerminalGo
    cmp #'L'
    bne @maybeDump
    jmp PaperLoad
@maybeDump:
    cmp #'Q'
    bne TerminalLoop
    jmp PaperDump

TerminalGo:
    jsr AcceptAddress
    jmp RunAddress

TerminalSelect:
    jsr AcceptAddress
    jmp ReportAddress

AcceptAddress:
    lda HaveHex
    beq @unchanged
    lda EntryLo
    sta AddrLo
    lda EntryHi
    sta AddrHi
@unchanged:
    rts

TerminalWrite:
    lda HaveHex
    beq ReportAddress
    ldy #0
    lda EntryLo
    sta (AddrLo),y
TerminalNext:
    jsr IncrementAddress
    jmp ReportAddress

TerminalPrevious:
    lda AddrLo
    bne @samePage
    dec AddrHi
@samePage:
    dec AddrLo
ReportAddress:
    jsr LineBreak
    lda AddrHi
    jsr SendHexByte
    lda AddrLo
    jsr SendHexByte
    lda #' '
    jsr OutChar
    ldy #0
    lda (AddrLo),y
    jsr SendHexByte
    jmp TerminalClear

LineBreak:
    lda #13
    jsr OutChar
    lda #10
    jmp OutChar

; C is set for a hexadecimal digit on return.
AsciiHex:
    cmp #'0'
    bcc @invalid
    cmp #'9'+1
    bcs @letter
    sbc #'0'-1
    sec
    rts
@letter:
    and #$DF
    cmp #'A'
    bcc @invalid
    cmp #'F'+1
    bcs @invalid
    sbc #'A'-11
    sec
    rts
@invalid:
    clc
    rts

SendHexByte:
    pha
    lsr a
    lsr a
    lsr a
    lsr a
    jsr SendNibble
    pla
SendNibble:
    php
    cld
    and #$0F
    cmp #10
    bcc @digit
    adc #6
@digit:
    adc #'0'
    plp
    jmp OutChar

PaperLoad:
    jsr ResetRecords
@leader:
    jsr GetChar
    cmp #';'
    bne @leader
    jsr ResetSum
    jsr ReadSumByte
    bcc PaperError
    sta ByteCount
    jsr ReadSumByte
    bcc PaperError
    sta TapeHi
    jsr ReadSumByte
    bcc PaperError
    sta TapeLo
    ldx ByteCount
    beq @check
    ldy #0
@data:
    jsr ReadSumByte
    bcc PaperError
    sta (TapeLo),y
    iny
    dex
    bne @data
@check:
    jsr ReadHexByte
    bcc PaperError
    cmp SumHi
    bne PaperError
    jsr ReadHexByte
    bcc PaperError
    cmp SumLo
    bne PaperError
    lda ByteCount
    beq @eof
    jsr CountRecord
    jmp @leader
@eof:
    lda TapeHi
    cmp RecordsH
    bne PaperError
    lda TapeLo
    cmp Records
    bne PaperError
    jsr LineBreak
    lda #'O'
    jsr OutChar
    lda #'K'
    jsr OutChar
    jmp TerminalStart

PaperError:
    jsr LineBreak
    lda #'E'
    jsr OutChar
    lda #'R'
    jsr OutChar
    jsr OutChar
    jmp TerminalStart

ReadSumByte:
    jsr ReadHexByte
    bcc @invalid
    jsr AddChecksum
    sec
@invalid:
    rts

ReadHexByte:
    jsr GetChar
    jsr AsciiHex
    bcc @invalid
    asl a
    asl a
    asl a
    asl a
    sta HalfHex
    jsr GetChar
    jsr AsciiHex
    bcc @invalid
    ora HalfHex
@invalid:
    rts

ResetRecords:
    lda #0
    sta Records
    sta RecordsH
    rts

CountRecord:
    inc Records
    bne @done
    inc RecordsH
@done:
    rts

ResetSum:
    lda #0
    sta SumLo
    sta SumHi
    rts

AddChecksum:
    pha
    clc
    adc SumLo
    sta SumLo
    bcc @done
    inc SumHi
@done:
    pla
    rts

PaperDump:
    jsr ResetRecords
    jsr LineBreak
    lda AddrLo
    sta TapeLo
    lda AddrHi
    sta TapeHi
@remaining:
    sec
    lda DumpEnd
    sbc TapeLo
    tax
    lda DumpEnd+1
    sbc TapeHi
    bcc @eof
    bne @full
    cpx #24
    bcs @full
    inx
    lda #1
    bne @record
@full:
    ldx #24
    lda #0
@record:
    sta LastBlock
    stx ByteCount
    jsr StartRecord
    lda ByteCount
    jsr WriteSumByte
    lda TapeHi
    jsr WriteSumByte
    lda TapeLo
    jsr WriteSumByte
    ldy #0
@write:
    lda (TapeLo),y
    jsr WriteSumByte
    iny
    cpy ByteCount
    bne @write
    jsr EndRecord
    jsr CountRecord
    lda LastBlock
    bne @eof
    tya
    clc
    adc TapeLo
    sta TapeLo
    bcc @remaining
    inc TapeHi
    jmp @remaining
@eof:
    jsr StartRecord
    lda #0
    jsr WriteSumByte
    lda RecordsH
    jsr WriteSumByte
    lda Records
    jsr WriteSumByte
    jsr EndRecord
    lda #$13
    jsr OutChar
    jmp TerminalStart

StartRecord:
    jsr ResetSum
    lda #';'
    jmp OutChar

WriteSumByte:
    jsr AddChecksum
    jmp SendHexByte

EndRecord:
    lda SumHi
    jsr SendHexByte
    lda SumLo
    jsr SendHexByte
    jmp LineBreak
