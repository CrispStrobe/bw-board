;--------------------------------------------------------
; File Created by SDCC : free open source ANSI-C Compiler
; Version 4.2.0 #13081 (Linux)
;--------------------------------------------------------
	.module button_led_matrix
	.optsdcc -mmcs51 --model-small
	
;--------------------------------------------------------
; Public variables in this module
;--------------------------------------------------------
	.globl _matrix_chars
	.globl _main
	.globl _display_digit
	.globl _scan_keypad
	.globl _HC575_write
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
	.globl _key_value
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
_key_value::
	.ds 1
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
;Allocation info for local variables in function 'HC575_write'
;------------------------------------------------------------
;value                     Allocated to registers r7 
;i                         Allocated to registers r6 
;------------------------------------------------------------
;	01_button_led_matrix/button_led_matrix.c:188: void HC575_write(uint8_t value) {
;	-----------------------------------------
;	 function HC575_write
;	-----------------------------------------
_HC575_write:
	ar7 = 0x07
	ar6 = 0x06
	ar5 = 0x05
	ar4 = 0x04
	ar3 = 0x03
	ar2 = 0x02
	ar1 = 0x01
	ar0 = 0x00
	mov	r7,dpl
;	01_button_led_matrix/button_led_matrix.c:189: SRCLK=0;
;	assignBit
	clr	_P3_6
;	01_button_led_matrix/button_led_matrix.c:190: RCLK=0;
;	assignBit
	clr	_P3_5
;	01_button_led_matrix/button_led_matrix.c:191: for(uint8_t i=0; i<8; i++) {
	mov	r6,#0x00
00103$:
	cjne	r6,#0x08,00116$
00116$:
	jnc	00101$
;	01_button_led_matrix/button_led_matrix.c:192: SER = value >> 7;
	mov	a,r7
	rl	a
	anl	a,#0x01
;	assignBit
	add	a,#0xff
	mov	_P3_4,c
;	01_button_led_matrix/button_led_matrix.c:193: value <<= 1;
	mov	ar5,r7
	mov	a,r5
	add	a,r5
	mov	r7,a
;	01_button_led_matrix/button_led_matrix.c:194: SRCLK = 1;
;	assignBit
	setb	_P3_6
;	01_button_led_matrix/button_led_matrix.c:195: NOP();
	NOP	
;	01_button_led_matrix/button_led_matrix.c:196: NOP();
	NOP	
;	01_button_led_matrix/button_led_matrix.c:197: SRCLK = 0;
;	assignBit
	clr	_P3_6
;	01_button_led_matrix/button_led_matrix.c:191: for(uint8_t i=0; i<8; i++) {
	inc	r6
	sjmp	00103$
00101$:
;	01_button_led_matrix/button_led_matrix.c:199: RCLK = 1;
;	assignBit
	setb	_P3_5
;	01_button_led_matrix/button_led_matrix.c:200: NOP();
	NOP	
;	01_button_led_matrix/button_led_matrix.c:201: NOP();
	NOP	
;	01_button_led_matrix/button_led_matrix.c:202: RCLK = 0;
;	assignBit
	clr	_P3_5
;	01_button_led_matrix/button_led_matrix.c:203: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'scan_keypad'
;------------------------------------------------------------
;	01_button_led_matrix/button_led_matrix.c:209: void scan_keypad(void) {
;	-----------------------------------------
;	 function scan_keypad
;	-----------------------------------------
_scan_keypad:
;	01_button_led_matrix/button_led_matrix.c:210: GPIO_KEYPAD = 0x0F; // Enable P10..P13 (all rows) to see if any key is pressed
	mov	_P1,#0x0f
;	01_button_led_matrix/button_led_matrix.c:211: NOP(); NOP();
	NOP	
	NOP	
;	01_button_led_matrix/button_led_matrix.c:212: key_value = -1; // Assume no key pressed
	mov	_key_value,#0xff
;	01_button_led_matrix/button_led_matrix.c:213: if(GPIO_KEYPAD != 0x0F) { // A key is pressed, shorted to ground
	mov	a,#0x0f
	cjne	a,_P1,00157$
	sjmp	00114$
00157$:
;	01_button_led_matrix/button_led_matrix.c:214: switch (GPIO_KEYPAD) {
	mov	r7,_P1
	cjne	r7,#0x07,00158$
	sjmp	00101$
00158$:
	cjne	r7,#0x0b,00159$
	sjmp	00102$
00159$:
	cjne	r7,#0x0d,00160$
	sjmp	00103$
00160$:
;	01_button_led_matrix/button_led_matrix.c:215: case 0x07: // Column 0
	cjne	r7,#0x0e,00105$
	sjmp	00104$
00101$:
;	01_button_led_matrix/button_led_matrix.c:216: key_value = 0;
	mov	_key_value,#0x00
;	01_button_led_matrix/button_led_matrix.c:217: break;
;	01_button_led_matrix/button_led_matrix.c:218: case 0x0B: // Column 1
	sjmp	00105$
00102$:
;	01_button_led_matrix/button_led_matrix.c:219: key_value = 1;
	mov	_key_value,#0x01
;	01_button_led_matrix/button_led_matrix.c:220: break;
;	01_button_led_matrix/button_led_matrix.c:221: case 0x0D: // Column 2
	sjmp	00105$
00103$:
;	01_button_led_matrix/button_led_matrix.c:222: key_value = 2;
	mov	_key_value,#0x02
;	01_button_led_matrix/button_led_matrix.c:223: break;
;	01_button_led_matrix/button_led_matrix.c:224: case 0x0E: // Column 3
	sjmp	00105$
00104$:
;	01_button_led_matrix/button_led_matrix.c:225: key_value = 3;
	mov	_key_value,#0x03
;	01_button_led_matrix/button_led_matrix.c:227: }
00105$:
;	01_button_led_matrix/button_led_matrix.c:228: NOP();
	NOP	
;	01_button_led_matrix/button_led_matrix.c:229: NOP();
	NOP	
;	01_button_led_matrix/button_led_matrix.c:231: GPIO_KEYPAD = 0xF0;
	mov	_P1,#0xf0
;	01_button_led_matrix/button_led_matrix.c:232: NOP();
	NOP	
;	01_button_led_matrix/button_led_matrix.c:233: NOP();
	NOP	
;	01_button_led_matrix/button_led_matrix.c:234: if (key_value != -1) {
	mov	a,#0xff
	cjne	a,_key_value,00162$
	sjmp	00114$
00162$:
;	01_button_led_matrix/button_led_matrix.c:235: switch (GPIO_KEYPAD) {
	mov	r7,_P1
	cjne	r7,#0x70,00163$
	sjmp	00114$
00163$:
	cjne	r7,#0xb0,00164$
	sjmp	00107$
00164$:
	cjne	r7,#0xd0,00165$
	sjmp	00108$
00165$:
;	01_button_led_matrix/button_led_matrix.c:236: case 0x70: // Row 0
	cjne	r7,#0xe0,00114$
	sjmp	00109$
;	01_button_led_matrix/button_led_matrix.c:237: key_value += 0;
;	01_button_led_matrix/button_led_matrix.c:238: break;
;	01_button_led_matrix/button_led_matrix.c:239: case 0xB0: // Row 1
	sjmp	00114$
00107$:
;	01_button_led_matrix/button_led_matrix.c:240: key_value += 4;
	mov	a,_key_value
	add	a,#0x04
	mov	_key_value,a
;	01_button_led_matrix/button_led_matrix.c:241: break;
;	01_button_led_matrix/button_led_matrix.c:242: case 0xD0: // Row 2
	sjmp	00114$
00108$:
;	01_button_led_matrix/button_led_matrix.c:243: key_value += 8;
	mov	a,#0x08
	add	a,_key_value
	mov	_key_value,a
;	01_button_led_matrix/button_led_matrix.c:244: break;
;	01_button_led_matrix/button_led_matrix.c:245: case 0xE0: // Row 3
	sjmp	00114$
00109$:
;	01_button_led_matrix/button_led_matrix.c:246: key_value += 12;
	mov	a,#0x0c
	add	a,_key_value
	mov	_key_value,a
;	01_button_led_matrix/button_led_matrix.c:248: }
00114$:
;	01_button_led_matrix/button_led_matrix.c:251: GPIO_KEYPAD = 0x00; // Disable all rows and columns
	mov	_P1,#0x00
;	01_button_led_matrix/button_led_matrix.c:252: NOP(); NOP();
	NOP	
	NOP	
;	01_button_led_matrix/button_led_matrix.c:253: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'display_digit'
;------------------------------------------------------------
;digit                     Allocated to registers r7 
;i                         Allocated to registers r6 
;scan_line                 Allocated to registers r5 
;------------------------------------------------------------
;	01_button_led_matrix/button_led_matrix.c:255: void display_digit(int8_t digit) {
;	-----------------------------------------
;	 function display_digit
;	-----------------------------------------
_display_digit:
	mov	r7,dpl
;	01_button_led_matrix/button_led_matrix.c:256: if(digit > 0x0F || digit < 0) return; // Invalid digit
	clr	c
	mov	a,#(0x0f ^ 0x80)
	mov	b,r7
	xrl	b,#0x80
	subb	a,b
	jc	00101$
	mov	a,r7
	jnb	acc.7,00102$
00101$:
	ret
00102$:
;	01_button_led_matrix/button_led_matrix.c:257: P0 = 0xFF;
	mov	_P0,#0xff
;	01_button_led_matrix/button_led_matrix.c:259: for(uint8_t i=0; i<8; i++) {
	mov	r6,#0x00
00106$:
	cjne	r6,#0x08,00125$
00125$:
	jnc	00108$
;	01_button_led_matrix/button_led_matrix.c:260: P0 = ~matrix_chars[i+(digit*8)];
	mov	ar4,r6
	mov	r5,#0x00
	mov	a,r7
	mov	r2,a
	rlc	a
	subb	a,acc
	swap	a
	rr	a
	anl	a,#0xf8
	xch	a,r2
	swap	a
	rr	a
	xch	a,r2
	xrl	a,r2
	xch	a,r2
	anl	a,#0xf8
	xch	a,r2
	xrl	a,r2
	mov	r3,a
	mov	a,r2
	add	a,r4
	mov	r4,a
	mov	a,r3
	addc	a,r5
	mov	r5,a
	mov	a,r4
	add	a,#_matrix_chars
	mov	dpl,a
	mov	a,r5
	addc	a,#(_matrix_chars >> 8)
	mov	dph,a
	clr	a
	movc	a,@a+dptr
	cpl	a
	mov	_P0,a
;	01_button_led_matrix/button_led_matrix.c:261: uint8_t scan_line = 7-i; // Scan from top to bottom
	mov	ar5,r6
	mov	a,#0x07
	clr	c
	subb	a,r5
	mov	r5,a
;	01_button_led_matrix/button_led_matrix.c:262: HC575_write((1 << scan_line)); // invert since active low
	mov	b,r5
	inc	b
	mov	a,#0x01
	sjmp	00129$
00127$:
	add	a,acc
00129$:
	djnz	b,00127$
	mov	dpl,a
	push	ar7
	push	ar6
	lcall	_HC575_write
;	01_button_led_matrix/button_led_matrix.c:263: HC575_write(0); // invert since active low, to avoid ghosting
	mov	dpl,#0x00
	lcall	_HC575_write
	pop	ar6
	pop	ar7
;	01_button_led_matrix/button_led_matrix.c:259: for(uint8_t i=0; i<8; i++) {
	inc	r6
	sjmp	00106$
00108$:
;	01_button_led_matrix/button_led_matrix.c:266: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'main'
;------------------------------------------------------------
;	01_button_led_matrix/button_led_matrix.c:268: void main(void) {
;	-----------------------------------------
;	 function main
;	-----------------------------------------
_main:
00105$:
;	01_button_led_matrix/button_led_matrix.c:270: scan_keypad();
	lcall	_scan_keypad
;	01_button_led_matrix/button_led_matrix.c:271: if(key_value >= 0) {
	mov	a,_key_value
	jb	acc.7,00102$
;	01_button_led_matrix/button_led_matrix.c:272: display_digit(key_value);
	mov	dpl,_key_value
	lcall	_display_digit
	sjmp	00105$
00102$:
;	01_button_led_matrix/button_led_matrix.c:274: HC575_write(0); // Turn off all rows
	mov	dpl,#0x00
	lcall	_HC575_write
;	01_button_led_matrix/button_led_matrix.c:277: }
	sjmp	00105$
	.area CSEG    (CODE)
	.area CONST   (CODE)
_matrix_chars:
	.db #0x00	; 0
	.db #0x1c	; 28
	.db #0x22	; 34
	.db #0x22	; 34
	.db #0x22	; 34
	.db #0x22	; 34
	.db #0x22	; 34
	.db #0x1c	; 28
	.db #0x00	; 0
	.db #0x08	; 8
	.db #0x18	; 24
	.db #0x08	; 8
	.db #0x08	; 8
	.db #0x08	; 8
	.db #0x08	; 8
	.db #0x1e	; 30
	.db #0x00	; 0
	.db #0x1c	; 28
	.db #0x22	; 34
	.db #0x04	; 4
	.db #0x08	; 8
	.db #0x10	; 16
	.db #0x3e	; 62
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x1c	; 28
	.db #0x22	; 34
	.db #0x04	; 4
	.db #0x0c	; 12
	.db #0x02	; 2
	.db #0x22	; 34
	.db #0x1c	; 28
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x28	; 40
	.db #0x28	; 40
	.db #0x3e	; 62
	.db #0x08	; 8
	.db #0x08	; 8
	.db #0x08	; 8
	.db #0x00	; 0
	.db #0x3e	; 62
	.db #0x20	; 32
	.db #0x38	; 56	'8'
	.db #0x04	; 4
	.db #0x02	; 2
	.db #0x22	; 34
	.db #0x1c	; 28
	.db #0x00	; 0
	.db #0x0c	; 12
	.db #0x10	; 16
	.db #0x3c	; 60
	.db #0x22	; 34
	.db #0x22	; 34
	.db #0x22	; 34
	.db #0x1c	; 28
	.db #0x00	; 0
	.db #0x3e	; 62
	.db #0x02	; 2
	.db #0x04	; 4
	.db #0x08	; 8
	.db #0x10	; 16
	.db #0x20	; 32
	.db #0x20	; 32
	.db #0x00	; 0
	.db #0x1c	; 28
	.db #0x22	; 34
	.db #0x1c	; 28
	.db #0x22	; 34
	.db #0x22	; 34
	.db #0x22	; 34
	.db #0x1c	; 28
	.db #0x00	; 0
	.db #0x1c	; 28
	.db #0x22	; 34
	.db #0x22	; 34
	.db #0x1e	; 30
	.db #0x02	; 2
	.db #0x04	; 4
	.db #0x18	; 24
	.db #0x00	; 0
	.db #0x0c	; 12
	.db #0x12	; 18
	.db #0x21	; 33
	.db #0x3f	; 63
	.db #0x21	; 33
	.db #0x21	; 33
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x3c	; 60
	.db #0x22	; 34
	.db #0x3c	; 60
	.db #0x22	; 34
	.db #0x22	; 34
	.db #0x3c	; 60
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x1e	; 30
	.db #0x20	; 32
	.db #0x20	; 32
	.db #0x20	; 32
	.db #0x20	; 32
	.db #0x1e	; 30
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x3c	; 60
	.db #0x22	; 34
	.db #0x22	; 34
	.db #0x22	; 34
	.db #0x22	; 34
	.db #0x3c	; 60
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x3e	; 62
	.db #0x20	; 32
	.db #0x38	; 56	'8'
	.db #0x20	; 32
	.db #0x20	; 32
	.db #0x3e	; 62
	.db #0x00	; 0
	.db #0x00	; 0
	.db #0x3e	; 62
	.db #0x20	; 32
	.db #0x38	; 56	'8'
	.db #0x20	; 32
	.db #0x20	; 32
	.db #0x20	; 32
	.db #0x00	; 0
	.area XINIT   (CODE)
	.area CABS    (ABS,CODE)
