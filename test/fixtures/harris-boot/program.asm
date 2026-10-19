; Owned real-mode boot-subset program, assembled at ROM offset 0100h.
; DS is zero after reset. Results are observable in the wired RAM banks.
CLI
MOV AX,1234h
MOV [0500h],AX
MOV AX,5678h
MOV [0502h],AX
MOV AX,[0500h]
ADD AX,[0502h]
MOV [0504h],AX
HLT
