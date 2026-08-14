;--------------------------------------------------------
; File Created by SDCC : free open source ANSI-C Compiler
; Version 4.2.0 #13081 (Linux)
;--------------------------------------------------------
	.module irda
	.optsdcc -mmcs51 --model-small
	
;--------------------------------------------------------
; Public variables in this module
;--------------------------------------------------------
	.globl _segment_map
	.globl _main
	.globl _delay
	.globl _int0_isr
	.globl _tf0_isr
	.globl _ext_init
	.globl _timer0_init
	.globl _CY
	.globl _AC
	.globl _F0
	.globl _RS1
	.globl _RS0
	.globl _OV
	.globl _F1
	.globl _P
	.globl _PS
	.globl _PT1
	.globl _PX1
	.globl _PT0
	.globl _PX0
	.globl _RD
	.globl _WR
	.globl _T1
	.globl _T0
	.globl _INT1
	.globl _INT0
	.globl _TXD
	.globl _RXD
	.globl _P3_7
	.globl _P3_6
	.globl _P3_5
	.globl _P3_4
	.globl _P3_3
	.globl _P3_2
	.globl _P3_1
	.globl _P3_0
	.globl _EA
	.globl _ES
	.globl _ET1
	.globl _EX1
	.globl _ET0
	.globl _EX0
	.globl _P2_7
	.globl _P2_6
	.globl _P2_5
	.globl _P2_4
	.globl _P2_3
	.globl _P2_2
	.globl _P2_1
	.globl _P2_0
	.globl _SM0
	.globl _SM1
	.globl _SM2
	.globl _REN
	.globl _TB8
	.globl _RB8
	.globl _TI
	.globl _RI
	.globl _P1_7
	.globl _P1_6
	.globl _P1_5
	.globl _P1_4
	.globl _P1_3
	.globl _P1_2
	.globl _P1_1
	.globl _P1_0
	.globl _TF1
	.globl _TR1
	.globl _TF0
	.globl _TR0
	.globl _IE1
	.globl _IT1
	.globl _IE0
	.globl _IT0
	.globl _P0_7
	.globl _P0_6
	.globl _P0_5
	.globl _P0_4
	.globl _P0_3
	.globl _P0_2
	.globl _P0_1
	.globl _P0_0
	.globl _B
	.globl _ACC
	.globl _PSW
	.globl _IP
	.globl _P3
	.globl _IE
	.globl _P2
	.globl _SBUF
	.globl _SCON
	.globl _P1
	.globl _TH1
	.globl _TH0
	.globl _TL1
	.globl _TL0
	.globl _TMOD
	.globl _TCON
	.globl _PCON
	.globl _DPH
	.globl _DPL
	.globl _SP
	.globl _P0
	.globl _last_pattern
	.globl _pattern
	.globl _pulse_count
	.globl _ms_counter
;--------------------------------------------------------
; special function registers
;--------------------------------------------------------
	.area RSEG    (ABS,DATA)
	.org 0x0000
_P0	=	0x0080
_SP	=	0x0081
_DPL	=	0x0082
_DPH	=	0x0083
_PCON	=	0x0087
_TCON	=	0x0088
_TMOD	=	0x0089
_TL0	=	0x008a
_TL1	=	0x008b
_TH0	=	0x008c
_TH1	=	0x008d
_P1	=	0x0090
_SCON	=	0x0098
_SBUF	=	0x0099
_P2	=	0x00a0
_IE	=	0x00a8
_P3	=	0x00b0
_IP	=	0x00b8
_PSW	=	0x00d0
_ACC	=	0x00e0
_B	=	0x00f0
;--------------------------------------------------------
; special function bits
;--------------------------------------------------------
	.area RSEG    (ABS,DATA)
	.org 0x0000
_P0_0	=	0x0080
_P0_1	=	0x0081
_P0_2	=	0x0082
_P0_3	=	0x0083
_P0_4	=	0x0084
_P0_5	=	0x0085
_P0_6	=	0x0086
_P0_7	=	0x0087
_IT0	=	0x0088
_IE0	=	0x0089
_IT1	=	0x008a
_IE1	=	0x008b
_TR0	=	0x008c
_TF0	=	0x008d
_TR1	=	0x008e
_TF1	=	0x008f
_P1_0	=	0x0090
_P1_1	=	0x0091
_P1_2	=	0x0092
_P1_3	=	0x0093
_P1_4	=	0x0094
_P1_5	=	0x0095
_P1_6	=	0x0096
_P1_7	=	0x0097
_RI	=	0x0098
_TI	=	0x0099
_RB8	=	0x009a
_TB8	=	0x009b
_REN	=	0x009c
_SM2	=	0x009d
_SM1	=	0x009e
_SM0	=	0x009f
_P2_0	=	0x00a0
_P2_1	=	0x00a1
_P2_2	=	0x00a2
_P2_3	=	0x00a3
_P2_4	=	0x00a4
_P2_5	=	0x00a5
_P2_6	=	0x00a6
_P2_7	=	0x00a7
_EX0	=	0x00a8
_ET0	=	0x00a9
_EX1	=	0x00aa
_ET1	=	0x00ab
_ES	=	0x00ac
_EA	=	0x00af
_P3_0	=	0x00b0
_P3_1	=	0x00b1
_P3_2	=	0x00b2
_P3_3	=	0x00b3
_P3_4	=	0x00b4
_P3_5	=	0x00b5
_P3_6	=	0x00b6
_P3_7	=	0x00b7
_RXD	=	0x00b0
_TXD	=	0x00b1
_INT0	=	0x00b2
_INT1	=	0x00b3
_T0	=	0x00b4
_T1	=	0x00b5
_WR	=	0x00b6
_RD	=	0x00b7
_PX0	=	0x00b8
_PT0	=	0x00b9
_PX1	=	0x00ba
_PT1	=	0x00bb
_PS	=	0x00bc
_P	=	0x00d0
_F1	=	0x00d1
_OV	=	0x00d2
_RS0	=	0x00d3
_RS1	=	0x00d4
_F0	=	0x00d5
_AC	=	0x00d6
_CY	=	0x00d7
;--------------------------------------------------------
; overlayable register banks
;--------------------------------------------------------
	.area REG_BANK_0	(REL,OVR,DATA)
	.ds 8
;--------------------------------------------------------
; internal ram data
;--------------------------------------------------------
	.area DSEG    (DATA)
_ms_counter::
	.ds 1
_pulse_count::
	.ds 1
_pattern::
	.ds 4
_last_pattern::
	.ds 4
;--------------------------------------------------------
; overlayable items in internal ram
;--------------------------------------------------------
	.area	OSEG    (OVR,DATA)
;--------------------------------------------------------
; Stack segment in internal ram
;--------------------------------------------------------
	.area	SSEG
__start__stack:
	.ds	1

;--------------------------------------------------------
; indirectly addressable internal ram data
;--------------------------------------------------------
	.area ISEG    (DATA)
;--------------------------------------------------------
; absolute internal ram data
;--------------------------------------------------------
	.area IABS    (ABS,DATA)
	.area IABS    (ABS,DATA)
;--------------------------------------------------------
; bit data
;--------------------------------------------------------
	.area BSEG    (BIT)
;--------------------------------------------------------
; paged external ram data
;--------------------------------------------------------
	.area PSEG    (PAG,XDATA)
;--------------------------------------------------------
; external ram data
;--------------------------------------------------------
	.area XSEG    (XDATA)
;--------------------------------------------------------
; absolute external ram data
;--------------------------------------------------------
	.area XABS    (ABS,XDATA)
;--------------------------------------------------------
; external initialized ram data
;--------------------------------------------------------
	.area XISEG   (XDATA)
	.area HOME    (CODE)
	.area GSINIT0 (CODE)
	.area GSINIT1 (CODE)
	.area GSINIT2 (CODE)
	.area GSINIT3 (CODE)
	.area GSINIT4 (CODE)
	.area GSINIT5 (CODE)
	.area GSINIT  (CODE)
	.area GSFINAL (CODE)
	.area CSEG    (CODE)
;--------------------------------------------------------
; interrupt vector
;--------------------------------------------------------
	.area HOME    (CODE)
__interrupt_vect:
	ljmp	__sdcc_gsinit_startup
	ljmp	_int0_isr
	.ds	5
	ljmp	_tf0_isr
;--------------------------------------------------------
; global & static initialisations
;--------------------------------------------------------
	.area HOME    (CODE)
	.area GSINIT  (CODE)
	.area GSFINAL (CODE)
	.area GSINIT  (CODE)
	.globl __sdcc_gsinit_startup
	.globl __sdcc_program_startup
	.globl __start__stack
	.globl __mcs51_genXINIT
	.globl __mcs51_genXRAMCLEAR
	.globl __mcs51_genRAMCLEAR
;	08_irda/irda.c:41: uint8_t ms_counter = 0;
	mov	_ms_counter,#0x00
;	08_irda/irda.c:42: int8_t pulse_count = 0;
	mov	_pulse_count,#0x00
;	08_irda/irda.c:43: uint32_t pattern = 0;
	clr	a
	mov	_pattern,a
	mov	(_pattern + 1),a
	mov	(_pattern + 2),a
	mov	(_pattern + 3),a
;	08_irda/irda.c:44: uint32_t last_pattern = 0xFFFFFFFF;
	dec	a
	mov	_last_pattern,a
	mov	(_last_pattern + 1),a
	mov	(_last_pattern + 2),a
	mov	(_last_pattern + 3),a
	.area GSFINAL (CODE)
	ljmp	__sdcc_program_startup
;--------------------------------------------------------
; Home
;--------------------------------------------------------
	.area HOME    (CODE)
	.area HOME    (CODE)
__sdcc_program_startup:
	ljmp	_main
;	return from main will return to caller
;--------------------------------------------------------
; code
;--------------------------------------------------------
	.area CSEG    (CODE)
;------------------------------------------------------------
;Allocation info for local variables in function 'timer0_init'
;------------------------------------------------------------
;	08_irda/irda.c:24: void timer0_init(void) {
;	-----------------------------------------
;	 function timer0_init
;	-----------------------------------------
_timer0_init:
	ar7 = 0x07
	ar6 = 0x06
	ar5 = 0x05
	ar4 = 0x04
	ar3 = 0x03
	ar2 = 0x02
	ar1 = 0x01
	ar0 = 0x00
;	08_irda/irda.c:25: TMOD &= 0xF0;	/* Clear Timer 0 mode bits */
	anl	_TMOD,#0xf0
;	08_irda/irda.c:26: TMOD |= 0x1;	/* Set Timer 0 mode to 16-bit */
	orl	_TMOD,#0x01
;	08_irda/irda.c:27: TH0 = 0xfc;	/* Set Timer 0 high byte for 16-bit mode */
	mov	_TH0,#0xfc
;	08_irda/irda.c:28: TL0 = 0x18;	/* Set Timer 0 low byte for 16-bit mode */
	mov	_TL0,#0x18
;	08_irda/irda.c:29: TF0 = 0;	/* Clear Timer 0 overflow flag */
;	assignBit
	clr	_TF0
;	08_irda/irda.c:30: TR0 = 1;	/* Start Timer 0 */
;	assignBit
	setb	_TR0
;	08_irda/irda.c:33: ET0 = 1;
;	assignBit
	setb	_ET0
;	08_irda/irda.c:34: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'ext_init'
;------------------------------------------------------------
;	08_irda/irda.c:36: void ext_init(void) {
;	-----------------------------------------
;	 function ext_init
;	-----------------------------------------
_ext_init:
;	08_irda/irda.c:37: IT0 = 1;	/* INT0 (P3.2) Falling Edge */
;	assignBit
	setb	_IT0
;	08_irda/irda.c:38: EX0 = 1;	/* Enable INT0 (P3.2) */
;	assignBit
	setb	_EX0
;	08_irda/irda.c:39: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'tf0_isr'
;------------------------------------------------------------
;	08_irda/irda.c:46: void tf0_isr(void) __interrupt(TF0_VECTOR) {
;	-----------------------------------------
;	 function tf0_isr
;	-----------------------------------------
_tf0_isr:
	push	acc
	push	psw
;	08_irda/irda.c:47: P3_4 = !P3_4; // Heartbeat on P3.3
	cpl	_P3_4
;	08_irda/irda.c:49: TH0 = 0xfc;	/* Set Timer 0 high byte for 16-bit mode */
	mov	_TH0,#0xfc
;	08_irda/irda.c:50: TL0 = 0x18;	/* Set Timer 0 low byte for 16-bit mode */
	mov	_TL0,#0x18
;	08_irda/irda.c:51: if(ms_counter<50) {
	mov	a,#0x100 - 0x32
	add	a,_ms_counter
	jc	00103$
;	08_irda/irda.c:52: ms_counter++;
	inc	_ms_counter
00103$:
;	08_irda/irda.c:54: }
	pop	psw
	pop	acc
	reti
;	eliminated unneeded mov psw,# (no regs used in bank)
;	eliminated unneeded push/pop dpl
;	eliminated unneeded push/pop dph
;	eliminated unneeded push/pop b
;------------------------------------------------------------
;Allocation info for local variables in function 'int0_isr'
;------------------------------------------------------------
;cur_timer                 Allocated to registers r7 
;------------------------------------------------------------
;	08_irda/irda.c:56: void int0_isr(void) __interrupt(IE0_VECTOR) {
;	-----------------------------------------
;	 function int0_isr
;	-----------------------------------------
_int0_isr:
	push	acc
	push	b
	push	ar7
	push	ar6
	push	ar5
	push	ar4
	push	psw
	mov	psw,#0x00
;	08_irda/irda.c:57: uint8_t cur_timer = ms_counter;
	mov	r7,_ms_counter
;	08_irda/irda.c:60: ms_counter = 0;
	mov	_ms_counter,#0x00
;	08_irda/irda.c:61: TH0 = 0xfc;	/* Set Timer 0 high byte for 16-bit mode */
	mov	_TH0,#0xfc
;	08_irda/irda.c:62: TL0 = 0x18;	/* Set Timer 0 low byte for 16-bit mode */
	mov	_TL0,#0x18
;	08_irda/irda.c:64: pulse_count++;
	inc	_pulse_count
;	08_irda/irda.c:66: if(cur_timer == 50) {
	cjne	r7,#0x32,00107$
;	08_irda/irda.c:68: pulse_count = -2; // Ignore sync edges
	mov	_pulse_count,#0xfe
;	08_irda/irda.c:69: pattern = 0;      // Reset pattern
	clr	a
	mov	_pattern,a
	mov	(_pattern + 1),a
	mov	(_pattern + 2),a
	mov	(_pattern + 3),a
	sjmp	00108$
00107$:
;	08_irda/irda.c:70: } else if(pulse_count >= 0 && pulse_count < 31) {
	mov	a,_pulse_count
	jb	acc.7,00108$
	clr	c
	mov	a,_pulse_count
	xrl	a,#0x80
	subb	a,#0x9f
	jnc	00108$
;	08_irda/irda.c:72: if(cur_timer>= 2) { // Threshold between 0 and 1
	cjne	r7,#0x02,00137$
00137$:
	jc	00108$
;	08_irda/irda.c:73: pattern |= 0x00000001 << (31 - pulse_count); // MSB first
	mov	r7,_pulse_count
	mov	a,#0x1f
	clr	c
	subb	a,r7
	mov	r7,a
	mov	b,r7
	inc	b
	mov	r7,#0x01
	mov	r6,#0x00
	sjmp	00140$
00139$:
	mov	a,r7
	add	a,r7
	mov	r7,a
	mov	a,r6
	rlc	a
	mov	r6,a
00140$:
	djnz	b,00139$
	mov	a,r6
	rlc	a
	subb	a,acc
	mov	r5,a
	mov	r4,a
	mov	a,r7
	orl	_pattern,a
	mov	a,r6
	orl	(_pattern + 1),a
	mov	a,r5
	orl	(_pattern + 2),a
	mov	a,r4
	orl	(_pattern + 3),a
00108$:
;	08_irda/irda.c:76: if(pulse_count >= 32) {
	clr	c
	mov	a,_pulse_count
	xrl	a,#0x80
	subb	a,#0xa0
	jc	00111$
;	08_irda/irda.c:78: last_pattern = pattern;
	mov	_last_pattern,_pattern
	mov	(_last_pattern + 1),(_pattern + 1)
	mov	(_last_pattern + 2),(_pattern + 2)
	mov	(_last_pattern + 3),(_pattern + 3)
00111$:
;	08_irda/irda.c:80: }
	pop	psw
	pop	ar4
	pop	ar5
	pop	ar6
	pop	ar7
	pop	b
	pop	acc
	reti
;	eliminated unneeded push/pop dpl
;	eliminated unneeded push/pop dph
;------------------------------------------------------------
;Allocation info for local variables in function 'delay'
;------------------------------------------------------------
;t                         Allocated to registers 
;------------------------------------------------------------
;	08_irda/irda.c:104: void delay(uint16_t t) {
;	-----------------------------------------
;	 function delay
;	-----------------------------------------
_delay:
	mov	r6,dpl
	mov	r7,dph
;	08_irda/irda.c:105: while (t--)
00101$:
	mov	ar4,r6
	mov	ar5,r7
	dec	r6
	cjne	r6,#0xff,00111$
	dec	r7
00111$:
	mov	a,r4
	orl	a,r5
	jnz	00101$
;	08_irda/irda.c:107: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'main'
;------------------------------------------------------------
;i                         Allocated to registers r7 
;nibble                    Allocated to registers 
;------------------------------------------------------------
;	08_irda/irda.c:109: void main(void) {
;	-----------------------------------------
;	 function main
;	-----------------------------------------
_main:
;	08_irda/irda.c:110: timer0_init();
	lcall	_timer0_init
;	08_irda/irda.c:111: ext_init();
	lcall	_ext_init
;	08_irda/irda.c:112: EA = 1; // Enable global interrupts
;	assignBit
	setb	_EA
;	08_irda/irda.c:114: P0 = 0x00; // Initialize port
	mov	_P0,#0x00
;	08_irda/irda.c:115: P2 = 0x00;
	mov	_P2,#0x00
;	08_irda/irda.c:119: for(uint8_t i=0; i<8; i++) {
00112$:
	mov	r7,#0x00
00104$:
	cjne	r7,#0x08,00122$
00122$:
	jnc	00112$
;	08_irda/irda.c:120: P2 = i<<2; // activate digit i (P2_2..P2_4)
	mov	ar6,r7
	mov	a,r6
	add	a,r6
	add	a,acc
	mov	_P2,a
;	08_irda/irda.c:123: uint8_t nibble = (last_pattern >> i*4) & 0x0F;
	mov	a,r7
	add	a,r7
	add	a,acc
	mov	r6,a
	mov	b,r6
	inc	b
	mov	r6,_last_pattern
	mov	r5,(_last_pattern + 1)
	mov	r4,(_last_pattern + 2)
	mov	r3,(_last_pattern + 3)
	sjmp	00125$
00124$:
	clr	c
	mov	a,r3
	rrc	a
	mov	r3,a
	mov	a,r4
	rrc	a
	mov	r4,a
	mov	a,r5
	rrc	a
	mov	r5,a
	mov	a,r6
	rrc	a
	mov	r6,a
00125$:
	djnz	b,00124$
	mov	a,#0x0f
	anl	a,r6
;	08_irda/irda.c:124: LED_DIGIT = segment_map[nibble];
	mov	dptr,#_segment_map
	movc	a,@a+dptr
	mov	_P0,a
;	08_irda/irda.c:125: delay(200); // Short delay for multiplexing
	mov	dptr,#0x00c8
	push	ar7
	lcall	_delay
	pop	ar7
;	08_irda/irda.c:126: LED_DIGIT = 0x00; // Turn off all segments
	mov	_P0,#0x00
;	08_irda/irda.c:119: for(uint8_t i=0; i<8; i++) {
	inc	r7
;	08_irda/irda.c:129: }
	sjmp	00104$
	.area CSEG    (CODE)
	.area CONST   (CODE)
_segment_map:
	.db #0x3f	; 63
	.db #0x06	; 6
	.db #0x5b	; 91
	.db #0x4f	; 79	'O'
	.db #0x66	; 102	'f'
	.db #0x6d	; 109	'm'
	.db #0x7d	; 125
	.db #0x07	; 7
	.db #0x7f	; 127
	.db #0x6f	; 111	'o'
	.db #0x77	; 119	'w'
	.db #0x7c	; 124
	.db #0x39	; 57	'9'
	.db #0x5e	; 94
	.db #0x79	; 121	'y'
	.db #0x71	; 113	'q'
	.area XINIT   (CODE)
	.area CABS    (ABS,CODE)
