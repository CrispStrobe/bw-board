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
                                    114 ;--------------------------------------------------------
                                    115 ; special function registers
                                    116 ;--------------------------------------------------------
                                    117 	.area RSEG    (ABS,DATA)
      000000                        118 	.org 0x0000
                           000080   119 _P0	=	0x0080
                           000081   120 _SP	=	0x0081
                           000082   121 _DPL	=	0x0082
                           000083   122 _DPH	=	0x0083
                           000087   123 _PCON	=	0x0087
                           000088   124 _TCON	=	0x0088
                           000089   125 _TMOD	=	0x0089
                           00008A   126 _TL0	=	0x008a
                           00008B   127 _TL1	=	0x008b
                           00008C   128 _TH0	=	0x008c
                           00008D   129 _TH1	=	0x008d
                           000090   130 _P1	=	0x0090
                           000098   131 _SCON	=	0x0098
                           000099   132 _SBUF	=	0x0099
                           0000A0   133 _P2	=	0x00a0
                           0000A8   134 _IE	=	0x00a8
                           0000B0   135 _P3	=	0x00b0
                           0000B8   136 _IP	=	0x00b8
                           0000D0   137 _PSW	=	0x00d0
                           0000E0   138 _ACC	=	0x00e0
                           0000F0   139 _B	=	0x00f0
                                    140 ;--------------------------------------------------------
                                    141 ; special function bits
                                    142 ;--------------------------------------------------------
                                    143 	.area RSEG    (ABS,DATA)
      000000                        144 	.org 0x0000
                           000080   145 _P0_0	=	0x0080
                           000081   146 _P0_1	=	0x0081
                           000082   147 _P0_2	=	0x0082
                           000083   148 _P0_3	=	0x0083
                           000084   149 _P0_4	=	0x0084
                           000085   150 _P0_5	=	0x0085
                           000086   151 _P0_6	=	0x0086
                           000087   152 _P0_7	=	0x0087
                           000088   153 _IT0	=	0x0088
                           000089   154 _IE0	=	0x0089
                           00008A   155 _IT1	=	0x008a
                           00008B   156 _IE1	=	0x008b
                           00008C   157 _TR0	=	0x008c
                           00008D   158 _TF0	=	0x008d
                           00008E   159 _TR1	=	0x008e
                           00008F   160 _TF1	=	0x008f
                           000090   161 _P1_0	=	0x0090
                           000091   162 _P1_1	=	0x0091
                           000092   163 _P1_2	=	0x0092
                           000093   164 _P1_3	=	0x0093
                           000094   165 _P1_4	=	0x0094
                           000095   166 _P1_5	=	0x0095
                           000096   167 _P1_6	=	0x0096
                           000097   168 _P1_7	=	0x0097
                           000098   169 _RI	=	0x0098
                           000099   170 _TI	=	0x0099
                           00009A   171 _RB8	=	0x009a
                           00009B   172 _TB8	=	0x009b
                           00009C   173 _REN	=	0x009c
                           00009D   174 _SM2	=	0x009d
                           00009E   175 _SM1	=	0x009e
                           00009F   176 _SM0	=	0x009f
                           0000A0   177 _P2_0	=	0x00a0
                           0000A1   178 _P2_1	=	0x00a1
                           0000A2   179 _P2_2	=	0x00a2
                           0000A3   180 _P2_3	=	0x00a3
                           0000A4   181 _P2_4	=	0x00a4
                           0000A5   182 _P2_5	=	0x00a5
                           0000A6   183 _P2_6	=	0x00a6
                           0000A7   184 _P2_7	=	0x00a7
                           0000A8   185 _EX0	=	0x00a8
                           0000A9   186 _ET0	=	0x00a9
                           0000AA   187 _EX1	=	0x00aa
                           0000AB   188 _ET1	=	0x00ab
                           0000AC   189 _ES	=	0x00ac
                           0000AF   190 _EA	=	0x00af
                           0000B0   191 _P3_0	=	0x00b0
                           0000B1   192 _P3_1	=	0x00b1
                           0000B2   193 _P3_2	=	0x00b2
                           0000B3   194 _P3_3	=	0x00b3
                           0000B4   195 _P3_4	=	0x00b4
                           0000B5   196 _P3_5	=	0x00b5
                           0000B6   197 _P3_6	=	0x00b6
                           0000B7   198 _P3_7	=	0x00b7
                           0000B0   199 _RXD	=	0x00b0
                           0000B1   200 _TXD	=	0x00b1
                           0000B2   201 _INT0	=	0x00b2
                           0000B3   202 _INT1	=	0x00b3
                           0000B4   203 _T0	=	0x00b4
                           0000B5   204 _T1	=	0x00b5
                           0000B6   205 _WR	=	0x00b6
                           0000B7   206 _RD	=	0x00b7
                           0000B8   207 _PX0	=	0x00b8
                           0000B9   208 _PT0	=	0x00b9
                           0000BA   209 _PX1	=	0x00ba
                           0000BB   210 _PT1	=	0x00bb
                           0000BC   211 _PS	=	0x00bc
                           0000D0   212 _P	=	0x00d0
                           0000D1   213 _F1	=	0x00d1
                           0000D2   214 _OV	=	0x00d2
                           0000D3   215 _RS0	=	0x00d3
                           0000D4   216 _RS1	=	0x00d4
                           0000D5   217 _F0	=	0x00d5
                           0000D6   218 _AC	=	0x00d6
                           0000D7   219 _CY	=	0x00d7
                                    220 ;--------------------------------------------------------
                                    221 ; overlayable register banks
                                    222 ;--------------------------------------------------------
                                    223 	.area REG_BANK_0	(REL,OVR,DATA)
      000000                        224 	.ds 8
                                    225 ;--------------------------------------------------------
                                    226 ; internal ram data
                                    227 ;--------------------------------------------------------
                                    228 	.area DSEG    (DATA)
                                    229 ;--------------------------------------------------------
                                    230 ; overlayable items in internal ram
                                    231 ;--------------------------------------------------------
                                    232 ;--------------------------------------------------------
                                    233 ; Stack segment in internal ram
                                    234 ;--------------------------------------------------------
                                    235 	.area	SSEG
      000021                        236 __start__stack:
      000021                        237 	.ds	1
                                    238 
                                    239 ;--------------------------------------------------------
                                    240 ; indirectly addressable internal ram data
                                    241 ;--------------------------------------------------------
                                    242 	.area ISEG    (DATA)
                                    243 ;--------------------------------------------------------
                                    244 ; absolute internal ram data
                                    245 ;--------------------------------------------------------
                                    246 	.area IABS    (ABS,DATA)
                                    247 	.area IABS    (ABS,DATA)
                                    248 ;--------------------------------------------------------
                                    249 ; bit data
                                    250 ;--------------------------------------------------------
                                    251 	.area BSEG    (BIT)
      000000                        252 _led_0_state::
      000000                        253 	.ds 1
      000001                        254 _led_1_state::
      000001                        255 	.ds 1
      000002                        256 _led_2_state::
      000002                        257 	.ds 1
      000003                        258 _led_3_state::
      000003                        259 	.ds 1
                                    260 ;--------------------------------------------------------
                                    261 ; paged external ram data
                                    262 ;--------------------------------------------------------
                                    263 	.area PSEG    (PAG,XDATA)
                                    264 ;--------------------------------------------------------
                                    265 ; external ram data
                                    266 ;--------------------------------------------------------
                                    267 	.area XSEG    (XDATA)
                                    268 ;--------------------------------------------------------
                                    269 ; absolute external ram data
                                    270 ;--------------------------------------------------------
                                    271 	.area XABS    (ABS,XDATA)
                                    272 ;--------------------------------------------------------
                                    273 ; external initialized ram data
                                    274 ;--------------------------------------------------------
                                    275 	.area XISEG   (XDATA)
                                    276 	.area HOME    (CODE)
                                    277 	.area GSINIT0 (CODE)
                                    278 	.area GSINIT1 (CODE)
                                    279 	.area GSINIT2 (CODE)
                                    280 	.area GSINIT3 (CODE)
                                    281 	.area GSINIT4 (CODE)
                                    282 	.area GSINIT5 (CODE)
                                    283 	.area GSINIT  (CODE)
                                    284 	.area GSFINAL (CODE)
                                    285 	.area CSEG    (CODE)
                                    286 ;--------------------------------------------------------
                                    287 ; interrupt vector
                                    288 ;--------------------------------------------------------
                                    289 	.area HOME    (CODE)
      000000                        290 __interrupt_vect:
      000000 02 00 11         [24]  291 	ljmp	__sdcc_gsinit_startup
      000003 32               [24]  292 	reti
      000004                        293 	.ds	7
      00000B 02 00 8F         [24]  294 	ljmp	_tf0_isr
                                    295 ;--------------------------------------------------------
                                    296 ; global & static initialisations
                                    297 ;--------------------------------------------------------
                                    298 	.area HOME    (CODE)
                                    299 	.area GSINIT  (CODE)
                                    300 	.area GSFINAL (CODE)
                                    301 	.area GSINIT  (CODE)
                                    302 	.globl __sdcc_gsinit_startup
                                    303 	.globl __sdcc_program_startup
                                    304 	.globl __start__stack
                                    305 	.globl __mcs51_genXINIT
                                    306 	.globl __mcs51_genXRAMCLEAR
                                    307 	.globl __mcs51_genRAMCLEAR
                                    308 ;	01_led_button_timer/led_button.c:37: __bit led_0_state = 0;
                                    309 ;	assignBit
      00006A C2 00            [12]  310 	clr	_led_0_state
                                    311 ;	01_led_button_timer/led_button.c:38: __bit led_1_state = 0;
                                    312 ;	assignBit
      00006C C2 01            [12]  313 	clr	_led_1_state
                                    314 ;	01_led_button_timer/led_button.c:39: __bit led_2_state = 0;
                                    315 ;	assignBit
      00006E C2 02            [12]  316 	clr	_led_2_state
                                    317 ;	01_led_button_timer/led_button.c:40: __bit led_3_state = 0;
                                    318 ;	assignBit
      000070 C2 03            [12]  319 	clr	_led_3_state
                                    320 	.area GSFINAL (CODE)
      000072 02 00 0E         [24]  321 	ljmp	__sdcc_program_startup
                                    322 ;--------------------------------------------------------
                                    323 ; Home
                                    324 ;--------------------------------------------------------
                                    325 	.area HOME    (CODE)
                                    326 	.area HOME    (CODE)
      00000E                        327 __sdcc_program_startup:
      00000E 02 00 86         [24]  328 	ljmp	_main
                                    329 ;	return from main will return to caller
                                    330 ;--------------------------------------------------------
                                    331 ; code
                                    332 ;--------------------------------------------------------
                                    333 	.area CSEG    (CODE)
                                    334 ;------------------------------------------------------------
                                    335 ;Allocation info for local variables in function 'timer0_init'
                                    336 ;------------------------------------------------------------
                                    337 ;	01_led_button_timer/led_button.c:19: void timer0_init(void) {
                                    338 ;	-----------------------------------------
                                    339 ;	 function timer0_init
                                    340 ;	-----------------------------------------
      000075                        341 _timer0_init:
                           000007   342 	ar7 = 0x07
                           000006   343 	ar6 = 0x06
                           000005   344 	ar5 = 0x05
                           000004   345 	ar4 = 0x04
                           000003   346 	ar3 = 0x03
                           000002   347 	ar2 = 0x02
                           000001   348 	ar1 = 0x01
                           000000   349 	ar0 = 0x00
                                    350 ;	01_led_button_timer/led_button.c:20: TMOD &= 0xF0;	/* Clear Timer 0 mode bits */
      000075 53 89 F0         [24]  351 	anl	_TMOD,#0xf0
                                    352 ;	01_led_button_timer/led_button.c:21: TMOD |= 0x1;	/* Set Timer 0 mode to 16-bit */
      000078 43 89 01         [24]  353 	orl	_TMOD,#0x01
                                    354 ;	01_led_button_timer/led_button.c:22: TH0 = 0x3c;	/* Set Timer 0 high byte for 16-bit mode */
      00007B 75 8C 3C         [24]  355 	mov	_TH0,#0x3c
                                    356 ;	01_led_button_timer/led_button.c:23: TL0 = 0xb0;	/* Set Timer 0 low byte for 16-bit mode */
      00007E 75 8A B0         [24]  357 	mov	_TL0,#0xb0
                                    358 ;	01_led_button_timer/led_button.c:24: TF0 = 0;	/* Clear Timer 0 overflow flag */
                                    359 ;	assignBit
      000081 C2 8D            [12]  360 	clr	_TF0
                                    361 ;	01_led_button_timer/led_button.c:25: TR0 = 1;	/* Start Timer 0 */
                                    362 ;	assignBit
      000083 D2 8C            [12]  363 	setb	_TR0
                                    364 ;	01_led_button_timer/led_button.c:26: }
      000085 22               [24]  365 	ret
                                    366 ;------------------------------------------------------------
                                    367 ;Allocation info for local variables in function 'main'
                                    368 ;------------------------------------------------------------
                                    369 ;	01_led_button_timer/led_button.c:28: void main(void) {
                                    370 ;	-----------------------------------------
                                    371 ;	 function main
                                    372 ;	-----------------------------------------
      000086                        373 _main:
                                    374 ;	01_led_button_timer/led_button.c:29: timer0_init();
      000086 12 00 75         [24]  375 	lcall	_timer0_init
                                    376 ;	01_led_button_timer/led_button.c:31: ET0 = 1;	/* Enable Timer 0 interrupt */
                                    377 ;	assignBit
      000089 D2 A9            [12]  378 	setb	_ET0
                                    379 ;	01_led_button_timer/led_button.c:32: EA  = 1; /* Enable global interrupts */
                                    380 ;	assignBit
      00008B D2 AF            [12]  381 	setb	_EA
      00008D                        382 00103$:
                                    383 ;	01_led_button_timer/led_button.c:35: }
      00008D 80 FE            [24]  384 	sjmp	00103$
                                    385 ;------------------------------------------------------------
                                    386 ;Allocation info for local variables in function 'tf0_isr'
                                    387 ;------------------------------------------------------------
                                    388 ;	01_led_button_timer/led_button.c:42: void tf0_isr(void) __interrupt(TF0_VECTOR) {
                                    389 ;	-----------------------------------------
                                    390 ;	 function tf0_isr
                                    391 ;	-----------------------------------------
      00008F                        392 _tf0_isr:
      00008F C0 D0            [24]  393 	push	psw
                                    394 ;	01_led_button_timer/led_button.c:43: if(P3_1 == 0) {
      000091 20 B1 02         [24]  395 	jb	_P3_1,00102$
                                    396 ;	01_led_button_timer/led_button.c:44: led_0_state = !led_0_state;
      000094 B2 00            [12]  397 	cpl	_led_0_state
      000096                        398 00102$:
                                    399 ;	01_led_button_timer/led_button.c:46: if(P3_0 == 0) {
      000096 20 B0 02         [24]  400 	jb	_P3_0,00104$
                                    401 ;	01_led_button_timer/led_button.c:47: led_1_state = !led_1_state;
      000099 B2 01            [12]  402 	cpl	_led_1_state
      00009B                        403 00104$:
                                    404 ;	01_led_button_timer/led_button.c:49: if(P3_2 == 0) {
      00009B 20 B2 02         [24]  405 	jb	_P3_2,00106$
                                    406 ;	01_led_button_timer/led_button.c:50: led_2_state = !led_2_state;
      00009E B2 02            [12]  407 	cpl	_led_2_state
      0000A0                        408 00106$:
                                    409 ;	01_led_button_timer/led_button.c:52: if(P3_3 == 0) {
      0000A0 20 B3 02         [24]  410 	jb	_P3_3,00108$
                                    411 ;	01_led_button_timer/led_button.c:53: led_3_state = !led_3_state;
      0000A3 B2 03            [12]  412 	cpl	_led_3_state
      0000A5                        413 00108$:
                                    414 ;	01_led_button_timer/led_button.c:56: P2_0 = led_0_state;
                                    415 ;	assignBit
      0000A5 A2 00            [12]  416 	mov	c,_led_0_state
      0000A7 92 A0            [24]  417 	mov	_P2_0,c
                                    418 ;	01_led_button_timer/led_button.c:57: P2_1 = led_1_state;
                                    419 ;	assignBit
      0000A9 A2 01            [12]  420 	mov	c,_led_1_state
      0000AB 92 A1            [24]  421 	mov	_P2_1,c
                                    422 ;	01_led_button_timer/led_button.c:58: P2_2 = led_2_state;
                                    423 ;	assignBit
      0000AD A2 02            [12]  424 	mov	c,_led_2_state
      0000AF 92 A2            [24]  425 	mov	_P2_2,c
                                    426 ;	01_led_button_timer/led_button.c:59: P2_3 = led_3_state;
                                    427 ;	assignBit
      0000B1 A2 03            [12]  428 	mov	c,_led_3_state
      0000B3 92 A3            [24]  429 	mov	_P2_3,c
                                    430 ;	01_led_button_timer/led_button.c:61: TF0 = 0;	/* Clear Timer 0 overflow flag */
                                    431 ;	assignBit
      0000B5 C2 8D            [12]  432 	clr	_TF0
                                    433 ;	01_led_button_timer/led_button.c:62: }
      0000B7 D0 D0            [24]  434 	pop	psw
      0000B9 32               [24]  435 	reti
                                    436 ;	eliminated unneeded mov psw,# (no regs used in bank)
                                    437 ;	eliminated unneeded push/pop dpl
                                    438 ;	eliminated unneeded push/pop dph
                                    439 ;	eliminated unneeded push/pop b
                                    440 ;	eliminated unneeded push/pop acc
                                    441 	.area CSEG    (CODE)
                                    442 	.area CONST   (CODE)
                                    443 	.area XINIT   (CODE)
                                    444 	.area CABS    (ABS,CODE)
