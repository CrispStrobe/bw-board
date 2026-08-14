;--------------------------------------------------------
; File Created by SDCC : free open source ANSI-C Compiler
; Version 4.2.0 #13081 (Linux)
;--------------------------------------------------------
	.module led_button
	.optsdcc -mmcs51 --model-small
	
;--------------------------------------------------------
; Public variables in this module
;--------------------------------------------------------
	.globl _tf0_isr
	.globl _main
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
	.globl _led_3_state
	.globl _led_2_state
	.globl _led_1_state
	.globl _led_0_state
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
;--------------------------------------------------------
; overlayable items in internal ram
;--------------------------------------------------------
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
_led_0_state::
	.ds 1
_led_1_state::
	.ds 1
_led_2_state::
	.ds 1
_led_3_state::
	.ds 1
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
	reti
	.ds	7
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
;	01_led_button_timer/led_button.c:37: __bit led_0_state = 0;
;	assignBit
	clr	_led_0_state
;	01_led_button_timer/led_button.c:38: __bit led_1_state = 0;
;	assignBit
	clr	_led_1_state
;	01_led_button_timer/led_button.c:39: __bit led_2_state = 0;
;	assignBit
	clr	_led_2_state
;	01_led_button_timer/led_button.c:40: __bit led_3_state = 0;
;	assignBit
	clr	_led_3_state
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
;	01_led_button_timer/led_button.c:19: void timer0_init(void) {
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
;	01_led_button_timer/led_button.c:20: TMOD &= 0xF0;	/* Clear Timer 0 mode bits */
	anl	_TMOD,#0xf0
;	01_led_button_timer/led_button.c:21: TMOD |= 0x1;	/* Set Timer 0 mode to 16-bit */
	orl	_TMOD,#0x01
;	01_led_button_timer/led_button.c:22: TH0 = 0x3c;	/* Set Timer 0 high byte for 16-bit mode */
	mov	_TH0,#0x3c
;	01_led_button_timer/led_button.c:23: TL0 = 0xb0;	/* Set Timer 0 low byte for 16-bit mode */
	mov	_TL0,#0xb0
;	01_led_button_timer/led_button.c:24: TF0 = 0;	/* Clear Timer 0 overflow flag */
;	assignBit
	clr	_TF0
;	01_led_button_timer/led_button.c:25: TR0 = 1;	/* Start Timer 0 */
;	assignBit
	setb	_TR0
;	01_led_button_timer/led_button.c:26: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'main'
;------------------------------------------------------------
;	01_led_button_timer/led_button.c:28: void main(void) {
;	-----------------------------------------
;	 function main
;	-----------------------------------------
_main:
;	01_led_button_timer/led_button.c:29: timer0_init();
	lcall	_timer0_init
;	01_led_button_timer/led_button.c:31: ET0 = 1;	/* Enable Timer 0 interrupt */
;	assignBit
	setb	_ET0
;	01_led_button_timer/led_button.c:32: EA  = 1; /* Enable global interrupts */
;	assignBit
	setb	_EA
00103$:
;	01_led_button_timer/led_button.c:35: }
	sjmp	00103$
;------------------------------------------------------------
;Allocation info for local variables in function 'tf0_isr'
;------------------------------------------------------------
;	01_led_button_timer/led_button.c:42: void tf0_isr(void) __interrupt(TF0_VECTOR) {
;	-----------------------------------------
;	 function tf0_isr
;	-----------------------------------------
_tf0_isr:
	push	psw
;	01_led_button_timer/led_button.c:43: if(P3_1 == 0) {
	jb	_P3_1,00102$
;	01_led_button_timer/led_button.c:44: led_0_state = !led_0_state;
	cpl	_led_0_state
00102$:
;	01_led_button_timer/led_button.c:46: if(P3_0 == 0) {
	jb	_P3_0,00104$
;	01_led_button_timer/led_button.c:47: led_1_state = !led_1_state;
	cpl	_led_1_state
00104$:
;	01_led_button_timer/led_button.c:49: if(P3_2 == 0) {
	jb	_P3_2,00106$
;	01_led_button_timer/led_button.c:50: led_2_state = !led_2_state;
	cpl	_led_2_state
00106$:
;	01_led_button_timer/led_button.c:52: if(P3_3 == 0) {
	jb	_P3_3,00108$
;	01_led_button_timer/led_button.c:53: led_3_state = !led_3_state;
	cpl	_led_3_state
00108$:
;	01_led_button_timer/led_button.c:56: P2_0 = led_0_state;
;	assignBit
	mov	c,_led_0_state
	mov	_P2_0,c
;	01_led_button_timer/led_button.c:57: P2_1 = led_1_state;
;	assignBit
	mov	c,_led_1_state
	mov	_P2_1,c
;	01_led_button_timer/led_button.c:58: P2_2 = led_2_state;
;	assignBit
	mov	c,_led_2_state
	mov	_P2_2,c
;	01_led_button_timer/led_button.c:59: P2_3 = led_3_state;
;	assignBit
	mov	c,_led_3_state
	mov	_P2_3,c
;	01_led_button_timer/led_button.c:61: TF0 = 0;	/* Clear Timer 0 overflow flag */
;	assignBit
	clr	_TF0
;	01_led_button_timer/led_button.c:62: }
	pop	psw
	reti
;	eliminated unneeded mov psw,# (no regs used in bank)
;	eliminated unneeded push/pop dpl
;	eliminated unneeded push/pop dph
;	eliminated unneeded push/pop b
;	eliminated unneeded push/pop acc
	.area CSEG    (CODE)
	.area CONST   (CODE)
	.area XINIT   (CODE)
	.area CABS    (ABS,CODE)
