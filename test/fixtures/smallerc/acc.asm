bits 16

; glb total : int
section .bss
	alignb 2
	global	_total
_total:
	resb	2

; RPN'ized expression: "8 "
; Expanded expression: "8 "
; Expression value: 8
; glb table : [8u] int
section .bss
	alignb 2
	global	_table
_table:
	resb	16

; glb add3 : (
; prm     a : int
; prm     b : int
; prm     c : int
;     ) int
section .text
	global	_add3
_add3:
	push	bp
	mov	bp, sp
	;sub	sp,          0
; loc     a : (@4) : int
; loc     b : (@6) : int
; loc     c : (@8) : int
; return
; RPN'ized expression: "a b + c + "
; Expanded expression: "(@4) *(2) (@6) *(2) + (@8) *(2) + "
; Fused expression:    "+ *(@4) *(@6) + ax *(@8)  "
	mov	ax, [bp+4]
	add	ax, [bp+6]
	add	ax, [bp+8]
L1:
	leave
	ret

; glb square : (
; prm     n : int
;     ) int
section .text
	global	_square
_square:
	push	bp
	mov	bp, sp
	;sub	sp,          0
; loc     n : (@4) : int
; return
; RPN'ized expression: "n n * "
; Expanded expression: "(@4) *(2) (@4) *(2) * "
; Fused expression:    "* *(@4) *(@4)  "
	mov	ax, [bp+4]
	mul	word [bp+4]
L3:
	leave
	ret

; glb main : (void) int
section .text
	global	_main
_main:
	push	bp
	mov	bp, sp
	 sub	sp,          4
; loc     i : (@-2) : int
; loc     s : (@-4) : int
; for
; RPN'ized expression: "i 0 = "
; Expanded expression: "(@-2) 0 =(2) "
; Fused expression:    "=(170) *(@-2) 0 "
	mov	ax, 0
	mov	[bp-2], ax
L7:
; RPN'ized expression: "i 8 < "
; Expanded expression: "(@-2) *(2) 8 < "
; Fused expression:    "< *(@-2) 8 IF! "
	mov	ax, [bp-2]
	cmp	ax, 8
	jge	L10
; RPN'ized expression: "i ++p "
; Expanded expression: "(@-2) ++p(2) "
; RPN'ized expression: "table i + *u ( i square ) = "
; Expanded expression: "table (@-2) *(2) 2 * +  (@-2) *(2)  square ()2 =(2) "
; Fused expression:    "* *(@-2) 2 + table ax push-ax ( *(2) (@-2) , square )2 =(170) **sp ax "
	mov	ax, [bp-2]
	imul	ax, ax, 2
	mov	cx, ax
	mov	ax, _table
	add	ax, cx
	push	ax
	push	word [bp-2]
	call	_square
	sub	sp, -2
	pop	bx
	mov	[bx], ax
L8:
; Fused expression:    "++p(2) *(@-2) "
	mov	ax, [bp-2]
	inc	word [bp-2]
	jmp	L7
L10:
; RPN'ized expression: "s 0 = "
; Expanded expression: "(@-4) 0 =(2) "
; Fused expression:    "=(170) *(@-4) 0 "
	mov	ax, 0
	mov	[bp-4], ax
; for
; RPN'ized expression: "i 0 = "
; Expanded expression: "(@-2) 0 =(2) "
; Fused expression:    "=(170) *(@-2) 0 "
	mov	ax, 0
	mov	[bp-2], ax
L11:
; RPN'ized expression: "i 8 < "
; Expanded expression: "(@-2) *(2) 8 < "
; Fused expression:    "< *(@-2) 8 IF! "
	mov	ax, [bp-2]
	cmp	ax, 8
	jge	L14
; RPN'ized expression: "i ++p "
; Expanded expression: "(@-2) ++p(2) "
; RPN'ized expression: "s s table i + *u + = "
; Expanded expression: "(@-4) (@-4) *(2) table (@-2) *(2) 2 * + *(2) + =(2) "
; Fused expression:    "* *(@-2) 2 + table ax + *(@-4) *ax =(170) *(@-4) ax "
	mov	ax, [bp-2]
	imul	ax, ax, 2
	mov	cx, ax
	mov	ax, _table
	add	ax, cx
	mov	bx, ax
	mov	cx, [bx]
	mov	ax, [bp-4]
	add	ax, cx
	mov	[bp-4], ax
L12:
; Fused expression:    "++p(2) *(@-2) "
	mov	ax, [bp-2]
	inc	word [bp-2]
	jmp	L11
L14:
; RPN'ized expression: "total s ( 3 , 2 , 1 add3 ) + = "
; Expanded expression: "total (@-4) *(2)  3  2  1  add3 ()6 + =(2) "
; Fused expression:    "( 3 , 2 , 1 , add3 )6 + *(@-4) ax =(170) *total ax "
	push	3
	push	2
	push	1
	call	_add3
	sub	sp, -6
	mov	cx, ax
	mov	ax, [bp-4]
	add	ax, cx
	mov	[_total], ax
; return
; RPN'ized expression: "total "
; Expanded expression: "total *(2) "
; Fused expression:    "*(2) total  "
	mov	ax, [_total]
	jmp	L5
; Fused expression:    "0  "
	mov	ax, 0
L5:
	leave
	ret



; Syntax/declaration table/stack:
; Bytes used: 200/15360


; Macro table:
; Macro __SMALLER_C__ = `0x0100`
; Macro __SMALLER_C_16__ = ``
; Macro __SMALLER_C_SCHAR__ = ``
; Macro __SMALLER_C_UWCHAR__ = ``
; Macro __SMALLER_C_WCHAR16__ = ``
; Bytes used: 110/5120


; Identifier table:
; Ident 
; Ident __floatsisf
; Ident __floatunsisf
; Ident __fixsfsi
; Ident __fixunssfsi
; Ident __addsf3
; Ident __subsf3
; Ident __negsf2
; Ident __mulsf3
; Ident __divsf3
; Ident __lesf2
; Ident __gesf2
; Ident total
; Ident table
; Ident add3
; Ident a
; Ident b
; Ident c
; Ident square
; Ident n
; Ident main
; Ident <something>
; Bytes used: 182/5632

; Next label number: 15
; Compilation succeeded.
