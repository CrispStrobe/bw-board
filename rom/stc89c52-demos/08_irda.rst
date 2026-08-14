                                      1 ;--------------------------------------------------------
                                      2 ; File Created by SDCC : free open source ANSI-C Compiler
                                      3 ; Version 4.2.0 #13081 (Linux)
                                      4 ;--------------------------------------------------------
                                      5 	.module irda
                                      6 	.optsdcc -mmcs51 --model-small
                                      7 	
                                      8 ;--------------------------------------------------------
                                      9 ; Public variables in this module
                                     10 ;--------------------------------------------------------
                                     11 	.globl _segment_map
                                     12 	.globl _main
                                     13 	.globl _delay
                                     14 	.globl _int0_isr
                                     15 	.globl _tf0_isr
                                     16 	.globl _ext_init
                                     17 	.globl _timer0_init
                                     18 	.globl _CY
                                     19 	.globl _AC
                                     20 	.globl _F0
                                     21 	.globl _RS1
                                     22 	.globl _RS0
                                     23 	.globl _OV
                                     24 	.globl _F1
                                     25 	.globl _P
                                     26 	.globl _PS
                                     27 	.globl _PT1
                                     28 	.globl _PX1
                                     29 	.globl _PT0
                                     30 	.globl _PX0
                                     31 	.globl _RD
                                     32 	.globl _WR
                                     33 	.globl _T1
                                     34 	.globl _T0
                                     35 	.globl _INT1
                                     36 	.globl _INT0
                                     37 	.globl _TXD
                                     38 	.globl _RXD
                                     39 	.globl _P3_7
                                     40 	.globl _P3_6
                                     41 	.globl _P3_5
                                     42 	.globl _P3_4
                                     43 	.globl _P3_3
                                     44 	.globl _P3_2
                                     45 	.globl _P3_1
                                     46 	.globl _P3_0
                                     47 	.globl _EA
                                     48 	.globl _ES
                                     49 	.globl _ET1
                                     50 	.globl _EX1
                                     51 	.globl _ET0
                                     52 	.globl _EX0
                                     53 	.globl _P2_7
                                     54 	.globl _P2_6
                                     55 	.globl _P2_5
                                     56 	.globl _P2_4
                                     57 	.globl _P2_3
                                     58 	.globl _P2_2
                                     59 	.globl _P2_1
                                     60 	.globl _P2_0
                                     61 	.globl _SM0
                                     62 	.globl _SM1
                                     63 	.globl _SM2
                                     64 	.globl _REN
                                     65 	.globl _TB8
                                     66 	.globl _RB8
                                     67 	.globl _TI
                                     68 	.globl _RI
                                     69 	.globl _P1_7
                                     70 	.globl _P1_6
                                     71 	.globl _P1_5
                                     72 	.globl _P1_4
                                     73 	.globl _P1_3
                                     74 	.globl _P1_2
                                     75 	.globl _P1_1
                                     76 	.globl _P1_0
                                     77 	.globl _TF1
                                     78 	.globl _TR1
                                     79 	.globl _TF0
                                     80 	.globl _TR0
                                     81 	.globl _IE1
                                     82 	.globl _IT1
                                     83 	.globl _IE0
                                     84 	.globl _IT0
                                     85 	.globl _P0_7
                                     86 	.globl _P0_6
                                     87 	.globl _P0_5
                                     88 	.globl _P0_4
                                     89 	.globl _P0_3
                                     90 	.globl _P0_2
                                     91 	.globl _P0_1
                                     92 	.globl _P0_0
                                     93 	.globl _B
                                     94 	.globl _ACC
                                     95 	.globl _PSW
                                     96 	.globl _IP
                                     97 	.globl _P3
                                     98 	.globl _IE
                                     99 	.globl _P2
                                    100 	.globl _SBUF
                                    101 	.globl _SCON
                                    102 	.globl _P1
                                    103 	.globl _TH1
                                    104 	.globl _TH0
                                    105 	.globl _TL1
                                    106 	.globl _TL0
                                    107 	.globl _TMOD
                                    108 	.globl _TCON
                                    109 	.globl _PCON
                                    110 	.globl _DPH
                                    111 	.globl _DPL
                                    112 	.globl _SP
                                    113 	.globl _P0
                                    114 	.globl _last_pattern
                                    115 	.globl _pattern
                                    116 	.globl _pulse_count
                                    117 	.globl _ms_counter
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
      000008                        233 _ms_counter::
      000008                        234 	.ds 1
      000009                        235 _pulse_count::
      000009                        236 	.ds 1
      00000A                        237 _pattern::
      00000A                        238 	.ds 4
      00000E                        239 _last_pattern::
      00000E                        240 	.ds 4
                                    241 ;--------------------------------------------------------
                                    242 ; overlayable items in internal ram
                                    243 ;--------------------------------------------------------
                                    244 	.area	OSEG    (OVR,DATA)
                                    245 ;--------------------------------------------------------
                                    246 ; Stack segment in internal ram
                                    247 ;--------------------------------------------------------
                                    248 	.area	SSEG
      000012                        249 __start__stack:
      000012                        250 	.ds	1
                                    251 
                                    252 ;--------------------------------------------------------
                                    253 ; indirectly addressable internal ram data
                                    254 ;--------------------------------------------------------
                                    255 	.area ISEG    (DATA)
                                    256 ;--------------------------------------------------------
                                    257 ; absolute internal ram data
                                    258 ;--------------------------------------------------------
                                    259 	.area IABS    (ABS,DATA)
                                    260 	.area IABS    (ABS,DATA)
                                    261 ;--------------------------------------------------------
                                    262 ; bit data
                                    263 ;--------------------------------------------------------
                                    264 	.area BSEG    (BIT)
                                    265 ;--------------------------------------------------------
                                    266 ; paged external ram data
                                    267 ;--------------------------------------------------------
                                    268 	.area PSEG    (PAG,XDATA)
                                    269 ;--------------------------------------------------------
                                    270 ; external ram data
                                    271 ;--------------------------------------------------------
                                    272 	.area XSEG    (XDATA)
                                    273 ;--------------------------------------------------------
                                    274 ; absolute external ram data
                                    275 ;--------------------------------------------------------
                                    276 	.area XABS    (ABS,XDATA)
                                    277 ;--------------------------------------------------------
                                    278 ; external initialized ram data
                                    279 ;--------------------------------------------------------
                                    280 	.area XISEG   (XDATA)
                                    281 	.area HOME    (CODE)
                                    282 	.area GSINIT0 (CODE)
                                    283 	.area GSINIT1 (CODE)
                                    284 	.area GSINIT2 (CODE)
                                    285 	.area GSINIT3 (CODE)
                                    286 	.area GSINIT4 (CODE)
                                    287 	.area GSINIT5 (CODE)
                                    288 	.area GSINIT  (CODE)
                                    289 	.area GSFINAL (CODE)
                                    290 	.area CSEG    (CODE)
                                    291 ;--------------------------------------------------------
                                    292 ; interrupt vector
                                    293 ;--------------------------------------------------------
                                    294 	.area HOME    (CODE)
      000000                        295 __interrupt_vect:
      000000 02 00 11         [24]  296 	ljmp	__sdcc_gsinit_startup
      000003 02 00 B6         [24]  297 	ljmp	_int0_isr
      000006                        298 	.ds	5
      00000B 02 00 9D         [24]  299 	ljmp	_tf0_isr
                                    300 ;--------------------------------------------------------
                                    301 ; global & static initialisations
                                    302 ;--------------------------------------------------------
                                    303 	.area HOME    (CODE)
                                    304 	.area GSINIT  (CODE)
                                    305 	.area GSFINAL (CODE)
                                    306 	.area GSINIT  (CODE)
                                    307 	.globl __sdcc_gsinit_startup
                                    308 	.globl __sdcc_program_startup
                                    309 	.globl __start__stack
                                    310 	.globl __mcs51_genXINIT
                                    311 	.globl __mcs51_genXRAMCLEAR
                                    312 	.globl __mcs51_genRAMCLEAR
                                    313 ;	08_irda/irda.c:41: uint8_t ms_counter = 0;
      00006A 75 08 00         [24]  314 	mov	_ms_counter,#0x00
                                    315 ;	08_irda/irda.c:42: int8_t pulse_count = 0;
      00006D 75 09 00         [24]  316 	mov	_pulse_count,#0x00
                                    317 ;	08_irda/irda.c:43: uint32_t pattern = 0;
      000070 E4               [12]  318 	clr	a
      000071 F5 0A            [12]  319 	mov	_pattern,a
      000073 F5 0B            [12]  320 	mov	(_pattern + 1),a
      000075 F5 0C            [12]  321 	mov	(_pattern + 2),a
      000077 F5 0D            [12]  322 	mov	(_pattern + 3),a
                                    323 ;	08_irda/irda.c:44: uint32_t last_pattern = 0xFFFFFFFF;
      000079 14               [12]  324 	dec	a
      00007A F5 0E            [12]  325 	mov	_last_pattern,a
      00007C F5 0F            [12]  326 	mov	(_last_pattern + 1),a
      00007E F5 10            [12]  327 	mov	(_last_pattern + 2),a
      000080 F5 11            [12]  328 	mov	(_last_pattern + 3),a
                                    329 	.area GSFINAL (CODE)
      000082 02 00 0E         [24]  330 	ljmp	__sdcc_program_startup
                                    331 ;--------------------------------------------------------
                                    332 ; Home
                                    333 ;--------------------------------------------------------
                                    334 	.area HOME    (CODE)
                                    335 	.area HOME    (CODE)
      00000E                        336 __sdcc_program_startup:
      00000E 02 01 5A         [24]  337 	ljmp	_main
                                    338 ;	return from main will return to caller
                                    339 ;--------------------------------------------------------
                                    340 ; code
                                    341 ;--------------------------------------------------------
                                    342 	.area CSEG    (CODE)
                                    343 ;------------------------------------------------------------
                                    344 ;Allocation info for local variables in function 'timer0_init'
                                    345 ;------------------------------------------------------------
                                    346 ;	08_irda/irda.c:24: void timer0_init(void) {
                                    347 ;	-----------------------------------------
                                    348 ;	 function timer0_init
                                    349 ;	-----------------------------------------
      000085                        350 _timer0_init:
                           000007   351 	ar7 = 0x07
                           000006   352 	ar6 = 0x06
                           000005   353 	ar5 = 0x05
                           000004   354 	ar4 = 0x04
                           000003   355 	ar3 = 0x03
                           000002   356 	ar2 = 0x02
                           000001   357 	ar1 = 0x01
                           000000   358 	ar0 = 0x00
                                    359 ;	08_irda/irda.c:25: TMOD &= 0xF0;	/* Clear Timer 0 mode bits */
      000085 53 89 F0         [24]  360 	anl	_TMOD,#0xf0
                                    361 ;	08_irda/irda.c:26: TMOD |= 0x1;	/* Set Timer 0 mode to 16-bit */
      000088 43 89 01         [24]  362 	orl	_TMOD,#0x01
                                    363 ;	08_irda/irda.c:27: TH0 = 0xfc;	/* Set Timer 0 high byte for 16-bit mode */
      00008B 75 8C FC         [24]  364 	mov	_TH0,#0xfc
                                    365 ;	08_irda/irda.c:28: TL0 = 0x18;	/* Set Timer 0 low byte for 16-bit mode */
      00008E 75 8A 18         [24]  366 	mov	_TL0,#0x18
                                    367 ;	08_irda/irda.c:29: TF0 = 0;	/* Clear Timer 0 overflow flag */
                                    368 ;	assignBit
      000091 C2 8D            [12]  369 	clr	_TF0
                                    370 ;	08_irda/irda.c:30: TR0 = 1;	/* Start Timer 0 */
                                    371 ;	assignBit
      000093 D2 8C            [12]  372 	setb	_TR0
                                    373 ;	08_irda/irda.c:33: ET0 = 1;
                                    374 ;	assignBit
      000095 D2 A9            [12]  375 	setb	_ET0
                                    376 ;	08_irda/irda.c:34: }
      000097 22               [24]  377 	ret
                                    378 ;------------------------------------------------------------
                                    379 ;Allocation info for local variables in function 'ext_init'
                                    380 ;------------------------------------------------------------
                                    381 ;	08_irda/irda.c:36: void ext_init(void) {
                                    382 ;	-----------------------------------------
                                    383 ;	 function ext_init
                                    384 ;	-----------------------------------------
      000098                        385 _ext_init:
                                    386 ;	08_irda/irda.c:37: IT0 = 1;	/* INT0 (P3.2) Falling Edge */
                                    387 ;	assignBit
      000098 D2 88            [12]  388 	setb	_IT0
                                    389 ;	08_irda/irda.c:38: EX0 = 1;	/* Enable INT0 (P3.2) */
                                    390 ;	assignBit
      00009A D2 A8            [12]  391 	setb	_EX0
                                    392 ;	08_irda/irda.c:39: }
      00009C 22               [24]  393 	ret
                                    394 ;------------------------------------------------------------
                                    395 ;Allocation info for local variables in function 'tf0_isr'
                                    396 ;------------------------------------------------------------
                                    397 ;	08_irda/irda.c:46: void tf0_isr(void) __interrupt(TF0_VECTOR) {
                                    398 ;	-----------------------------------------
                                    399 ;	 function tf0_isr
                                    400 ;	-----------------------------------------
      00009D                        401 _tf0_isr:
      00009D C0 E0            [24]  402 	push	acc
      00009F C0 D0            [24]  403 	push	psw
                                    404 ;	08_irda/irda.c:47: P3_4 = !P3_4; // Heartbeat on P3.3
      0000A1 B2 B4            [12]  405 	cpl	_P3_4
                                    406 ;	08_irda/irda.c:49: TH0 = 0xfc;	/* Set Timer 0 high byte for 16-bit mode */
      0000A3 75 8C FC         [24]  407 	mov	_TH0,#0xfc
                                    408 ;	08_irda/irda.c:50: TL0 = 0x18;	/* Set Timer 0 low byte for 16-bit mode */
      0000A6 75 8A 18         [24]  409 	mov	_TL0,#0x18
                                    410 ;	08_irda/irda.c:51: if(ms_counter<50) {
      0000A9 74 CE            [12]  411 	mov	a,#0x100 - 0x32
      0000AB 25 08            [12]  412 	add	a,_ms_counter
      0000AD 40 02            [24]  413 	jc	00103$
                                    414 ;	08_irda/irda.c:52: ms_counter++;
      0000AF 05 08            [12]  415 	inc	_ms_counter
      0000B1                        416 00103$:
                                    417 ;	08_irda/irda.c:54: }
      0000B1 D0 D0            [24]  418 	pop	psw
      0000B3 D0 E0            [24]  419 	pop	acc
      0000B5 32               [24]  420 	reti
                                    421 ;	eliminated unneeded mov psw,# (no regs used in bank)
                                    422 ;	eliminated unneeded push/pop dpl
                                    423 ;	eliminated unneeded push/pop dph
                                    424 ;	eliminated unneeded push/pop b
                                    425 ;------------------------------------------------------------
                                    426 ;Allocation info for local variables in function 'int0_isr'
                                    427 ;------------------------------------------------------------
                                    428 ;cur_timer                 Allocated to registers r7 
                                    429 ;------------------------------------------------------------
                                    430 ;	08_irda/irda.c:56: void int0_isr(void) __interrupt(IE0_VECTOR) {
                                    431 ;	-----------------------------------------
                                    432 ;	 function int0_isr
                                    433 ;	-----------------------------------------
      0000B6                        434 _int0_isr:
      0000B6 C0 E0            [24]  435 	push	acc
      0000B8 C0 F0            [24]  436 	push	b
      0000BA C0 07            [24]  437 	push	ar7
      0000BC C0 06            [24]  438 	push	ar6
      0000BE C0 05            [24]  439 	push	ar5
      0000C0 C0 04            [24]  440 	push	ar4
      0000C2 C0 D0            [24]  441 	push	psw
      0000C4 75 D0 00         [24]  442 	mov	psw,#0x00
                                    443 ;	08_irda/irda.c:57: uint8_t cur_timer = ms_counter;
      0000C7 AF 08            [24]  444 	mov	r7,_ms_counter
                                    445 ;	08_irda/irda.c:60: ms_counter = 0;
      0000C9 75 08 00         [24]  446 	mov	_ms_counter,#0x00
                                    447 ;	08_irda/irda.c:61: TH0 = 0xfc;	/* Set Timer 0 high byte for 16-bit mode */
      0000CC 75 8C FC         [24]  448 	mov	_TH0,#0xfc
                                    449 ;	08_irda/irda.c:62: TL0 = 0x18;	/* Set Timer 0 low byte for 16-bit mode */
      0000CF 75 8A 18         [24]  450 	mov	_TL0,#0x18
                                    451 ;	08_irda/irda.c:64: pulse_count++;
      0000D2 05 09            [12]  452 	inc	_pulse_count
                                    453 ;	08_irda/irda.c:66: if(cur_timer == 50) {
      0000D4 BF 32 0E         [24]  454 	cjne	r7,#0x32,00107$
                                    455 ;	08_irda/irda.c:68: pulse_count = -2; // Ignore sync edges
      0000D7 75 09 FE         [24]  456 	mov	_pulse_count,#0xfe
                                    457 ;	08_irda/irda.c:69: pattern = 0;      // Reset pattern
      0000DA E4               [12]  458 	clr	a
      0000DB F5 0A            [12]  459 	mov	_pattern,a
      0000DD F5 0B            [12]  460 	mov	(_pattern + 1),a
      0000DF F5 0C            [12]  461 	mov	(_pattern + 2),a
      0000E1 F5 0D            [12]  462 	mov	(_pattern + 3),a
      0000E3 80 3F            [24]  463 	sjmp	00108$
      0000E5                        464 00107$:
                                    465 ;	08_irda/irda.c:70: } else if(pulse_count >= 0 && pulse_count < 31) {
      0000E5 E5 09            [12]  466 	mov	a,_pulse_count
      0000E7 20 E7 3A         [24]  467 	jb	acc.7,00108$
      0000EA C3               [12]  468 	clr	c
      0000EB E5 09            [12]  469 	mov	a,_pulse_count
      0000ED 64 80            [12]  470 	xrl	a,#0x80
      0000EF 94 9F            [12]  471 	subb	a,#0x9f
      0000F1 50 31            [24]  472 	jnc	00108$
                                    473 ;	08_irda/irda.c:72: if(cur_timer>= 2) { // Threshold between 0 and 1
      0000F3 BF 02 00         [24]  474 	cjne	r7,#0x02,00137$
      0000F6                        475 00137$:
      0000F6 40 2C            [24]  476 	jc	00108$
                                    477 ;	08_irda/irda.c:73: pattern |= 0x00000001 << (31 - pulse_count); // MSB first
      0000F8 AF 09            [24]  478 	mov	r7,_pulse_count
      0000FA 74 1F            [12]  479 	mov	a,#0x1f
      0000FC C3               [12]  480 	clr	c
      0000FD 9F               [12]  481 	subb	a,r7
      0000FE FF               [12]  482 	mov	r7,a
      0000FF 8F F0            [24]  483 	mov	b,r7
      000101 05 F0            [12]  484 	inc	b
      000103 7F 01            [12]  485 	mov	r7,#0x01
      000105 7E 00            [12]  486 	mov	r6,#0x00
      000107 80 06            [24]  487 	sjmp	00140$
      000109                        488 00139$:
      000109 EF               [12]  489 	mov	a,r7
      00010A 2F               [12]  490 	add	a,r7
      00010B FF               [12]  491 	mov	r7,a
      00010C EE               [12]  492 	mov	a,r6
      00010D 33               [12]  493 	rlc	a
      00010E FE               [12]  494 	mov	r6,a
      00010F                        495 00140$:
      00010F D5 F0 F7         [24]  496 	djnz	b,00139$
      000112 EE               [12]  497 	mov	a,r6
      000113 33               [12]  498 	rlc	a
      000114 95 E0            [12]  499 	subb	a,acc
      000116 FD               [12]  500 	mov	r5,a
      000117 FC               [12]  501 	mov	r4,a
      000118 EF               [12]  502 	mov	a,r7
      000119 42 0A            [12]  503 	orl	_pattern,a
      00011B EE               [12]  504 	mov	a,r6
      00011C 42 0B            [12]  505 	orl	(_pattern + 1),a
      00011E ED               [12]  506 	mov	a,r5
      00011F 42 0C            [12]  507 	orl	(_pattern + 2),a
      000121 EC               [12]  508 	mov	a,r4
      000122 42 0D            [12]  509 	orl	(_pattern + 3),a
      000124                        510 00108$:
                                    511 ;	08_irda/irda.c:76: if(pulse_count >= 32) {
      000124 C3               [12]  512 	clr	c
      000125 E5 09            [12]  513 	mov	a,_pulse_count
      000127 64 80            [12]  514 	xrl	a,#0x80
      000129 94 A0            [12]  515 	subb	a,#0xa0
      00012B 40 0C            [24]  516 	jc	00111$
                                    517 ;	08_irda/irda.c:78: last_pattern = pattern;
      00012D 85 0A 0E         [24]  518 	mov	_last_pattern,_pattern
      000130 85 0B 0F         [24]  519 	mov	(_last_pattern + 1),(_pattern + 1)
      000133 85 0C 10         [24]  520 	mov	(_last_pattern + 2),(_pattern + 2)
      000136 85 0D 11         [24]  521 	mov	(_last_pattern + 3),(_pattern + 3)
      000139                        522 00111$:
                                    523 ;	08_irda/irda.c:80: }
      000139 D0 D0            [24]  524 	pop	psw
      00013B D0 04            [24]  525 	pop	ar4
      00013D D0 05            [24]  526 	pop	ar5
      00013F D0 06            [24]  527 	pop	ar6
      000141 D0 07            [24]  528 	pop	ar7
      000143 D0 F0            [24]  529 	pop	b
      000145 D0 E0            [24]  530 	pop	acc
      000147 32               [24]  531 	reti
                                    532 ;	eliminated unneeded push/pop dpl
                                    533 ;	eliminated unneeded push/pop dph
                                    534 ;------------------------------------------------------------
                                    535 ;Allocation info for local variables in function 'delay'
                                    536 ;------------------------------------------------------------
                                    537 ;t                         Allocated to registers 
                                    538 ;------------------------------------------------------------
                                    539 ;	08_irda/irda.c:104: void delay(uint16_t t) {
                                    540 ;	-----------------------------------------
                                    541 ;	 function delay
                                    542 ;	-----------------------------------------
      000148                        543 _delay:
      000148 AE 82            [24]  544 	mov	r6,dpl
      00014A AF 83            [24]  545 	mov	r7,dph
                                    546 ;	08_irda/irda.c:105: while (t--)
      00014C                        547 00101$:
      00014C 8E 04            [24]  548 	mov	ar4,r6
      00014E 8F 05            [24]  549 	mov	ar5,r7
      000150 1E               [12]  550 	dec	r6
      000151 BE FF 01         [24]  551 	cjne	r6,#0xff,00111$
      000154 1F               [12]  552 	dec	r7
      000155                        553 00111$:
      000155 EC               [12]  554 	mov	a,r4
      000156 4D               [12]  555 	orl	a,r5
      000157 70 F3            [24]  556 	jnz	00101$
                                    557 ;	08_irda/irda.c:107: }
      000159 22               [24]  558 	ret
                                    559 ;------------------------------------------------------------
                                    560 ;Allocation info for local variables in function 'main'
                                    561 ;------------------------------------------------------------
                                    562 ;i                         Allocated to registers r7 
                                    563 ;nibble                    Allocated to registers 
                                    564 ;------------------------------------------------------------
                                    565 ;	08_irda/irda.c:109: void main(void) {
                                    566 ;	-----------------------------------------
                                    567 ;	 function main
                                    568 ;	-----------------------------------------
      00015A                        569 _main:
                                    570 ;	08_irda/irda.c:110: timer0_init();
      00015A 12 00 85         [24]  571 	lcall	_timer0_init
                                    572 ;	08_irda/irda.c:111: ext_init();
      00015D 12 00 98         [24]  573 	lcall	_ext_init
                                    574 ;	08_irda/irda.c:112: EA = 1; // Enable global interrupts
                                    575 ;	assignBit
      000160 D2 AF            [12]  576 	setb	_EA
                                    577 ;	08_irda/irda.c:114: P0 = 0x00; // Initialize port
      000162 75 80 00         [24]  578 	mov	_P0,#0x00
                                    579 ;	08_irda/irda.c:115: P2 = 0x00;
      000165 75 A0 00         [24]  580 	mov	_P2,#0x00
                                    581 ;	08_irda/irda.c:119: for(uint8_t i=0; i<8; i++) {
      000168                        582 00112$:
      000168 7F 00            [12]  583 	mov	r7,#0x00
      00016A                        584 00104$:
      00016A BF 08 00         [24]  585 	cjne	r7,#0x08,00122$
      00016D                        586 00122$:
      00016D 50 F9            [24]  587 	jnc	00112$
                                    588 ;	08_irda/irda.c:120: P2 = i<<2; // activate digit i (P2_2..P2_4)
      00016F 8F 06            [24]  589 	mov	ar6,r7
      000171 EE               [12]  590 	mov	a,r6
      000172 2E               [12]  591 	add	a,r6
      000173 25 E0            [12]  592 	add	a,acc
      000175 F5 A0            [12]  593 	mov	_P2,a
                                    594 ;	08_irda/irda.c:123: uint8_t nibble = (last_pattern >> i*4) & 0x0F;
      000177 EF               [12]  595 	mov	a,r7
      000178 2F               [12]  596 	add	a,r7
      000179 25 E0            [12]  597 	add	a,acc
      00017B FE               [12]  598 	mov	r6,a
      00017C 8E F0            [24]  599 	mov	b,r6
      00017E 05 F0            [12]  600 	inc	b
      000180 AE 0E            [24]  601 	mov	r6,_last_pattern
      000182 AD 0F            [24]  602 	mov	r5,(_last_pattern + 1)
      000184 AC 10            [24]  603 	mov	r4,(_last_pattern + 2)
      000186 AB 11            [24]  604 	mov	r3,(_last_pattern + 3)
      000188 80 0D            [24]  605 	sjmp	00125$
      00018A                        606 00124$:
      00018A C3               [12]  607 	clr	c
      00018B EB               [12]  608 	mov	a,r3
      00018C 13               [12]  609 	rrc	a
      00018D FB               [12]  610 	mov	r3,a
      00018E EC               [12]  611 	mov	a,r4
      00018F 13               [12]  612 	rrc	a
      000190 FC               [12]  613 	mov	r4,a
      000191 ED               [12]  614 	mov	a,r5
      000192 13               [12]  615 	rrc	a
      000193 FD               [12]  616 	mov	r5,a
      000194 EE               [12]  617 	mov	a,r6
      000195 13               [12]  618 	rrc	a
      000196 FE               [12]  619 	mov	r6,a
      000197                        620 00125$:
      000197 D5 F0 F0         [24]  621 	djnz	b,00124$
      00019A 74 0F            [12]  622 	mov	a,#0x0f
      00019C 5E               [12]  623 	anl	a,r6
                                    624 ;	08_irda/irda.c:124: LED_DIGIT = segment_map[nibble];
      00019D 90 01 B7         [24]  625 	mov	dptr,#_segment_map
      0001A0 93               [24]  626 	movc	a,@a+dptr
      0001A1 F5 80            [12]  627 	mov	_P0,a
                                    628 ;	08_irda/irda.c:125: delay(200); // Short delay for multiplexing
      0001A3 90 00 C8         [24]  629 	mov	dptr,#0x00c8
      0001A6 C0 07            [24]  630 	push	ar7
      0001A8 12 01 48         [24]  631 	lcall	_delay
      0001AB D0 07            [24]  632 	pop	ar7
                                    633 ;	08_irda/irda.c:126: LED_DIGIT = 0x00; // Turn off all segments
      0001AD 75 80 00         [24]  634 	mov	_P0,#0x00
                                    635 ;	08_irda/irda.c:119: for(uint8_t i=0; i<8; i++) {
      0001B0 0F               [12]  636 	inc	r7
                                    637 ;	08_irda/irda.c:129: }
      0001B1 80 B7            [24]  638 	sjmp	00104$
                                    639 	.area CSEG    (CODE)
                                    640 	.area CONST   (CODE)
      0001B7                        641 _segment_map:
      0001B7 3F                     642 	.db #0x3f	; 63
      0001B8 06                     643 	.db #0x06	; 6
      0001B9 5B                     644 	.db #0x5b	; 91
      0001BA 4F                     645 	.db #0x4f	; 79	'O'
      0001BB 66                     646 	.db #0x66	; 102	'f'
      0001BC 6D                     647 	.db #0x6d	; 109	'm'
      0001BD 7D                     648 	.db #0x7d	; 125
      0001BE 07                     649 	.db #0x07	; 7
      0001BF 7F                     650 	.db #0x7f	; 127
      0001C0 6F                     651 	.db #0x6f	; 111	'o'
      0001C1 77                     652 	.db #0x77	; 119	'w'
      0001C2 7C                     653 	.db #0x7c	; 124
      0001C3 39                     654 	.db #0x39	; 57	'9'
      0001C4 5E                     655 	.db #0x5e	; 94
      0001C5 79                     656 	.db #0x79	; 121	'y'
      0001C6 71                     657 	.db #0x71	; 113	'q'
                                    658 	.area XINIT   (CODE)
                                    659 	.area CABS    (ABS,CODE)
