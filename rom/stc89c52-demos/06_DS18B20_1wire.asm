;--------------------------------------------------------
; File Created by SDCC : free open source ANSI-C Compiler
; Version 4.2.0 #13081 (Linux)
;--------------------------------------------------------
	.module wire
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
	.globl _temp_to_celsius
	.globl _ds18b20_read_temperature
	.globl _ds18b20_start_conversion
	.globl _wire_read_byte
	.globl _wire_write_byte
	.globl _wire_init
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
	.globl _decimal_index
	.globl _seg_digit
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
_seg_digit::
	.ds 1
_decimal_index::
	.ds 1
_digits::
	.ds 8
_int_to_digits_PARM_2:
	.ds 3
_int_to_digits_i_65537_26:
	.ds 2
_int_to_digits_sloc0_1_0:
	.ds 3
;--------------------------------------------------------
; overlayable items in internal ram
;--------------------------------------------------------
	.area	OSEG    (OVR,DATA)
	.area	OSEG    (OVR,DATA)
_wire_write_byte_j_65536_5:
	.ds 1
	.area	OSEG    (OVR,DATA)
_wire_read_byte_j_65536_9:
	.ds 1
_wire_read_byte_byte_65536_9:
	.ds 1
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
;	06_DS18B20_1wire/wire.c:123: volatile uint8_t seg_digit = 0;     // current display index
	mov	_seg_digit,#0x00
;	06_DS18B20_1wire/wire.c:124: volatile uint8_t decimal_index = 2; // where is the decimal point
	mov	_decimal_index,#0x02
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
;	06_DS18B20_1wire/wire.c:23: void delay(uint16_t t) {
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
;	06_DS18B20_1wire/wire.c:24: while (t--) // Simple delay loop (more than 1us at 12MHz)
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
;	06_DS18B20_1wire/wire.c:26: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'wire_init'
;------------------------------------------------------------
;	06_DS18B20_1wire/wire.c:30: void wire_init() { // https://www.analog.com/media/en/technical-documentation/data-sheets/ds18b20.pdf p 15
;	-----------------------------------------
;	 function wire_init
;	-----------------------------------------
_wire_init:
;	06_DS18B20_1wire/wire.c:31: DS18B20_DQ = 0;   // Assert reset pulse
;	assignBit
	clr	_P3_7
;	06_DS18B20_1wire/wire.c:32: delay(480);
	mov	dptr,#0x01e0
	lcall	_delay
;	06_DS18B20_1wire/wire.c:33: DS18B20_DQ = 1;
;	assignBit
	setb	_P3_7
;	06_DS18B20_1wire/wire.c:34: delay(5);
	mov	dptr,#0x0005
	lcall	_delay
;	06_DS18B20_1wire/wire.c:35: while(DS18B20_DQ); // Wait for presence pulse (FIXME: Maybe add timeout for peripheral failures)
00101$:
	jb	_P3_7,00101$
;	06_DS18B20_1wire/wire.c:36: delay(500);
	mov	dptr,#0x01f4
;	06_DS18B20_1wire/wire.c:37: }
	ljmp	_delay
;------------------------------------------------------------
;Allocation info for local variables in function 'wire_write_byte'
;------------------------------------------------------------
;byte                      Allocated to registers r7 
;j                         Allocated with name '_wire_write_byte_j_65536_5'
;i                         Allocated to registers r6 
;------------------------------------------------------------
;	06_DS18B20_1wire/wire.c:39: void wire_write_byte(uint8_t byte) {
;	-----------------------------------------
;	 function wire_write_byte
;	-----------------------------------------
_wire_write_byte:
	mov	r7,dpl
;	06_DS18B20_1wire/wire.c:40: volatile uint8_t j = 0;
	mov	_wire_write_byte_j_65536_5,#0x00
;	06_DS18B20_1wire/wire.c:41: for(uint8_t i = 0; i < 8; i++) {
	mov	r6,#0x00
00106$:
	cjne	r6,#0x08,00127$
00127$:
	jnc	00108$
;	06_DS18B20_1wire/wire.c:42: DS18B20_DQ = 0; // Start time slot
;	assignBit
	clr	_P3_7
;	06_DS18B20_1wire/wire.c:43: j++; // small delay
	mov	a,_wire_write_byte_j_65536_5
	inc	a
	mov	_wire_write_byte_j_65536_5,a
;	06_DS18B20_1wire/wire.c:44: DS18B20_DQ = (byte & 0x01);  // Write bit (0 or 1 ... math also introduces needed delay)
	mov	a,r7
	anl	a,#0x01
;	assignBit
	mov	r5,a
	add	a,#0xff
	mov	_P3_7,c
;	06_DS18B20_1wire/wire.c:45: j = 6;
	mov	_wire_write_byte_j_65536_5,#0x06
;	06_DS18B20_1wire/wire.c:46: while(j--);
00101$:
	mov	a,_wire_write_byte_j_65536_5
	mov	r5,a
	dec	a
	mov	_wire_write_byte_j_65536_5,a
	mov	a,r5
	jnz	00101$
;	06_DS18B20_1wire/wire.c:47: DS18B20_DQ = 1; // Finish time slot
;	assignBit
	setb	_P3_7
;	06_DS18B20_1wire/wire.c:48: byte >>= 1;
	mov	a,r7
	clr	c
	rrc	a
	mov	r7,a
;	06_DS18B20_1wire/wire.c:41: for(uint8_t i = 0; i < 8; i++) {
	inc	r6
	sjmp	00106$
00108$:
;	06_DS18B20_1wire/wire.c:50: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'wire_read_byte'
;------------------------------------------------------------
;j                         Allocated with name '_wire_read_byte_j_65536_9'
;byte                      Allocated with name '_wire_read_byte_byte_65536_9'
;i                         Allocated to registers r7 
;------------------------------------------------------------
;	06_DS18B20_1wire/wire.c:52: uint8_t wire_read_byte(void) {
;	-----------------------------------------
;	 function wire_read_byte
;	-----------------------------------------
_wire_read_byte:
;	06_DS18B20_1wire/wire.c:53: volatile uint8_t j = 0, byte = 0;
	mov	_wire_read_byte_j_65536_9,#0x00
	mov	_wire_read_byte_byte_65536_9,#0x00
;	06_DS18B20_1wire/wire.c:55: for(uint8_t i = 0; i < 8; i++) {
	mov	r7,#0x00
00106$:
	cjne	r7,#0x08,00127$
00127$:
	jnc	00104$
;	06_DS18B20_1wire/wire.c:56: DS18B20_DQ = 0; // Start time slot
;	assignBit
	clr	_P3_7
;	06_DS18B20_1wire/wire.c:57: j++; // small delay
	mov	a,_wire_read_byte_j_65536_9
	inc	a
	mov	_wire_read_byte_j_65536_9,a
;	06_DS18B20_1wire/wire.c:58: DS18B20_DQ = 1; // Release bus
;	assignBit
	setb	_P3_7
;	06_DS18B20_1wire/wire.c:59: j = 1;
	mov	_wire_read_byte_j_65536_9,#0x01
;	06_DS18B20_1wire/wire.c:60: while(j--);
00101$:
	mov	a,_wire_read_byte_j_65536_9
	mov	r6,a
	dec	a
	mov	_wire_read_byte_j_65536_9,a
	mov	a,r6
	jnz	00101$
;	06_DS18B20_1wire/wire.c:61: byte |= (DS18B20_DQ<<i);
	mov	c,_P3_7
	clr	a
	rlc	a
	mov	r6,a
	mov	b,r7
	inc	b
	mov	a,r6
	sjmp	00132$
00130$:
	add	a,acc
00132$:
	djnz	b,00130$
	mov	r6,a
	orl	_wire_read_byte_byte_65536_9,a
;	06_DS18B20_1wire/wire.c:55: for(uint8_t i = 0; i < 8; i++) {
	inc	r7
	sjmp	00106$
00104$:
;	06_DS18B20_1wire/wire.c:63: return byte;
	mov	dpl,_wire_read_byte_byte_65536_9
;	06_DS18B20_1wire/wire.c:64: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'ds18b20_start_conversion'
;------------------------------------------------------------
;	06_DS18B20_1wire/wire.c:66: void ds18b20_start_conversion() {
;	-----------------------------------------
;	 function ds18b20_start_conversion
;	-----------------------------------------
_ds18b20_start_conversion:
;	06_DS18B20_1wire/wire.c:67: wire_init();
	lcall	_wire_init
;	06_DS18B20_1wire/wire.c:68: wire_write_byte(0xCC); // Skip ROM (only thing connected to P3_7)
	mov	dpl,#0xcc
	lcall	_wire_write_byte
;	06_DS18B20_1wire/wire.c:69: wire_write_byte(0x44); // Convert T
	mov	dpl,#0x44
;	06_DS18B20_1wire/wire.c:70: }
	ljmp	_wire_write_byte
;------------------------------------------------------------
;Allocation info for local variables in function 'ds18b20_read_temperature'
;------------------------------------------------------------
;temp                      Allocated to registers 
;------------------------------------------------------------
;	06_DS18B20_1wire/wire.c:72: int16_t ds18b20_read_temperature() {
;	-----------------------------------------
;	 function ds18b20_read_temperature
;	-----------------------------------------
_ds18b20_read_temperature:
;	06_DS18B20_1wire/wire.c:74: wire_init();
	lcall	_wire_init
;	06_DS18B20_1wire/wire.c:75: wire_write_byte(0xCC); // Skip ROM
	mov	dpl,#0xcc
	lcall	_wire_write_byte
;	06_DS18B20_1wire/wire.c:76: wire_write_byte(0xBE); // Read Scratchpad
	mov	dpl,#0xbe
	lcall	_wire_write_byte
;	06_DS18B20_1wire/wire.c:77: temp = wire_read_byte();
	lcall	_wire_read_byte
	mov	r7,dpl
	mov	r6,#0x00
;	06_DS18B20_1wire/wire.c:78: temp |= wire_read_byte() << 8;
	push	ar7
	push	ar6
	lcall	_wire_read_byte
	mov	r5,dpl
	pop	ar6
	pop	ar7
	mov	ar4,r5
	mov	r5,#0x00
	mov	a,r7
	orl	ar5,a
	mov	a,r6
	orl	ar4,a
	mov	dpl,r5
	mov	dph,r4
;	06_DS18B20_1wire/wire.c:79: return temp;
;	06_DS18B20_1wire/wire.c:80: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'temp_to_celsius'
;------------------------------------------------------------
;raw                       Allocated to registers r6 r7 
;------------------------------------------------------------
;	06_DS18B20_1wire/wire.c:82: uint16_t temp_to_celsius(uint16_t raw) {
;	-----------------------------------------
;	 function temp_to_celsius
;	-----------------------------------------
_temp_to_celsius:
	mov	r6,dpl
	mov	r7,dph
;	06_DS18B20_1wire/wire.c:84: return (raw * 10) / 16; // Return temperature in 0.01 degrees C
	mov	__mulint_PARM_2,r6
	mov	(__mulint_PARM_2 + 1),r7
	mov	dptr,#0x000a
	lcall	__mulint
	mov	r6,dpl
	mov	a,dph
	swap	a
	xch	a,r6
	swap	a
	anl	a,#0x0f
	xrl	a,r6
	xch	a,r6
	anl	a,#0x0f
	xch	a,r6
	xrl	a,r6
	xch	a,r6
;	06_DS18B20_1wire/wire.c:85: }
	mov	dpl,r6
	mov	dph,a
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'timer0_init'
;------------------------------------------------------------
;	06_DS18B20_1wire/wire.c:113: void timer0_init(void) {
;	-----------------------------------------
;	 function timer0_init
;	-----------------------------------------
_timer0_init:
;	06_DS18B20_1wire/wire.c:114: TMOD &= 0xF0;	/* Clear Timer 0 mode bits */
	anl	_TMOD,#0xf0
;	06_DS18B20_1wire/wire.c:115: TMOD |= 0x1;	/* Set Timer 0 mode to 16-bit */
	orl	_TMOD,#0x01
;	06_DS18B20_1wire/wire.c:116: TH0 = 0xdc;	/* Set Timer 0 high byte for 16-bit mode */
	mov	_TH0,#0xdc
;	06_DS18B20_1wire/wire.c:117: TL0 = 0x00;	/* Set Timer 0 low byte for 16-bit mode */
	mov	_TL0,#0x00
;	06_DS18B20_1wire/wire.c:118: TF0 = 0;	/* Clear Timer 0 overflow flag */
;	assignBit
	clr	_TF0
;	06_DS18B20_1wire/wire.c:119: TR0 = 1;	/* Start Timer 0 */
;	assignBit
	setb	_TR0
;	06_DS18B20_1wire/wire.c:120: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'tf0_isr'
;------------------------------------------------------------
;val                       Allocated to registers r7 
;------------------------------------------------------------
;	06_DS18B20_1wire/wire.c:127: void tf0_isr(void) __interrupt(TF0_VECTOR) {
;	-----------------------------------------
;	 function tf0_isr
;	-----------------------------------------
_tf0_isr:
	push	acc
	push	dpl
	push	dph
	push	ar7
	push	ar6
	push	ar1
	push	psw
	mov	psw,#0x00
;	06_DS18B20_1wire/wire.c:128: LED_DIGIT = 0x00; // Turn off all segments
	mov	_P0,#0x00
;	06_DS18B20_1wire/wire.c:129: P2 = seg_digit<<2; // activate digit i (P2_2..P2_4)
	mov	a,_seg_digit
	add	a,acc
	add	a,acc
	mov	_P2,a
;	06_DS18B20_1wire/wire.c:132: uint8_t val = segment_map[digits[seg_digit]];
	mov	a,_seg_digit
	add	a,#_digits
	mov	r1,a
	mov	a,@r1
	mov	dptr,#_segment_map
	movc	a,@a+dptr
	mov	r7,a
;	06_DS18B20_1wire/wire.c:133: if(seg_digit == decimal_index) {
	mov	a,_decimal_index
	cjne	a,_seg_digit,00102$
;	06_DS18B20_1wire/wire.c:134: val |= segment_dp;
	mov	dptr,#_segment_dp
	clr	a
	movc	a,@a+dptr
	mov	r6,a
	orl	ar7,a
00102$:
;	06_DS18B20_1wire/wire.c:136: LED_DIGIT = val;
	mov	_P0,r7
;	06_DS18B20_1wire/wire.c:137: seg_digit++;
	mov	a,_seg_digit
	inc	a
	mov	_seg_digit,a
;	06_DS18B20_1wire/wire.c:138: if(seg_digit > 7)
	mov	a,_seg_digit
	add	a,#0xff - 0x07
	jnc	00104$
;	06_DS18B20_1wire/wire.c:139: seg_digit = 0;
	mov	_seg_digit,#0x00
00104$:
;	06_DS18B20_1wire/wire.c:142: TH0 = 0xfc;	/* Set Timer 0 high byte for 16-bit mode */
	mov	_TH0,#0xfc
;	06_DS18B20_1wire/wire.c:143: TL0 = 0x66;	/* Set Timer 0 low byte for 16-bit mode */
	mov	_TL0,#0x66
;	06_DS18B20_1wire/wire.c:144: TF0 = 0;	/* Clear Timer 0 overflow flag */
;	assignBit
	clr	_TF0
;	06_DS18B20_1wire/wire.c:145: }
	pop	psw
	pop	ar1
	pop	ar6
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
;i                         Allocated with name '_int_to_digits_i_65537_26'
;temp_N                    Allocated to registers r6 r7 
;sloc0                     Allocated with name '_int_to_digits_sloc0_1_0'
;------------------------------------------------------------
;	06_DS18B20_1wire/wire.c:147: void int_to_digits(int16_t val, uint8_t *ptr) {
;	-----------------------------------------
;	 function int_to_digits
;	-----------------------------------------
_int_to_digits:
	mov	r6,dpl
	mov	r7,dph
;	06_DS18B20_1wire/wire.c:148: for(uint8_t i = 0; i < 8; i++) {
	mov	r5,#0x00
00107$:
	cjne	r5,#0x08,00139$
00139$:
	jnc	00101$
;	06_DS18B20_1wire/wire.c:149: ptr[i] = 0;
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
;	06_DS18B20_1wire/wire.c:148: for(uint8_t i = 0; i < 8; i++) {
	inc	r5
	sjmp	00107$
00101$:
;	06_DS18B20_1wire/wire.c:153: int16_t temp_N = (val < 0) ? -val : val;
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
;	06_DS18B20_1wire/wire.c:156: while (temp_N > 0 && i >= 0) {
	mov	_int_to_digits_i_65537_26,#0x07
	mov	(_int_to_digits_i_65537_26 + 1),#0x00
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
	mov	a,(_int_to_digits_i_65537_26 + 1)
	jb	acc.7,00109$
;	06_DS18B20_1wire/wire.c:158: ptr[7-i] = temp_N % 10;
	mov	a,#0x07
	clr	c
	subb	a,_int_to_digits_i_65537_26
	mov	r0,a
	clr	a
	subb	a,(_int_to_digits_i_65537_26 + 1)
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
;	06_DS18B20_1wire/wire.c:161: temp_N = temp_N / 10;
	mov	__divsint_PARM_2,#0x0a
	mov	(__divsint_PARM_2 + 1),#0x00
	mov	dpl,r2
	mov	dph,r3
	lcall	__divsint
	mov	r4,dpl
	mov	r5,dph
	mov	ar6,r4
	mov	ar7,r5
;	06_DS18B20_1wire/wire.c:164: i = i - 1;
	dec	_int_to_digits_i_65537_26
	mov	a,#0xff
	cjne	a,_int_to_digits_i_65537_26,00144$
	dec	(_int_to_digits_i_65537_26 + 1)
00144$:
	sjmp	00103$
00109$:
;	06_DS18B20_1wire/wire.c:166: }
	ret
;------------------------------------------------------------
;Allocation info for local variables in function 'main'
;------------------------------------------------------------
;temperature               Allocated to registers 
;i                         Allocated to registers r7 
;i                         Allocated to registers r7 
;------------------------------------------------------------
;	06_DS18B20_1wire/wire.c:169: void main(void) {
;	-----------------------------------------
;	 function main
;	-----------------------------------------
_main:
;	06_DS18B20_1wire/wire.c:171: timer0_init();
	lcall	_timer0_init
;	06_DS18B20_1wire/wire.c:173: for(uint8_t i = 0; i < 8; i++) {
	mov	r7,#0x00
00105$:
	cjne	r7,#0x08,00141$
00141$:
	jnc	00101$
;	06_DS18B20_1wire/wire.c:174: digits[i] = 0;
	mov	a,r7
	add	a,#_digits
	mov	r0,a
	mov	@r0,#0x00
;	06_DS18B20_1wire/wire.c:173: for(uint8_t i = 0; i < 8; i++) {
	inc	r7
	sjmp	00105$
00101$:
;	06_DS18B20_1wire/wire.c:177: ET0 = 1;	/* Enable Timer 0 interrupt */
;	assignBit
	setb	_ET0
;	06_DS18B20_1wire/wire.c:178: EA  = 1; /* Enable global interrupts */
;	assignBit
	setb	_EA
00110$:
;	06_DS18B20_1wire/wire.c:181: EA  = 0; /* Disable for aliasing issues */
;	assignBit
	clr	_EA
;	06_DS18B20_1wire/wire.c:182: ds18b20_start_conversion();
	lcall	_ds18b20_start_conversion
;	06_DS18B20_1wire/wire.c:183: EA = 1;
;	assignBit
	setb	_EA
;	06_DS18B20_1wire/wire.c:184: for (uint8_t i = 0; i < 15; i++) {
	mov	r7,#0x00
00108$:
	cjne	r7,#0x0f,00143$
00143$:
	jnc	00102$
;	06_DS18B20_1wire/wire.c:185: delay(10000);
	mov	dptr,#0x2710
	push	ar7
	lcall	_delay
	pop	ar7
;	06_DS18B20_1wire/wire.c:184: for (uint8_t i = 0; i < 15; i++) {
	inc	r7
	sjmp	00108$
00102$:
;	06_DS18B20_1wire/wire.c:187: EA  = 0; /* Disable for aliasing issues */
;	assignBit
	clr	_EA
;	06_DS18B20_1wire/wire.c:188: temperature = ds18b20_read_temperature();
	lcall	_ds18b20_read_temperature
;	06_DS18B20_1wire/wire.c:189: temperature = temp_to_celsius(temperature);
	lcall	_temp_to_celsius
;	06_DS18B20_1wire/wire.c:191: int_to_digits(temperature, digits);
	mov	_int_to_digits_PARM_2,#_digits
	mov	(_int_to_digits_PARM_2 + 1),#0x00
	mov	(_int_to_digits_PARM_2 + 2),#0x40
	lcall	_int_to_digits
;	06_DS18B20_1wire/wire.c:192: EA = 1;
;	assignBit
	setb	_EA
;	06_DS18B20_1wire/wire.c:195: }
	sjmp	00110$
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
