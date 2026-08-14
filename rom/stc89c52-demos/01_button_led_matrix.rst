                                      1 ;--------------------------------------------------------
                                      2 ; File Created by SDCC : free open source ANSI-C Compiler
                                      3 ; Version 4.2.0 #13081 (Linux)
                                      4 ;--------------------------------------------------------
                                      5 	.module button_led_matrix
                                      6 	.optsdcc -mmcs51 --model-small
                                      7 	
                                      8 ;--------------------------------------------------------
                                      9 ; Public variables in this module
                                     10 ;--------------------------------------------------------
                                     11 	.globl _matrix_chars
                                     12 	.globl _main
                                     13 	.globl _display_digit
                                     14 	.globl _scan_keypad
                                     15 	.globl _HC575_write
                                     16 	.globl _CY
                                     17 	.globl _AC
                                     18 	.globl _F0
                                     19 	.globl _RS1
                                     20 	.globl _RS0
                                     21 	.globl _OV
                                     22 	.globl _F1
                                     23 	.globl _P
                                     24 	.globl _PS
                                     25 	.globl _PT1
                                     26 	.globl _PX1
                                     27 	.globl _PT0
                                     28 	.globl _PX0
                                     29 	.globl _RD
                                     30 	.globl _WR
                                     31 	.globl _T1
                                     32 	.globl _T0
                                     33 	.globl _INT1
                                     34 	.globl _INT0
                                     35 	.globl _TXD
                                     36 	.globl _RXD
                                     37 	.globl _P3_7
                                     38 	.globl _P3_6
                                     39 	.globl _P3_5
                                     40 	.globl _P3_4
                                     41 	.globl _P3_3
                                     42 	.globl _P3_2
                                     43 	.globl _P3_1
                                     44 	.globl _P3_0
                                     45 	.globl _EA
                                     46 	.globl _ES
                                     47 	.globl _ET1
                                     48 	.globl _EX1
                                     49 	.globl _ET0
                                     50 	.globl _EX0
                                     51 	.globl _P2_7
                                     52 	.globl _P2_6
                                     53 	.globl _P2_5
                                     54 	.globl _P2_4
                                     55 	.globl _P2_3
                                     56 	.globl _P2_2
                                     57 	.globl _P2_1
                                     58 	.globl _P2_0
                                     59 	.globl _SM0
                                     60 	.globl _SM1
                                     61 	.globl _SM2
                                     62 	.globl _REN
                                     63 	.globl _TB8
                                     64 	.globl _RB8
                                     65 	.globl _TI
                                     66 	.globl _RI
                                     67 	.globl _P1_7
                                     68 	.globl _P1_6
                                     69 	.globl _P1_5
                                     70 	.globl _P1_4
                                     71 	.globl _P1_3
                                     72 	.globl _P1_2
                                     73 	.globl _P1_1
                                     74 	.globl _P1_0
                                     75 	.globl _TF1
                                     76 	.globl _TR1
                                     77 	.globl _TF0
                                     78 	.globl _TR0
                                     79 	.globl _IE1
                                     80 	.globl _IT1
                                     81 	.globl _IE0
                                     82 	.globl _IT0
                                     83 	.globl _P0_7
                                     84 	.globl _P0_6
                                     85 	.globl _P0_5
                                     86 	.globl _P0_4
                                     87 	.globl _P0_3
                                     88 	.globl _P0_2
                                     89 	.globl _P0_1
                                     90 	.globl _P0_0
                                     91 	.globl _B
                                     92 	.globl _ACC
                                     93 	.globl _PSW
                                     94 	.globl _IP
                                     95 	.globl _P3
                                     96 	.globl _IE
                                     97 	.globl _P2
                                     98 	.globl _SBUF
                                     99 	.globl _SCON
                                    100 	.globl _P1
                                    101 	.globl _TH1
                                    102 	.globl _TH0
                                    103 	.globl _TL1
                                    104 	.globl _TL0
                                    105 	.globl _TMOD
                                    106 	.globl _TCON
                                    107 	.globl _PCON
                                    108 	.globl _DPH
                                    109 	.globl _DPL
                                    110 	.globl _SP
                                    111 	.globl _P0
                                    112 	.globl _key_value
                                    113 ;--------------------------------------------------------
                                    114 ; special function registers
                                    115 ;--------------------------------------------------------
                                    116 	.area RSEG    (ABS,DATA)
      000000                        117 	.org 0x0000
                           000080   118 _P0	=	0x0080
                           000081   119 _SP	=	0x0081
                           000082   120 _DPL	=	0x0082
                           000083   121 _DPH	=	0x0083
                           000087   122 _PCON	=	0x0087
                           000088   123 _TCON	=	0x0088
                           000089   124 _TMOD	=	0x0089
                           00008A   125 _TL0	=	0x008a
                           00008B   126 _TL1	=	0x008b
                           00008C   127 _TH0	=	0x008c
                           00008D   128 _TH1	=	0x008d
                           000090   129 _P1	=	0x0090
                           000098   130 _SCON	=	0x0098
                           000099   131 _SBUF	=	0x0099
                           0000A0   132 _P2	=	0x00a0
                           0000A8   133 _IE	=	0x00a8
                           0000B0   134 _P3	=	0x00b0
                           0000B8   135 _IP	=	0x00b8
                           0000D0   136 _PSW	=	0x00d0
                           0000E0   137 _ACC	=	0x00e0
                           0000F0   138 _B	=	0x00f0
                                    139 ;--------------------------------------------------------
                                    140 ; special function bits
                                    141 ;--------------------------------------------------------
                                    142 	.area RSEG    (ABS,DATA)
      000000                        143 	.org 0x0000
                           000080   144 _P0_0	=	0x0080
                           000081   145 _P0_1	=	0x0081
                           000082   146 _P0_2	=	0x0082
                           000083   147 _P0_3	=	0x0083
                           000084   148 _P0_4	=	0x0084
                           000085   149 _P0_5	=	0x0085
                           000086   150 _P0_6	=	0x0086
                           000087   151 _P0_7	=	0x0087
                           000088   152 _IT0	=	0x0088
                           000089   153 _IE0	=	0x0089
                           00008A   154 _IT1	=	0x008a
                           00008B   155 _IE1	=	0x008b
                           00008C   156 _TR0	=	0x008c
                           00008D   157 _TF0	=	0x008d
                           00008E   158 _TR1	=	0x008e
                           00008F   159 _TF1	=	0x008f
                           000090   160 _P1_0	=	0x0090
                           000091   161 _P1_1	=	0x0091
                           000092   162 _P1_2	=	0x0092
                           000093   163 _P1_3	=	0x0093
                           000094   164 _P1_4	=	0x0094
                           000095   165 _P1_5	=	0x0095
                           000096   166 _P1_6	=	0x0096
                           000097   167 _P1_7	=	0x0097
                           000098   168 _RI	=	0x0098
                           000099   169 _TI	=	0x0099
                           00009A   170 _RB8	=	0x009a
                           00009B   171 _TB8	=	0x009b
                           00009C   172 _REN	=	0x009c
                           00009D   173 _SM2	=	0x009d
                           00009E   174 _SM1	=	0x009e
                           00009F   175 _SM0	=	0x009f
                           0000A0   176 _P2_0	=	0x00a0
                           0000A1   177 _P2_1	=	0x00a1
                           0000A2   178 _P2_2	=	0x00a2
                           0000A3   179 _P2_3	=	0x00a3
                           0000A4   180 _P2_4	=	0x00a4
                           0000A5   181 _P2_5	=	0x00a5
                           0000A6   182 _P2_6	=	0x00a6
                           0000A7   183 _P2_7	=	0x00a7
                           0000A8   184 _EX0	=	0x00a8
                           0000A9   185 _ET0	=	0x00a9
                           0000AA   186 _EX1	=	0x00aa
                           0000AB   187 _ET1	=	0x00ab
                           0000AC   188 _ES	=	0x00ac
                           0000AF   189 _EA	=	0x00af
                           0000B0   190 _P3_0	=	0x00b0
                           0000B1   191 _P3_1	=	0x00b1
                           0000B2   192 _P3_2	=	0x00b2
                           0000B3   193 _P3_3	=	0x00b3
                           0000B4   194 _P3_4	=	0x00b4
                           0000B5   195 _P3_5	=	0x00b5
                           0000B6   196 _P3_6	=	0x00b6
                           0000B7   197 _P3_7	=	0x00b7
                           0000B0   198 _RXD	=	0x00b0
                           0000B1   199 _TXD	=	0x00b1
                           0000B2   200 _INT0	=	0x00b2
                           0000B3   201 _INT1	=	0x00b3
                           0000B4   202 _T0	=	0x00b4
                           0000B5   203 _T1	=	0x00b5
                           0000B6   204 _WR	=	0x00b6
                           0000B7   205 _RD	=	0x00b7
                           0000B8   206 _PX0	=	0x00b8
                           0000B9   207 _PT0	=	0x00b9
                           0000BA   208 _PX1	=	0x00ba
                           0000BB   209 _PT1	=	0x00bb
                           0000BC   210 _PS	=	0x00bc
                           0000D0   211 _P	=	0x00d0
                           0000D1   212 _F1	=	0x00d1
                           0000D2   213 _OV	=	0x00d2
                           0000D3   214 _RS0	=	0x00d3
                           0000D4   215 _RS1	=	0x00d4
                           0000D5   216 _F0	=	0x00d5
                           0000D6   217 _AC	=	0x00d6
                           0000D7   218 _CY	=	0x00d7
                                    219 ;--------------------------------------------------------
                                    220 ; overlayable register banks
                                    221 ;--------------------------------------------------------
                                    222 	.area REG_BANK_0	(REL,OVR,DATA)
      000000                        223 	.ds 8
                                    224 ;--------------------------------------------------------
                                    225 ; internal ram data
                                    226 ;--------------------------------------------------------
                                    227 	.area DSEG    (DATA)
      000008                        228 _key_value::
      000008                        229 	.ds 1
                                    230 ;--------------------------------------------------------
                                    231 ; overlayable items in internal ram
                                    232 ;--------------------------------------------------------
                                    233 	.area	OSEG    (OVR,DATA)
                                    234 ;--------------------------------------------------------
                                    235 ; Stack segment in internal ram
                                    236 ;--------------------------------------------------------
                                    237 	.area	SSEG
      000009                        238 __start__stack:
      000009                        239 	.ds	1
                                    240 
                                    241 ;--------------------------------------------------------
                                    242 ; indirectly addressable internal ram data
                                    243 ;--------------------------------------------------------
                                    244 	.area ISEG    (DATA)
                                    245 ;--------------------------------------------------------
                                    246 ; absolute internal ram data
                                    247 ;--------------------------------------------------------
                                    248 	.area IABS    (ABS,DATA)
                                    249 	.area IABS    (ABS,DATA)
                                    250 ;--------------------------------------------------------
                                    251 ; bit data
                                    252 ;--------------------------------------------------------
                                    253 	.area BSEG    (BIT)
                                    254 ;--------------------------------------------------------
                                    255 ; paged external ram data
                                    256 ;--------------------------------------------------------
                                    257 	.area PSEG    (PAG,XDATA)
                                    258 ;--------------------------------------------------------
                                    259 ; external ram data
                                    260 ;--------------------------------------------------------
                                    261 	.area XSEG    (XDATA)
                                    262 ;--------------------------------------------------------
                                    263 ; absolute external ram data
                                    264 ;--------------------------------------------------------
                                    265 	.area XABS    (ABS,XDATA)
                                    266 ;--------------------------------------------------------
                                    267 ; external initialized ram data
                                    268 ;--------------------------------------------------------
                                    269 	.area XISEG   (XDATA)
                                    270 	.area HOME    (CODE)
                                    271 	.area GSINIT0 (CODE)
                                    272 	.area GSINIT1 (CODE)
                                    273 	.area GSINIT2 (CODE)
                                    274 	.area GSINIT3 (CODE)
                                    275 	.area GSINIT4 (CODE)
                                    276 	.area GSINIT5 (CODE)
                                    277 	.area GSINIT  (CODE)
                                    278 	.area GSFINAL (CODE)
                                    279 	.area CSEG    (CODE)
                                    280 ;--------------------------------------------------------
                                    281 ; interrupt vector
                                    282 ;--------------------------------------------------------
                                    283 	.area HOME    (CODE)
      000000                        284 __interrupt_vect:
      000000 02 00 06         [24]  285 	ljmp	__sdcc_gsinit_startup
                                    286 ;--------------------------------------------------------
                                    287 ; global & static initialisations
                                    288 ;--------------------------------------------------------
                                    289 	.area HOME    (CODE)
                                    290 	.area GSINIT  (CODE)
                                    291 	.area GSFINAL (CODE)
                                    292 	.area GSINIT  (CODE)
                                    293 	.globl __sdcc_gsinit_startup
                                    294 	.globl __sdcc_program_startup
                                    295 	.globl __start__stack
                                    296 	.globl __mcs51_genXINIT
                                    297 	.globl __mcs51_genXRAMCLEAR
                                    298 	.globl __mcs51_genRAMCLEAR
                                    299 	.area GSFINAL (CODE)
      00005F 02 00 03         [24]  300 	ljmp	__sdcc_program_startup
                                    301 ;--------------------------------------------------------
                                    302 ; Home
                                    303 ;--------------------------------------------------------
                                    304 	.area HOME    (CODE)
                                    305 	.area HOME    (CODE)
      000003                        306 __sdcc_program_startup:
      000003 02 01 7A         [24]  307 	ljmp	_main
                                    308 ;	return from main will return to caller
                                    309 ;--------------------------------------------------------
                                    310 ; code
                                    311 ;--------------------------------------------------------
                                    312 	.area CSEG    (CODE)
                                    313 ;------------------------------------------------------------
                                    314 ;Allocation info for local variables in function 'HC575_write'
                                    315 ;------------------------------------------------------------
                                    316 ;value                     Allocated to registers r7 
                                    317 ;i                         Allocated to registers r6 
                                    318 ;------------------------------------------------------------
                                    319 ;	01_button_led_matrix/button_led_matrix.c:188: void HC575_write(uint8_t value) {
                                    320 ;	-----------------------------------------
                                    321 ;	 function HC575_write
                                    322 ;	-----------------------------------------
      000062                        323 _HC575_write:
                           000007   324 	ar7 = 0x07
                           000006   325 	ar6 = 0x06
                           000005   326 	ar5 = 0x05
                           000004   327 	ar4 = 0x04
                           000003   328 	ar3 = 0x03
                           000002   329 	ar2 = 0x02
                           000001   330 	ar1 = 0x01
                           000000   331 	ar0 = 0x00
      000062 AF 82            [24]  332 	mov	r7,dpl
                                    333 ;	01_button_led_matrix/button_led_matrix.c:189: SRCLK=0;
                                    334 ;	assignBit
      000064 C2 B6            [12]  335 	clr	_P3_6
                                    336 ;	01_button_led_matrix/button_led_matrix.c:190: RCLK=0;
                                    337 ;	assignBit
      000066 C2 B5            [12]  338 	clr	_P3_5
                                    339 ;	01_button_led_matrix/button_led_matrix.c:191: for(uint8_t i=0; i<8; i++) {
      000068 7E 00            [12]  340 	mov	r6,#0x00
      00006A                        341 00103$:
      00006A BE 08 00         [24]  342 	cjne	r6,#0x08,00116$
      00006D                        343 00116$:
      00006D 50 16            [24]  344 	jnc	00101$
                                    345 ;	01_button_led_matrix/button_led_matrix.c:192: SER = value >> 7;
      00006F EF               [12]  346 	mov	a,r7
      000070 23               [12]  347 	rl	a
      000071 54 01            [12]  348 	anl	a,#0x01
                                    349 ;	assignBit
      000073 24 FF            [12]  350 	add	a,#0xff
      000075 92 B4            [24]  351 	mov	_P3_4,c
                                    352 ;	01_button_led_matrix/button_led_matrix.c:193: value <<= 1;
      000077 8F 05            [24]  353 	mov	ar5,r7
      000079 ED               [12]  354 	mov	a,r5
      00007A 2D               [12]  355 	add	a,r5
      00007B FF               [12]  356 	mov	r7,a
                                    357 ;	01_button_led_matrix/button_led_matrix.c:194: SRCLK = 1;
                                    358 ;	assignBit
      00007C D2 B6            [12]  359 	setb	_P3_6
                                    360 ;	01_button_led_matrix/button_led_matrix.c:195: NOP();
      00007E 00               [12]  361 	NOP	
                                    362 ;	01_button_led_matrix/button_led_matrix.c:196: NOP();
      00007F 00               [12]  363 	NOP	
                                    364 ;	01_button_led_matrix/button_led_matrix.c:197: SRCLK = 0;
                                    365 ;	assignBit
      000080 C2 B6            [12]  366 	clr	_P3_6
                                    367 ;	01_button_led_matrix/button_led_matrix.c:191: for(uint8_t i=0; i<8; i++) {
      000082 0E               [12]  368 	inc	r6
      000083 80 E5            [24]  369 	sjmp	00103$
      000085                        370 00101$:
                                    371 ;	01_button_led_matrix/button_led_matrix.c:199: RCLK = 1;
                                    372 ;	assignBit
      000085 D2 B5            [12]  373 	setb	_P3_5
                                    374 ;	01_button_led_matrix/button_led_matrix.c:200: NOP();
      000087 00               [12]  375 	NOP	
                                    376 ;	01_button_led_matrix/button_led_matrix.c:201: NOP();
      000088 00               [12]  377 	NOP	
                                    378 ;	01_button_led_matrix/button_led_matrix.c:202: RCLK = 0;
                                    379 ;	assignBit
      000089 C2 B5            [12]  380 	clr	_P3_5
                                    381 ;	01_button_led_matrix/button_led_matrix.c:203: }
      00008B 22               [24]  382 	ret
                                    383 ;------------------------------------------------------------
                                    384 ;Allocation info for local variables in function 'scan_keypad'
                                    385 ;------------------------------------------------------------
                                    386 ;	01_button_led_matrix/button_led_matrix.c:209: void scan_keypad(void) {
                                    387 ;	-----------------------------------------
                                    388 ;	 function scan_keypad
                                    389 ;	-----------------------------------------
      00008C                        390 _scan_keypad:
                                    391 ;	01_button_led_matrix/button_led_matrix.c:210: GPIO_KEYPAD = 0x0F; // Enable P10..P13 (all rows) to see if any key is pressed
      00008C 75 90 0F         [24]  392 	mov	_P1,#0x0f
                                    393 ;	01_button_led_matrix/button_led_matrix.c:211: NOP(); NOP();
      00008F 00               [12]  394 	NOP	
      000090 00               [12]  395 	NOP	
                                    396 ;	01_button_led_matrix/button_led_matrix.c:212: key_value = -1; // Assume no key pressed
      000091 75 08 FF         [24]  397 	mov	_key_value,#0xff
                                    398 ;	01_button_led_matrix/button_led_matrix.c:213: if(GPIO_KEYPAD != 0x0F) { // A key is pressed, shorted to ground
      000094 74 0F            [12]  399 	mov	a,#0x0f
      000096 B5 90 02         [24]  400 	cjne	a,_P1,00157$
      000099 80 64            [24]  401 	sjmp	00114$
      00009B                        402 00157$:
                                    403 ;	01_button_led_matrix/button_led_matrix.c:214: switch (GPIO_KEYPAD) {
      00009B AF 90            [24]  404 	mov	r7,_P1
      00009D BF 07 02         [24]  405 	cjne	r7,#0x07,00158$
      0000A0 80 0F            [24]  406 	sjmp	00101$
      0000A2                        407 00158$:
      0000A2 BF 0B 02         [24]  408 	cjne	r7,#0x0b,00159$
      0000A5 80 0F            [24]  409 	sjmp	00102$
      0000A7                        410 00159$:
      0000A7 BF 0D 02         [24]  411 	cjne	r7,#0x0d,00160$
      0000AA 80 0F            [24]  412 	sjmp	00103$
      0000AC                        413 00160$:
                                    414 ;	01_button_led_matrix/button_led_matrix.c:215: case 0x07: // Column 0
      0000AC BF 0E 14         [24]  415 	cjne	r7,#0x0e,00105$
      0000AF 80 0F            [24]  416 	sjmp	00104$
      0000B1                        417 00101$:
                                    418 ;	01_button_led_matrix/button_led_matrix.c:216: key_value = 0;
      0000B1 75 08 00         [24]  419 	mov	_key_value,#0x00
                                    420 ;	01_button_led_matrix/button_led_matrix.c:217: break;
                                    421 ;	01_button_led_matrix/button_led_matrix.c:218: case 0x0B: // Column 1
      0000B4 80 0D            [24]  422 	sjmp	00105$
      0000B6                        423 00102$:
                                    424 ;	01_button_led_matrix/button_led_matrix.c:219: key_value = 1;
      0000B6 75 08 01         [24]  425 	mov	_key_value,#0x01
                                    426 ;	01_button_led_matrix/button_led_matrix.c:220: break;
                                    427 ;	01_button_led_matrix/button_led_matrix.c:221: case 0x0D: // Column 2
      0000B9 80 08            [24]  428 	sjmp	00105$
      0000BB                        429 00103$:
                                    430 ;	01_button_led_matrix/button_led_matrix.c:222: key_value = 2;
      0000BB 75 08 02         [24]  431 	mov	_key_value,#0x02
                                    432 ;	01_button_led_matrix/button_led_matrix.c:223: break;
                                    433 ;	01_button_led_matrix/button_led_matrix.c:224: case 0x0E: // Column 3
      0000BE 80 03            [24]  434 	sjmp	00105$
      0000C0                        435 00104$:
                                    436 ;	01_button_led_matrix/button_led_matrix.c:225: key_value = 3;
      0000C0 75 08 03         [24]  437 	mov	_key_value,#0x03
                                    438 ;	01_button_led_matrix/button_led_matrix.c:227: }
      0000C3                        439 00105$:
                                    440 ;	01_button_led_matrix/button_led_matrix.c:228: NOP();
      0000C3 00               [12]  441 	NOP	
                                    442 ;	01_button_led_matrix/button_led_matrix.c:229: NOP();
      0000C4 00               [12]  443 	NOP	
                                    444 ;	01_button_led_matrix/button_led_matrix.c:231: GPIO_KEYPAD = 0xF0;
      0000C5 75 90 F0         [24]  445 	mov	_P1,#0xf0
                                    446 ;	01_button_led_matrix/button_led_matrix.c:232: NOP();
      0000C8 00               [12]  447 	NOP	
                                    448 ;	01_button_led_matrix/button_led_matrix.c:233: NOP();
      0000C9 00               [12]  449 	NOP	
                                    450 ;	01_button_led_matrix/button_led_matrix.c:234: if (key_value != -1) {
      0000CA 74 FF            [12]  451 	mov	a,#0xff
      0000CC B5 08 02         [24]  452 	cjne	a,_key_value,00162$
      0000CF 80 2E            [24]  453 	sjmp	00114$
      0000D1                        454 00162$:
                                    455 ;	01_button_led_matrix/button_led_matrix.c:235: switch (GPIO_KEYPAD) {
      0000D1 AF 90            [24]  456 	mov	r7,_P1
      0000D3 BF 70 02         [24]  457 	cjne	r7,#0x70,00163$
      0000D6 80 27            [24]  458 	sjmp	00114$
      0000D8                        459 00163$:
      0000D8 BF B0 02         [24]  460 	cjne	r7,#0xb0,00164$
      0000DB 80 0C            [24]  461 	sjmp	00107$
      0000DD                        462 00164$:
      0000DD BF D0 02         [24]  463 	cjne	r7,#0xd0,00165$
      0000E0 80 0F            [24]  464 	sjmp	00108$
      0000E2                        465 00165$:
                                    466 ;	01_button_led_matrix/button_led_matrix.c:236: case 0x70: // Row 0
      0000E2 BF E0 1A         [24]  467 	cjne	r7,#0xe0,00114$
      0000E5 80 12            [24]  468 	sjmp	00109$
                                    469 ;	01_button_led_matrix/button_led_matrix.c:237: key_value += 0;
                                    470 ;	01_button_led_matrix/button_led_matrix.c:238: break;
                                    471 ;	01_button_led_matrix/button_led_matrix.c:239: case 0xB0: // Row 1
      0000E7 80 16            [24]  472 	sjmp	00114$
      0000E9                        473 00107$:
                                    474 ;	01_button_led_matrix/button_led_matrix.c:240: key_value += 4;
      0000E9 E5 08            [12]  475 	mov	a,_key_value
      0000EB 24 04            [12]  476 	add	a,#0x04
      0000ED F5 08            [12]  477 	mov	_key_value,a
                                    478 ;	01_button_led_matrix/button_led_matrix.c:241: break;
                                    479 ;	01_button_led_matrix/button_led_matrix.c:242: case 0xD0: // Row 2
      0000EF 80 0E            [24]  480 	sjmp	00114$
      0000F1                        481 00108$:
                                    482 ;	01_button_led_matrix/button_led_matrix.c:243: key_value += 8;
      0000F1 74 08            [12]  483 	mov	a,#0x08
      0000F3 25 08            [12]  484 	add	a,_key_value
      0000F5 F5 08            [12]  485 	mov	_key_value,a
                                    486 ;	01_button_led_matrix/button_led_matrix.c:244: break;
                                    487 ;	01_button_led_matrix/button_led_matrix.c:245: case 0xE0: // Row 3
      0000F7 80 06            [24]  488 	sjmp	00114$
      0000F9                        489 00109$:
                                    490 ;	01_button_led_matrix/button_led_matrix.c:246: key_value += 12;
      0000F9 74 0C            [12]  491 	mov	a,#0x0c
      0000FB 25 08            [12]  492 	add	a,_key_value
      0000FD F5 08            [12]  493 	mov	_key_value,a
                                    494 ;	01_button_led_matrix/button_led_matrix.c:248: }
      0000FF                        495 00114$:
                                    496 ;	01_button_led_matrix/button_led_matrix.c:251: GPIO_KEYPAD = 0x00; // Disable all rows and columns
      0000FF 75 90 00         [24]  497 	mov	_P1,#0x00
                                    498 ;	01_button_led_matrix/button_led_matrix.c:252: NOP(); NOP();
      000102 00               [12]  499 	NOP	
      000103 00               [12]  500 	NOP	
                                    501 ;	01_button_led_matrix/button_led_matrix.c:253: }
      000104 22               [24]  502 	ret
                                    503 ;------------------------------------------------------------
                                    504 ;Allocation info for local variables in function 'display_digit'
                                    505 ;------------------------------------------------------------
                                    506 ;digit                     Allocated to registers r7 
                                    507 ;i                         Allocated to registers r6 
                                    508 ;scan_line                 Allocated to registers r5 
                                    509 ;------------------------------------------------------------
                                    510 ;	01_button_led_matrix/button_led_matrix.c:255: void display_digit(int8_t digit) {
                                    511 ;	-----------------------------------------
                                    512 ;	 function display_digit
                                    513 ;	-----------------------------------------
      000105                        514 _display_digit:
      000105 AF 82            [24]  515 	mov	r7,dpl
                                    516 ;	01_button_led_matrix/button_led_matrix.c:256: if(digit > 0x0F || digit < 0) return; // Invalid digit
      000107 C3               [12]  517 	clr	c
      000108 74 8F            [12]  518 	mov	a,#(0x0f ^ 0x80)
      00010A 8F F0            [24]  519 	mov	b,r7
      00010C 63 F0 80         [24]  520 	xrl	b,#0x80
      00010F 95 F0            [12]  521 	subb	a,b
      000111 40 04            [24]  522 	jc	00101$
      000113 EF               [12]  523 	mov	a,r7
      000114 30 E7 01         [24]  524 	jnb	acc.7,00102$
      000117                        525 00101$:
      000117 22               [24]  526 	ret
      000118                        527 00102$:
                                    528 ;	01_button_led_matrix/button_led_matrix.c:257: P0 = 0xFF;
      000118 75 80 FF         [24]  529 	mov	_P0,#0xff
                                    530 ;	01_button_led_matrix/button_led_matrix.c:259: for(uint8_t i=0; i<8; i++) {
      00011B 7E 00            [12]  531 	mov	r6,#0x00
      00011D                        532 00106$:
      00011D BE 08 00         [24]  533 	cjne	r6,#0x08,00125$
      000120                        534 00125$:
      000120 50 57            [24]  535 	jnc	00108$
                                    536 ;	01_button_led_matrix/button_led_matrix.c:260: P0 = ~matrix_chars[i+(digit*8)];
      000122 8E 04            [24]  537 	mov	ar4,r6
      000124 7D 00            [12]  538 	mov	r5,#0x00
      000126 EF               [12]  539 	mov	a,r7
      000127 FA               [12]  540 	mov	r2,a
      000128 33               [12]  541 	rlc	a
      000129 95 E0            [12]  542 	subb	a,acc
      00012B C4               [12]  543 	swap	a
      00012C 03               [12]  544 	rr	a
      00012D 54 F8            [12]  545 	anl	a,#0xf8
      00012F CA               [12]  546 	xch	a,r2
      000130 C4               [12]  547 	swap	a
      000131 03               [12]  548 	rr	a
      000132 CA               [12]  549 	xch	a,r2
      000133 6A               [12]  550 	xrl	a,r2
      000134 CA               [12]  551 	xch	a,r2
      000135 54 F8            [12]  552 	anl	a,#0xf8
      000137 CA               [12]  553 	xch	a,r2
      000138 6A               [12]  554 	xrl	a,r2
      000139 FB               [12]  555 	mov	r3,a
      00013A EA               [12]  556 	mov	a,r2
      00013B 2C               [12]  557 	add	a,r4
      00013C FC               [12]  558 	mov	r4,a
      00013D EB               [12]  559 	mov	a,r3
      00013E 3D               [12]  560 	addc	a,r5
      00013F FD               [12]  561 	mov	r5,a
      000140 EC               [12]  562 	mov	a,r4
      000141 24 96            [12]  563 	add	a,#_matrix_chars
      000143 F5 82            [12]  564 	mov	dpl,a
      000145 ED               [12]  565 	mov	a,r5
      000146 34 01            [12]  566 	addc	a,#(_matrix_chars >> 8)
      000148 F5 83            [12]  567 	mov	dph,a
      00014A E4               [12]  568 	clr	a
      00014B 93               [24]  569 	movc	a,@a+dptr
      00014C F4               [12]  570 	cpl	a
      00014D F5 80            [12]  571 	mov	_P0,a
                                    572 ;	01_button_led_matrix/button_led_matrix.c:261: uint8_t scan_line = 7-i; // Scan from top to bottom
      00014F 8E 05            [24]  573 	mov	ar5,r6
      000151 74 07            [12]  574 	mov	a,#0x07
      000153 C3               [12]  575 	clr	c
      000154 9D               [12]  576 	subb	a,r5
      000155 FD               [12]  577 	mov	r5,a
                                    578 ;	01_button_led_matrix/button_led_matrix.c:262: HC575_write((1 << scan_line)); // invert since active low
      000156 8D F0            [24]  579 	mov	b,r5
      000158 05 F0            [12]  580 	inc	b
      00015A 74 01            [12]  581 	mov	a,#0x01
      00015C 80 02            [24]  582 	sjmp	00129$
      00015E                        583 00127$:
      00015E 25 E0            [12]  584 	add	a,acc
      000160                        585 00129$:
      000160 D5 F0 FB         [24]  586 	djnz	b,00127$
      000163 F5 82            [12]  587 	mov	dpl,a
      000165 C0 07            [24]  588 	push	ar7
      000167 C0 06            [24]  589 	push	ar6
      000169 12 00 62         [24]  590 	lcall	_HC575_write
                                    591 ;	01_button_led_matrix/button_led_matrix.c:263: HC575_write(0); // invert since active low, to avoid ghosting
      00016C 75 82 00         [24]  592 	mov	dpl,#0x00
      00016F 12 00 62         [24]  593 	lcall	_HC575_write
      000172 D0 06            [24]  594 	pop	ar6
      000174 D0 07            [24]  595 	pop	ar7
                                    596 ;	01_button_led_matrix/button_led_matrix.c:259: for(uint8_t i=0; i<8; i++) {
      000176 0E               [12]  597 	inc	r6
      000177 80 A4            [24]  598 	sjmp	00106$
      000179                        599 00108$:
                                    600 ;	01_button_led_matrix/button_led_matrix.c:266: }
      000179 22               [24]  601 	ret
                                    602 ;------------------------------------------------------------
                                    603 ;Allocation info for local variables in function 'main'
                                    604 ;------------------------------------------------------------
                                    605 ;	01_button_led_matrix/button_led_matrix.c:268: void main(void) {
                                    606 ;	-----------------------------------------
                                    607 ;	 function main
                                    608 ;	-----------------------------------------
      00017A                        609 _main:
      00017A                        610 00105$:
                                    611 ;	01_button_led_matrix/button_led_matrix.c:270: scan_keypad();
      00017A 12 00 8C         [24]  612 	lcall	_scan_keypad
                                    613 ;	01_button_led_matrix/button_led_matrix.c:271: if(key_value >= 0) {
      00017D E5 08            [12]  614 	mov	a,_key_value
      00017F 20 E7 08         [24]  615 	jb	acc.7,00102$
                                    616 ;	01_button_led_matrix/button_led_matrix.c:272: display_digit(key_value);
      000182 85 08 82         [24]  617 	mov	dpl,_key_value
      000185 12 01 05         [24]  618 	lcall	_display_digit
      000188 80 F0            [24]  619 	sjmp	00105$
      00018A                        620 00102$:
                                    621 ;	01_button_led_matrix/button_led_matrix.c:274: HC575_write(0); // Turn off all rows
      00018A 75 82 00         [24]  622 	mov	dpl,#0x00
      00018D 12 00 62         [24]  623 	lcall	_HC575_write
                                    624 ;	01_button_led_matrix/button_led_matrix.c:277: }
      000190 80 E8            [24]  625 	sjmp	00105$
                                    626 	.area CSEG    (CODE)
                                    627 	.area CONST   (CODE)
      000196                        628 _matrix_chars:
      000196 00                     629 	.db #0x00	; 0
      000197 1C                     630 	.db #0x1c	; 28
      000198 22                     631 	.db #0x22	; 34
      000199 22                     632 	.db #0x22	; 34
      00019A 22                     633 	.db #0x22	; 34
      00019B 22                     634 	.db #0x22	; 34
      00019C 22                     635 	.db #0x22	; 34
      00019D 1C                     636 	.db #0x1c	; 28
      00019E 00                     637 	.db #0x00	; 0
      00019F 08                     638 	.db #0x08	; 8
      0001A0 18                     639 	.db #0x18	; 24
      0001A1 08                     640 	.db #0x08	; 8
      0001A2 08                     641 	.db #0x08	; 8
      0001A3 08                     642 	.db #0x08	; 8
      0001A4 08                     643 	.db #0x08	; 8
      0001A5 1E                     644 	.db #0x1e	; 30
      0001A6 00                     645 	.db #0x00	; 0
      0001A7 1C                     646 	.db #0x1c	; 28
      0001A8 22                     647 	.db #0x22	; 34
      0001A9 04                     648 	.db #0x04	; 4
      0001AA 08                     649 	.db #0x08	; 8
      0001AB 10                     650 	.db #0x10	; 16
      0001AC 3E                     651 	.db #0x3e	; 62
      0001AD 00                     652 	.db #0x00	; 0
      0001AE 00                     653 	.db #0x00	; 0
      0001AF 1C                     654 	.db #0x1c	; 28
      0001B0 22                     655 	.db #0x22	; 34
      0001B1 04                     656 	.db #0x04	; 4
      0001B2 0C                     657 	.db #0x0c	; 12
      0001B3 02                     658 	.db #0x02	; 2
      0001B4 22                     659 	.db #0x22	; 34
      0001B5 1C                     660 	.db #0x1c	; 28
      0001B6 00                     661 	.db #0x00	; 0
      0001B7 00                     662 	.db #0x00	; 0
      0001B8 28                     663 	.db #0x28	; 40
      0001B9 28                     664 	.db #0x28	; 40
      0001BA 3E                     665 	.db #0x3e	; 62
      0001BB 08                     666 	.db #0x08	; 8
      0001BC 08                     667 	.db #0x08	; 8
      0001BD 08                     668 	.db #0x08	; 8
      0001BE 00                     669 	.db #0x00	; 0
      0001BF 3E                     670 	.db #0x3e	; 62
      0001C0 20                     671 	.db #0x20	; 32
      0001C1 38                     672 	.db #0x38	; 56	'8'
      0001C2 04                     673 	.db #0x04	; 4
      0001C3 02                     674 	.db #0x02	; 2
      0001C4 22                     675 	.db #0x22	; 34
      0001C5 1C                     676 	.db #0x1c	; 28
      0001C6 00                     677 	.db #0x00	; 0
      0001C7 0C                     678 	.db #0x0c	; 12
      0001C8 10                     679 	.db #0x10	; 16
      0001C9 3C                     680 	.db #0x3c	; 60
      0001CA 22                     681 	.db #0x22	; 34
      0001CB 22                     682 	.db #0x22	; 34
      0001CC 22                     683 	.db #0x22	; 34
      0001CD 1C                     684 	.db #0x1c	; 28
      0001CE 00                     685 	.db #0x00	; 0
      0001CF 3E                     686 	.db #0x3e	; 62
      0001D0 02                     687 	.db #0x02	; 2
      0001D1 04                     688 	.db #0x04	; 4
      0001D2 08                     689 	.db #0x08	; 8
      0001D3 10                     690 	.db #0x10	; 16
      0001D4 20                     691 	.db #0x20	; 32
      0001D5 20                     692 	.db #0x20	; 32
      0001D6 00                     693 	.db #0x00	; 0
      0001D7 1C                     694 	.db #0x1c	; 28
      0001D8 22                     695 	.db #0x22	; 34
      0001D9 1C                     696 	.db #0x1c	; 28
      0001DA 22                     697 	.db #0x22	; 34
      0001DB 22                     698 	.db #0x22	; 34
      0001DC 22                     699 	.db #0x22	; 34
      0001DD 1C                     700 	.db #0x1c	; 28
      0001DE 00                     701 	.db #0x00	; 0
      0001DF 1C                     702 	.db #0x1c	; 28
      0001E0 22                     703 	.db #0x22	; 34
      0001E1 22                     704 	.db #0x22	; 34
      0001E2 1E                     705 	.db #0x1e	; 30
      0001E3 02                     706 	.db #0x02	; 2
      0001E4 04                     707 	.db #0x04	; 4
      0001E5 18                     708 	.db #0x18	; 24
      0001E6 00                     709 	.db #0x00	; 0
      0001E7 0C                     710 	.db #0x0c	; 12
      0001E8 12                     711 	.db #0x12	; 18
      0001E9 21                     712 	.db #0x21	; 33
      0001EA 3F                     713 	.db #0x3f	; 63
      0001EB 21                     714 	.db #0x21	; 33
      0001EC 21                     715 	.db #0x21	; 33
      0001ED 00                     716 	.db #0x00	; 0
      0001EE 00                     717 	.db #0x00	; 0
      0001EF 3C                     718 	.db #0x3c	; 60
      0001F0 22                     719 	.db #0x22	; 34
      0001F1 3C                     720 	.db #0x3c	; 60
      0001F2 22                     721 	.db #0x22	; 34
      0001F3 22                     722 	.db #0x22	; 34
      0001F4 3C                     723 	.db #0x3c	; 60
      0001F5 00                     724 	.db #0x00	; 0
      0001F6 00                     725 	.db #0x00	; 0
      0001F7 1E                     726 	.db #0x1e	; 30
      0001F8 20                     727 	.db #0x20	; 32
      0001F9 20                     728 	.db #0x20	; 32
      0001FA 20                     729 	.db #0x20	; 32
      0001FB 20                     730 	.db #0x20	; 32
      0001FC 1E                     731 	.db #0x1e	; 30
      0001FD 00                     732 	.db #0x00	; 0
      0001FE 00                     733 	.db #0x00	; 0
      0001FF 3C                     734 	.db #0x3c	; 60
      000200 22                     735 	.db #0x22	; 34
      000201 22                     736 	.db #0x22	; 34
      000202 22                     737 	.db #0x22	; 34
      000203 22                     738 	.db #0x22	; 34
      000204 3C                     739 	.db #0x3c	; 60
      000205 00                     740 	.db #0x00	; 0
      000206 00                     741 	.db #0x00	; 0
      000207 3E                     742 	.db #0x3e	; 62
      000208 20                     743 	.db #0x20	; 32
      000209 38                     744 	.db #0x38	; 56	'8'
      00020A 20                     745 	.db #0x20	; 32
      00020B 20                     746 	.db #0x20	; 32
      00020C 3E                     747 	.db #0x3e	; 62
      00020D 00                     748 	.db #0x00	; 0
      00020E 00                     749 	.db #0x00	; 0
      00020F 3E                     750 	.db #0x3e	; 62
      000210 20                     751 	.db #0x20	; 32
      000211 38                     752 	.db #0x38	; 56	'8'
      000212 20                     753 	.db #0x20	; 32
      000213 20                     754 	.db #0x20	; 32
      000214 20                     755 	.db #0x20	; 32
      000215 00                     756 	.db #0x00	; 0
                                    757 	.area XINIT   (CODE)
                                    758 	.area CABS    (ABS,CODE)
