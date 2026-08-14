;--------------------------------------------------------
; File Created by SDCC : free open source ANSI-C Compiler
; Version 4.2.0 #13081 (Linux)
;--------------------------------------------------------
	.module lcd
	.optsdcc -mmcs51 --model-small
	
;--------------------------------------------------------
; Public variables in this module
;--------------------------------------------------------
	.globl _main
	.globl _st7920_init
	.globl _st7920_text
	.globl _st7920_data
	.globl _st7920_command
	.globl _st7920_byte
	.globl _delay
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
	.area	OSEG    (OVR,DATA)
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
;Allocation info for local variables in function 'delay'
;------------------------------------------------------------
;t                         Allocated to registers 
;------------------------------------------------------------
;	04_st7920_lcd/lcd.c:28: void delay(uint16_t t) {
;	-----------------------------------------
;	 function delay
;	-----------------------------------------
_delay:
	ar7 = 0x07
	ar6 = 0x06
	ar5 = 0x05
	ar4 = 0x04
	ar3 = 0x03
	ar2 = 0x02
	ar1 = 0x01
	ar0 = 0x00
	mov	r6,dpl
	mov	r7,dph
;	04_st7920_lcd/lcd.c:29: while (t--) // Simple delay loop (more than 1us at 12MHz)
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
;	04_st7920_lcd/lcd.c:31: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'st7920_byte'
;------------------------------------------------------------
;d                         Allocated to registers r7 
;i                         Allocated to registers r6 
;------------------------------------------------------------
;	04_st7920_lcd/lcd.c:33: void st7920_byte(uint8_t d) {
;	-----------------------------------------
;	 function st7920_byte
;	-----------------------------------------
_st7920_byte:
	mov	r7,dpl
;	04_st7920_lcd/lcd.c:34: for(uint8_t i = 0; i < 8; i++) { // MSB first
	mov	r6,#0x00
00103$:
	cjne	r6,#0x08,00116$
00116$:
	jnc	00101$
;	04_st7920_lcd/lcd.c:35: ST7920_SCLK = 0; // Toggle bits on rising edge
;	assignBit
	clr	_P2_7
;	04_st7920_lcd/lcd.c:36: ST7920_SID = d & 0x80;
	mov	a,r7
	rl	a
	anl	a,#0x01
;	assignBit
	add	a,#0xff
	mov	_P2_5,c
;	04_st7920_lcd/lcd.c:37: d <<= 1;
	mov	ar5,r7
	mov	a,r5
	add	a,r5
	mov	r7,a
;	04_st7920_lcd/lcd.c:38: ST7920_SCLK = 1; // Reset state
;	assignBit
	setb	_P2_7
;	04_st7920_lcd/lcd.c:34: for(uint8_t i = 0; i < 8; i++) { // MSB first
	inc	r6
	sjmp	00103$
00101$:
;	04_st7920_lcd/lcd.c:40: ST7920_SCLK = 0; // Reset state
;	assignBit
	clr	_P2_7
;	04_st7920_lcd/lcd.c:41: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'st7920_command'
;------------------------------------------------------------
;cmd                       Allocated to registers r7 
;------------------------------------------------------------
;	04_st7920_lcd/lcd.c:43: void st7920_command(uint8_t cmd) {
;	-----------------------------------------
;	 function st7920_command
;	-----------------------------------------
_st7920_command:
	mov	r7,dpl
;	04_st7920_lcd/lcd.c:44: ST7920_CS = 1;
;	assignBit
	setb	_P2_6
;	04_st7920_lcd/lcd.c:45: st7920_byte(0b11111000);
	mov	dpl,#0xf8
	push	ar7
	lcall	_st7920_byte
	pop	ar7
;	04_st7920_lcd/lcd.c:48: st7920_byte(0xF0 & cmd);        // high nibble
	mov	a,#0xf0
	anl	a,r7
	mov	dpl,a
	push	ar7
	lcall	_st7920_byte
	pop	ar7
;	04_st7920_lcd/lcd.c:49: st7920_byte(0xF0 & (cmd << 4)); // low nibble
	mov	a,r7
	swap	a
	anl	a,#0xf0
	mov	r7,a
	mov	a,#0xf0
	anl	a,r7
	mov	dpl,a
	lcall	_st7920_byte
;	04_st7920_lcd/lcd.c:50: ST7920_CS = 0;
;	assignBit
	clr	_P2_6
;	04_st7920_lcd/lcd.c:51: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'st7920_data'
;------------------------------------------------------------
;data                      Allocated to registers r7 
;------------------------------------------------------------
;	04_st7920_lcd/lcd.c:53: void st7920_data(uint8_t data) {
;	-----------------------------------------
;	 function st7920_data
;	-----------------------------------------
_st7920_data:
	mov	r7,dpl
;	04_st7920_lcd/lcd.c:54: ST7920_CS = 1;
;	assignBit
	setb	_P2_6
;	04_st7920_lcd/lcd.c:55: st7920_byte(0b11111010);
	mov	dpl,#0xfa
	push	ar7
	lcall	_st7920_byte
	pop	ar7
;	04_st7920_lcd/lcd.c:58: st7920_byte(0xF0 & data);        // high nibble
	mov	a,#0xf0
	anl	a,r7
	mov	dpl,a
	push	ar7
	lcall	_st7920_byte
	pop	ar7
;	04_st7920_lcd/lcd.c:59: st7920_byte(0xF0 & (data << 4)); // low nibble
	mov	a,r7
	swap	a
	anl	a,#0xf0
	mov	r7,a
	mov	a,#0xf0
	anl	a,r7
	mov	dpl,a
	lcall	_st7920_byte
;	04_st7920_lcd/lcd.c:60: ST7920_CS = 0;
;	assignBit
	clr	_P2_6
;	04_st7920_lcd/lcd.c:61: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'st7920_text'
;------------------------------------------------------------
;str                       Allocated to registers 
;------------------------------------------------------------
;	04_st7920_lcd/lcd.c:63: void st7920_text(const char* str) {
;	-----------------------------------------
;	 function st7920_text
;	-----------------------------------------
_st7920_text:
	mov	r5,dpl
	mov	r6,dph
	mov	r7,b
;	04_st7920_lcd/lcd.c:64: while (*str) {
00101$:
	mov	dpl,r5
	mov	dph,r6
	mov	b,r7
	lcall	__gptrget
	mov	r4,a
	jz	00104$
;	04_st7920_lcd/lcd.c:65: st7920_data((uint8_t)(*str));
	mov	dpl,r4
	push	ar7
	push	ar6
	push	ar5
	lcall	_st7920_data
	pop	ar5
	pop	ar6
	pop	ar7
;	04_st7920_lcd/lcd.c:66: str++;
	inc	r5
	cjne	r5,#0x00,00101$
	inc	r6
	sjmp	00101$
00104$:
;	04_st7920_lcd/lcd.c:68: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'st7920_init'
;------------------------------------------------------------
;	04_st7920_lcd/lcd.c:70: void st7920_init() { // Figure 8-bit interface from ST7920 datasheet
;	-----------------------------------------
;	 function st7920_init
;	-----------------------------------------
_st7920_init:
;	04_st7920_lcd/lcd.c:71: ST7920_SCLK = 0; // Reset state
;	assignBit
	clr	_P2_7
;	04_st7920_lcd/lcd.c:72: ST7920_RST = 0; // Force reset
;	assignBit
	clr	_P3_4
;	04_st7920_lcd/lcd.c:73: ST7920_CS = 0;  // Defined state
;	assignBit
	clr	_P2_6
;	04_st7920_lcd/lcd.c:74: delay(40000);
	mov	dptr,#0x9c40
	lcall	_delay
;	04_st7920_lcd/lcd.c:75: ST7920_RST = 1;
;	assignBit
	setb	_P3_4
;	04_st7920_lcd/lcd.c:76: delay(40000); // Wait for more than 40ms after Vcc rises to 4.5V
	mov	dptr,#0x9c40
;	04_st7920_lcd/lcd.c:77: }
	ljmp	_delay
;------------------------------------------------------------
;Allocation info for local variables in function 'main'
;------------------------------------------------------------
;	04_st7920_lcd/lcd.c:79: void main(void) {
;	-----------------------------------------
;	 function main
;	-----------------------------------------
_main:
;	04_st7920_lcd/lcd.c:80: st7920_init();
	lcall	_st7920_init
;	04_st7920_lcd/lcd.c:81: st7920_command(ST7920_DISP_ON);
	mov	dpl,#0x0c
	lcall	_st7920_command
;	04_st7920_lcd/lcd.c:83: st7920_text("Hello, World!");
	mov	dptr,#___str_0
	mov	b,#0x80
	lcall	_st7920_text
00103$:
;	04_st7920_lcd/lcd.c:86: }
	sjmp	00103$
	.area CSEG    (CODE)
	.area CONST   (CODE)
	.area CONST   (CODE)
___str_0:
	.ascii "Hello, World!"
	.db 0x00
	.area CSEG    (CODE)
	.area XINIT   (CODE)
	.area CABS    (ABS,CODE)
