                                      1 ;--------------------------------------------------------
                                      2 ; File Created by SDCC : free open source ANSI-C Compiler
                                      3 ; Version 4.2.0 #13081 (Linux)
                                      4 ;--------------------------------------------------------
                                      5 	.module lcd
                                      6 	.optsdcc -mmcs51 --model-small
                                      7 	
                                      8 ;--------------------------------------------------------
                                      9 ; Public variables in this module
                                     10 ;--------------------------------------------------------
                                     11 	.globl _cindy_crawford_helmut_newton_bitmask
                                     12 	.globl _main
                                     13 	.globl _st7920_init
                                     14 	.globl _clear_graphics
                                     15 	.globl _st7920_text
                                     16 	.globl _st7920_pos
                                     17 	.globl _st7920_data
                                     18 	.globl _st7920_command
                                     19 	.globl _st7920_byte
                                     20 	.globl _delay
                                     21 	.globl _CY
                                     22 	.globl _AC
                                     23 	.globl _F0
                                     24 	.globl _RS1
                                     25 	.globl _RS0
                                     26 	.globl _OV
                                     27 	.globl _F1
                                     28 	.globl _P
                                     29 	.globl _PS
                                     30 	.globl _PT1
                                     31 	.globl _PX1
                                     32 	.globl _PT0
                                     33 	.globl _PX0
                                     34 	.globl _RD
                                     35 	.globl _WR
                                     36 	.globl _T1
                                     37 	.globl _T0
                                     38 	.globl _INT1
                                     39 	.globl _INT0
                                     40 	.globl _TXD
                                     41 	.globl _RXD
                                     42 	.globl _P3_7
                                     43 	.globl _P3_6
                                     44 	.globl _P3_5
                                     45 	.globl _P3_4
                                     46 	.globl _P3_3
                                     47 	.globl _P3_2
                                     48 	.globl _P3_1
                                     49 	.globl _P3_0
                                     50 	.globl _EA
                                     51 	.globl _ES
                                     52 	.globl _ET1
                                     53 	.globl _EX1
                                     54 	.globl _ET0
                                     55 	.globl _EX0
                                     56 	.globl _P2_7
                                     57 	.globl _P2_6
                                     58 	.globl _P2_5
                                     59 	.globl _P2_4
                                     60 	.globl _P2_3
                                     61 	.globl _P2_2
                                     62 	.globl _P2_1
                                     63 	.globl _P2_0
                                     64 	.globl _SM0
                                     65 	.globl _SM1
                                     66 	.globl _SM2
                                     67 	.globl _REN
                                     68 	.globl _TB8
                                     69 	.globl _RB8
                                     70 	.globl _TI
                                     71 	.globl _RI
                                     72 	.globl _P1_7
                                     73 	.globl _P1_6
                                     74 	.globl _P1_5
                                     75 	.globl _P1_4
                                     76 	.globl _P1_3
                                     77 	.globl _P1_2
                                     78 	.globl _P1_1
                                     79 	.globl _P1_0
                                     80 	.globl _TF1
                                     81 	.globl _TR1
                                     82 	.globl _TF0
                                     83 	.globl _TR0
                                     84 	.globl _IE1
                                     85 	.globl _IT1
                                     86 	.globl _IE0
                                     87 	.globl _IT0
                                     88 	.globl _P0_7
                                     89 	.globl _P0_6
                                     90 	.globl _P0_5
                                     91 	.globl _P0_4
                                     92 	.globl _P0_3
                                     93 	.globl _P0_2
                                     94 	.globl _P0_1
                                     95 	.globl _P0_0
                                     96 	.globl _B
                                     97 	.globl _ACC
                                     98 	.globl _PSW
                                     99 	.globl _IP
                                    100 	.globl _P3
                                    101 	.globl _IE
                                    102 	.globl _P2
                                    103 	.globl _SBUF
                                    104 	.globl _SCON
                                    105 	.globl _P1
                                    106 	.globl _TH1
                                    107 	.globl _TH0
                                    108 	.globl _TL1
                                    109 	.globl _TL0
                                    110 	.globl _TMOD
                                    111 	.globl _TCON
                                    112 	.globl _PCON
                                    113 	.globl _DPH
                                    114 	.globl _DPL
                                    115 	.globl _SP
                                    116 	.globl _P0
                                    117 	.globl _st7920_pos_PARM_2
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
      000008                        233 _st7920_pos_PARM_2:
      000008                        234 	.ds 1
                                    235 ;--------------------------------------------------------
                                    236 ; overlayable items in internal ram
                                    237 ;--------------------------------------------------------
                                    238 	.area	OSEG    (OVR,DATA)
                                    239 	.area	OSEG    (OVR,DATA)
                                    240 ;--------------------------------------------------------
                                    241 ; Stack segment in internal ram
                                    242 ;--------------------------------------------------------
                                    243 	.area	SSEG
      000009                        244 __start__stack:
      000009                        245 	.ds	1
                                    246 
                                    247 ;--------------------------------------------------------
                                    248 ; indirectly addressable internal ram data
                                    249 ;--------------------------------------------------------
                                    250 	.area ISEG    (DATA)
                                    251 ;--------------------------------------------------------
                                    252 ; absolute internal ram data
                                    253 ;--------------------------------------------------------
                                    254 	.area IABS    (ABS,DATA)
                                    255 	.area IABS    (ABS,DATA)
                                    256 ;--------------------------------------------------------
                                    257 ; bit data
                                    258 ;--------------------------------------------------------
                                    259 	.area BSEG    (BIT)
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
      000000 02 00 06         [24]  291 	ljmp	__sdcc_gsinit_startup
                                    292 ;--------------------------------------------------------
                                    293 ; global & static initialisations
                                    294 ;--------------------------------------------------------
                                    295 	.area HOME    (CODE)
                                    296 	.area GSINIT  (CODE)
                                    297 	.area GSFINAL (CODE)
                                    298 	.area GSINIT  (CODE)
                                    299 	.globl __sdcc_gsinit_startup
                                    300 	.globl __sdcc_program_startup
                                    301 	.globl __start__stack
                                    302 	.globl __mcs51_genXINIT
                                    303 	.globl __mcs51_genXRAMCLEAR
                                    304 	.globl __mcs51_genRAMCLEAR
                                    305 	.area GSFINAL (CODE)
      00005F 02 00 03         [24]  306 	ljmp	__sdcc_program_startup
                                    307 ;--------------------------------------------------------
                                    308 ; Home
                                    309 ;--------------------------------------------------------
                                    310 	.area HOME    (CODE)
                                    311 	.area HOME    (CODE)
      000003                        312 __sdcc_program_startup:
      000003 02 01 99         [24]  313 	ljmp	_main
                                    314 ;	return from main will return to caller
                                    315 ;--------------------------------------------------------
                                    316 ; code
                                    317 ;--------------------------------------------------------
                                    318 	.area CSEG    (CODE)
                                    319 ;------------------------------------------------------------
                                    320 ;Allocation info for local variables in function 'delay'
                                    321 ;------------------------------------------------------------
                                    322 ;t                         Allocated to registers 
                                    323 ;------------------------------------------------------------
                                    324 ;	04_st7920_graph/lcd.c:32: void delay(uint16_t t) {
                                    325 ;	-----------------------------------------
                                    326 ;	 function delay
                                    327 ;	-----------------------------------------
      000062                        328 _delay:
                           000007   329 	ar7 = 0x07
                           000006   330 	ar6 = 0x06
                           000005   331 	ar5 = 0x05
                           000004   332 	ar4 = 0x04
                           000003   333 	ar3 = 0x03
                           000002   334 	ar2 = 0x02
                           000001   335 	ar1 = 0x01
                           000000   336 	ar0 = 0x00
      000062 AE 82            [24]  337 	mov	r6,dpl
      000064 AF 83            [24]  338 	mov	r7,dph
                                    339 ;	04_st7920_graph/lcd.c:33: while (t--) // Simple delay loop (more than 1us at 12MHz)
      000066                        340 00101$:
      000066 8E 04            [24]  341 	mov	ar4,r6
      000068 8F 05            [24]  342 	mov	ar5,r7
      00006A 1E               [12]  343 	dec	r6
      00006B BE FF 01         [24]  344 	cjne	r6,#0xff,00111$
      00006E 1F               [12]  345 	dec	r7
      00006F                        346 00111$:
      00006F EC               [12]  347 	mov	a,r4
      000070 4D               [12]  348 	orl	a,r5
      000071 70 F3            [24]  349 	jnz	00101$
                                    350 ;	04_st7920_graph/lcd.c:35: }
      000073 22               [24]  351 	ret
                                    352 ;------------------------------------------------------------
                                    353 ;Allocation info for local variables in function 'st7920_byte'
                                    354 ;------------------------------------------------------------
                                    355 ;d                         Allocated to registers r7 
                                    356 ;i                         Allocated to registers r6 
                                    357 ;------------------------------------------------------------
                                    358 ;	04_st7920_graph/lcd.c:37: void st7920_byte(uint8_t d) {
                                    359 ;	-----------------------------------------
                                    360 ;	 function st7920_byte
                                    361 ;	-----------------------------------------
      000074                        362 _st7920_byte:
      000074 AF 82            [24]  363 	mov	r7,dpl
                                    364 ;	04_st7920_graph/lcd.c:38: for(uint8_t i = 0; i < 8; i++) { // MSB first
      000076 7E 00            [12]  365 	mov	r6,#0x00
      000078                        366 00103$:
      000078 BE 08 00         [24]  367 	cjne	r6,#0x08,00116$
      00007B                        368 00116$:
      00007B 50 14            [24]  369 	jnc	00101$
                                    370 ;	04_st7920_graph/lcd.c:39: ST7920_SCLK = 0; // Toggle bits on rising edge
                                    371 ;	assignBit
      00007D C2 A7            [12]  372 	clr	_P2_7
                                    373 ;	04_st7920_graph/lcd.c:40: ST7920_SID = d & 0x80;
      00007F EF               [12]  374 	mov	a,r7
      000080 23               [12]  375 	rl	a
      000081 54 01            [12]  376 	anl	a,#0x01
                                    377 ;	assignBit
      000083 24 FF            [12]  378 	add	a,#0xff
      000085 92 A5            [24]  379 	mov	_P2_5,c
                                    380 ;	04_st7920_graph/lcd.c:41: d <<= 1;
      000087 8F 05            [24]  381 	mov	ar5,r7
      000089 ED               [12]  382 	mov	a,r5
      00008A 2D               [12]  383 	add	a,r5
      00008B FF               [12]  384 	mov	r7,a
                                    385 ;	04_st7920_graph/lcd.c:42: ST7920_SCLK = 1; // Reset state
                                    386 ;	assignBit
      00008C D2 A7            [12]  387 	setb	_P2_7
                                    388 ;	04_st7920_graph/lcd.c:38: for(uint8_t i = 0; i < 8; i++) { // MSB first
      00008E 0E               [12]  389 	inc	r6
      00008F 80 E7            [24]  390 	sjmp	00103$
      000091                        391 00101$:
                                    392 ;	04_st7920_graph/lcd.c:44: ST7920_SCLK = 0; // Reset state
                                    393 ;	assignBit
      000091 C2 A7            [12]  394 	clr	_P2_7
                                    395 ;	04_st7920_graph/lcd.c:45: }
      000093 22               [24]  396 	ret
                                    397 ;------------------------------------------------------------
                                    398 ;Allocation info for local variables in function 'st7920_command'
                                    399 ;------------------------------------------------------------
                                    400 ;cmd                       Allocated to registers r7 
                                    401 ;------------------------------------------------------------
                                    402 ;	04_st7920_graph/lcd.c:47: void st7920_command(uint8_t cmd) {
                                    403 ;	-----------------------------------------
                                    404 ;	 function st7920_command
                                    405 ;	-----------------------------------------
      000094                        406 _st7920_command:
      000094 AF 82            [24]  407 	mov	r7,dpl
                                    408 ;	04_st7920_graph/lcd.c:48: ST7920_CS = 1;
                                    409 ;	assignBit
      000096 D2 A6            [12]  410 	setb	_P2_6
                                    411 ;	04_st7920_graph/lcd.c:49: st7920_byte(0b11111000);
      000098 75 82 F8         [24]  412 	mov	dpl,#0xf8
      00009B C0 07            [24]  413 	push	ar7
      00009D 12 00 74         [24]  414 	lcall	_st7920_byte
      0000A0 D0 07            [24]  415 	pop	ar7
                                    416 ;	04_st7920_graph/lcd.c:52: st7920_byte(0xF0 & cmd);        // high nibble
      0000A2 74 F0            [12]  417 	mov	a,#0xf0
      0000A4 5F               [12]  418 	anl	a,r7
      0000A5 F5 82            [12]  419 	mov	dpl,a
      0000A7 C0 07            [24]  420 	push	ar7
      0000A9 12 00 74         [24]  421 	lcall	_st7920_byte
      0000AC D0 07            [24]  422 	pop	ar7
                                    423 ;	04_st7920_graph/lcd.c:53: st7920_byte(0xF0 & (cmd << 4)); // low nibble
      0000AE EF               [12]  424 	mov	a,r7
      0000AF C4               [12]  425 	swap	a
      0000B0 54 F0            [12]  426 	anl	a,#0xf0
      0000B2 FF               [12]  427 	mov	r7,a
      0000B3 74 F0            [12]  428 	mov	a,#0xf0
      0000B5 5F               [12]  429 	anl	a,r7
      0000B6 F5 82            [12]  430 	mov	dpl,a
      0000B8 12 00 74         [24]  431 	lcall	_st7920_byte
                                    432 ;	04_st7920_graph/lcd.c:54: ST7920_CS = 0;
                                    433 ;	assignBit
      0000BB C2 A6            [12]  434 	clr	_P2_6
                                    435 ;	04_st7920_graph/lcd.c:55: }
      0000BD 22               [24]  436 	ret
                                    437 ;------------------------------------------------------------
                                    438 ;Allocation info for local variables in function 'st7920_data'
                                    439 ;------------------------------------------------------------
                                    440 ;data                      Allocated to registers r7 
                                    441 ;------------------------------------------------------------
                                    442 ;	04_st7920_graph/lcd.c:57: void st7920_data(uint8_t data) {
                                    443 ;	-----------------------------------------
                                    444 ;	 function st7920_data
                                    445 ;	-----------------------------------------
      0000BE                        446 _st7920_data:
      0000BE AF 82            [24]  447 	mov	r7,dpl
                                    448 ;	04_st7920_graph/lcd.c:58: ST7920_CS = 1;
                                    449 ;	assignBit
      0000C0 D2 A6            [12]  450 	setb	_P2_6
                                    451 ;	04_st7920_graph/lcd.c:59: st7920_byte(0b11111010);
      0000C2 75 82 FA         [24]  452 	mov	dpl,#0xfa
      0000C5 C0 07            [24]  453 	push	ar7
      0000C7 12 00 74         [24]  454 	lcall	_st7920_byte
      0000CA D0 07            [24]  455 	pop	ar7
                                    456 ;	04_st7920_graph/lcd.c:62: st7920_byte(0xF0 & data);        // high nibble
      0000CC 74 F0            [12]  457 	mov	a,#0xf0
      0000CE 5F               [12]  458 	anl	a,r7
      0000CF F5 82            [12]  459 	mov	dpl,a
      0000D1 C0 07            [24]  460 	push	ar7
      0000D3 12 00 74         [24]  461 	lcall	_st7920_byte
      0000D6 D0 07            [24]  462 	pop	ar7
                                    463 ;	04_st7920_graph/lcd.c:63: st7920_byte(0xF0 & (data << 4)); // low nibble
      0000D8 EF               [12]  464 	mov	a,r7
      0000D9 C4               [12]  465 	swap	a
      0000DA 54 F0            [12]  466 	anl	a,#0xf0
      0000DC FF               [12]  467 	mov	r7,a
      0000DD 74 F0            [12]  468 	mov	a,#0xf0
      0000DF 5F               [12]  469 	anl	a,r7
      0000E0 F5 82            [12]  470 	mov	dpl,a
      0000E2 12 00 74         [24]  471 	lcall	_st7920_byte
                                    472 ;	04_st7920_graph/lcd.c:64: ST7920_CS = 0;
                                    473 ;	assignBit
      0000E5 C2 A6            [12]  474 	clr	_P2_6
                                    475 ;	04_st7920_graph/lcd.c:65: }
      0000E7 22               [24]  476 	ret
                                    477 ;------------------------------------------------------------
                                    478 ;Allocation info for local variables in function 'st7920_pos'
                                    479 ;------------------------------------------------------------
                                    480 ;y                         Allocated with name '_st7920_pos_PARM_2'
                                    481 ;x                         Allocated to registers r7 
                                    482 ;------------------------------------------------------------
                                    483 ;	04_st7920_graph/lcd.c:80: void st7920_pos(uint8_t x, uint8_t y) {
                                    484 ;	-----------------------------------------
                                    485 ;	 function st7920_pos
                                    486 ;	-----------------------------------------
      0000E8                        487 _st7920_pos:
      0000E8 AF 82            [24]  488 	mov	r7,dpl
                                    489 ;	04_st7920_graph/lcd.c:81: if(y >= 32) { // Wrap around for 128x64 mode
      0000EA 74 E0            [12]  490 	mov	a,#0x100 - 0x20
      0000EC 25 08            [12]  491 	add	a,_st7920_pos_PARM_2
      0000EE 50 0D            [24]  492 	jnc	00102$
                                    493 ;	04_st7920_graph/lcd.c:82: x += 8;
      0000F0 8F 06            [24]  494 	mov	ar6,r7
      0000F2 74 08            [12]  495 	mov	a,#0x08
      0000F4 2E               [12]  496 	add	a,r6
      0000F5 FF               [12]  497 	mov	r7,a
                                    498 ;	04_st7920_graph/lcd.c:83: y -= 32;
      0000F6 E5 08            [12]  499 	mov	a,_st7920_pos_PARM_2
      0000F8 FE               [12]  500 	mov	r6,a
      0000F9 24 E0            [12]  501 	add	a,#0xe0
      0000FB F5 08            [12]  502 	mov	_st7920_pos_PARM_2,a
      0000FD                        503 00102$:
                                    504 ;	04_st7920_graph/lcd.c:85: st7920_command(ST7920_ADDR | (y & 0x3F)); // Set GDRAM Y address
      0000FD E5 08            [12]  505 	mov	a,_st7920_pos_PARM_2
      0000FF 54 3F            [12]  506 	anl	a,#0x3f
      000101 44 80            [12]  507 	orl	a,#0x80
      000103 F5 82            [12]  508 	mov	dpl,a
      000105 C0 07            [24]  509 	push	ar7
      000107 12 00 94         [24]  510 	lcall	_st7920_command
      00010A D0 07            [24]  511 	pop	ar7
                                    512 ;	04_st7920_graph/lcd.c:86: st7920_command(ST7920_ADDR | (x & 0x0F)); // Set GDRAM X address
      00010C 74 0F            [12]  513 	mov	a,#0x0f
      00010E 5F               [12]  514 	anl	a,r7
      00010F 44 80            [12]  515 	orl	a,#0x80
      000111 F5 82            [12]  516 	mov	dpl,a
                                    517 ;	04_st7920_graph/lcd.c:87: }
      000113 02 00 94         [24]  518 	ljmp	_st7920_command
                                    519 ;------------------------------------------------------------
                                    520 ;Allocation info for local variables in function 'st7920_text'
                                    521 ;------------------------------------------------------------
                                    522 ;str                       Allocated to registers 
                                    523 ;------------------------------------------------------------
                                    524 ;	04_st7920_graph/lcd.c:89: void st7920_text(const char* str) {
                                    525 ;	-----------------------------------------
                                    526 ;	 function st7920_text
                                    527 ;	-----------------------------------------
      000116                        528 _st7920_text:
      000116 AD 82            [24]  529 	mov	r5,dpl
      000118 AE 83            [24]  530 	mov	r6,dph
      00011A AF F0            [24]  531 	mov	r7,b
                                    532 ;	04_st7920_graph/lcd.c:90: while (*str) {
      00011C                        533 00101$:
      00011C 8D 82            [24]  534 	mov	dpl,r5
      00011E 8E 83            [24]  535 	mov	dph,r6
      000120 8F F0            [24]  536 	mov	b,r7
      000122 12 02 21         [24]  537 	lcall	__gptrget
      000125 FC               [12]  538 	mov	r4,a
      000126 60 18            [24]  539 	jz	00104$
                                    540 ;	04_st7920_graph/lcd.c:91: st7920_data((uint8_t)(*str));
      000128 8C 82            [24]  541 	mov	dpl,r4
      00012A C0 07            [24]  542 	push	ar7
      00012C C0 06            [24]  543 	push	ar6
      00012E C0 05            [24]  544 	push	ar5
      000130 12 00 BE         [24]  545 	lcall	_st7920_data
      000133 D0 05            [24]  546 	pop	ar5
      000135 D0 06            [24]  547 	pop	ar6
      000137 D0 07            [24]  548 	pop	ar7
                                    549 ;	04_st7920_graph/lcd.c:92: str++;
      000139 0D               [12]  550 	inc	r5
      00013A BD 00 DF         [24]  551 	cjne	r5,#0x00,00101$
      00013D 0E               [12]  552 	inc	r6
      00013E 80 DC            [24]  553 	sjmp	00101$
      000140                        554 00104$:
                                    555 ;	04_st7920_graph/lcd.c:94: }
      000140 22               [24]  556 	ret
                                    557 ;------------------------------------------------------------
                                    558 ;Allocation info for local variables in function 'clear_graphics'
                                    559 ;------------------------------------------------------------
                                    560 ;row                       Allocated to registers r7 
                                    561 ;col                       Allocated to registers r6 
                                    562 ;------------------------------------------------------------
                                    563 ;	04_st7920_graph/lcd.c:96: void clear_graphics(void) {
                                    564 ;	-----------------------------------------
                                    565 ;	 function clear_graphics
                                    566 ;	-----------------------------------------
      000141                        567 _clear_graphics:
                                    568 ;	04_st7920_graph/lcd.c:97: for(uint8_t row = 0; row < 64; row++) {
      000141 7F 00            [12]  569 	mov	r7,#0x00
      000143                        570 00107$:
      000143 BF 40 00         [24]  571 	cjne	r7,#0x40,00129$
      000146                        572 00129$:
      000146 50 2D            [24]  573 	jnc	00109$
                                    574 ;	04_st7920_graph/lcd.c:98: st7920_pos(0,row);
      000148 8F 08            [24]  575 	mov	_st7920_pos_PARM_2,r7
      00014A 75 82 00         [24]  576 	mov	dpl,#0x00
      00014D C0 07            [24]  577 	push	ar7
      00014F 12 00 E8         [24]  578 	lcall	_st7920_pos
      000152 D0 07            [24]  579 	pop	ar7
                                    580 ;	04_st7920_graph/lcd.c:99: for(uint8_t col = 0; col < 8; col++) {
      000154 7E 00            [12]  581 	mov	r6,#0x00
      000156                        582 00104$:
      000156 BE 08 00         [24]  583 	cjne	r6,#0x08,00131$
      000159                        584 00131$:
      000159 50 17            [24]  585 	jnc	00108$
                                    586 ;	04_st7920_graph/lcd.c:100: st7920_data(0x00);
      00015B 75 82 00         [24]  587 	mov	dpl,#0x00
      00015E C0 07            [24]  588 	push	ar7
      000160 C0 06            [24]  589 	push	ar6
      000162 12 00 BE         [24]  590 	lcall	_st7920_data
                                    591 ;	04_st7920_graph/lcd.c:101: st7920_data(0x00);
      000165 75 82 00         [24]  592 	mov	dpl,#0x00
      000168 12 00 BE         [24]  593 	lcall	_st7920_data
      00016B D0 06            [24]  594 	pop	ar6
      00016D D0 07            [24]  595 	pop	ar7
                                    596 ;	04_st7920_graph/lcd.c:99: for(uint8_t col = 0; col < 8; col++) {
      00016F 0E               [12]  597 	inc	r6
      000170 80 E4            [24]  598 	sjmp	00104$
      000172                        599 00108$:
                                    600 ;	04_st7920_graph/lcd.c:97: for(uint8_t row = 0; row < 64; row++) {
      000172 0F               [12]  601 	inc	r7
      000173 80 CE            [24]  602 	sjmp	00107$
      000175                        603 00109$:
                                    604 ;	04_st7920_graph/lcd.c:104: }
      000175 22               [24]  605 	ret
                                    606 ;------------------------------------------------------------
                                    607 ;Allocation info for local variables in function 'st7920_init'
                                    608 ;------------------------------------------------------------
                                    609 ;	04_st7920_graph/lcd.c:106: void st7920_init() { // Figure 8-bit interface from ST7920 datasheet
                                    610 ;	-----------------------------------------
                                    611 ;	 function st7920_init
                                    612 ;	-----------------------------------------
      000176                        613 _st7920_init:
                                    614 ;	04_st7920_graph/lcd.c:107: ST7920_SCLK = 0; // Reset state
                                    615 ;	assignBit
      000176 C2 A7            [12]  616 	clr	_P2_7
                                    617 ;	04_st7920_graph/lcd.c:108: ST7920_RST = 0; // Force reset
                                    618 ;	assignBit
      000178 C2 B4            [12]  619 	clr	_P3_4
                                    620 ;	04_st7920_graph/lcd.c:109: ST7920_CS = 0;  // Defined state
                                    621 ;	assignBit
      00017A C2 A6            [12]  622 	clr	_P2_6
                                    623 ;	04_st7920_graph/lcd.c:110: delay(40000);
      00017C 90 9C 40         [24]  624 	mov	dptr,#0x9c40
      00017F 12 00 62         [24]  625 	lcall	_delay
                                    626 ;	04_st7920_graph/lcd.c:111: ST7920_RST = 1;
                                    627 ;	assignBit
      000182 D2 B4            [12]  628 	setb	_P3_4
                                    629 ;	04_st7920_graph/lcd.c:112: delay(40000); // Wait for more than 40ms after Vcc rises to 4.5V
      000184 90 9C 40         [24]  630 	mov	dptr,#0x9c40
      000187 12 00 62         [24]  631 	lcall	_delay
                                    632 ;	04_st7920_graph/lcd.c:113: st7920_command(ST7920_EXTENDED_MODE); // Extended mode to make GDRAM accessible
      00018A 75 82 34         [24]  633 	mov	dpl,#0x34
      00018D 12 00 94         [24]  634 	lcall	_st7920_command
                                    635 ;	04_st7920_graph/lcd.c:114: clear_graphics();                     // Clear graphics RAM
      000190 12 01 41         [24]  636 	lcall	_clear_graphics
                                    637 ;	04_st7920_graph/lcd.c:115: st7920_command(ST7920_GRAPHICS_MODE); // Enable GRAM mapping
      000193 75 82 36         [24]  638 	mov	dpl,#0x36
                                    639 ;	04_st7920_graph/lcd.c:116: }
      000196 02 00 94         [24]  640 	ljmp	_st7920_command
                                    641 ;------------------------------------------------------------
                                    642 ;Allocation info for local variables in function 'main'
                                    643 ;------------------------------------------------------------
                                    644 ;row                       Allocated to registers r7 
                                    645 ;col                       Allocated to registers r6 
                                    646 ;------------------------------------------------------------
                                    647 ;	04_st7920_graph/lcd.c:118: void main(void) {
                                    648 ;	-----------------------------------------
                                    649 ;	 function main
                                    650 ;	-----------------------------------------
      000199                        651 _main:
                                    652 ;	04_st7920_graph/lcd.c:119: st7920_init();
      000199 12 01 76         [24]  653 	lcall	_st7920_init
                                    654 ;	04_st7920_graph/lcd.c:122: for(uint8_t row = 0; row < 64; row++) {
      00019C 7F 00            [12]  655 	mov	r7,#0x00
      00019E                        656 00108$:
      00019E BF 40 00         [24]  657 	cjne	r7,#0x40,00136$
      0001A1                        658 00136$:
      0001A1 40 03            [24]  659 	jc	00137$
      0001A3 02 02 1F         [24]  660 	ljmp	00111$
      0001A6                        661 00137$:
                                    662 ;	04_st7920_graph/lcd.c:123: st7920_pos(0, row);
      0001A6 8F 08            [24]  663 	mov	_st7920_pos_PARM_2,r7
      0001A8 75 82 00         [24]  664 	mov	dpl,#0x00
      0001AB C0 07            [24]  665 	push	ar7
      0001AD 12 00 E8         [24]  666 	lcall	_st7920_pos
      0001B0 D0 07            [24]  667 	pop	ar7
                                    668 ;	04_st7920_graph/lcd.c:124: for(uint8_t col = 0; col < 8; col++) {
      0001B2 7E 00            [12]  669 	mov	r6,#0x00
      0001B4                        670 00105$:
      0001B4 BE 08 00         [24]  671 	cjne	r6,#0x08,00138$
      0001B7                        672 00138$:
      0001B7 50 62            [24]  673 	jnc	00109$
                                    674 ;	04_st7920_graph/lcd.c:125: st7920_data(cindy_crawford_helmut_newton_bitmask[row * 16 + col * 2]);
      0001B9 8F 04            [24]  675 	mov	ar4,r7
      0001BB E4               [12]  676 	clr	a
      0001BC C4               [12]  677 	swap	a
      0001BD 54 F0            [12]  678 	anl	a,#0xf0
      0001BF CC               [12]  679 	xch	a,r4
      0001C0 C4               [12]  680 	swap	a
      0001C1 CC               [12]  681 	xch	a,r4
      0001C2 6C               [12]  682 	xrl	a,r4
      0001C3 CC               [12]  683 	xch	a,r4
      0001C4 54 F0            [12]  684 	anl	a,#0xf0
      0001C6 CC               [12]  685 	xch	a,r4
      0001C7 6C               [12]  686 	xrl	a,r4
      0001C8 FD               [12]  687 	mov	r5,a
      0001C9 8E 02            [24]  688 	mov	ar2,r6
      0001CB 7B 00            [12]  689 	mov	r3,#0x00
      0001CD EA               [12]  690 	mov	a,r2
      0001CE 2A               [12]  691 	add	a,r2
      0001CF FA               [12]  692 	mov	r2,a
      0001D0 EB               [12]  693 	mov	a,r3
      0001D1 33               [12]  694 	rlc	a
      0001D2 FB               [12]  695 	mov	r3,a
      0001D3 EA               [12]  696 	mov	a,r2
      0001D4 2C               [12]  697 	add	a,r4
      0001D5 FC               [12]  698 	mov	r4,a
      0001D6 EB               [12]  699 	mov	a,r3
      0001D7 3D               [12]  700 	addc	a,r5
      0001D8 FD               [12]  701 	mov	r5,a
      0001D9 EC               [12]  702 	mov	a,r4
      0001DA 24 41            [12]  703 	add	a,#_cindy_crawford_helmut_newton_bitmask
      0001DC F5 82            [12]  704 	mov	dpl,a
      0001DE ED               [12]  705 	mov	a,r5
      0001DF 34 02            [12]  706 	addc	a,#(_cindy_crawford_helmut_newton_bitmask >> 8)
      0001E1 F5 83            [12]  707 	mov	dph,a
      0001E3 E4               [12]  708 	clr	a
      0001E4 93               [24]  709 	movc	a,@a+dptr
      0001E5 F5 82            [12]  710 	mov	dpl,a
      0001E7 C0 07            [24]  711 	push	ar7
      0001E9 C0 06            [24]  712 	push	ar6
      0001EB C0 05            [24]  713 	push	ar5
      0001ED C0 04            [24]  714 	push	ar4
      0001EF 12 00 BE         [24]  715 	lcall	_st7920_data
      0001F2 D0 04            [24]  716 	pop	ar4
      0001F4 D0 05            [24]  717 	pop	ar5
      0001F6 D0 06            [24]  718 	pop	ar6
      0001F8 D0 07            [24]  719 	pop	ar7
                                    720 ;	04_st7920_graph/lcd.c:126: st7920_data(cindy_crawford_helmut_newton_bitmask[row * 16 + col * 2 + 1]);
      0001FA 0C               [12]  721 	inc	r4
      0001FB BC 00 01         [24]  722 	cjne	r4,#0x00,00140$
      0001FE 0D               [12]  723 	inc	r5
      0001FF                        724 00140$:
      0001FF EC               [12]  725 	mov	a,r4
      000200 24 41            [12]  726 	add	a,#_cindy_crawford_helmut_newton_bitmask
      000202 F5 82            [12]  727 	mov	dpl,a
      000204 ED               [12]  728 	mov	a,r5
      000205 34 02            [12]  729 	addc	a,#(_cindy_crawford_helmut_newton_bitmask >> 8)
      000207 F5 83            [12]  730 	mov	dph,a
      000209 E4               [12]  731 	clr	a
      00020A 93               [24]  732 	movc	a,@a+dptr
      00020B F5 82            [12]  733 	mov	dpl,a
      00020D C0 07            [24]  734 	push	ar7
      00020F C0 06            [24]  735 	push	ar6
      000211 12 00 BE         [24]  736 	lcall	_st7920_data
      000214 D0 06            [24]  737 	pop	ar6
      000216 D0 07            [24]  738 	pop	ar7
                                    739 ;	04_st7920_graph/lcd.c:124: for(uint8_t col = 0; col < 8; col++) {
      000218 0E               [12]  740 	inc	r6
      000219 80 99            [24]  741 	sjmp	00105$
      00021B                        742 00109$:
                                    743 ;	04_st7920_graph/lcd.c:122: for(uint8_t row = 0; row < 64; row++) {
      00021B 0F               [12]  744 	inc	r7
      00021C 02 01 9E         [24]  745 	ljmp	00108$
      00021F                        746 00111$:
                                    747 ;	04_st7920_graph/lcd.c:146: }
      00021F 80 FE            [24]  748 	sjmp	00111$
                                    749 	.area CSEG    (CODE)
                                    750 	.area CONST   (CODE)
      000241                        751 _cindy_crawford_helmut_newton_bitmask:
      000241 00                     752 	.db #0x00	; 0
      000242 00                     753 	.db #0x00	; 0
      000243 00                     754 	.db #0x00	; 0
      000244 00                     755 	.db #0x00	; 0
      000245 00                     756 	.db #0x00	; 0
      000246 00                     757 	.db #0x00	; 0
      000247 00                     758 	.db #0x00	; 0
      000248 00                     759 	.db #0x00	; 0
      000249 00                     760 	.db #0x00	; 0
      00024A 00                     761 	.db #0x00	; 0
      00024B 00                     762 	.db #0x00	; 0
      00024C 00                     763 	.db #0x00	; 0
      00024D 00                     764 	.db #0x00	; 0
      00024E 00                     765 	.db #0x00	; 0
      00024F 00                     766 	.db #0x00	; 0
      000250 00                     767 	.db #0x00	; 0
      000251 00                     768 	.db #0x00	; 0
      000252 00                     769 	.db #0x00	; 0
      000253 00                     770 	.db #0x00	; 0
      000254 00                     771 	.db #0x00	; 0
      000255 00                     772 	.db #0x00	; 0
      000256 00                     773 	.db #0x00	; 0
      000257 00                     774 	.db #0x00	; 0
      000258 00                     775 	.db #0x00	; 0
      000259 00                     776 	.db #0x00	; 0
      00025A 00                     777 	.db #0x00	; 0
      00025B 00                     778 	.db #0x00	; 0
      00025C 00                     779 	.db #0x00	; 0
      00025D 00                     780 	.db #0x00	; 0
      00025E 00                     781 	.db #0x00	; 0
      00025F 00                     782 	.db #0x00	; 0
      000260 00                     783 	.db #0x00	; 0
      000261 00                     784 	.db #0x00	; 0
      000262 00                     785 	.db #0x00	; 0
      000263 00                     786 	.db #0x00	; 0
      000264 00                     787 	.db #0x00	; 0
      000265 00                     788 	.db #0x00	; 0
      000266 00                     789 	.db #0x00	; 0
      000267 00                     790 	.db #0x00	; 0
      000268 00                     791 	.db #0x00	; 0
      000269 00                     792 	.db #0x00	; 0
      00026A 00                     793 	.db #0x00	; 0
      00026B 00                     794 	.db #0x00	; 0
      00026C 10                     795 	.db #0x10	; 16
      00026D 08                     796 	.db #0x08	; 8
      00026E 00                     797 	.db #0x00	; 0
      00026F 00                     798 	.db #0x00	; 0
      000270 00                     799 	.db #0x00	; 0
      000271 00                     800 	.db #0x00	; 0
      000272 00                     801 	.db #0x00	; 0
      000273 00                     802 	.db #0x00	; 0
      000274 00                     803 	.db #0x00	; 0
      000275 00                     804 	.db #0x00	; 0
      000276 00                     805 	.db #0x00	; 0
      000277 00                     806 	.db #0x00	; 0
      000278 00                     807 	.db #0x00	; 0
      000279 00                     808 	.db #0x00	; 0
      00027A 00                     809 	.db #0x00	; 0
      00027B 00                     810 	.db #0x00	; 0
      00027C 10                     811 	.db #0x10	; 16
      00027D 08                     812 	.db #0x08	; 8
      00027E 00                     813 	.db #0x00	; 0
      00027F 00                     814 	.db #0x00	; 0
      000280 00                     815 	.db #0x00	; 0
      000281 00                     816 	.db #0x00	; 0
      000282 00                     817 	.db #0x00	; 0
      000283 00                     818 	.db #0x00	; 0
      000284 00                     819 	.db #0x00	; 0
      000285 00                     820 	.db #0x00	; 0
      000286 00                     821 	.db #0x00	; 0
      000287 00                     822 	.db #0x00	; 0
      000288 00                     823 	.db #0x00	; 0
      000289 00                     824 	.db #0x00	; 0
      00028A 00                     825 	.db #0x00	; 0
      00028B 00                     826 	.db #0x00	; 0
      00028C 08                     827 	.db #0x08	; 8
      00028D 10                     828 	.db #0x10	; 16
      00028E 00                     829 	.db #0x00	; 0
      00028F 00                     830 	.db #0x00	; 0
      000290 00                     831 	.db #0x00	; 0
      000291 00                     832 	.db #0x00	; 0
      000292 00                     833 	.db #0x00	; 0
      000293 00                     834 	.db #0x00	; 0
      000294 00                     835 	.db #0x00	; 0
      000295 00                     836 	.db #0x00	; 0
      000296 00                     837 	.db #0x00	; 0
      000297 00                     838 	.db #0x00	; 0
      000298 00                     839 	.db #0x00	; 0
      000299 00                     840 	.db #0x00	; 0
      00029A 00                     841 	.db #0x00	; 0
      00029B 00                     842 	.db #0x00	; 0
      00029C 0C                     843 	.db #0x0c	; 12
      00029D 18                     844 	.db #0x18	; 24
      00029E 00                     845 	.db #0x00	; 0
      00029F 00                     846 	.db #0x00	; 0
      0002A0 00                     847 	.db #0x00	; 0
      0002A1 00                     848 	.db #0x00	; 0
      0002A2 00                     849 	.db #0x00	; 0
      0002A3 00                     850 	.db #0x00	; 0
      0002A4 00                     851 	.db #0x00	; 0
      0002A5 00                     852 	.db #0x00	; 0
      0002A6 00                     853 	.db #0x00	; 0
      0002A7 00                     854 	.db #0x00	; 0
      0002A8 00                     855 	.db #0x00	; 0
      0002A9 00                     856 	.db #0x00	; 0
      0002AA 00                     857 	.db #0x00	; 0
      0002AB 00                     858 	.db #0x00	; 0
      0002AC 0D                     859 	.db #0x0d	; 13
      0002AD F0                     860 	.db #0xf0	; 240
      0002AE 00                     861 	.db #0x00	; 0
      0002AF 00                     862 	.db #0x00	; 0
      0002B0 00                     863 	.db #0x00	; 0
      0002B1 00                     864 	.db #0x00	; 0
      0002B2 00                     865 	.db #0x00	; 0
      0002B3 00                     866 	.db #0x00	; 0
      0002B4 00                     867 	.db #0x00	; 0
      0002B5 00                     868 	.db #0x00	; 0
      0002B6 00                     869 	.db #0x00	; 0
      0002B7 00                     870 	.db #0x00	; 0
      0002B8 00                     871 	.db #0x00	; 0
      0002B9 00                     872 	.db #0x00	; 0
      0002BA 00                     873 	.db #0x00	; 0
      0002BB 00                     874 	.db #0x00	; 0
      0002BC 0F                     875 	.db #0x0f	; 15
      0002BD F8                     876 	.db #0xf8	; 248
      0002BE 00                     877 	.db #0x00	; 0
      0002BF 00                     878 	.db #0x00	; 0
      0002C0 00                     879 	.db #0x00	; 0
      0002C1 00                     880 	.db #0x00	; 0
      0002C2 00                     881 	.db #0x00	; 0
      0002C3 00                     882 	.db #0x00	; 0
      0002C4 00                     883 	.db #0x00	; 0
      0002C5 00                     884 	.db #0x00	; 0
      0002C6 00                     885 	.db #0x00	; 0
      0002C7 00                     886 	.db #0x00	; 0
      0002C8 00                     887 	.db #0x00	; 0
      0002C9 00                     888 	.db #0x00	; 0
      0002CA 00                     889 	.db #0x00	; 0
      0002CB 00                     890 	.db #0x00	; 0
      0002CC 0F                     891 	.db #0x0f	; 15
      0002CD FC                     892 	.db #0xfc	; 252
      0002CE 00                     893 	.db #0x00	; 0
      0002CF 00                     894 	.db #0x00	; 0
      0002D0 00                     895 	.db #0x00	; 0
      0002D1 08                     896 	.db #0x08	; 8
      0002D2 00                     897 	.db #0x00	; 0
      0002D3 00                     898 	.db #0x00	; 0
      0002D4 00                     899 	.db #0x00	; 0
      0002D5 00                     900 	.db #0x00	; 0
      0002D6 00                     901 	.db #0x00	; 0
      0002D7 00                     902 	.db #0x00	; 0
      0002D8 00                     903 	.db #0x00	; 0
      0002D9 00                     904 	.db #0x00	; 0
      0002DA 00                     905 	.db #0x00	; 0
      0002DB 00                     906 	.db #0x00	; 0
      0002DC 0F                     907 	.db #0x0f	; 15
      0002DD FC                     908 	.db #0xfc	; 252
      0002DE 00                     909 	.db #0x00	; 0
      0002DF 00                     910 	.db #0x00	; 0
      0002E0 00                     911 	.db #0x00	; 0
      0002E1 7A                     912 	.db #0x7a	; 122	'z'
      0002E2 00                     913 	.db #0x00	; 0
      0002E3 00                     914 	.db #0x00	; 0
      0002E4 00                     915 	.db #0x00	; 0
      0002E5 00                     916 	.db #0x00	; 0
      0002E6 00                     917 	.db #0x00	; 0
      0002E7 00                     918 	.db #0x00	; 0
      0002E8 00                     919 	.db #0x00	; 0
      0002E9 00                     920 	.db #0x00	; 0
      0002EA 00                     921 	.db #0x00	; 0
      0002EB 00                     922 	.db #0x00	; 0
      0002EC 0E                     923 	.db #0x0e	; 14
      0002ED 78                     924 	.db #0x78	; 120	'x'
      0002EE 00                     925 	.db #0x00	; 0
      0002EF 00                     926 	.db #0x00	; 0
      0002F0 00                     927 	.db #0x00	; 0
      0002F1 7A                     928 	.db #0x7a	; 122	'z'
      0002F2 80                     929 	.db #0x80	; 128
      0002F3 00                     930 	.db #0x00	; 0
      0002F4 00                     931 	.db #0x00	; 0
      0002F5 00                     932 	.db #0x00	; 0
      0002F6 00                     933 	.db #0x00	; 0
      0002F7 00                     934 	.db #0x00	; 0
      0002F8 00                     935 	.db #0x00	; 0
      0002F9 00                     936 	.db #0x00	; 0
      0002FA 00                     937 	.db #0x00	; 0
      0002FB 00                     938 	.db #0x00	; 0
      0002FC 0F                     939 	.db #0x0f	; 15
      0002FD 6C                     940 	.db #0x6c	; 108	'l'
      0002FE 00                     941 	.db #0x00	; 0
      0002FF 00                     942 	.db #0x00	; 0
      000300 00                     943 	.db #0x00	; 0
      000301 FD                     944 	.db #0xfd	; 253
      000302 F0                     945 	.db #0xf0	; 240
      000303 00                     946 	.db #0x00	; 0
      000304 00                     947 	.db #0x00	; 0
      000305 00                     948 	.db #0x00	; 0
      000306 00                     949 	.db #0x00	; 0
      000307 00                     950 	.db #0x00	; 0
      000308 00                     951 	.db #0x00	; 0
      000309 00                     952 	.db #0x00	; 0
      00030A 00                     953 	.db #0x00	; 0
      00030B 00                     954 	.db #0x00	; 0
      00030C 0E                     955 	.db #0x0e	; 14
      00030D B8                     956 	.db #0xb8	; 184
      00030E 00                     957 	.db #0x00	; 0
      00030F 00                     958 	.db #0x00	; 0
      000310 00                     959 	.db #0x00	; 0
      000311 BD                     960 	.db #0xbd	; 189
      000312 70                     961 	.db #0x70	; 112	'p'
      000313 70                     962 	.db #0x70	; 112	'p'
      000314 00                     963 	.db #0x00	; 0
      000315 00                     964 	.db #0x00	; 0
      000316 00                     965 	.db #0x00	; 0
      000317 00                     966 	.db #0x00	; 0
      000318 00                     967 	.db #0x00	; 0
      000319 00                     968 	.db #0x00	; 0
      00031A 00                     969 	.db #0x00	; 0
      00031B 00                     970 	.db #0x00	; 0
      00031C 0F                     971 	.db #0x0f	; 15
      00031D 48                     972 	.db #0x48	; 72	'H'
      00031E 00                     973 	.db #0x00	; 0
      00031F 00                     974 	.db #0x00	; 0
      000320 00                     975 	.db #0x00	; 0
      000321 FF                     976 	.db #0xff	; 255
      000322 F5                     977 	.db #0xf5	; 245
      000323 E5                     978 	.db #0xe5	; 229
      000324 54                     979 	.db #0x54	; 84	'T'
      000325 00                     980 	.db #0x00	; 0
      000326 00                     981 	.db #0x00	; 0
      000327 00                     982 	.db #0x00	; 0
      000328 00                     983 	.db #0x00	; 0
      000329 00                     984 	.db #0x00	; 0
      00032A 00                     985 	.db #0x00	; 0
      00032B 00                     986 	.db #0x00	; 0
      00032C 1F                     987 	.db #0x1f	; 31
      00032D D8                     988 	.db #0xd8	; 216
      00032E 04                     989 	.db #0x04	; 4
      00032F 00                     990 	.db #0x00	; 0
      000330 00                     991 	.db #0x00	; 0
      000331 FF                     992 	.db #0xff	; 255
      000332 FD                     993 	.db #0xfd	; 253
      000333 E8                     994 	.db #0xe8	; 232
      000334 02                     995 	.db #0x02	; 2
      000335 00                     996 	.db #0x00	; 0
      000336 00                     997 	.db #0x00	; 0
      000337 0A                     998 	.db #0x0a	; 10
      000338 80                     999 	.db #0x80	; 128
      000339 00                    1000 	.db #0x00	; 0
      00033A 00                    1001 	.db #0x00	; 0
      00033B 2A                    1002 	.db #0x2a	; 42
      00033C 8F                    1003 	.db #0x8f	; 143
      00033D F8                    1004 	.db #0xf8	; 248
      00033E B6                    1005 	.db #0xb6	; 182
      00033F 00                    1006 	.db #0x00	; 0
      000340 00                    1007 	.db #0x00	; 0
      000341 FF                    1008 	.db #0xff	; 255
      000342 FF                    1009 	.db #0xff	; 255
      000343 E8                    1010 	.db #0xe8	; 232
      000344 04                    1011 	.db #0x04	; 4
      000345 80                    1012 	.db #0x80	; 128
      000346 00                    1013 	.db #0x00	; 0
      000347 10                    1014 	.db #0x10	; 16
      000348 40                    1015 	.db #0x40	; 64
      000349 00                    1016 	.db #0x00	; 0
      00034A 0A                    1017 	.db #0x0a	; 10
      00034B 84                    1018 	.db #0x84	; 132
      00034C BF                    1019 	.db #0xbf	; 191
      00034D 75                    1020 	.db #0x75	; 117	'u'
      00034E 55                    1021 	.db #0x55	; 85	'U'
      00034F 55                    1022 	.db #0x55	; 85	'U'
      000350 55                    1023 	.db #0x55	; 85	'U'
      000351 FF                    1024 	.db #0xff	; 255
      000352 FF                    1025 	.db #0xff	; 255
      000353 F5                    1026 	.db #0xf5	; 245
      000354 50                    1027 	.db #0x50	; 80	'P'
      000355 A0                    1028 	.db #0xa0	; 160
      000356 00                    1029 	.db #0x00	; 0
      000357 11                    1030 	.db #0x11	; 17
      000358 28                    1031 	.db #0x28	; 40
      000359 00                    1032 	.db #0x00	; 0
      00035A A0                    1033 	.db #0xa0	; 160
      00035B AB                    1034 	.db #0xab	; 171
      00035C EF                    1035 	.db #0xef	; 239
      00035D F9                    1036 	.db #0xf9	; 249
      00035E 57                    1037 	.db #0x57	; 87	'W'
      00035F AA                    1038 	.db #0xaa	; 170
      000360 AA                    1039 	.db #0xaa	; 170
      000361 FF                    1040 	.db #0xff	; 255
      000362 FF                    1041 	.db #0xff	; 255
      000363 F6                    1042 	.db #0xf6	; 246
      000364 8A                    1043 	.db #0x8a	; 138
      000365 00                    1044 	.db #0x00	; 0
      000366 00                    1045 	.db #0x00	; 0
      000367 22                    1046 	.db #0x22	; 34
      000368 44                    1047 	.db #0x44	; 68	'D'
      000369 55                    1048 	.db #0x55	; 85	'U'
      00036A 15                    1049 	.db #0x15	; 21
      00036B 7F                    1050 	.db #0x7f	; 127
      00036C FF                    1051 	.db #0xff	; 255
      00036D F5                    1052 	.db #0xf5	; 245
      00036E 75                    1053 	.db #0x75	; 117	'u'
      00036F 76                    1054 	.db #0x76	; 118	'v'
      000370 AA                    1055 	.db #0xaa	; 170
      000371 FF                    1056 	.db #0xff	; 255
      000372 FF                    1057 	.db #0xff	; 255
      000373 FF                    1058 	.db #0xff	; 255
      000374 69                    1059 	.db #0x69	; 105	'i'
      000375 55                    1060 	.db #0x55	; 85	'U'
      000376 55                    1061 	.db #0x55	; 85	'U'
      000377 29                    1062 	.db #0x29	; 41
      000378 25                    1063 	.db #0x25	; 37
      000379 01                    1064 	.db #0x01	; 1
      00037A 45                    1065 	.db #0x45	; 69	'E'
      00037B FF                    1066 	.db #0xff	; 255
      00037C F7                    1067 	.db #0xf7	; 247
      00037D F5                    1068 	.db #0xf5	; 245
      00037E 5F                    1069 	.db #0x5f	; 95
      00037F 7F                    1070 	.db #0x7f	; 127
      000380 AB                    1071 	.db #0xab	; 171
      000381 FF                    1072 	.db #0xff	; 255
      000382 FF                    1073 	.db #0xff	; 255
      000383 FF                    1074 	.db #0xff	; 255
      000384 D5                    1075 	.db #0xd5	; 213
      000385 55                    1076 	.db #0x55	; 85	'U'
      000386 55                    1077 	.db #0x55	; 85	'U'
      000387 54                    1078 	.db #0x54	; 84	'T'
      000388 A9                    1079 	.db #0xa9	; 169
      000389 6A                    1080 	.db #0x6a	; 106	'j'
      00038A AF                    1081 	.db #0xaf	; 175
      00038B FF                    1082 	.db #0xff	; 255
      00038C FF                    1083 	.db #0xff	; 255
      00038D F5                    1084 	.db #0xf5	; 245
      00038E 56                    1085 	.db #0x56	; 86	'V'
      00038F B7                    1086 	.db #0xb7	; 183
      000390 BF                    1087 	.db #0xbf	; 191
      000391 FF                    1088 	.db #0xff	; 255
      000392 FF                    1089 	.db #0xff	; 255
      000393 FF                    1090 	.db #0xff	; 255
      000394 D5                    1091 	.db #0xd5	; 213
      000395 55                    1092 	.db #0x55	; 85	'U'
      000396 55                    1093 	.db #0x55	; 85	'U'
      000397 55                    1094 	.db #0x55	; 85	'U'
      000398 56                    1095 	.db #0x56	; 86	'V'
      000399 B6                    1096 	.db #0xb6	; 182
      00039A AF                    1097 	.db #0xaf	; 175
      00039B FF                    1098 	.db #0xff	; 255
      00039C FE                    1099 	.db #0xfe	; 254
      00039D D7                    1100 	.db #0xd7	; 215
      00039E 77                    1101 	.db #0x77	; 119	'w'
      00039F 5F                    1102 	.db #0x5f	; 95
      0003A0 EF                    1103 	.db #0xef	; 239
      0003A1 FF                    1104 	.db #0xff	; 255
      0003A2 FF                    1105 	.db #0xff	; 255
      0003A3 FF                    1106 	.db #0xff	; 255
      0003A4 FF                    1107 	.db #0xff	; 255
      0003A5 FF                    1108 	.db #0xff	; 255
      0003A6 FF                    1109 	.db #0xff	; 255
      0003A7 FD                    1110 	.db #0xfd	; 253
      0003A8 B5                    1111 	.db #0xb5	; 181
      0003A9 6F                    1112 	.db #0x6f	; 111	'o'
      0003AA BF                    1113 	.db #0xbf	; 191
      0003AB FF                    1114 	.db #0xff	; 255
      0003AC FF                    1115 	.db #0xff	; 255
      0003AD BB                    1116 	.db #0xbb	; 187
      0003AE AD                    1117 	.db #0xad	; 173
      0003AF 7F                    1118 	.db #0x7f	; 127
      0003B0 FF                    1119 	.db #0xff	; 255
      0003B1 FF                    1120 	.db #0xff	; 255
      0003B2 FF                    1121 	.db #0xff	; 255
      0003B3 FF                    1122 	.db #0xff	; 255
      0003B4 FF                    1123 	.db #0xff	; 255
      0003B5 FF                    1124 	.db #0xff	; 255
      0003B6 FE                    1125 	.db #0xfe	; 254
      0003B7 94                    1126 	.db #0x94	; 148
      0003B8 DF                    1127 	.db #0xdf	; 223
      0003B9 DF                    1128 	.db #0xdf	; 223
      0003BA DF                    1129 	.db #0xdf	; 223
      0003BB FF                    1130 	.db #0xff	; 255
      0003BC FF                    1131 	.db #0xff	; 255
      0003BD FF                    1132 	.db #0xff	; 255
      0003BE AB                    1133 	.db #0xab	; 171
      0003BF BA                    1134 	.db #0xba	; 186
      0003C0 EF                    1135 	.db #0xef	; 239
      0003C1 FF                    1136 	.db #0xff	; 255
      0003C2 FF                    1137 	.db #0xff	; 255
      0003C3 FF                    1138 	.db #0xff	; 255
      0003C4 EB                    1139 	.db #0xeb	; 235
      0003C5 FF                    1140 	.db #0xff	; 255
      0003C6 FF                    1141 	.db #0xff	; 255
      0003C7 FF                    1142 	.db #0xff	; 255
      0003C8 FF                    1143 	.db #0xff	; 255
      0003C9 FF                    1144 	.db #0xff	; 255
      0003CA BF                    1145 	.db #0xbf	; 191
      0003CB FF                    1146 	.db #0xff	; 255
      0003CC FF                    1147 	.db #0xff	; 255
      0003CD FF                    1148 	.db #0xff	; 255
      0003CE DA                    1149 	.db #0xda	; 218
      0003CF AF                    1150 	.db #0xaf	; 175
      0003D0 F7                    1151 	.db #0xf7	; 247
      0003D1 FF                    1152 	.db #0xff	; 255
      0003D2 FF                    1153 	.db #0xff	; 255
      0003D3 FF                    1154 	.db #0xff	; 255
      0003D4 FF                    1155 	.db #0xff	; 255
      0003D5 FF                    1156 	.db #0xff	; 255
      0003D6 DF                    1157 	.db #0xdf	; 223
      0003D7 80                    1158 	.db #0x80	; 128
      0003D8 1F                    1159 	.db #0x1f	; 31
      0003D9 FF                    1160 	.db #0xff	; 255
      0003DA BF                    1161 	.db #0xbf	; 191
      0003DB FF                    1162 	.db #0xff	; 255
      0003DC FF                    1163 	.db #0xff	; 255
      0003DD FF                    1164 	.db #0xff	; 255
      0003DE EE                    1165 	.db #0xee	; 238
      0003DF D4                    1166 	.db #0xd4	; 212
      0003E0 FF                    1167 	.db #0xff	; 255
      0003E1 FF                    1168 	.db #0xff	; 255
      0003E2 FF                    1169 	.db #0xff	; 255
      0003E3 FF                    1170 	.db #0xff	; 255
      0003E4 FD                    1171 	.db #0xfd	; 253
      0003E5 7F                    1172 	.db #0x7f	; 127
      0003E6 58                    1173 	.db #0x58	; 88	'X'
      0003E7 43                    1174 	.db #0x43	; 67	'C'
      0003E8 FF                    1175 	.db #0xff	; 255
      0003E9 FF                    1176 	.db #0xff	; 255
      0003EA FF                    1177 	.db #0xff	; 255
      0003EB FF                    1178 	.db #0xff	; 255
      0003EC FF                    1179 	.db #0xff	; 255
      0003ED FD                    1180 	.db #0xfd	; 253
      0003EE DB                    1181 	.db #0xdb	; 219
      0003EF 7F                    1182 	.db #0x7f	; 127
      0003F0 DF                    1183 	.db #0xdf	; 223
      0003F1 FF                    1184 	.db #0xff	; 255
      0003F2 FF                    1185 	.db #0xff	; 255
      0003F3 FF                    1186 	.db #0xff	; 255
      0003F4 F8                    1187 	.db #0xf8	; 248
      0003F5 02                    1188 	.db #0x02	; 2
      0003F6 F5                    1189 	.db #0xf5	; 245
      0003F7 60                    1190 	.db #0x60	; 96
      0003F8 FF                    1191 	.db #0xff	; 255
      0003F9 FF                    1192 	.db #0xff	; 255
      0003FA FF                    1193 	.db #0xff	; 255
      0003FB FF                    1194 	.db #0xff	; 255
      0003FC FF                    1195 	.db #0xff	; 255
      0003FD FF                    1196 	.db #0xff	; 255
      0003FE EB                    1197 	.db #0xeb	; 235
      0003FF 7A                    1198 	.db #0x7a	; 122	'z'
      000400 DF                    1199 	.db #0xdf	; 223
      000401 FF                    1200 	.db #0xff	; 255
      000402 FF                    1201 	.db #0xff	; 255
      000403 FF                    1202 	.db #0xff	; 255
      000404 C6                    1203 	.db #0xc6	; 198
      000405 01                    1204 	.db #0x01	; 1
      000406 ED                    1205 	.db #0xed	; 237
      000407 40                    1206 	.db #0x40	; 64
      000408 FF                    1207 	.db #0xff	; 255
      000409 FF                    1208 	.db #0xff	; 255
      00040A FF                    1209 	.db #0xff	; 255
      00040B FF                    1210 	.db #0xff	; 255
      00040C FF                    1211 	.db #0xff	; 255
      00040D FA                    1212 	.db #0xfa	; 250
      00040E ED                    1213 	.db #0xed	; 237
      00040F FD                    1214 	.db #0xfd	; 253
      000410 5D                    1215 	.db #0x5d	; 93
      000411 FF                    1216 	.db #0xff	; 255
      000412 FF                    1217 	.db #0xff	; 255
      000413 FF                    1218 	.db #0xff	; 255
      000414 EB                    1219 	.db #0xeb	; 235
      000415 E1                    1220 	.db #0xe1	; 225
      000416 F5                    1221 	.db #0xf5	; 245
      000417 50                    1222 	.db #0x50	; 80	'P'
      000418 7F                    1223 	.db #0x7f	; 127
      000419 FF                    1224 	.db #0xff	; 255
      00041A FF                    1225 	.db #0xff	; 255
      00041B FF                    1226 	.db #0xff	; 255
      00041C FF                    1227 	.db #0xff	; 255
      00041D FF                    1228 	.db #0xff	; 255
      00041E EB                    1229 	.db #0xeb	; 235
      00041F DB                    1230 	.db #0xdb	; 219
      000420 6F                    1231 	.db #0x6f	; 111	'o'
      000421 FF                    1232 	.db #0xff	; 255
      000422 FF                    1233 	.db #0xff	; 255
      000423 FF                    1234 	.db #0xff	; 255
      000424 AA                    1235 	.db #0xaa	; 170
      000425 A8                    1236 	.db #0xa8	; 168
      000426 71                    1237 	.db #0x71	; 113	'q'
      000427 40                    1238 	.db #0x40	; 64
      000428 7F                    1239 	.db #0x7f	; 127
      000429 FF                    1240 	.db #0xff	; 255
      00042A FF                    1241 	.db #0xff	; 255
      00042B FF                    1242 	.db #0xff	; 255
      00042C FF                    1243 	.db #0xff	; 255
      00042D F7                    1244 	.db #0xf7	; 247
      00042E D7                    1245 	.db #0xd7	; 215
      00042F BA                    1246 	.db #0xba	; 186
      000430 B7                    1247 	.db #0xb7	; 183
      000431 FF                    1248 	.db #0xff	; 255
      000432 FF                    1249 	.db #0xff	; 255
      000433 FF                    1250 	.db #0xff	; 255
      000434 D5                    1251 	.db #0xd5	; 213
      000435 54                    1252 	.db #0x54	; 84	'T'
      000436 2A                    1253 	.db #0x2a	; 42
      000437 D0                    1254 	.db #0xd0	; 208
      000438 3F                    1255 	.db #0x3f	; 63
      000439 FF                    1256 	.db #0xff	; 255
      00043A FF                    1257 	.db #0xff	; 255
      00043B FF                    1258 	.db #0xff	; 255
      00043C FF                    1259 	.db #0xff	; 255
      00043D FF                    1260 	.db #0xff	; 255
      00043E FB                    1261 	.db #0xfb	; 251
      00043F 77                    1262 	.db #0x77	; 119	'w'
      000440 BF                    1263 	.db #0xbf	; 191
      000441 FF                    1264 	.db #0xff	; 255
      000442 FF                    1265 	.db #0xff	; 255
      000443 FF                    1266 	.db #0xff	; 255
      000444 54                    1267 	.db #0x54	; 84	'T'
      000445 AA                    1268 	.db #0xaa	; 170
      000446 15                    1269 	.db #0x15	; 21
      000447 A0                    1270 	.db #0xa0	; 160
      000448 1F                    1271 	.db #0x1f	; 31
      000449 FF                    1272 	.db #0xff	; 255
      00044A FF                    1273 	.db #0xff	; 255
      00044B FF                    1274 	.db #0xff	; 255
      00044C FF                    1275 	.db #0xff	; 255
      00044D FF                    1276 	.db #0xff	; 255
      00044E 76                    1277 	.db #0x76	; 118	'v'
      00044F FF                    1278 	.db #0xff	; 255
      000450 FF                    1279 	.db #0xff	; 255
      000451 FF                    1280 	.db #0xff	; 255
      000452 FF                    1281 	.db #0xff	; 255
      000453 FF                    1282 	.db #0xff	; 255
      000454 55                    1283 	.db #0x55	; 85	'U'
      000455 2A                    1284 	.db #0x2a	; 42
      000456 85                    1285 	.db #0x85	; 133
      000457 D0                    1286 	.db #0xd0	; 208
      000458 0F                    1287 	.db #0x0f	; 15
      000459 FF                    1288 	.db #0xff	; 255
      00045A FF                    1289 	.db #0xff	; 255
      00045B FF                    1290 	.db #0xff	; 255
      00045C FF                    1291 	.db #0xff	; 255
      00045D FF                    1292 	.db #0xff	; 255
      00045E E9                    1293 	.db #0xe9	; 233
      00045F DF                    1294 	.db #0xdf	; 223
      000460 BF                    1295 	.db #0xbf	; 191
      000461 00                    1296 	.db #0x00	; 0
      000462 0A                    1297 	.db #0x0a	; 10
      000463 FD                    1298 	.db #0xfd	; 253
      000464 55                    1299 	.db #0x55	; 85	'U'
      000465 4A                    1300 	.db #0x4a	; 74	'J'
      000466 87                    1301 	.db #0x87	; 135
      000467 C0                    1302 	.db #0xc0	; 192
      000468 0F                    1303 	.db #0x0f	; 15
      000469 FF                    1304 	.db #0xff	; 255
      00046A FF                    1305 	.db #0xff	; 255
      00046B FF                    1306 	.db #0xff	; 255
      00046C FF                    1307 	.db #0xff	; 255
      00046D FF                    1308 	.db #0xff	; 255
      00046E FF                    1309 	.db #0xff	; 255
      00046F FF                    1310 	.db #0xff	; 255
      000470 FF                    1311 	.db #0xff	; 255
      000471 00                    1312 	.db #0x00	; 0
      000472 00                    1313 	.db #0x00	; 0
      000473 03                    1314 	.db #0x03	; 3
      000474 57                    1315 	.db #0x57	; 87	'W'
      000475 AA                    1316 	.db #0xaa	; 170
      000476 A0                    1317 	.db #0xa0	; 160
      000477 E0                    1318 	.db #0xe0	; 224
      000478 07                    1319 	.db #0x07	; 7
      000479 FF                    1320 	.db #0xff	; 255
      00047A FF                    1321 	.db #0xff	; 255
      00047B FF                    1322 	.db #0xff	; 255
      00047C FF                    1323 	.db #0xff	; 255
      00047D FF                    1324 	.db #0xff	; 255
      00047E FF                    1325 	.db #0xff	; 255
      00047F FF                    1326 	.db #0xff	; 255
      000480 FF                    1327 	.db #0xff	; 255
      000481 00                    1328 	.db #0x00	; 0
      000482 00                    1329 	.db #0x00	; 0
      000483 05                    1330 	.db #0x05	; 5
      000484 6A                    1331 	.db #0x6a	; 106	'j'
      000485 45                    1332 	.db #0x45	; 69	'E'
      000486 50                    1333 	.db #0x50	; 80	'P'
      000487 00                    1334 	.db #0x00	; 0
      000488 07                    1335 	.db #0x07	; 7
      000489 FF                    1336 	.db #0xff	; 255
      00048A FF                    1337 	.db #0xff	; 255
      00048B DF                    1338 	.db #0xdf	; 223
      00048C FF                    1339 	.db #0xff	; 255
      00048D FF                    1340 	.db #0xff	; 255
      00048E FF                    1341 	.db #0xff	; 255
      00048F FF                    1342 	.db #0xff	; 255
      000490 FF                    1343 	.db #0xff	; 255
      000491 00                    1344 	.db #0x00	; 0
      000492 00                    1345 	.db #0x00	; 0
      000493 05                    1346 	.db #0x05	; 5
      000494 56                    1347 	.db #0x56	; 86	'V'
      000495 28                    1348 	.db #0x28	; 40
      000496 AA                    1349 	.db #0xaa	; 170
      000497 30                    1350 	.db #0x30	; 48	'0'
      000498 00                    1351 	.db #0x00	; 0
      000499 00                    1352 	.db #0x00	; 0
      00049A 33                    1353 	.db #0x33	; 51	'3'
      00049B FF                    1354 	.db #0xff	; 255
      00049C FF                    1355 	.db #0xff	; 255
      00049D FF                    1356 	.db #0xff	; 255
      00049E FF                    1357 	.db #0xff	; 255
      00049F FF                    1358 	.db #0xff	; 255
      0004A0 FF                    1359 	.db #0xff	; 255
      0004A1 00                    1360 	.db #0x00	; 0
      0004A2 00                    1361 	.db #0x00	; 0
      0004A3 1A                    1362 	.db #0x1a	; 26
      0004A4 AA                    1363 	.db #0xaa	; 170
      0004A5 15                    1364 	.db #0x15	; 21
      0004A6 54                    1365 	.db #0x54	; 84	'T'
      0004A7 80                    1366 	.db #0x80	; 128
      0004A8 00                    1367 	.db #0x00	; 0
      0004A9 00                    1368 	.db #0x00	; 0
      0004AA 20                    1369 	.db #0x20	; 32
      0004AB 81                    1370 	.db #0x81	; 129
      0004AC 81                    1371 	.db #0x81	; 129
      0004AD FF                    1372 	.db #0xff	; 255
      0004AE FF                    1373 	.db #0xff	; 255
      0004AF FF                    1374 	.db #0xff	; 255
      0004B0 FF                    1375 	.db #0xff	; 255
      0004B1 00                    1376 	.db #0x00	; 0
      0004B2 00                    1377 	.db #0x00	; 0
      0004B3 0A                    1378 	.db #0x0a	; 10
      0004B4 94                    1379 	.db #0x94	; 148
      0004B5 0A                    1380 	.db #0x0a	; 10
      0004B6 2A                    1381 	.db #0x2a	; 42
      0004B7 50                    1382 	.db #0x50	; 80	'P'
      0004B8 00                    1383 	.db #0x00	; 0
      0004B9 00                    1384 	.db #0x00	; 0
      0004BA 5E                    1385 	.db #0x5e	; 94
      0004BB 01                    1386 	.db #0x01	; 1
      0004BC 80                    1387 	.db #0x80	; 128
      0004BD E0                    1388 	.db #0xe0	; 224
      0004BE 00                    1389 	.db #0x00	; 0
      0004BF 12                    1390 	.db #0x12	; 18
      0004C0 FF                    1391 	.db #0xff	; 255
      0004C1 00                    1392 	.db #0x00	; 0
      0004C2 00                    1393 	.db #0x00	; 0
      0004C3 2A                    1394 	.db #0x2a	; 42
      0004C4 50                    1395 	.db #0x50	; 80	'P'
      0004C5 BA                    1396 	.db #0xba	; 186
      0004C6 95                    1397 	.db #0x95	; 149
      0004C7 08                    1398 	.db #0x08	; 8
      0004C8 02                    1399 	.db #0x02	; 2
      0004C9 00                    1400 	.db #0x00	; 0
      0004CA 76                    1401 	.db #0x76	; 118	'v'
      0004CB 83                    1402 	.db #0x83	; 131
      0004CC 80                    1403 	.db #0x80	; 128
      0004CD C0                    1404 	.db #0xc0	; 192
      0004CE 00                    1405 	.db #0x00	; 0
      0004CF 00                    1406 	.db #0x00	; 0
      0004D0 00                    1407 	.db #0x00	; 0
      0004D1 00                    1408 	.db #0x00	; 0
      0004D2 00                    1409 	.db #0x00	; 0
      0004D3 29                    1410 	.db #0x29	; 41
      0004D4 52                    1411 	.db #0x52	; 82	'R'
      0004D5 BA                    1412 	.db #0xba	; 186
      0004D6 C5                    1413 	.db #0xc5	; 197
      0004D7 E4                    1414 	.db #0xe4	; 228
      0004D8 00                    1415 	.db #0x00	; 0
      0004D9 00                    1416 	.db #0x00	; 0
      0004DA 3F                    1417 	.db #0x3f	; 63
      0004DB C1                    1418 	.db #0xc1	; 193
      0004DC 80                    1419 	.db #0x80	; 128
      0004DD E0                    1420 	.db #0xe0	; 224
      0004DE 00                    1421 	.db #0x00	; 0
      0004DF 00                    1422 	.db #0x00	; 0
      0004E0 00                    1423 	.db #0x00	; 0
      0004E1 00                    1424 	.db #0x00	; 0
      0004E2 00                    1425 	.db #0x00	; 0
      0004E3 AA                    1426 	.db #0xaa	; 170
      0004E4 4A                    1427 	.db #0x4a	; 74	'J'
      0004E5 E1                    1428 	.db #0xe1	; 225
      0004E6 52                    1429 	.db #0x52	; 82	'R'
      0004E7 29                    1430 	.db #0x29	; 41
      0004E8 50                    1431 	.db #0x50	; 80	'P'
      0004E9 00                    1432 	.db #0x00	; 0
      0004EA 3F                    1433 	.db #0x3f	; 63
      0004EB E3                    1434 	.db #0xe3	; 227
      0004EC 00                    1435 	.db #0x00	; 0
      0004ED C0                    1436 	.db #0xc0	; 192
      0004EE 00                    1437 	.db #0x00	; 0
      0004EF 00                    1438 	.db #0x00	; 0
      0004F0 00                    1439 	.db #0x00	; 0
      0004F1 00                    1440 	.db #0x00	; 0
      0004F2 00                    1441 	.db #0x00	; 0
      0004F3 92                    1442 	.db #0x92	; 146
      0004F4 94                    1443 	.db #0x94	; 148
      0004F5 20                    1444 	.db #0x20	; 32
      0004F6 A9                    1445 	.db #0xa9	; 169
      0004F7 54                    1446 	.db #0x54	; 84	'T'
      0004F8 7F                    1447 	.db #0x7f	; 127
      0004F9 01                    1448 	.db #0x01	; 1
      0004FA 3C                    1449 	.db #0x3c	; 60
      0004FB FA                    1450 	.db #0xfa	; 250
      0004FC 80                    1451 	.db #0x80	; 128
      0004FD C0                    1452 	.db #0xc0	; 192
      0004FE 00                    1453 	.db #0x00	; 0
      0004FF 00                    1454 	.db #0x00	; 0
      000500 00                    1455 	.db #0x00	; 0
      000501 00                    1456 	.db #0x00	; 0
      000502 02                    1457 	.db #0x02	; 2
      000503 4A                    1458 	.db #0x4a	; 74	'J'
      000504 7F                    1459 	.db #0x7f	; 127
      000505 C0                    1460 	.db #0xc0	; 192
      000506 55                    1461 	.db #0x55	; 85	'U'
      000507 55                    1462 	.db #0x55	; 85	'U'
      000508 3F                    1463 	.db #0x3f	; 63
      000509 C0                    1464 	.db #0xc0	; 192
      00050A 20                    1465 	.db #0x20	; 32
      00050B F8                    1466 	.db #0xf8	; 248
      00050C 00                    1467 	.db #0x00	; 0
      00050D C0                    1468 	.db #0xc0	; 192
      00050E 00                    1469 	.db #0x00	; 0
      00050F 00                    1470 	.db #0x00	; 0
      000510 00                    1471 	.db #0x00	; 0
      000511 00                    1472 	.db #0x00	; 0
      000512 01                    1473 	.db #0x01	; 1
      000513 57                    1474 	.db #0x57	; 87	'W'
      000514 7F                    1475 	.db #0x7f	; 127
      000515 C0                    1476 	.db #0xc0	; 192
      000516 1A                    1477 	.db #0x1a	; 26
      000517 55                    1478 	.db #0x55	; 85	'U'
      000518 1F                    1479 	.db #0x1f	; 31
      000519 F0                    1480 	.db #0xf0	; 240
      00051A 19                    1481 	.db #0x19	; 25
      00051B F8                    1482 	.db #0xf8	; 248
      00051C 00                    1483 	.db #0x00	; 0
      00051D C0                    1484 	.db #0xc0	; 192
      00051E 00                    1485 	.db #0x00	; 0
      00051F 00                    1486 	.db #0x00	; 0
      000520 00                    1487 	.db #0x00	; 0
      000521 00                    1488 	.db #0x00	; 0
      000522 0A                    1489 	.db #0x0a	; 10
      000523 A3                    1490 	.db #0xa3	; 163
      000524 FB                    1491 	.db #0xfb	; 251
      000525 80                    1492 	.db #0x80	; 128
      000526 15                    1493 	.db #0x15	; 21
      000527 54                    1494 	.db #0x54	; 84	'T'
      000528 BF                    1495 	.db #0xbf	; 191
      000529 80                    1496 	.db #0x80	; 128
      00052A 23                    1497 	.db #0x23	; 35
      00052B FC                    1498 	.db #0xfc	; 252
      00052C 00                    1499 	.db #0x00	; 0
      00052D 80                    1500 	.db #0x80	; 128
      00052E 00                    1501 	.db #0x00	; 0
      00052F 00                    1502 	.db #0x00	; 0
      000530 00                    1503 	.db #0x00	; 0
      000531 00                    1504 	.db #0x00	; 0
      000532 15                    1505 	.db #0x15	; 21
      000533 60                    1506 	.db #0x60	; 96
      000534 A3                    1507 	.db #0xa3	; 163
      000535 00                    1508 	.db #0x00	; 0
      000536 0D                    1509 	.db #0x0d	; 13
      000537 55                    1510 	.db #0x55	; 85	'U'
      000538 1F                    1511 	.db #0x1f	; 31
      000539 80                    1512 	.db #0x80	; 128
      00053A 13                    1513 	.db #0x13	; 19
      00053B FF                    1514 	.db #0xff	; 255
      00053C 00                    1515 	.db #0x00	; 0
      00053D 81                    1516 	.db #0x81	; 129
      00053E 1A                    1517 	.db #0x1a	; 26
      00053F 00                    1518 	.db #0x00	; 0
      000540 00                    1519 	.db #0x00	; 0
      000541 00                    1520 	.db #0x00	; 0
      000542 2A                    1521 	.db #0x2a	; 42
      000543 E0                    1522 	.db #0xe0	; 224
      000544 04                    1523 	.db #0x04	; 4
      000545 00                    1524 	.db #0x00	; 0
      000546 05                    1525 	.db #0x05	; 5
      000547 55                    1526 	.db #0x55	; 85	'U'
      000548 7C                    1527 	.db #0x7c	; 124
      000549 02                    1528 	.db #0x02	; 2
      00054A 27                    1529 	.db #0x27	; 39
      00054B FE                    1530 	.db #0xfe	; 254
      00054C C0                    1531 	.db #0xc0	; 192
      00054D 45                    1532 	.db #0x45	; 69	'E'
      00054E F4                    1533 	.db #0xf4	; 244
      00054F 0C                    1534 	.db #0x0c	; 12
      000550 00                    1535 	.db #0x00	; 0
      000551 5F                    1536 	.db #0x5f	; 95
      000552 55                    1537 	.db #0x55	; 85	'U'
      000553 FF                    1538 	.db #0xff	; 255
      000554 FF                    1539 	.db #0xff	; 255
      000555 FF                    1540 	.db #0xff	; 255
      000556 A6                    1541 	.db #0xa6	; 166
      000557 AD                    1542 	.db #0xad	; 173
      000558 7C                    1543 	.db #0x7c	; 124
      000559 02                    1544 	.db #0x02	; 2
      00055A 27                    1545 	.db #0x27	; 39
      00055B F8                    1546 	.db #0xf8	; 248
      00055C 70                    1547 	.db #0x70	; 112	'p'
      00055D 06                    1548 	.db #0x06	; 6
      00055E 97                    1549 	.db #0x97	; 151
      00055F 2E                    1550 	.db #0x2e	; 46
      000560 00                    1551 	.db #0x00	; 0
      000561 F0                    1552 	.db #0xf0	; 240
      000562 AF                    1553 	.db #0xaf	; 175
      000563 F5                    1554 	.db #0xf5	; 245
      000564 FA                    1555 	.db #0xfa	; 250
      000565 AA                    1556 	.db #0xaa	; 170
      000566 DF                    1557 	.db #0xdf	; 223
      000567 AB                    1558 	.db #0xab	; 171
      000568 FA                    1559 	.db #0xfa	; 250
      000569 14                    1560 	.db #0x14	; 20
      00056A 2F                    1561 	.db #0x2f	; 47
      00056B EA                    1562 	.db #0xea	; 234
      00056C 00                    1563 	.db #0x00	; 0
      00056D 0D                    1564 	.db #0x0d	; 13
      00056E D5                    1565 	.db #0xd5	; 213
      00056F DF                    1566 	.db #0xdf	; 223
      000570 00                    1567 	.db #0x00	; 0
      000571 3A                    1568 	.db #0x3a	; 58
      000572 3F                    1569 	.db #0x3f	; 63
      000573 F6                    1570 	.db #0xf6	; 246
      000574 AF                    1571 	.db #0xaf	; 175
      000575 6D                    1572 	.db #0x6d	; 109	'm'
      000576 55                    1573 	.db #0x55	; 85	'U'
      000577 ED                    1574 	.db #0xed	; 237
      000578 F9                    1575 	.db #0xf9	; 249
      000579 44                    1576 	.db #0x44	; 68	'D'
      00057A 17                    1577 	.db #0x17	; 23
      00057B FA                    1578 	.db #0xfa	; 250
      00057C 00                    1579 	.db #0x00	; 0
      00057D 2F                    1580 	.db #0x2f	; 47
      00057E EF                    1581 	.db #0xef	; 239
      00057F 7F                    1582 	.db #0x7f	; 127
      000580 00                    1583 	.db #0x00	; 0
      000581 FD                    1584 	.db #0xfd	; 253
      000582 EB                    1585 	.db #0xeb	; 235
      000583 AD                    1586 	.db #0xad	; 173
      000584 D5                    1587 	.db #0xd5	; 213
      000585 B6                    1588 	.db #0xb6	; 182
      000586 D5                    1589 	.db #0xd5	; 213
      000587 DB                    1590 	.db #0xdb	; 219
      000588 F6                    1591 	.db #0xf6	; 246
      000589 B8                    1592 	.db #0xb8	; 184
      00058A 3F                    1593 	.db #0x3f	; 63
      00058B FC                    1594 	.db #0xfc	; 252
      00058C 03                    1595 	.db #0x03	; 3
      00058D 7F                    1596 	.db #0x7f	; 127
      00058E FF                    1597 	.db #0xff	; 255
      00058F FF                    1598 	.db #0xff	; 255
      000590 80                    1599 	.db #0x80	; 128
      000591 AF                    1600 	.db #0xaf	; 175
      000592 EB                    1601 	.db #0xeb	; 235
      000593 ED                    1602 	.db #0xed	; 237
      000594 76                    1603 	.db #0x76	; 118	'v'
      000595 DB                    1604 	.db #0xdb	; 219
      000596 6D                    1605 	.db #0x6d	; 109	'm'
      000597 7F                    1606 	.db #0x7f	; 127
      000598 F5                    1607 	.db #0xf5	; 245
      000599 5D                    1608 	.db #0x5d	; 93
      00059A 1F                    1609 	.db #0x1f	; 31
      00059B F4                    1610 	.db #0xf4	; 244
      00059C 09                    1611 	.db #0x09	; 9
      00059D 1F                    1612 	.db #0x1f	; 31
      00059E FF                    1613 	.db #0xff	; 255
      00059F FF                    1614 	.db #0xff	; 255
      0005A0 80                    1615 	.db #0x80	; 128
      0005A1 7F                    1616 	.db #0x7f	; 127
      0005A2 B6                    1617 	.db #0xb6	; 182
      0005A3 B6                    1618 	.db #0xb6	; 182
      0005A4 DB                    1619 	.db #0xdb	; 219
      0005A5 6D                    1620 	.db #0x6d	; 109	'm'
      0005A6 BB                    1621 	.db #0xbb	; 187
      0005A7 FF                    1622 	.db #0xff	; 255
      0005A8 EF                    1623 	.db #0xef	; 239
      0005A9 F8                    1624 	.db #0xf8	; 248
      0005AA 3F                    1625 	.db #0x3f	; 63
      0005AB C0                    1626 	.db #0xc0	; 192
      0005AC 2B                    1627 	.db #0x2b	; 43
      0005AD FF                    1628 	.db #0xff	; 255
      0005AE FF                    1629 	.db #0xff	; 255
      0005AF FF                    1630 	.db #0xff	; 255
      0005B0 80                    1631 	.db #0x80	; 128
      0005B1 FF                    1632 	.db #0xff	; 255
      0005B2 FF                    1633 	.db #0xff	; 255
      0005B3 FE                    1634 	.db #0xfe	; 254
      0005B4 DB                    1635 	.db #0xdb	; 219
      0005B5 7F                    1636 	.db #0x7f	; 127
      0005B6 FF                    1637 	.db #0xff	; 255
      0005B7 FF                    1638 	.db #0xff	; 255
      0005B8 FF                    1639 	.db #0xff	; 255
      0005B9 FD                    1640 	.db #0xfd	; 253
      0005BA 0E                    1641 	.db #0x0e	; 14
      0005BB 00                    1642 	.db #0x00	; 0
      0005BC AB                    1643 	.db #0xab	; 171
      0005BD FF                    1644 	.db #0xff	; 255
      0005BE FF                    1645 	.db #0xff	; 255
      0005BF FF                    1646 	.db #0xff	; 255
      0005C0 00                    1647 	.db #0x00	; 0
      0005C1 2F                    1648 	.db #0x2f	; 47
      0005C2 FF                    1649 	.db #0xff	; 255
      0005C3 FF                    1650 	.db #0xff	; 255
      0005C4 FF                    1651 	.db #0xff	; 255
      0005C5 FF                    1652 	.db #0xff	; 255
      0005C6 FF                    1653 	.db #0xff	; 255
      0005C7 FF                    1654 	.db #0xff	; 255
      0005C8 FF                    1655 	.db #0xff	; 255
      0005C9 FA                    1656 	.db #0xfa	; 250
      0005CA 10                    1657 	.db #0x10	; 16
      0005CB 05                    1658 	.db #0x05	; 5
      0005CC 7F                    1659 	.db #0x7f	; 127
      0005CD FF                    1660 	.db #0xff	; 255
      0005CE FF                    1661 	.db #0xff	; 255
      0005CF FF                    1662 	.db #0xff	; 255
      0005D0 00                    1663 	.db #0x00	; 0
      0005D1 00                    1664 	.db #0x00	; 0
      0005D2 00                    1665 	.db #0x00	; 0
      0005D3 7F                    1666 	.db #0x7f	; 127
      0005D4 FF                    1667 	.db #0xff	; 255
      0005D5 FF                    1668 	.db #0xff	; 255
      0005D6 FE                    1669 	.db #0xfe	; 254
      0005D7 AA                    1670 	.db #0xaa	; 170
      0005D8 AA                    1671 	.db #0xaa	; 170
      0005D9 FA                    1672 	.db #0xfa	; 250
      0005DA 88                    1673 	.db #0x88	; 136
      0005DB 15                    1674 	.db #0x15	; 21
      0005DC 7F                    1675 	.db #0x7f	; 127
      0005DD FF                    1676 	.db #0xff	; 255
      0005DE FF                    1677 	.db #0xff	; 255
      0005DF FF                    1678 	.db #0xff	; 255
      0005E0 00                    1679 	.db #0x00	; 0
      0005E1 00                    1680 	.db #0x00	; 0
      0005E2 00                    1681 	.db #0x00	; 0
      0005E3 00                    1682 	.db #0x00	; 0
      0005E4 00                    1683 	.db #0x00	; 0
      0005E5 00                    1684 	.db #0x00	; 0
      0005E6 BF                    1685 	.db #0xbf	; 191
      0005E7 FD                    1686 	.db #0xfd	; 253
      0005E8 5B                    1687 	.db #0x5b	; 91
      0005E9 5A                    1688 	.db #0x5a	; 90	'Z'
      0005EA 50                    1689 	.db #0x50	; 80	'P'
      0005EB AB                    1690 	.db #0xab	; 171
      0005EC FF                    1691 	.db #0xff	; 255
      0005ED 55                    1692 	.db #0x55	; 85	'U'
      0005EE FF                    1693 	.db #0xff	; 255
      0005EF FF                    1694 	.db #0xff	; 255
      0005F0 00                    1695 	.db #0x00	; 0
      0005F1 00                    1696 	.db #0x00	; 0
      0005F2 00                    1697 	.db #0x00	; 0
      0005F3 00                    1698 	.db #0x00	; 0
      0005F4 00                    1699 	.db #0x00	; 0
      0005F5 00                    1700 	.db #0x00	; 0
      0005F6 00                    1701 	.db #0x00	; 0
      0005F7 05                    1702 	.db #0x05	; 5
      0005F8 DF                    1703 	.db #0xdf	; 223
      0005F9 FA                    1704 	.db #0xfa	; 250
      0005FA AA                    1705 	.db #0xaa	; 170
      0005FB AB                    1706 	.db #0xab	; 171
      0005FC FD                    1707 	.db #0xfd	; 253
      0005FD B5                    1708 	.db #0xb5	; 181
      0005FE 55                    1709 	.db #0x55	; 85	'U'
      0005FF FF                    1710 	.db #0xff	; 255
      000600 80                    1711 	.db #0x80	; 128
      000601 00                    1712 	.db #0x00	; 0
      000602 00                    1713 	.db #0x00	; 0
      000603 00                    1714 	.db #0x00	; 0
      000604 00                    1715 	.db #0x00	; 0
      000605 00                    1716 	.db #0x00	; 0
      000606 00                    1717 	.db #0x00	; 0
      000607 00                    1718 	.db #0x00	; 0
      000608 00                    1719 	.db #0x00	; 0
      000609 1A                    1720 	.db #0x1a	; 26
      00060A AA                    1721 	.db #0xaa	; 170
      00060B AF                    1722 	.db #0xaf	; 175
      00060C FF                    1723 	.db #0xff	; 255
      00060D FF                    1724 	.db #0xff	; 255
      00060E FF                    1725 	.db #0xff	; 255
      00060F FF                    1726 	.db #0xff	; 255
      000610 80                    1727 	.db #0x80	; 128
      000611 00                    1728 	.db #0x00	; 0
      000612 00                    1729 	.db #0x00	; 0
      000613 00                    1730 	.db #0x00	; 0
      000614 00                    1731 	.db #0x00	; 0
      000615 00                    1732 	.db #0x00	; 0
      000616 00                    1733 	.db #0x00	; 0
      000617 00                    1734 	.db #0x00	; 0
      000618 00                    1735 	.db #0x00	; 0
      000619 0D                    1736 	.db #0x0d	; 13
      00061A 55                    1737 	.db #0x55	; 85	'U'
      00061B 70                    1738 	.db #0x70	; 112	'p'
      00061C 00                    1739 	.db #0x00	; 0
      00061D 00                    1740 	.db #0x00	; 0
      00061E FF                    1741 	.db #0xff	; 255
      00061F FF                    1742 	.db #0xff	; 255
      000620 00                    1743 	.db #0x00	; 0
      000621 00                    1744 	.db #0x00	; 0
      000622 00                    1745 	.db #0x00	; 0
      000623 00                    1746 	.db #0x00	; 0
      000624 00                    1747 	.db #0x00	; 0
      000625 00                    1748 	.db #0x00	; 0
      000626 00                    1749 	.db #0x00	; 0
      000627 00                    1750 	.db #0x00	; 0
      000628 00                    1751 	.db #0x00	; 0
      000629 0F                    1752 	.db #0x0f	; 15
      00062A E8                    1753 	.db #0xe8	; 232
      00062B 00                    1754 	.db #0x00	; 0
      00062C 00                    1755 	.db #0x00	; 0
      00062D 00                    1756 	.db #0x00	; 0
      00062E 00                    1757 	.db #0x00	; 0
      00062F 01                    1758 	.db #0x01	; 1
      000630 00                    1759 	.db #0x00	; 0
      000631 00                    1760 	.db #0x00	; 0
      000632 00                    1761 	.db #0x00	; 0
      000633 00                    1762 	.db #0x00	; 0
      000634 00                    1763 	.db #0x00	; 0
      000635 00                    1764 	.db #0x00	; 0
      000636 00                    1765 	.db #0x00	; 0
      000637 00                    1766 	.db #0x00	; 0
      000638 00                    1767 	.db #0x00	; 0
      000639 00                    1768 	.db #0x00	; 0
      00063A 00                    1769 	.db #0x00	; 0
      00063B 00                    1770 	.db #0x00	; 0
      00063C 00                    1771 	.db #0x00	; 0
      00063D 00                    1772 	.db #0x00	; 0
      00063E 00                    1773 	.db #0x00	; 0
      00063F 00                    1774 	.db #0x00	; 0
      000640 00                    1775 	.db #0x00	; 0
                                   1776 	.area XINIT   (CODE)
                                   1777 	.area CABS    (ABS,CODE)
