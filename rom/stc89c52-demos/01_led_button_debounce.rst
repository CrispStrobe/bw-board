                                      1 ;--------------------------------------------------------
                                      2 ; File Created by SDCC : free open source ANSI-C Compiler
                                      3 ; Version 4.2.0 #13081 (Linux)
                                      4 ;--------------------------------------------------------
                                      5 	.module led_button
                                      6 	.optsdcc -mmcs51 --model-small
                                      7 	
                                      8 ;--------------------------------------------------------
                                      9 ; Public variables in this module
                                     10 ;--------------------------------------------------------
                                     11 	.globl _tf0_isr
                                     12 	.globl _main
                                     13 	.globl _timer0_init
                                     14 	.globl _CY
                                     15 	.globl _AC
                                     16 	.globl _F0
                                     17 	.globl _RS1
                                     18 	.globl _RS0
                                     19 	.globl _OV
                                     20 	.globl _F1
                                     21 	.globl _P
                                     22 	.globl _PS
                                     23 	.globl _PT1
                                     24 	.globl _PX1
                                     25 	.globl _PT0
                                     26 	.globl _PX0
                                     27 	.globl _RD
                                     28 	.globl _WR
                                     29 	.globl _T1
                                     30 	.globl _T0
                                     31 	.globl _INT1
                                     32 	.globl _INT0
                                     33 	.globl _TXD
                                     34 	.globl _RXD
                                     35 	.globl _P3_7
                                     36 	.globl _P3_6
                                     37 	.globl _P3_5
                                     38 	.globl _P3_4
                                     39 	.globl _P3_3
                                     40 	.globl _P3_2
                                     41 	.globl _P3_1
                                     42 	.globl _P3_0
                                     43 	.globl _EA
                                     44 	.globl _ES
                                     45 	.globl _ET1
                                     46 	.globl _EX1
                                     47 	.globl _ET0
                                     48 	.globl _EX0
                                     49 	.globl _P2_7
                                     50 	.globl _P2_6
                                     51 	.globl _P2_5
                                     52 	.globl _P2_4
                                     53 	.globl _P2_3
                                     54 	.globl _P2_2
                                     55 	.globl _P2_1
                                     56 	.globl _P2_0
                                     57 	.globl _SM0
                                     58 	.globl _SM1
                                     59 	.globl _SM2
                                     60 	.globl _REN
                                     61 	.globl _TB8
                                     62 	.globl _RB8
                                     63 	.globl _TI
                                     64 	.globl _RI
                                     65 	.globl _P1_7
                                     66 	.globl _P1_6
                                     67 	.globl _P1_5
                                     68 	.globl _P1_4
                                     69 	.globl _P1_3
                                     70 	.globl _P1_2
                                     71 	.globl _P1_1
                                     72 	.globl _P1_0
                                     73 	.globl _TF1
                                     74 	.globl _TR1
                                     75 	.globl _TF0
                                     76 	.globl _TR0
                                     77 	.globl _IE1
                                     78 	.globl _IT1
                                     79 	.globl _IE0
                                     80 	.globl _IT0
                                     81 	.globl _P0_7
                                     82 	.globl _P0_6
                                     83 	.globl _P0_5
                                     84 	.globl _P0_4
                                     85 	.globl _P0_3
                                     86 	.globl _P0_2
                                     87 	.globl _P0_1
                                     88 	.globl _P0_0
                                     89 	.globl _B
                                     90 	.globl _ACC
                                     91 	.globl _PSW
                                     92 	.globl _IP
                                     93 	.globl _P3
                                     94 	.globl _IE
                                     95 	.globl _P2
                                     96 	.globl _SBUF
                                     97 	.globl _SCON
                                     98 	.globl _P1
                                     99 	.globl _TH1
                                    100 	.globl _TH0
                                    101 	.globl _TL1
                                    102 	.globl _TL0
                                    103 	.globl _TMOD
                                    104 	.globl _TCON
                                    105 	.globl _PCON
                                    106 	.globl _DPH
                                    107 	.globl _DPL
                                    108 	.globl _SP
                                    109 	.globl _P0
                                    110 	.globl _led_3_state
                                    111 	.globl _led_2_state
                                    112 	.globl _led_1_state
                                    113 	.globl _led_0_state
                                    114 	.globl _button_3_counter
                                    115 	.globl _button_2_counter
                                    116 	.globl _button_1_counter
                                    117 	.globl _button_0_counter
                                    118 ;--------------------------------------------------------
                                    119 ; special function registers
                                    120 ;--------------------------------------------------------
                                    121 	.area RSEG    (ABS,DATA)
      000000                        122 	.org 0x0000
                           000080   123 _P0	=	0x0080
                           000081   124 _SP	=	0x0081
                           000082   125 _DPL	=	0x0082
                           000083   126 _DPH	=	0x0083
                           000087   127 _PCON	=	0x0087
                           000088   128 _TCON	=	0x0088
                           000089   129 _TMOD	=	0x0089
                           00008A   130 _TL0	=	0x008a
                           00008B   131 _TL1	=	0x008b
                           00008C   132 _TH0	=	0x008c
                           00008D   133 _TH1	=	0x008d
                           000090   134 _P1	=	0x0090
                           000098   135 _SCON	=	0x0098
                           000099   136 _SBUF	=	0x0099
                           0000A0   137 _P2	=	0x00a0
                           0000A8   138 _IE	=	0x00a8
                           0000B0   139 _P3	=	0x00b0
                           0000B8   140 _IP	=	0x00b8
                           0000D0   141 _PSW	=	0x00d0
                           0000E0   142 _ACC	=	0x00e0
                           0000F0   143 _B	=	0x00f0
                                    144 ;--------------------------------------------------------
                                    145 ; special function bits
                                    146 ;--------------------------------------------------------
                                    147 	.area RSEG    (ABS,DATA)
      000000                        148 	.org 0x0000
                           000080   149 _P0_0	=	0x0080
                           000081   150 _P0_1	=	0x0081
                           000082   151 _P0_2	=	0x0082
                           000083   152 _P0_3	=	0x0083
                           000084   153 _P0_4	=	0x0084
                           000085   154 _P0_5	=	0x0085
                           000086   155 _P0_6	=	0x0086
                           000087   156 _P0_7	=	0x0087
                           000088   157 _IT0	=	0x0088
                           000089   158 _IE0	=	0x0089
                           00008A   159 _IT1	=	0x008a
                           00008B   160 _IE1	=	0x008b
                           00008C   161 _TR0	=	0x008c
                           00008D   162 _TF0	=	0x008d
                           00008E   163 _TR1	=	0x008e
                           00008F   164 _TF1	=	0x008f
                           000090   165 _P1_0	=	0x0090
                           000091   166 _P1_1	=	0x0091
                           000092   167 _P1_2	=	0x0092
                           000093   168 _P1_3	=	0x0093
                           000094   169 _P1_4	=	0x0094
                           000095   170 _P1_5	=	0x0095
                           000096   171 _P1_6	=	0x0096
                           000097   172 _P1_7	=	0x0097
                           000098   173 _RI	=	0x0098
                           000099   174 _TI	=	0x0099
                           00009A   175 _RB8	=	0x009a
                           00009B   176 _TB8	=	0x009b
                           00009C   177 _REN	=	0x009c
                           00009D   178 _SM2	=	0x009d
                           00009E   179 _SM1	=	0x009e
                           00009F   180 _SM0	=	0x009f
                           0000A0   181 _P2_0	=	0x00a0
                           0000A1   182 _P2_1	=	0x00a1
                           0000A2   183 _P2_2	=	0x00a2
                           0000A3   184 _P2_3	=	0x00a3
                           0000A4   185 _P2_4	=	0x00a4
                           0000A5   186 _P2_5	=	0x00a5
                           0000A6   187 _P2_6	=	0x00a6
                           0000A7   188 _P2_7	=	0x00a7
                           0000A8   189 _EX0	=	0x00a8
                           0000A9   190 _ET0	=	0x00a9
                           0000AA   191 _EX1	=	0x00aa
                           0000AB   192 _ET1	=	0x00ab
                           0000AC   193 _ES	=	0x00ac
                           0000AF   194 _EA	=	0x00af
                           0000B0   195 _P3_0	=	0x00b0
                           0000B1   196 _P3_1	=	0x00b1
                           0000B2   197 _P3_2	=	0x00b2
                           0000B3   198 _P3_3	=	0x00b3
                           0000B4   199 _P3_4	=	0x00b4
                           0000B5   200 _P3_5	=	0x00b5
                           0000B6   201 _P3_6	=	0x00b6
                           0000B7   202 _P3_7	=	0x00b7
                           0000B0   203 _RXD	=	0x00b0
                           0000B1   204 _TXD	=	0x00b1
                           0000B2   205 _INT0	=	0x00b2
                           0000B3   206 _INT1	=	0x00b3
                           0000B4   207 _T0	=	0x00b4
                           0000B5   208 _T1	=	0x00b5
                           0000B6   209 _WR	=	0x00b6
                           0000B7   210 _RD	=	0x00b7
                           0000B8   211 _PX0	=	0x00b8
                           0000B9   212 _PT0	=	0x00b9
                           0000BA   213 _PX1	=	0x00ba
                           0000BB   214 _PT1	=	0x00bb
                           0000BC   215 _PS	=	0x00bc
                           0000D0   216 _P	=	0x00d0
                           0000D1   217 _F1	=	0x00d1
                           0000D2   218 _OV	=	0x00d2
                           0000D3   219 _RS0	=	0x00d3
                           0000D4   220 _RS1	=	0x00d4
                           0000D5   221 _F0	=	0x00d5
                           0000D6   222 _AC	=	0x00d6
                           0000D7   223 _CY	=	0x00d7
                                    224 ;--------------------------------------------------------
                                    225 ; overlayable register banks
                                    226 ;--------------------------------------------------------
                                    227 	.area REG_BANK_0	(REL,OVR,DATA)
      000000                        228 	.ds 8
                                    229 ;--------------------------------------------------------
                                    230 ; internal ram data
                                    231 ;--------------------------------------------------------
                                    232 	.area DSEG    (DATA)
      000008                        233 _button_0_counter::
      000008                        234 	.ds 1
      000009                        235 _button_1_counter::
      000009                        236 	.ds 1
      00000A                        237 _button_2_counter::
      00000A                        238 	.ds 1
      00000B                        239 _button_3_counter::
      00000B                        240 	.ds 1
                                    241 ;--------------------------------------------------------
                                    242 ; overlayable items in internal ram
                                    243 ;--------------------------------------------------------
                                    244 ;--------------------------------------------------------
                                    245 ; Stack segment in internal ram
                                    246 ;--------------------------------------------------------
                                    247 	.area	SSEG
      000021                        248 __start__stack:
      000021                        249 	.ds	1
                                    250 
                                    251 ;--------------------------------------------------------
                                    252 ; indirectly addressable internal ram data
                                    253 ;--------------------------------------------------------
                                    254 	.area ISEG    (DATA)
                                    255 ;--------------------------------------------------------
                                    256 ; absolute internal ram data
                                    257 ;--------------------------------------------------------
                                    258 	.area IABS    (ABS,DATA)
                                    259 	.area IABS    (ABS,DATA)
                                    260 ;--------------------------------------------------------
                                    261 ; bit data
                                    262 ;--------------------------------------------------------
                                    263 	.area BSEG    (BIT)
      000000                        264 _led_0_state::
      000000                        265 	.ds 1
      000001                        266 _led_1_state::
      000001                        267 	.ds 1
      000002                        268 _led_2_state::
      000002                        269 	.ds 1
      000003                        270 _led_3_state::
      000003                        271 	.ds 1
                                    272 ;--------------------------------------------------------
                                    273 ; paged external ram data
                                    274 ;--------------------------------------------------------
                                    275 	.area PSEG    (PAG,XDATA)
                                    276 ;--------------------------------------------------------
                                    277 ; external ram data
                                    278 ;--------------------------------------------------------
                                    279 	.area XSEG    (XDATA)
                                    280 ;--------------------------------------------------------
                                    281 ; absolute external ram data
                                    282 ;--------------------------------------------------------
                                    283 	.area XABS    (ABS,XDATA)
                                    284 ;--------------------------------------------------------
                                    285 ; external initialized ram data
                                    286 ;--------------------------------------------------------
                                    287 	.area XISEG   (XDATA)
                                    288 	.area HOME    (CODE)
                                    289 	.area GSINIT0 (CODE)
                                    290 	.area GSINIT1 (CODE)
                                    291 	.area GSINIT2 (CODE)
                                    292 	.area GSINIT3 (CODE)
                                    293 	.area GSINIT4 (CODE)
                                    294 	.area GSINIT5 (CODE)
                                    295 	.area GSINIT  (CODE)
                                    296 	.area GSFINAL (CODE)
                                    297 	.area CSEG    (CODE)
                                    298 ;--------------------------------------------------------
                                    299 ; interrupt vector
                                    300 ;--------------------------------------------------------
                                    301 	.area HOME    (CODE)
      000000                        302 __interrupt_vect:
      000000 02 00 11         [24]  303 	ljmp	__sdcc_gsinit_startup
      000003 32               [24]  304 	reti
      000004                        305 	.ds	7
      00000B 02 00 9B         [24]  306 	ljmp	_tf0_isr
                                    307 ;--------------------------------------------------------
                                    308 ; global & static initialisations
                                    309 ;--------------------------------------------------------
                                    310 	.area HOME    (CODE)
                                    311 	.area GSINIT  (CODE)
                                    312 	.area GSFINAL (CODE)
                                    313 	.area GSINIT  (CODE)
                                    314 	.globl __sdcc_gsinit_startup
                                    315 	.globl __sdcc_program_startup
                                    316 	.globl __start__stack
                                    317 	.globl __mcs51_genXINIT
                                    318 	.globl __mcs51_genXRAMCLEAR
                                    319 	.globl __mcs51_genRAMCLEAR
                                    320 ;	01_led_button_debounce/led_button.c:38: unsigned char button_0_counter = 0;
      00006A 75 08 00         [24]  321 	mov	_button_0_counter,#0x00
                                    322 ;	01_led_button_debounce/led_button.c:40: unsigned char button_1_counter = 0;
      00006D 75 09 00         [24]  323 	mov	_button_1_counter,#0x00
                                    324 ;	01_led_button_debounce/led_button.c:42: unsigned char button_2_counter = 0;
      000070 75 0A 00         [24]  325 	mov	_button_2_counter,#0x00
                                    326 ;	01_led_button_debounce/led_button.c:44: unsigned char button_3_counter = 0;
      000073 75 0B 00         [24]  327 	mov	_button_3_counter,#0x00
                                    328 ;	01_led_button_debounce/led_button.c:37: __bit led_0_state = 0;
                                    329 ;	assignBit
      000076 C2 00            [12]  330 	clr	_led_0_state
                                    331 ;	01_led_button_debounce/led_button.c:39: __bit led_1_state = 0;
                                    332 ;	assignBit
      000078 C2 01            [12]  333 	clr	_led_1_state
                                    334 ;	01_led_button_debounce/led_button.c:41: __bit led_2_state = 0;
                                    335 ;	assignBit
      00007A C2 02            [12]  336 	clr	_led_2_state
                                    337 ;	01_led_button_debounce/led_button.c:43: __bit led_3_state = 0;
                                    338 ;	assignBit
      00007C C2 03            [12]  339 	clr	_led_3_state
                                    340 	.area GSFINAL (CODE)
      00007E 02 00 0E         [24]  341 	ljmp	__sdcc_program_startup
                                    342 ;--------------------------------------------------------
                                    343 ; Home
                                    344 ;--------------------------------------------------------
                                    345 	.area HOME    (CODE)
                                    346 	.area HOME    (CODE)
      00000E                        347 __sdcc_program_startup:
      00000E 02 00 92         [24]  348 	ljmp	_main
                                    349 ;	return from main will return to caller
                                    350 ;--------------------------------------------------------
                                    351 ; code
                                    352 ;--------------------------------------------------------
                                    353 	.area CSEG    (CODE)
                                    354 ;------------------------------------------------------------
                                    355 ;Allocation info for local variables in function 'timer0_init'
                                    356 ;------------------------------------------------------------
                                    357 ;	01_led_button_debounce/led_button.c:19: void timer0_init(void) {
                                    358 ;	-----------------------------------------
                                    359 ;	 function timer0_init
                                    360 ;	-----------------------------------------
      000081                        361 _timer0_init:
                           000007   362 	ar7 = 0x07
                           000006   363 	ar6 = 0x06
                           000005   364 	ar5 = 0x05
                           000004   365 	ar4 = 0x04
                           000003   366 	ar3 = 0x03
                           000002   367 	ar2 = 0x02
                           000001   368 	ar1 = 0x01
                           000000   369 	ar0 = 0x00
                                    370 ;	01_led_button_debounce/led_button.c:20: TMOD &= 0xF0;	/* Clear Timer 0 mode bits */
      000081 53 89 F0         [24]  371 	anl	_TMOD,#0xf0
                                    372 ;	01_led_button_debounce/led_button.c:21: TMOD |= 0x1;	/* Set Timer 0 mode to 16-bit */
      000084 43 89 01         [24]  373 	orl	_TMOD,#0x01
                                    374 ;	01_led_button_debounce/led_button.c:22: TH0 = 0x3c;	/* Set Timer 0 high byte for 16-bit mode */
      000087 75 8C 3C         [24]  375 	mov	_TH0,#0x3c
                                    376 ;	01_led_button_debounce/led_button.c:23: TL0 = 0xb0;	/* Set Timer 0 low byte for 16-bit mode */
      00008A 75 8A B0         [24]  377 	mov	_TL0,#0xb0
                                    378 ;	01_led_button_debounce/led_button.c:24: TF0 = 0;	/* Clear Timer 0 overflow flag */
                                    379 ;	assignBit
      00008D C2 8D            [12]  380 	clr	_TF0
                                    381 ;	01_led_button_debounce/led_button.c:25: TR0 = 1;	/* Start Timer 0 */
                                    382 ;	assignBit
      00008F D2 8C            [12]  383 	setb	_TR0
                                    384 ;	01_led_button_debounce/led_button.c:26: }
      000091 22               [24]  385 	ret
                                    386 ;------------------------------------------------------------
                                    387 ;Allocation info for local variables in function 'main'
                                    388 ;------------------------------------------------------------
                                    389 ;	01_led_button_debounce/led_button.c:28: void main(void) {
                                    390 ;	-----------------------------------------
                                    391 ;	 function main
                                    392 ;	-----------------------------------------
      000092                        393 _main:
                                    394 ;	01_led_button_debounce/led_button.c:29: timer0_init();
      000092 12 00 81         [24]  395 	lcall	_timer0_init
                                    396 ;	01_led_button_debounce/led_button.c:31: ET0 = 1;	/* Enable Timer 0 interrupt */
                                    397 ;	assignBit
      000095 D2 A9            [12]  398 	setb	_ET0
                                    399 ;	01_led_button_debounce/led_button.c:32: EA  = 1; /* Enable global interrupts */
                                    400 ;	assignBit
      000097 D2 AF            [12]  401 	setb	_EA
      000099                        402 00103$:
                                    403 ;	01_led_button_debounce/led_button.c:35: }
      000099 80 FE            [24]  404 	sjmp	00103$
                                    405 ;------------------------------------------------------------
                                    406 ;Allocation info for local variables in function 'tf0_isr'
                                    407 ;------------------------------------------------------------
                                    408 ;	01_led_button_debounce/led_button.c:46: void tf0_isr(void) __interrupt(TF0_VECTOR) {
                                    409 ;	-----------------------------------------
                                    410 ;	 function tf0_isr
                                    411 ;	-----------------------------------------
      00009B                        412 _tf0_isr:
      00009B C0 E0            [24]  413 	push	acc
      00009D C0 D0            [24]  414 	push	psw
                                    415 ;	01_led_button_debounce/led_button.c:48: if(button_0_counter) {
      00009F E5 08            [12]  416 	mov	a,_button_0_counter
      0000A1 60 0B            [24]  417 	jz	00104$
                                    418 ;	01_led_button_debounce/led_button.c:49: button_0_counter++;
      0000A3 05 08            [12]  419 	inc	_button_0_counter
                                    420 ;	01_led_button_debounce/led_button.c:50: if(button_0_counter >= 20)
      0000A5 74 EC            [12]  421 	mov	a,#0x100 - 0x14
      0000A7 25 08            [12]  422 	add	a,_button_0_counter
      0000A9 50 03            [24]  423 	jnc	00104$
                                    424 ;	01_led_button_debounce/led_button.c:51: button_0_counter = 0; // Reset counter after hysteresis period
      0000AB 75 08 00         [24]  425 	mov	_button_0_counter,#0x00
      0000AE                        426 00104$:
                                    427 ;	01_led_button_debounce/led_button.c:53: if(button_1_counter) {
      0000AE E5 09            [12]  428 	mov	a,_button_1_counter
      0000B0 60 0B            [24]  429 	jz	00108$
                                    430 ;	01_led_button_debounce/led_button.c:54: button_1_counter++;
      0000B2 05 09            [12]  431 	inc	_button_1_counter
                                    432 ;	01_led_button_debounce/led_button.c:55: if (button_1_counter >= 20)
      0000B4 74 EC            [12]  433 	mov	a,#0x100 - 0x14
      0000B6 25 09            [12]  434 	add	a,_button_1_counter
      0000B8 50 03            [24]  435 	jnc	00108$
                                    436 ;	01_led_button_debounce/led_button.c:56: button_1_counter = 0; // Reset counter after hysteresis period
      0000BA 75 09 00         [24]  437 	mov	_button_1_counter,#0x00
      0000BD                        438 00108$:
                                    439 ;	01_led_button_debounce/led_button.c:58: if(button_2_counter) {
      0000BD E5 0A            [12]  440 	mov	a,_button_2_counter
      0000BF 60 0B            [24]  441 	jz	00112$
                                    442 ;	01_led_button_debounce/led_button.c:59: button_2_counter++;
      0000C1 05 0A            [12]  443 	inc	_button_2_counter
                                    444 ;	01_led_button_debounce/led_button.c:60: if (button_2_counter >= 20)
      0000C3 74 EC            [12]  445 	mov	a,#0x100 - 0x14
      0000C5 25 0A            [12]  446 	add	a,_button_2_counter
      0000C7 50 03            [24]  447 	jnc	00112$
                                    448 ;	01_led_button_debounce/led_button.c:61: button_2_counter = 0; // Reset counter after hysteresis period
      0000C9 75 0A 00         [24]  449 	mov	_button_2_counter,#0x00
      0000CC                        450 00112$:
                                    451 ;	01_led_button_debounce/led_button.c:63: if(button_3_counter) {
      0000CC E5 0B            [12]  452 	mov	a,_button_3_counter
      0000CE 60 0B            [24]  453 	jz	00116$
                                    454 ;	01_led_button_debounce/led_button.c:64: button_3_counter++;
      0000D0 05 0B            [12]  455 	inc	_button_3_counter
                                    456 ;	01_led_button_debounce/led_button.c:65: if (button_3_counter >= 20)
      0000D2 74 EC            [12]  457 	mov	a,#0x100 - 0x14
      0000D4 25 0B            [12]  458 	add	a,_button_3_counter
      0000D6 50 03            [24]  459 	jnc	00116$
                                    460 ;	01_led_button_debounce/led_button.c:66: button_3_counter = 0; // Reset counter after hysteresis period
      0000D8 75 0B 00         [24]  461 	mov	_button_3_counter,#0x00
      0000DB                        462 00116$:
                                    463 ;	01_led_button_debounce/led_button.c:70: if(P3_1 == 0 && button_0_counter == 0) {
      0000DB 20 B1 08         [24]  464 	jb	_P3_1,00118$
      0000DE E5 08            [12]  465 	mov	a,_button_0_counter
      0000E0 70 04            [24]  466 	jnz	00118$
                                    467 ;	01_led_button_debounce/led_button.c:71: led_0_state = !led_0_state;
      0000E2 B2 00            [12]  468 	cpl	_led_0_state
                                    469 ;	01_led_button_debounce/led_button.c:72: button_0_counter++; // Reset counter after valid press
      0000E4 05 08            [12]  470 	inc	_button_0_counter
      0000E6                        471 00118$:
                                    472 ;	01_led_button_debounce/led_button.c:74: if(P3_0 == 0 && button_1_counter == 0) {
      0000E6 20 B0 08         [24]  473 	jb	_P3_0,00121$
      0000E9 E5 09            [12]  474 	mov	a,_button_1_counter
      0000EB 70 04            [24]  475 	jnz	00121$
                                    476 ;	01_led_button_debounce/led_button.c:75: led_1_state = !led_1_state;
      0000ED B2 01            [12]  477 	cpl	_led_1_state
                                    478 ;	01_led_button_debounce/led_button.c:76: button_1_counter++; // Reset counter after valid press
      0000EF 05 09            [12]  479 	inc	_button_1_counter
      0000F1                        480 00121$:
                                    481 ;	01_led_button_debounce/led_button.c:78: if(P3_2 == 0 && button_2_counter == 0) {
      0000F1 20 B2 08         [24]  482 	jb	_P3_2,00124$
      0000F4 E5 0A            [12]  483 	mov	a,_button_2_counter
      0000F6 70 04            [24]  484 	jnz	00124$
                                    485 ;	01_led_button_debounce/led_button.c:79: led_2_state = !led_2_state;
      0000F8 B2 02            [12]  486 	cpl	_led_2_state
                                    487 ;	01_led_button_debounce/led_button.c:80: button_2_counter++; // Reset counter after valid press
      0000FA 05 0A            [12]  488 	inc	_button_2_counter
      0000FC                        489 00124$:
                                    490 ;	01_led_button_debounce/led_button.c:82: if(P3_3 == 0 && button_3_counter == 0) {
      0000FC 20 B3 08         [24]  491 	jb	_P3_3,00127$
      0000FF E5 0B            [12]  492 	mov	a,_button_3_counter
      000101 70 04            [24]  493 	jnz	00127$
                                    494 ;	01_led_button_debounce/led_button.c:83: led_3_state = !led_3_state;
      000103 B2 03            [12]  495 	cpl	_led_3_state
                                    496 ;	01_led_button_debounce/led_button.c:84: button_3_counter++; // Reset counter after valid press
      000105 05 0B            [12]  497 	inc	_button_3_counter
      000107                        498 00127$:
                                    499 ;	01_led_button_debounce/led_button.c:87: P2_0 = led_0_state;
                                    500 ;	assignBit
      000107 A2 00            [12]  501 	mov	c,_led_0_state
      000109 92 A0            [24]  502 	mov	_P2_0,c
                                    503 ;	01_led_button_debounce/led_button.c:88: P2_1 = led_1_state;
                                    504 ;	assignBit
      00010B A2 01            [12]  505 	mov	c,_led_1_state
      00010D 92 A1            [24]  506 	mov	_P2_1,c
                                    507 ;	01_led_button_debounce/led_button.c:89: P2_2 = led_2_state;
                                    508 ;	assignBit
      00010F A2 02            [12]  509 	mov	c,_led_2_state
      000111 92 A2            [24]  510 	mov	_P2_2,c
                                    511 ;	01_led_button_debounce/led_button.c:90: P2_3 = led_3_state;
                                    512 ;	assignBit
      000113 A2 03            [12]  513 	mov	c,_led_3_state
      000115 92 A3            [24]  514 	mov	_P2_3,c
                                    515 ;	01_led_button_debounce/led_button.c:92: TF0 = 0;	/* Clear Timer 0 overflow flag */
                                    516 ;	assignBit
      000117 C2 8D            [12]  517 	clr	_TF0
                                    518 ;	01_led_button_debounce/led_button.c:93: }
      000119 D0 D0            [24]  519 	pop	psw
      00011B D0 E0            [24]  520 	pop	acc
      00011D 32               [24]  521 	reti
                                    522 ;	eliminated unneeded mov psw,# (no regs used in bank)
                                    523 ;	eliminated unneeded push/pop dpl
                                    524 ;	eliminated unneeded push/pop dph
                                    525 ;	eliminated unneeded push/pop b
                                    526 	.area CSEG    (CODE)
                                    527 	.area CONST   (CODE)
                                    528 	.area XINIT   (CODE)
                                    529 	.area CABS    (ABS,CODE)
