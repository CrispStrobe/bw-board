;--------------------------------------------------------
; File Created by SDCC : free open source ANSI-C Compiler
; Version 4.2.0 #13081 (Linux)
;--------------------------------------------------------
	.module lcd
	.optsdcc -mmcs51 --model-small
	
;--------------------------------------------------------
; Public variables in this module
;--------------------------------------------------------
	.globl _custom_char_heart
	.globl _main
	.globl _hd44780_custom_char
	.globl _hd44780_init
	.globl _hd44780_text
	.globl _hd44780_data
	.globl _hd44780_command
	.globl _hd44780_byte
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
	.globl _hd44780_custom_char_PARM_2
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
_hd44780_custom_char_PARM_2:
	.ds 3
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
;	03_hd44780_lcd/lcd.c:52: void delay(uint16_t t) {
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
;	03_hd44780_lcd/lcd.c:53: while (t--) // Simple delay loop (more than 1us at 12MHz)
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
;	03_hd44780_lcd/lcd.c:55: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'hd44780_byte'
;------------------------------------------------------------
;d                         Allocated to registers r7 
;------------------------------------------------------------
;	03_hd44780_lcd/lcd.c:57: void hd44780_byte(uint8_t d) {
;	-----------------------------------------
;	 function hd44780_byte
;	-----------------------------------------
_hd44780_byte:
	mov	r7,dpl
;	03_hd44780_lcd/lcd.c:58: HD44780_E = 1;
;	assignBit
	setb	_P2_7
;	03_hd44780_lcd/lcd.c:59: HD44780_DATA = d;
	mov	_P0,r7
;	03_hd44780_lcd/lcd.c:60: delay(10); // Enable pulse width
	mov	dptr,#0x000a
	lcall	_delay
;	03_hd44780_lcd/lcd.c:61: HD44780_E = 0;
;	assignBit
	clr	_P2_7
;	03_hd44780_lcd/lcd.c:62: delay(10); // Data hold time
	mov	dptr,#0x000a
;	03_hd44780_lcd/lcd.c:63: }
	ljmp	_delay
;------------------------------------------------------------
;Allocation info for local variables in function 'hd44780_command'
;------------------------------------------------------------
;cmd                       Allocated to registers r7 
;------------------------------------------------------------
;	03_hd44780_lcd/lcd.c:65: void hd44780_command(uint8_t cmd) {
;	-----------------------------------------
;	 function hd44780_command
;	-----------------------------------------
_hd44780_command:
	mov	r7,dpl
;	03_hd44780_lcd/lcd.c:66: HD44780_RS = 0; // Command mode
;	assignBit
	clr	_P2_6
;	03_hd44780_lcd/lcd.c:67: HD44780_RW = 0; // Write mode
;	assignBit
	clr	_P2_5
;	03_hd44780_lcd/lcd.c:68: hd44780_byte(cmd);
	mov	dpl,r7
	lcall	_hd44780_byte
;	03_hd44780_lcd/lcd.c:69: delay(100); // Wait for command to process
	mov	dptr,#0x0064
;	03_hd44780_lcd/lcd.c:70: }
	ljmp	_delay
;------------------------------------------------------------
;Allocation info for local variables in function 'hd44780_data'
;------------------------------------------------------------
;data                      Allocated to registers r7 
;------------------------------------------------------------
;	03_hd44780_lcd/lcd.c:72: void hd44780_data(uint8_t data) {
;	-----------------------------------------
;	 function hd44780_data
;	-----------------------------------------
_hd44780_data:
	mov	r7,dpl
;	03_hd44780_lcd/lcd.c:73: HD44780_RS = 1; // Data mode
;	assignBit
	setb	_P2_6
;	03_hd44780_lcd/lcd.c:74: HD44780_RW = 0; // Write mode
;	assignBit
	clr	_P2_5
;	03_hd44780_lcd/lcd.c:75: hd44780_byte(data);
	mov	dpl,r7
	lcall	_hd44780_byte
;	03_hd44780_lcd/lcd.c:76: delay(100); // Wait for data to process
	mov	dptr,#0x0064
;	03_hd44780_lcd/lcd.c:77: }
	ljmp	_delay
;------------------------------------------------------------
;Allocation info for local variables in function 'hd44780_text'
;------------------------------------------------------------
;str                       Allocated to registers 
;------------------------------------------------------------
;	03_hd44780_lcd/lcd.c:79: void hd44780_text(const char* str) {
;	-----------------------------------------
;	 function hd44780_text
;	-----------------------------------------
_hd44780_text:
	mov	r5,dpl
	mov	r6,dph
	mov	r7,b
;	03_hd44780_lcd/lcd.c:80: while (*str) {
00101$:
	mov	dpl,r5
	mov	dph,r6
	mov	b,r7
	lcall	__gptrget
	mov	r4,a
	jz	00104$
;	03_hd44780_lcd/lcd.c:81: hd44780_data((uint8_t)(*str));
	mov	dpl,r4
	push	ar7
	push	ar6
	push	ar5
	lcall	_hd44780_data
	pop	ar5
	pop	ar6
	pop	ar7
;	03_hd44780_lcd/lcd.c:82: str++;
	inc	r5
	cjne	r5,#0x00,00101$
	inc	r6
	sjmp	00101$
00104$:
;	03_hd44780_lcd/lcd.c:84: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'hd44780_init'
;------------------------------------------------------------
;	03_hd44780_lcd/lcd.c:86: void hd44780_init() { // Figure 23 from HD44780 datasheet
;	-----------------------------------------
;	 function hd44780_init
;	-----------------------------------------
_hd44780_init:
;	03_hd44780_lcd/lcd.c:87: delay(15000); // Wait for more than 15ms after Vcc rises to 4.5V
	mov	dptr,#0x3a98
	lcall	_delay
;	03_hd44780_lcd/lcd.c:89: hd44780_command(HD44780_FUNC_SET);
	mov	dpl,#0x30
	lcall	_hd44780_command
;	03_hd44780_lcd/lcd.c:90: delay(5000); // Wait for more than 4.1ms
	mov	dptr,#0x1388
	lcall	_delay
;	03_hd44780_lcd/lcd.c:91: hd44780_command(HD44780_FUNC_SET);
	mov	dpl,#0x30
	lcall	_hd44780_command
;	03_hd44780_lcd/lcd.c:92: delay(1000); // Wait for more than 1ms
	mov	dptr,#0x03e8
	lcall	_delay
;	03_hd44780_lcd/lcd.c:93: hd44780_command(HD44780_FUNC_SET);
	mov	dpl,#0x30
	lcall	_hd44780_command
;	03_hd44780_lcd/lcd.c:94: delay(100); // Wait for more than 100us
	mov	dptr,#0x0064
	lcall	_delay
;	03_hd44780_lcd/lcd.c:96: hd44780_command(HD44780_FUNC_SET | HD44780_2_ROWS);
	mov	dpl,#0x38
	lcall	_hd44780_command
;	03_hd44780_lcd/lcd.c:97: hd44780_command(HD44780_DISP_OFF);
	mov	dpl,#0x08
	lcall	_hd44780_command
;	03_hd44780_lcd/lcd.c:98: hd44780_command(HD44780_DISP_CLEAR);
	mov	dpl,#0x01
	lcall	_hd44780_command
;	03_hd44780_lcd/lcd.c:99: hd44780_command(HD44780_ENTRY_MODE);
	mov	dpl,#0x06
;	03_hd44780_lcd/lcd.c:100: }
	ljmp	_hd44780_command
;------------------------------------------------------------
;Allocation info for local variables in function 'hd44780_custom_char'
;------------------------------------------------------------
;charmap                   Allocated with name '_hd44780_custom_char_PARM_2'
;location                  Allocated to registers r7 
;i                         Allocated to registers r7 
;------------------------------------------------------------
;	03_hd44780_lcd/lcd.c:102: void hd44780_custom_char(uint8_t location, const uint8_t* charmap) {
;	-----------------------------------------
;	 function hd44780_custom_char
;	-----------------------------------------
_hd44780_custom_char:
;	03_hd44780_lcd/lcd.c:103: location &= 0x7; // We only have 8 locations 0-7
;	03_hd44780_lcd/lcd.c:104: hd44780_command(HD44780_CGRAM_ADDR | (location << 3)); // each location takes 8 bytes
	mov	a,dpl
	anl	a,#0x07
	swap	a
	rr	a
	anl	a,#0xf8
	mov	r7,a
	mov	a,#0x40
	orl	a,r7
	mov	dpl,a
	lcall	_hd44780_command
;	03_hd44780_lcd/lcd.c:105: for (uint8_t i = 0; i < 8; i++) {
	mov	r7,#0x00
00103$:
	cjne	r7,#0x08,00118$
00118$:
	jnc	00101$
;	03_hd44780_lcd/lcd.c:106: hd44780_data(charmap[i]);
	mov	a,r7
	add	a,_hd44780_custom_char_PARM_2
	mov	r4,a
	clr	a
	addc	a,(_hd44780_custom_char_PARM_2 + 1)
	mov	r5,a
	mov	r6,(_hd44780_custom_char_PARM_2 + 2)
	mov	dpl,r4
	mov	dph,r5
	mov	b,r6
	lcall	__gptrget
	mov	dpl,a
	push	ar7
	lcall	_hd44780_data
	pop	ar7
;	03_hd44780_lcd/lcd.c:105: for (uint8_t i = 0; i < 8; i++) {
	inc	r7
	sjmp	00103$
00101$:
;	03_hd44780_lcd/lcd.c:109: hd44780_command(HD44780_DRAM_ADDR);
	mov	dpl,#0x80
;	03_hd44780_lcd/lcd.c:110: }
	ljmp	_hd44780_command
;------------------------------------------------------------
;Allocation info for local variables in function 'main'
;------------------------------------------------------------
;	03_hd44780_lcd/lcd.c:112: void main(void) {
;	-----------------------------------------
;	 function main
;	-----------------------------------------
_main:
;	03_hd44780_lcd/lcd.c:113: hd44780_init();
	lcall	_hd44780_init
;	03_hd44780_lcd/lcd.c:114: hd44780_custom_char(0, custom_char_heart);
	mov	_hd44780_custom_char_PARM_2,#_custom_char_heart
	mov	(_hd44780_custom_char_PARM_2 + 1),#(_custom_char_heart >> 8)
	mov	(_hd44780_custom_char_PARM_2 + 2),#0x80
	mov	dpl,#0x00
	lcall	_hd44780_custom_char
;	03_hd44780_lcd/lcd.c:115: hd44780_command(HD44780_DISP_ON);
	mov	dpl,#0x0c
	lcall	_hd44780_command
;	03_hd44780_lcd/lcd.c:116: hd44780_text("Hello, World!");
	mov	dptr,#___str_0
	mov	b,#0x80
	lcall	_hd44780_text
;	03_hd44780_lcd/lcd.c:117: hd44780_command((HD44780_POSITION | HD44780_ROW2_START) | 1);
	mov	dpl,#0xc1
	lcall	_hd44780_command
;	03_hd44780_lcd/lcd.c:118: hd44780_data('\x00'); // Custom heart character
	mov	dpl,#0x00
	lcall	_hd44780_data
;	03_hd44780_lcd/lcd.c:119: hd44780_text("From 8051!");
	mov	dptr,#___str_1
	mov	b,#0x80
	lcall	_hd44780_text
;	03_hd44780_lcd/lcd.c:120: hd44780_data('\x00'); // Custom heart character
	mov	dpl,#0x00
	lcall	_hd44780_data
00103$:
;	03_hd44780_lcd/lcd.c:123: }
	sjmp	00103$
	.area CSEG    (CODE)
	.area CONST   (CODE)
_custom_char_heart:
	.db #0x00	; 0
	.db #0x0a	; 10
	.db #0x1f	; 31
	.db #0x1f	; 31
	.db #0x1f	; 31
	.db #0x0e	; 14
	.db #0x04	; 4
	.db #0x00	; 0
	.area CONST   (CODE)
___str_0:
	.ascii "Hello, World!"
	.db 0x00
	.area CSEG    (CODE)
	.area CONST   (CODE)
___str_1:
	.ascii "From 8051!"
	.db 0x00
	.area CSEG    (CODE)
	.area XINIT   (CODE)
	.area CABS    (ABS,CODE)
