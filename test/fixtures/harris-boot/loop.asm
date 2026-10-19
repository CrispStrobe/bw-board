; Owned RAM fill, sum and guest-side check. ROM origin 0100h; DS=0.
MOV BX,0500h
MOV CX,4
MOV AX,1
fill_words:
MOV [BX],AX
INC AX
INC BX
INC BX
LOOP fill_words
MOV BX,0500h
MOV CX,4
MOV AX,0
sum_words:
ADD AX,[BX]
INC BX
INC BX
LOOP sum_words
CMP AX,10
JNE failed
MOV [0510h],AX
HLT
failed:
MOV AX,0DEADh
MOV [0510h],AX
HLT
