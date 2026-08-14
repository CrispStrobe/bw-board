;--------------------------------------------------------
; File Created by SDCC : free open source ANSI-C Compiler
; Version 4.2.0 #13081 (Linux)
;--------------------------------------------------------
	.module lcd
	.optsdcc -mmcs51 --model-small
	
;--------------------------------------------------------
; Public variables in this module
;--------------------------------------------------------
	.globl _cindy_crawford_helmut_newton_bitmask
	.globl _main
	.globl _st7920_init
	.globl _clear_graphics
	.globl _st7920_text
	.globl _st7920_pos
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
	.globl _st7920_pos_PARM_2
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
_st7920_pos_PARM_2:
	.ds 1
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
;	04_st7920_graph/lcd.c:32: void delay(uint16_t t) {
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
;	04_st7920_graph/lcd.c:33: while (t--) // Simple delay loop (more than 1us at 12MHz)
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
;	04_st7920_graph/lcd.c:35: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'st7920_byte'
;------------------------------------------------------------
;d                         Allocated to registers r7 
;i                         Allocated to registers r6 
;------------------------------------------------------------
;	04_st7920_graph/lcd.c:37: void st7920_byte(uint8_t d) {
;	-----------------------------------------
;	 function st7920_byte
;	-----------------------------------------
_st7920_byte:
	mov	r7,dpl
;	04_st7920_graph/lcd.c:38: for(uint8_t i = 0; i < 8; i++) { // MSB first
	mov	r6,#0x00
00103$:
	cjne	r6,#0x08,00116$
00116$:
	jnc	00101$
;	04_st7920_graph/lcd.c:39: ST7920_SCLK = 0; // Toggle bits on rising edge
;	assignBit
	clr	_P2_7
;	04_st7920_graph/lcd.c:40: ST7920_SID = d & 0x80;
	mov	a,r7
	rl	a
	anl	a,#0x01
;	assignBit
	add	a,#0xff
	mov	_P2_5,c
;	04_st7920_graph/lcd.c:41: d <<= 1;
	mov	ar5,r7
	mov	a,r5
	add	a,r5
	mov	r7,a
;	04_st7920_graph/lcd.c:42: ST7920_SCLK = 1; // Reset state
;	assignBit
	setb	_P2_7
;	04_st7920_graph/lcd.c:38: for(uint8_t i = 0; i < 8; i++) { // MSB first
	inc	r6
	sjmp	00103$
00101$:
;	04_st7920_graph/lcd.c:44: ST7920_SCLK = 0; // Reset state
;	assignBit
	clr	_P2_7
;	04_st7920_graph/lcd.c:45: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'st7920_command'
;------------------------------------------------------------
;cmd                       Allocated to registers r7 
;------------------------------------------------------------
;	04_st7920_graph/lcd.c:47: void st7920_command(uint8_t cmd) {
;	-----------------------------------------
;	 function st7920_command
;	-----------------------------------------
_st7920_command:
	mov	r7,dpl
;	04_st7920_graph/lcd.c:48: ST7920_CS = 1;
;	assignBit
	setb	_P2_6
;	04_st7920_graph/lcd.c:49: st7920_byte(0b11111000);
	mov	dpl,#0xf8
	push	ar7
	lcall	_st7920_byte
	pop	ar7
;	04_st7920_graph/lcd.c:52: st7920_byte(0xF0 & cmd);        // high nibble
	mov	a,#0xf0
	anl	a,r7
	mov	dpl,a
	push	ar7
	lcall	_st7920_byte
	pop	ar7
;	04_st7920_graph/lcd.c:53: st7920_byte(0xF0 & (cmd << 4)); // low nibble
	mov	a,r7
	swap	a
	anl	a,#0xf0
	mov	r7,a
	mov	a,#0xf0
	anl	a,r7
	mov	dpl,a
	lcall	_st7920_byte
;	04_st7920_graph/lcd.c:54: ST7920_CS = 0;
;	assignBit
	clr	_P2_6
;	04_st7920_graph/lcd.c:55: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'st7920_data'
;------------------------------------------------------------
;data                      Allocated to registers r7 
;------------------------------------------------------------
;	04_st7920_graph/lcd.c:57: void st7920_data(uint8_t data) {
;	-----------------------------------------
;	 function st7920_data
;	-----------------------------------------
_st7920_data:
	mov	r7,dpl
;	04_st7920_graph/lcd.c:58: ST7920_CS = 1;
;	assignBit
	setb	_P2_6
;	04_st7920_graph/lcd.c:59: st7920_byte(0b11111010);
	mov	dpl,#0xfa
	push	ar7
	lcall	_st7920_byte
	pop	ar7
;	04_st7920_graph/lcd.c:62: st7920_byte(0xF0 & data);        // high nibble
	mov	a,#0xf0
	anl	a,r7
	mov	dpl,a
	push	ar7
	lcall	_st7920_byte
	pop	ar7
;	04_st7920_graph/lcd.c:63: st7920_byte(0xF0 & (data << 4)); // low nibble
	mov	a,r7
	swap	a
	anl	a,#0xf0
	mov	r7,a
	mov	a,#0xf0
	anl	a,r7
	mov	dpl,a
	lcall	_st7920_byte
;	04_st7920_graph/lcd.c:64: ST7920_CS = 0;
;	assignBit
	clr	_P2_6
;	04_st7920_graph/lcd.c:65: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'st7920_pos'
;------------------------------------------------------------
;y                         Allocated with name '_st7920_pos_PARM_2'
;x                         Allocated to registers r7 
;------------------------------------------------------------
;	04_st7920_graph/lcd.c:80: void st7920_pos(uint8_t x, uint8_t y) {
;	-----------------------------------------
;	 function st7920_pos
;	-----------------------------------------
_st7920_pos:
	mov	r7,dpl
;	04_st7920_graph/lcd.c:81: if(y >= 32) { // Wrap around for 128x64 mode
	mov	a,#0x100 - 0x20
	add	a,_st7920_pos_PARM_2
	jnc	00102$
;	04_st7920_graph/lcd.c:82: x += 8;
	mov	ar6,r7
	mov	a,#0x08
	add	a,r6
	mov	r7,a
;	04_st7920_graph/lcd.c:83: y -= 32;
	mov	a,_st7920_pos_PARM_2
	mov	r6,a
	add	a,#0xe0
	mov	_st7920_pos_PARM_2,a
00102$:
;	04_st7920_graph/lcd.c:85: st7920_command(ST7920_ADDR | (y & 0x3F)); // Set GDRAM Y address
	mov	a,_st7920_pos_PARM_2
	anl	a,#0x3f
	orl	a,#0x80
	mov	dpl,a
	push	ar7
	lcall	_st7920_command
	pop	ar7
;	04_st7920_graph/lcd.c:86: st7920_command(ST7920_ADDR | (x & 0x0F)); // Set GDRAM X address
	mov	a,#0x0f
	anl	a,r7
	orl	a,#0x80
	mov	dpl,a
;	04_st7920_graph/lcd.c:87: }
	ljmp	_st7920_command
;------------------------------------------------------------
;Allocation info for local variables in function 'st7920_text'
;------------------------------------------------------------
;str                       Allocated to registers 
;------------------------------------------------------------
;	04_st7920_graph/lcd.c:89: void st7920_text(const char* str) {
;	-----------------------------------------
;	 function st7920_text
;	-----------------------------------------
_st7920_text:
	mov	r5,dpl
	mov	r6,dph
	mov	r7,b
;	04_st7920_graph/lcd.c:90: while (*str) {
00101$:
	mov	dpl,r5
	mov	dph,r6
	mov	b,r7
	lcall	__gptrget
	mov	r4,a
	jz	00104$
;	04_st7920_graph/lcd.c:91: st7920_data((uint8_t)(*str));
	mov	dpl,r4
	push	ar7
	push	ar6
	push	ar5
	lcall	_st7920_data
	pop	ar5
	pop	ar6
	pop	ar7
;	04_st7920_graph/lcd.c:92: str++;
	inc	r5
	cjne	r5,#0x00,00101$
	inc	r6
	sjmp	00101$
00104$:
;	04_st7920_graph/lcd.c:94: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'clear_graphics'
;------------------------------------------------------------
;row                       Allocated to registers r7 
;col                       Allocated to registers r6 
;------------------------------------------------------------
;	04_st7920_graph/lcd.c:96: void clear_graphics(void) {
;	-----------------------------------------
;	 function clear_graphics
;	-----------------------------------------
_clear_graphics:
;	04_st7920_graph/lcd.c:97: for(uint8_t row = 0; row < 64; row++) {
	mov	r7,#0x00
00107$:
	cjne	r7,#0x40,00129$
00129$:
	jnc	00109$
;	04_st7920_graph/lcd.c:98: st7920_pos(0,row);
	mov	_st7920_pos_PARM_2,r7
	mov	dpl,#0x00
	push	ar7
	lcall	_st7920_pos
	pop	ar7
;	04_st7920_graph/lcd.c:99: for(uint8_t col = 0; col < 8; col++) {
	mov	r6,#0x00
00104$:
	cjne	r6,#0x08,00131$
00131$:
	jnc	00108$
;	04_st7920_graph/lcd.c:100: st7920_data(0x00);
	mov	dpl,#0x00
	push	ar7
	push	ar6
	lcall	_st7920_data
;	04_st7920_graph/lcd.c:101: st7920_data(0x00);
	mov	dpl,#0x00
	lcall	_st7920_data
	pop	ar6
	pop	ar7
;	04_st7920_graph/lcd.c:99: for(uint8_t col = 0; col < 8; col++) {
	inc	r6
	sjmp	00104$
00108$:
;	04_st7920_graph/lcd.c:97: for(uint8_t row = 0; row < 64; row++) {
	inc	r7
	sjmp	00107$
00109$:
;	04_st7920_graph/lcd.c:104: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'st7920_init'
;------------------------------------------------------------
;	04_st7920_graph/lcd.c:106: void st7920_init() { // Figure 8-bit interface from ST7920 datasheet
;	-----------------------------------------
;	 function st7920_init
;	-----------------------------------------
_st7920_init:
;	04_st7920_graph/lcd.c:107: ST7920_SCLK = 0; // Reset state
;	assignBit
	clr	_P2_7
;	04_st7920_graph/lcd.c:108: ST7920_RST = 0; // Force reset
;	assignBit
	clr	_P3_4
;	04_st7920_graph/lcd.c:109: ST7920_CS = 0;  // Defined state
;	assignBit
	clr	_P2_6
;	04_st7920_graph/lcd.c:110: delay(40000);
	mov	dptr,#0x9c40
	lcall	_delay
;	04_st7920_graph/lcd.c:111: ST7920_RST = 1;
;	assignBit
	setb	_P3_4
;	04_st7920_graph/lcd.c:112: delay(40000); // Wait for more than 40ms after Vcc rises to 4.5V
	mov	dptr,#0x9c40
	lcall	_delay
;	04_st7920_graph/lcd.c:113: st7920_command(ST7920_EXTENDED_MODE); // Extended mode to make GDRAM accessible
	mov	dpl,#0x34
	lcall	_st7920_command
;	04_st7920_graph/lcd.c:114: clear_graphics();                     // Clear graphics RAM
	lcall	_clear_graphics
;	04_st7920_graph/lcd.c:115: st7920_command(ST7920_GRAPHICS_MODE); // Enable GRAM mapping
	mov	dpl,#0x36
;	04_st7920_graph/lcd.c:116: }
	ljmp	_st7920_command
;------------------------------------------------------------
;Allocation info for local variables in function 'main'
;------------------------------------------------------------
;row                       Allocated to registers r7 
;col                       Allocated to registers r6 
;------------------------------------------------------------
;	04_st7920_graph/lcd.c:118: void main(void) {
;	-----------------------------------------
;	 function main
;	-----------------------------------------
_main:
;	04_st7920_graph/lcd.c:119: st7920_init();
	lcall	_st7920_init
;	04_st7920_graph/lcd.c:122: for(uint8_t row = 0; row < 64; row++) {
	mov	r7,#0x00
00108$:
	cjne	r7,#0x40,00136$
00136$:
	jc	00137$
	ljmp	00111$
00137$:
;	04_st7920_graph/lcd.c:123: st7920_pos(0, row);
	mov	_st7920_pos_PARM_2,r7
	mov	dpl,#0x00
	push	ar7
	lcall	_st7920_pos
	pop	ar7
;	04_st7920_graph/lcd.c:124: for(uint8_t col = 0; col < 8; col++) {
	mov	r6,#0x00
00105$:
	cjne	r6,#0x08,00138$
00138$:
	jnc	00109$
;	04_st7920_graph/lcd.c:125: st7920_data(cindy_crawford_helmut_newton_bitmask[row * 16 + col * 2]);
	mov	ar4,r7
	clr	a
	swap	a
	anl	a,#0xf0
	xch	a,r4
	swap	a
	xch	a,r4
	xrl	a,r4
	xch	a,r4
	anl	a,#0xf0
	xch	a,r4
	xrl	a,r4
	mov	r5,a
	mov	ar2,r6
	mov	r3,#0x00
	mov	a,r2
	add	a,r2
	mov	r2,a
	mov	a,r3
	rlc	a
	mov	r3,a
	mov	a,r2
	add	a,r4
	mov	r4,a
	mov	a,r3
	addc	a,r5
	mov	r5,a
	mov	a,r4
	add	a,#_cindy_crawford_helmut_newton_bitmask
	mov	dpl,a
	mov	a,r5
	addc	a,#(_cindy_crawford_helmut_newton_bitmask >> 8)
	mov	dph,a
	clr	a
	movc	a,@a+dptr
	mov	dpl,a
	push	ar7
	push	ar6
	push	ar5
	push	ar4
	lcall	_st7920_data
	pop	ar4
	pop	ar5
	pop	ar6
	pop	ar7
;	04_st7920_graph/lcd.c:126: st7920_data(cindy_crawford_helmut_newton_bitmask[row * 16 + col * 2 + 1]);
	inc	r4
	cjne	r4,#0x00,00140$
	inc	r5
00140$:
	mov	a,r4
	add	a,#_cindy_crawford_helmut_newton_bitmask
	mov	dpl,a
	mov	a,r5
	addc	a,#(_cindy_crawford_helmut_newton_bitmask >> 8)
	mov	dph,a
	clr	a
	movc	a,@a+dptr
	mov	dpl,a
	push	ar7
	push	ar6
	lcall	_st7920_data
	pop	ar6
	pop	ar7
;	04_st7920_graph/lcd.c:124: for(uint8_t col = 0; col < 8; col++) {
	inc	r6
	sjmp	00105$
00109$:
;	04_st7920_graph/lcd.c:122: for(uint8_t row = 0; row < 64; row++) {
	inc	r7
	ljmp	00108$
00111$:
;	04_st7920_graph/lcd.c:146: }
	sjmp	00111$
	.area CSEG    (CODE)
	.area CONST   (CODE)
_cindy_crawford_helmut_newton_bitmask:
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x10	; 16
	.db #0x08	; 8
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x10	; 16
	.db #0x08	; 8
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x08	; 8
	.db #0x10	; 16
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x0c	; 12
	.db #0x18	; 24
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x0d	; 13
	.db #0xf0	; 240
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x0f	; 15
	.db #0xf8	; 248
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x0f	; 15
	.db #0xfc	; 252
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x08	; 8
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x0f	; 15
	.db #0xfc	; 252
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x7a	; 122	'z'
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x0e	; 14
	.db #0x78	; 120	'x'
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x7a	; 122	'z'
	.db #0x80	; 128
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x0f	; 15
	.db #0x6c	; 108	'l'
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0xfd	; 253
	.db #0xf0	; 240
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x0e	; 14
	.db #0xb8	; 184
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0xbd	; 189
	.db #0x70	; 112	'p'
	.db #0x70	; 112	'p'
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x0f	; 15
	.db #0x48	; 72	'H'
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0xff	; 255
	.db #0xf5	; 245
	.db #0xe5	; 229
	.db #0x54	; 84	'T'
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x1f	; 31
	.db #0xd8	; 216
	.db #0x04	; 4
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0xff	; 255
	.db #0xfd	; 253
	.db #0xe8	; 232
	.db #0x02	; 2
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x0a	; 10
	.db #0x80	; 128
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x2a	; 42
	.db #0x8f	; 143
	.db #0xf8	; 248
	.db #0xb6	; 182
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xe8	; 232
	.db #0x04	; 4
	.db #0x80	; 128
	.db #0x00	; 0
	.db #0x10	; 16
	.db #0x40	; 64
	.db #0x00	; 0
	.db #0x0a	; 10
	.db #0x84	; 132
	.db #0xbf	; 191
	.db #0x75	; 117	'u'
	.db #0x55	; 85	'U'
	.db #0x55	; 85	'U'
	.db #0x55	; 85	'U'
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xf5	; 245
	.db #0x50	; 80	'P'
	.db #0xa0	; 160
	.db #0x00	; 0
	.db #0x11	; 17
	.db #0x28	; 40
	.db #0x00	; 0
	.db #0xa0	; 160
	.db #0xab	; 171
	.db #0xef	; 239
	.db #0xf9	; 249
	.db #0x57	; 87	'W'
	.db #0xaa	; 170
	.db #0xaa	; 170
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xf6	; 246
	.db #0x8a	; 138
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x22	; 34
	.db #0x44	; 68	'D'
	.db #0x55	; 85	'U'
	.db #0x15	; 21
	.db #0x7f	; 127
	.db #0xff	; 255
	.db #0xf5	; 245
	.db #0x75	; 117	'u'
	.db #0x76	; 118	'v'
	.db #0xaa	; 170
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x69	; 105	'i'
	.db #0x55	; 85	'U'
	.db #0x55	; 85	'U'
	.db #0x29	; 41
	.db #0x25	; 37
	.db #0x01	; 1
	.db #0x45	; 69	'E'
	.db #0xff	; 255
	.db #0xf7	; 247
	.db #0xf5	; 245
	.db #0x5f	; 95
	.db #0x7f	; 127
	.db #0xab	; 171
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xd5	; 213
	.db #0x55	; 85	'U'
	.db #0x55	; 85	'U'
	.db #0x54	; 84	'T'
	.db #0xa9	; 169
	.db #0x6a	; 106	'j'
	.db #0xaf	; 175
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xf5	; 245
	.db #0x56	; 86	'V'
	.db #0xb7	; 183
	.db #0xbf	; 191
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xd5	; 213
	.db #0x55	; 85	'U'
	.db #0x55	; 85	'U'
	.db #0x55	; 85	'U'
	.db #0x56	; 86	'V'
	.db #0xb6	; 182
	.db #0xaf	; 175
	.db #0xff	; 255
	.db #0xfe	; 254
	.db #0xd7	; 215
	.db #0x77	; 119	'w'
	.db #0x5f	; 95
	.db #0xef	; 239
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xfd	; 253
	.db #0xb5	; 181
	.db #0x6f	; 111	'o'
	.db #0xbf	; 191
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xbb	; 187
	.db #0xad	; 173
	.db #0x7f	; 127
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xfe	; 254
	.db #0x94	; 148
	.db #0xdf	; 223
	.db #0xdf	; 223
	.db #0xdf	; 223
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xab	; 171
	.db #0xba	; 186
	.db #0xef	; 239
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xeb	; 235
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xbf	; 191
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xda	; 218
	.db #0xaf	; 175
	.db #0xf7	; 247
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xdf	; 223
	.db #0x80	; 128
	.db #0x1f	; 31
	.db #0xff	; 255
	.db #0xbf	; 191
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xee	; 238
	.db #0xd4	; 212
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xfd	; 253
	.db #0x7f	; 127
	.db #0x58	; 88	'X'
	.db #0x43	; 67	'C'
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xfd	; 253
	.db #0xdb	; 219
	.db #0x7f	; 127
	.db #0xdf	; 223
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xf8	; 248
	.db #0x02	; 2
	.db #0xf5	; 245
	.db #0x60	; 96
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xeb	; 235
	.db #0x7a	; 122	'z'
	.db #0xdf	; 223
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xc6	; 198
	.db #0x01	; 1
	.db #0xed	; 237
	.db #0x40	; 64
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xfa	; 250
	.db #0xed	; 237
	.db #0xfd	; 253
	.db #0x5d	; 93
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xeb	; 235
	.db #0xe1	; 225
	.db #0xf5	; 245
	.db #0x50	; 80	'P'
	.db #0x7f	; 127
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xeb	; 235
	.db #0xdb	; 219
	.db #0x6f	; 111	'o'
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xaa	; 170
	.db #0xa8	; 168
	.db #0x71	; 113	'q'
	.db #0x40	; 64
	.db #0x7f	; 127
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xf7	; 247
	.db #0xd7	; 215
	.db #0xba	; 186
	.db #0xb7	; 183
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xd5	; 213
	.db #0x54	; 84	'T'
	.db #0x2a	; 42
	.db #0xd0	; 208
	.db #0x3f	; 63
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xfb	; 251
	.db #0x77	; 119	'w'
	.db #0xbf	; 191
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x54	; 84	'T'
	.db #0xaa	; 170
	.db #0x15	; 21
	.db #0xa0	; 160
	.db #0x1f	; 31
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x76	; 118	'v'
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x55	; 85	'U'
	.db #0x2a	; 42
	.db #0x85	; 133
	.db #0xd0	; 208
	.db #0x0f	; 15
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xe9	; 233
	.db #0xdf	; 223
	.db #0xbf	; 191
	.db #0x00	; 0
	.db #0x0a	; 10
	.db #0xfd	; 253
	.db #0x55	; 85	'U'
	.db #0x4a	; 74	'J'
	.db #0x87	; 135
	.db #0xc0	; 192
	.db #0x0f	; 15
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x03	; 3
	.db #0x57	; 87	'W'
	.db #0xaa	; 170
	.db #0xa0	; 160
	.db #0xe0	; 224
	.db #0x07	; 7
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x05	; 5
	.db #0x6a	; 106	'j'
	.db #0x45	; 69	'E'
	.db #0x50	; 80	'P'
	.db #0x00	; 0
	.db #0x07	; 7
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xdf	; 223
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x05	; 5
	.db #0x56	; 86	'V'
	.db #0x28	; 40
	.db #0xaa	; 170
	.db #0x30	; 48	'0'
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x33	; 51	'3'
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x1a	; 26
	.db #0xaa	; 170
	.db #0x15	; 21
	.db #0x54	; 84	'T'
	.db #0x80	; 128
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x20	; 32
	.db #0x81	; 129
	.db #0x81	; 129
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x0a	; 10
	.db #0x94	; 148
	.db #0x0a	; 10
	.db #0x2a	; 42
	.db #0x50	; 80	'P'
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x5e	; 94
	.db #0x01	; 1
	.db #0x80	; 128
	.db #0xe0	; 224
	.db #0x00	; 0
	.db #0x12	; 18
	.db #0xff	; 255
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x2a	; 42
	.db #0x50	; 80	'P'
	.db #0xba	; 186
	.db #0x95	; 149
	.db #0x08	; 8
	.db #0x02	; 2
	.db #0x00	; 0
	.db #0x76	; 118	'v'
	.db #0x83	; 131
	.db #0x80	; 128
	.db #0xc0	; 192
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x29	; 41
	.db #0x52	; 82	'R'
	.db #0xba	; 186
	.db #0xc5	; 197
	.db #0xe4	; 228
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x3f	; 63
	.db #0xc1	; 193
	.db #0x80	; 128
	.db #0xe0	; 224
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0xaa	; 170
	.db #0x4a	; 74	'J'
	.db #0xe1	; 225
	.db #0x52	; 82	'R'
	.db #0x29	; 41
	.db #0x50	; 80	'P'
	.db #0x00	; 0
	.db #0x3f	; 63
	.db #0xe3	; 227
	.db #0x00	; 0
	.db #0xc0	; 192
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x92	; 146
	.db #0x94	; 148
	.db #0x20	; 32
	.db #0xa9	; 169
	.db #0x54	; 84	'T'
	.db #0x7f	; 127
	.db #0x01	; 1
	.db #0x3c	; 60
	.db #0xfa	; 250
	.db #0x80	; 128
	.db #0xc0	; 192
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x02	; 2
	.db #0x4a	; 74	'J'
	.db #0x7f	; 127
	.db #0xc0	; 192
	.db #0x55	; 85	'U'
	.db #0x55	; 85	'U'
	.db #0x3f	; 63
	.db #0xc0	; 192
	.db #0x20	; 32
	.db #0xf8	; 248
	.db #0x00	; 0
	.db #0xc0	; 192
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x01	; 1
	.db #0x57	; 87	'W'
	.db #0x7f	; 127
	.db #0xc0	; 192
	.db #0x1a	; 26
	.db #0x55	; 85	'U'
	.db #0x1f	; 31
	.db #0xf0	; 240
	.db #0x19	; 25
	.db #0xf8	; 248
	.db #0x00	; 0
	.db #0xc0	; 192
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x0a	; 10
	.db #0xa3	; 163
	.db #0xfb	; 251
	.db #0x80	; 128
	.db #0x15	; 21
	.db #0x54	; 84	'T'
	.db #0xbf	; 191
	.db #0x80	; 128
	.db #0x23	; 35
	.db #0xfc	; 252
	.db #0x00	; 0
	.db #0x80	; 128
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x15	; 21
	.db #0x60	; 96
	.db #0xa3	; 163
	.db #0x00	; 0
	.db #0x0d	; 13
	.db #0x55	; 85	'U'
	.db #0x1f	; 31
	.db #0x80	; 128
	.db #0x13	; 19
	.db #0xff	; 255
	.db #0x00	; 0
	.db #0x81	; 129
	.db #0x1a	; 26
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x2a	; 42
	.db #0xe0	; 224
	.db #0x04	; 4
	.db #0x00	; 0
	.db #0x05	; 5
	.db #0x55	; 85	'U'
	.db #0x7c	; 124
	.db #0x02	; 2
	.db #0x27	; 39
	.db #0xfe	; 254
	.db #0xc0	; 192
	.db #0x45	; 69	'E'
	.db #0xf4	; 244
	.db #0x0c	; 12
	.db #0x00	; 0
	.db #0x5f	; 95
	.db #0x55	; 85	'U'
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xa6	; 166
	.db #0xad	; 173
	.db #0x7c	; 124
	.db #0x02	; 2
	.db #0x27	; 39
	.db #0xf8	; 248
	.db #0x70	; 112	'p'
	.db #0x06	; 6
	.db #0x97	; 151
	.db #0x2e	; 46
	.db #0x00	; 0
	.db #0xf0	; 240
	.db #0xaf	; 175
	.db #0xf5	; 245
	.db #0xfa	; 250
	.db #0xaa	; 170
	.db #0xdf	; 223
	.db #0xab	; 171
	.db #0xfa	; 250
	.db #0x14	; 20
	.db #0x2f	; 47
	.db #0xea	; 234
	.db #0x00	; 0
	.db #0x0d	; 13
	.db #0xd5	; 213
	.db #0xdf	; 223
	.db #0x00	; 0
	.db #0x3a	; 58
	.db #0x3f	; 63
	.db #0xf6	; 246
	.db #0xaf	; 175
	.db #0x6d	; 109	'm'
	.db #0x55	; 85	'U'
	.db #0xed	; 237
	.db #0xf9	; 249
	.db #0x44	; 68	'D'
	.db #0x17	; 23
	.db #0xfa	; 250
	.db #0x00	; 0
	.db #0x2f	; 47
	.db #0xef	; 239
	.db #0x7f	; 127
	.db #0x00	; 0
	.db #0xfd	; 253
	.db #0xeb	; 235
	.db #0xad	; 173
	.db #0xd5	; 213
	.db #0xb6	; 182
	.db #0xd5	; 213
	.db #0xdb	; 219
	.db #0xf6	; 246
	.db #0xb8	; 184
	.db #0x3f	; 63
	.db #0xfc	; 252
	.db #0x03	; 3
	.db #0x7f	; 127
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x80	; 128
	.db #0xaf	; 175
	.db #0xeb	; 235
	.db #0xed	; 237
	.db #0x76	; 118	'v'
	.db #0xdb	; 219
	.db #0x6d	; 109	'm'
	.db #0x7f	; 127
	.db #0xf5	; 245
	.db #0x5d	; 93
	.db #0x1f	; 31
	.db #0xf4	; 244
	.db #0x09	; 9
	.db #0x1f	; 31
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x80	; 128
	.db #0x7f	; 127
	.db #0xb6	; 182
	.db #0xb6	; 182
	.db #0xdb	; 219
	.db #0x6d	; 109	'm'
	.db #0xbb	; 187
	.db #0xff	; 255
	.db #0xef	; 239
	.db #0xf8	; 248
	.db #0x3f	; 63
	.db #0xc0	; 192
	.db #0x2b	; 43
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x80	; 128
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xfe	; 254
	.db #0xdb	; 219
	.db #0x7f	; 127
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xfd	; 253
	.db #0x0e	; 14
	.db #0x00	; 0
	.db #0xab	; 171
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x00	; 0
	.db #0x2f	; 47
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xfa	; 250
	.db #0x10	; 16
	.db #0x05	; 5
	.db #0x7f	; 127
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x7f	; 127
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xfe	; 254
	.db #0xaa	; 170
	.db #0xaa	; 170
	.db #0xfa	; 250
	.db #0x88	; 136
	.db #0x15	; 21
	.db #0x7f	; 127
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0xbf	; 191
	.db #0xfd	; 253
	.db #0x5b	; 91
	.db #0x5a	; 90	'Z'
	.db #0x50	; 80	'P'
	.db #0xab	; 171
	.db #0xff	; 255
	.db #0x55	; 85	'U'
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x05	; 5
	.db #0xdf	; 223
	.db #0xfa	; 250
	.db #0xaa	; 170
	.db #0xab	; 171
	.db #0xfd	; 253
	.db #0xb5	; 181
	.db #0x55	; 85	'U'
	.db #0xff	; 255
	.db #0x80	; 128
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x1a	; 26
	.db #0xaa	; 170
	.db #0xaf	; 175
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x80	; 128
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x0d	; 13
	.db #0x55	; 85	'U'
	.db #0x70	; 112	'p'
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0xff	; 255
	.db #0xff	; 255
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x0f	; 15
	.db #0xe8	; 232
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x01	; 1
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x00	; 0
	.area XINIT   (CODE)
	.area CABS    (ABS,CODE)
