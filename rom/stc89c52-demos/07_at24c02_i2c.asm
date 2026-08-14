;--------------------------------------------------------
; File Created by SDCC : free open source ANSI-C Compiler
; Version 4.2.0 #13081 (Linux)
;--------------------------------------------------------
	.module i2c
	.optsdcc -mmcs51 --model-small
	
;--------------------------------------------------------
; Public variables in this module
;--------------------------------------------------------
	.globl _segment_dp
	.globl _segment_map
	.globl _main
	.globl _int_to_digits
	.globl _tf0_isr
	.globl _timer0_init
	.globl _at24c02_read_byte
	.globl _at24c02_write_byte
	.globl _i2c_read
	.globl _i2c_write
	.globl _i2c_stop
	.globl _i2c_start
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
	.globl _int_to_digits_PARM_2
	.globl _digits
	.globl _seg_digit
	.globl _at24c02_write_byte_PARM_2
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
_at24c02_write_byte_PARM_2:
	.ds 1
_seg_digit::
	.ds 1
_digits::
	.ds 8
_int_to_digits_PARM_2:
	.ds 3
_int_to_digits_i_65537_29:
	.ds 2
_int_to_digits_sloc0_1_0:
	.ds 3
;--------------------------------------------------------
; overlayable items in internal ram
;--------------------------------------------------------
	.area	OSEG    (OVR,DATA)
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
;	07_at24c02_i2c/i2c.c:150: volatile uint8_t seg_digit = 0;     // current display index
	mov	_seg_digit,#0x00
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
;	07_at24c02_i2c/i2c.c:26: void delay(uint16_t t) {
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
;	07_at24c02_i2c/i2c.c:27: while (t--) // Simple delay loop (more than 1us at 12MHz)
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
;	07_at24c02_i2c/i2c.c:29: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'i2c_start'
;------------------------------------------------------------
;	07_at24c02_i2c/i2c.c:31: void i2c_start(void) {
;	-----------------------------------------
;	 function i2c_start
;	-----------------------------------------
_i2c_start:
;	07_at24c02_i2c/i2c.c:32: I2C_SDA = 1;
;	assignBit
	setb	_P2_0
;	07_at24c02_i2c/i2c.c:33: I2C_SCL = 1;
;	assignBit
	setb	_P2_1
;	07_at24c02_i2c/i2c.c:34: DELAY_10US();
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
;	07_at24c02_i2c/i2c.c:35: I2C_SDA = 0;
;	assignBit
	clr	_P2_0
;	07_at24c02_i2c/i2c.c:36: DELAY_10US();
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
;	07_at24c02_i2c/i2c.c:37: I2C_SCL = 0;
;	assignBit
	clr	_P2_1
;	07_at24c02_i2c/i2c.c:38: DELAY_10US();
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
;	07_at24c02_i2c/i2c.c:39: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'i2c_stop'
;------------------------------------------------------------
;	07_at24c02_i2c/i2c.c:41: void i2c_stop(void) {
;	-----------------------------------------
;	 function i2c_stop
;	-----------------------------------------
_i2c_stop:
;	07_at24c02_i2c/i2c.c:42: I2C_SDA = 0;
;	assignBit
	clr	_P2_0
;	07_at24c02_i2c/i2c.c:43: DELAY_10US();
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
;	07_at24c02_i2c/i2c.c:44: I2C_SCL = 1;
;	assignBit
	setb	_P2_1
;	07_at24c02_i2c/i2c.c:45: DELAY_10US();
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
;	07_at24c02_i2c/i2c.c:46: I2C_SDA = 1;
;	assignBit
	setb	_P2_0
;	07_at24c02_i2c/i2c.c:47: DELAY_10US();
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
;	07_at24c02_i2c/i2c.c:48: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'i2c_write'
;------------------------------------------------------------
;byte                      Allocated to registers r7 
;timer                     Allocated to registers r7 
;i                         Allocated to registers r6 
;------------------------------------------------------------
;	07_at24c02_i2c/i2c.c:50: uint8_t i2c_write(uint8_t byte) {
;	-----------------------------------------
;	 function i2c_write
;	-----------------------------------------
_i2c_write:
	mov	r7,dpl
;	07_at24c02_i2c/i2c.c:52: for(uint8_t i = 0; i < 8; i++) { // MSB first
	mov	r6,#0x00
00108$:
	cjne	r6,#0x08,00133$
00133$:
	jnc	00101$
;	07_at24c02_i2c/i2c.c:54: I2C_SDA = byte >> 7;
	mov	a,r7
	rl	a
	anl	a,#0x01
;	assignBit
	add	a,#0xff
	mov	_P2_0,c
;	07_at24c02_i2c/i2c.c:55: byte <<= 1;
	mov	ar5,r7
	mov	a,r5
	add	a,r5
	mov	r7,a
;	07_at24c02_i2c/i2c.c:56: DELAY_10US();
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
;	07_at24c02_i2c/i2c.c:57: I2C_SCL = 1;
;	assignBit
	setb	_P2_1
;	07_at24c02_i2c/i2c.c:58: DELAY_10US();
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
;	07_at24c02_i2c/i2c.c:59: I2C_SCL = 0;
;	assignBit
	clr	_P2_1
;	07_at24c02_i2c/i2c.c:60: DELAY_10US();
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
;	07_at24c02_i2c/i2c.c:52: for(uint8_t i = 0; i < 8; i++) { // MSB first
	inc	r6
	sjmp	00108$
00101$:
;	07_at24c02_i2c/i2c.c:63: I2C_SDA = 1; // Release SDA for ACK
;	assignBit
	setb	_P2_0
;	07_at24c02_i2c/i2c.c:64: DELAY_10US();
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
;	07_at24c02_i2c/i2c.c:65: I2C_SCL = 1;
;	assignBit
	setb	_P2_1
;	07_at24c02_i2c/i2c.c:66: while(I2C_SDA) { // Wait for ACK (or timeout as NACK)
	mov	r7,#0x00
00104$:
	jnb	_P2_0,00106$
;	07_at24c02_i2c/i2c.c:67: timer++;
	inc	r7
;	07_at24c02_i2c/i2c.c:68: if(timer > 250) {
	mov	a,r7
	add	a,#0xff - 0xfa
	jnc	00104$
;	07_at24c02_i2c/i2c.c:69: I2C_SCL = 0;
;	assignBit
	clr	_P2_1
;	07_at24c02_i2c/i2c.c:70: DELAY_10US();
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
;	07_at24c02_i2c/i2c.c:71: return 0; // NACK
	mov	dpl,#0x00
	ret
00106$:
;	07_at24c02_i2c/i2c.c:74: I2C_SCL = 0;
;	assignBit
	clr	_P2_1
;	07_at24c02_i2c/i2c.c:75: DELAY_10US();
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
;	07_at24c02_i2c/i2c.c:76: return 1; // ACK
	mov	dpl,#0x01
;	07_at24c02_i2c/i2c.c:77: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'i2c_read'
;------------------------------------------------------------
;byte                      Allocated to registers r5 
;i                         Allocated to registers r6 
;------------------------------------------------------------
;	07_at24c02_i2c/i2c.c:79: uint8_t i2c_read() {
;	-----------------------------------------
;	 function i2c_read
;	-----------------------------------------
_i2c_read:
;	07_at24c02_i2c/i2c.c:80: uint8_t byte = 0;
	mov	r7,#0x00
;	07_at24c02_i2c/i2c.c:81: for(uint8_t i = 0; i < 8; i++) {
	mov	r6,#0x00
00103$:
	cjne	r6,#0x08,00118$
00118$:
	jnc	00101$
;	07_at24c02_i2c/i2c.c:82: I2C_SCL = 1;
;	assignBit
	setb	_P2_1
;	07_at24c02_i2c/i2c.c:83: DELAY_10US();
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
;	07_at24c02_i2c/i2c.c:84: byte |= I2C_SDA;
	mov	c,_P2_0
	clr	a
	rlc	a
	mov	r5,a
	mov	a,r7
	orl	ar5,a
;	07_at24c02_i2c/i2c.c:85: I2C_SCL = 0;
;	assignBit
	clr	_P2_1
;	07_at24c02_i2c/i2c.c:86: DELAY_10US();
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
	NOP	
;	07_at24c02_i2c/i2c.c:87: byte <<= 1;
	mov	a,r5
	add	a,r5
	mov	r7,a
;	07_at24c02_i2c/i2c.c:81: for(uint8_t i = 0; i < 8; i++) {
	inc	r6
	sjmp	00103$
00101$:
;	07_at24c02_i2c/i2c.c:89: return byte;
	mov	dpl,r7
;	07_at24c02_i2c/i2c.c:90: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'at24c02_write_byte'
;------------------------------------------------------------
;data                      Allocated with name '_at24c02_write_byte_PARM_2'
;mem_addr                  Allocated to registers r7 
;------------------------------------------------------------
;	07_at24c02_i2c/i2c.c:94: void at24c02_write_byte(uint8_t mem_addr, uint8_t data) {
;	-----------------------------------------
;	 function at24c02_write_byte
;	-----------------------------------------
_at24c02_write_byte:
	mov	r7,dpl
;	07_at24c02_i2c/i2c.c:95: i2c_start();
	push	ar7
	lcall	_i2c_start
;	07_at24c02_i2c/i2c.c:96: i2c_write(AT24C02_ADDR); // Device address + Write
	mov	dpl,#0xa0
	lcall	_i2c_write
	pop	ar7
;	07_at24c02_i2c/i2c.c:97: i2c_write(mem_addr); // Memory address
	mov	dpl,r7
	lcall	_i2c_write
;	07_at24c02_i2c/i2c.c:98: i2c_write(data); // Data byte
	mov	dpl,_at24c02_write_byte_PARM_2
	lcall	_i2c_write
;	07_at24c02_i2c/i2c.c:99: i2c_stop();
;	07_at24c02_i2c/i2c.c:100: }
	ljmp	_i2c_stop
;------------------------------------------------------------
;Allocation info for local variables in function 'at24c02_read_byte'
;------------------------------------------------------------
;mem_addr                  Allocated to registers r7 
;data                      Allocated to registers r7 
;------------------------------------------------------------
;	07_at24c02_i2c/i2c.c:102: uint8_t at24c02_read_byte(uint8_t mem_addr) {
;	-----------------------------------------
;	 function at24c02_read_byte
;	-----------------------------------------
_at24c02_read_byte:
	mov	r7,dpl
;	07_at24c02_i2c/i2c.c:104: i2c_start();
	push	ar7
	lcall	_i2c_start
;	07_at24c02_i2c/i2c.c:105: i2c_write(AT24C02_ADDR); // Device address + Write
	mov	dpl,#0xa0
	lcall	_i2c_write
	pop	ar7
;	07_at24c02_i2c/i2c.c:106: i2c_write(mem_addr); // Memory address
	mov	dpl,r7
	lcall	_i2c_write
;	07_at24c02_i2c/i2c.c:107: i2c_start(); // Repeated start
	lcall	_i2c_start
;	07_at24c02_i2c/i2c.c:108: i2c_write(AT24C02_ADDR | 0x01); // Device address + Read
	mov	dpl,#0xa1
	lcall	_i2c_write
;	07_at24c02_i2c/i2c.c:109: data = i2c_read();
	lcall	_i2c_read
	mov	r7,dpl
;	07_at24c02_i2c/i2c.c:110: i2c_stop();
	push	ar7
	lcall	_i2c_stop
	pop	ar7
;	07_at24c02_i2c/i2c.c:111: return data;
	mov	dpl,r7
;	07_at24c02_i2c/i2c.c:112: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'timer0_init'
;------------------------------------------------------------
;	07_at24c02_i2c/i2c.c:140: void timer0_init(void) {
;	-----------------------------------------
;	 function timer0_init
;	-----------------------------------------
_timer0_init:
;	07_at24c02_i2c/i2c.c:141: TMOD &= 0xF0;	/* Clear Timer 0 mode bits */
	anl	_TMOD,#0xf0
;	07_at24c02_i2c/i2c.c:142: TMOD |= 0x1;	/* Set Timer 0 mode to 16-bit */
	orl	_TMOD,#0x01
;	07_at24c02_i2c/i2c.c:143: TH0 = 0xdc;	/* Set Timer 0 high byte for 16-bit mode */
	mov	_TH0,#0xdc
;	07_at24c02_i2c/i2c.c:144: TL0 = 0x00;	/* Set Timer 0 low byte for 16-bit mode */
	mov	_TL0,#0x00
;	07_at24c02_i2c/i2c.c:145: TF0 = 0;	/* Clear Timer 0 overflow flag */
;	assignBit
	clr	_TF0
;	07_at24c02_i2c/i2c.c:146: TR0 = 1;	/* Start Timer 0 */
;	assignBit
	setb	_TR0
;	07_at24c02_i2c/i2c.c:147: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'tf0_isr'
;------------------------------------------------------------
;val                       Allocated to registers 
;------------------------------------------------------------
;	07_at24c02_i2c/i2c.c:153: void tf0_isr(void) __interrupt(TF0_VECTOR) {
;	-----------------------------------------
;	 function tf0_isr
;	-----------------------------------------
_tf0_isr:
	push	acc
	push	dpl
	push	dph
	push	ar7
	push	ar1
	push	psw
	mov	psw,#0x00
;	07_at24c02_i2c/i2c.c:154: LED_DIGIT = 0x00; // Turn off all segments
	mov	_P0,#0x00
;	07_at24c02_i2c/i2c.c:155: P2 = seg_digit<<2; // activate digit i (P2_2..P2_4)
	mov	a,_seg_digit
	add	a,acc
	add	a,acc
	mov	_P2,a
;	07_at24c02_i2c/i2c.c:158: uint8_t val = segment_map[digits[seg_digit]];
	mov	a,_seg_digit
	add	a,#_digits
	mov	r1,a
	mov	a,@r1
	mov	dptr,#_segment_map
	movc	a,@a+dptr
	mov	_P0,a
;	07_at24c02_i2c/i2c.c:160: seg_digit++;
	mov	a,_seg_digit
	inc	a
	mov	_seg_digit,a
;	07_at24c02_i2c/i2c.c:161: if(seg_digit > 7)
	mov	a,_seg_digit
	add	a,#0xff - 0x07
	jnc	00102$
;	07_at24c02_i2c/i2c.c:162: seg_digit = 0;
	mov	_seg_digit,#0x00
00102$:
;	07_at24c02_i2c/i2c.c:165: TH0 = 0xfc;	/* Set Timer 0 high byte for 16-bit mode */
	mov	_TH0,#0xfc
;	07_at24c02_i2c/i2c.c:166: TL0 = 0x66;	/* Set Timer 0 low byte for 16-bit mode */
	mov	_TL0,#0x66
;	07_at24c02_i2c/i2c.c:167: TF0 = 0;	/* Clear Timer 0 overflow flag */
;	assignBit
	clr	_TF0
;	07_at24c02_i2c/i2c.c:168: }
	pop	psw
	pop	ar1
	pop	ar7
	pop	dph
	pop	dpl
	pop	acc
	reti
;	eliminated unneeded push/pop ar0
;	eliminated unneeded push/pop b
;------------------------------------------------------------
;Allocation info for local variables in function 'int_to_digits'
;------------------------------------------------------------
;ptr                       Allocated with name '_int_to_digits_PARM_2'
;val                       Allocated to registers r6 r7 
;i                         Allocated to registers r5 
;i                         Allocated with name '_int_to_digits_i_65537_29'
;temp_N                    Allocated to registers r6 r7 
;sloc0                     Allocated with name '_int_to_digits_sloc0_1_0'
;------------------------------------------------------------
;	07_at24c02_i2c/i2c.c:170: void int_to_digits(int16_t val, uint8_t *ptr) {
;	-----------------------------------------
;	 function int_to_digits
;	-----------------------------------------
_int_to_digits:
	mov	r6,dpl
	mov	r7,dph
;	07_at24c02_i2c/i2c.c:171: for(uint8_t i = 0; i < 8; i++) {
	mov	r5,#0x00
00107$:
	cjne	r5,#0x08,00139$
00139$:
	jnc	00101$
;	07_at24c02_i2c/i2c.c:172: ptr[i] = 0;
	mov	a,r5
	add	a,_int_to_digits_PARM_2
	mov	r2,a
	clr	a
	addc	a,(_int_to_digits_PARM_2 + 1)
	mov	r3,a
	mov	r4,(_int_to_digits_PARM_2 + 2)
	mov	dpl,r2
	mov	dph,r3
	mov	b,r4
	clr	a
	lcall	__gptrput
;	07_at24c02_i2c/i2c.c:171: for(uint8_t i = 0; i < 8; i++) {
	inc	r5
	sjmp	00107$
00101$:
;	07_at24c02_i2c/i2c.c:176: int16_t temp_N = (val < 0) ? -val : val;
	mov	ar5,r7
	mov	a,r5
	jnb	acc.7,00111$
	clr	c
	clr	a
	subb	a,r6
	mov	r4,a
	clr	a
	subb	a,r7
	mov	r5,a
	sjmp	00112$
00111$:
	mov	ar4,r6
	mov	ar5,r7
00112$:
	mov	ar6,r4
	mov	ar7,r5
;	07_at24c02_i2c/i2c.c:179: while (temp_N > 0 && i >= 0) {
	mov	_int_to_digits_i_65537_29,#0x07
	mov	(_int_to_digits_i_65537_29 + 1),#0x00
00103$:
	mov	ar2,r6
	mov	ar3,r7
	clr	c
	clr	a
	subb	a,r2
	mov	a,#(0x00 ^ 0x80)
	mov	b,r3
	xrl	b,#0x80
	subb	a,b
	jnc	00109$
	mov	a,(_int_to_digits_i_65537_29 + 1)
	jb	acc.7,00109$
;	07_at24c02_i2c/i2c.c:181: ptr[7-i] = temp_N % 10;
	mov	a,#0x07
	clr	c
	subb	a,_int_to_digits_i_65537_29
	mov	r0,a
	clr	a
	subb	a,(_int_to_digits_i_65537_29 + 1)
	mov	r1,a
	mov	a,r0
	add	a,_int_to_digits_PARM_2
	mov	_int_to_digits_sloc0_1_0,a
	mov	a,r1
	addc	a,(_int_to_digits_PARM_2 + 1)
	mov	(_int_to_digits_sloc0_1_0 + 1),a
	mov	(_int_to_digits_sloc0_1_0 + 2),(_int_to_digits_PARM_2 + 2)
	mov	__modsint_PARM_2,#0x0a
	mov	(__modsint_PARM_2 + 1),#0x00
	mov	dpl,r2
	mov	dph,r3
	push	ar3
	push	ar2
	lcall	__modsint
	mov	r4,dpl
	pop	ar2
	pop	ar3
	mov	dpl,_int_to_digits_sloc0_1_0
	mov	dph,(_int_to_digits_sloc0_1_0 + 1)
	mov	b,(_int_to_digits_sloc0_1_0 + 2)
	mov	a,r4
	lcall	__gptrput
;	07_at24c02_i2c/i2c.c:184: temp_N = temp_N / 10;
	mov	__divsint_PARM_2,#0x0a
	mov	(__divsint_PARM_2 + 1),#0x00
	mov	dpl,r2
	mov	dph,r3
	lcall	__divsint
	mov	r4,dpl
	mov	r5,dph
	mov	ar6,r4
	mov	ar7,r5
;	07_at24c02_i2c/i2c.c:187: i = i - 1;
	dec	_int_to_digits_i_65537_29
	mov	a,#0xff
	cjne	a,_int_to_digits_i_65537_29,00144$
	dec	(_int_to_digits_i_65537_29 + 1)
00144$:
	sjmp	00103$
00109$:
;	07_at24c02_i2c/i2c.c:189: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'main'
;------------------------------------------------------------
;data                      Allocated to registers r7 
;------------------------------------------------------------
;	07_at24c02_i2c/i2c.c:194: void main(void) {
;	-----------------------------------------
;	 function main
;	-----------------------------------------
_main:
;	07_at24c02_i2c/i2c.c:195: timer0_init();
	lcall	_timer0_init
;	07_at24c02_i2c/i2c.c:196: EA = 1; // Enable global interrupts
;	assignBit
	setb	_EA
;	07_at24c02_i2c/i2c.c:197: ET0 = 1;	/* Enable Timer 0 interrupt */
;	assignBit
	setb	_ET0
00116$:
;	07_at24c02_i2c/i2c.c:200: if(!K3) { // Write current_value to address 0x00 on button press
	jb	_P3_2,00107$
;	07_at24c02_i2c/i2c.c:201: delay(5000); // Debounce delay
	mov	dptr,#0x1388
	lcall	_delay
;	07_at24c02_i2c/i2c.c:202: if(!K3) { // Confirm button still pressed
	jb	_P3_2,00107$
;	07_at24c02_i2c/i2c.c:203: EA = 0; // Disable global interrupts
;	assignBit
	clr	_EA
;	07_at24c02_i2c/i2c.c:204: at24c02_write_byte(0x00, 0xFF);
	mov	_at24c02_write_byte_PARM_2,#0xff
	mov	dpl,#0x00
	lcall	_at24c02_write_byte
;	07_at24c02_i2c/i2c.c:205: EA = 1; // Enable global interrupts
;	assignBit
	setb	_EA
;	07_at24c02_i2c/i2c.c:206: while (!K3); // Wait for button release
00101$:
	jnb	_P3_2,00101$
00107$:
;	07_at24c02_i2c/i2c.c:209: if(!K4) { // Read byte from address 0x00 on button press
	jb	_P3_3,00116$
;	07_at24c02_i2c/i2c.c:210: delay(5000); // Debounce delay
	mov	dptr,#0x1388
	lcall	_delay
;	07_at24c02_i2c/i2c.c:211: if(!K4) { // Confirm button still pressed
	jb	_P3_3,00116$
;	07_at24c02_i2c/i2c.c:212: EA = 0; // Disable global interrupts
;	assignBit
	clr	_EA
;	07_at24c02_i2c/i2c.c:213: uint8_t data = at24c02_read_byte(0x00);
	mov	dpl,#0x00
	lcall	_at24c02_read_byte
	mov	r7,dpl
;	07_at24c02_i2c/i2c.c:214: EA = 1; // Enable global interrupts
;	assignBit
	setb	_EA
;	07_at24c02_i2c/i2c.c:215: int_to_digits(data, digits);
	mov	r6,#0x00
	mov	_int_to_digits_PARM_2,#_digits
;	1-genFromRTrack replaced	mov	(_int_to_digits_PARM_2 + 1),#0x00
	mov	(_int_to_digits_PARM_2 + 1),r6
	mov	(_int_to_digits_PARM_2 + 2),#0x40
	mov	dpl,r7
	mov	dph,r6
	lcall	_int_to_digits
;	07_at24c02_i2c/i2c.c:216: while (!K4); // Wait for button release
00108$:
	jnb	_P3_3,00108$
;	07_at24c02_i2c/i2c.c:220: }
	sjmp	00116$
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
_segment_dp:
	.db #0x80	; 128
	.area XINIT   (CODE)
	.area CABS    (ABS,CODE)
