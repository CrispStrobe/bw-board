; Original teaching-computer monitor for Intel 8049, 6 MHz.
; Main code uses register bank 0. The timer interrupt owns bank 1.
PC = 0x20
ACCH = 0x21
ACCL = 0x22
CAPACITY = 0x23
POINTER = 0x24
KEY = 0x26
TICK = 0x27
DIGITS = 0x28
COMPARE = 0x29
MODE = 0x2A
P1_LATCH = 0x2B
P2_LATCH = 0x2C
P4_LATCH = 0x2D
P5_LATCH = 0x2E
ERROR = 0x2F
FRAME = 0x30
ENTRY = 0x36

BASE_RAM = 0x2F
EXT_RAM = 0x1F
BASE_IO = 0xAF
EXT_IO = 0x9F
SCAN_RELOAD = 242 ; 14 timer increments at 80 microseconds each
GLYPH_A = 0x77
GLYPH_C = 0x39
GLYPH_E = 0x79
GLYPH_F = 0x71
GLYPH_P = 0x73
KEY_STP = 16
TAPE_DIRECTION = 0x40
TAPE_DATA = 0x80
TAPE_SHORT = 29
TAPE_LONG = 59
TAPE_MAX = 100
TAPE_MIN = 12
TAPE_SKEW = 8

.org 0
JMP reset
.org 3
RETR
.org 7
; Six equal slots. Save bus control pins before switching to display I/O.
SEL RB1
XCH A,R7
MOV A,#SCAN_RELOAD
MOV T,A
IN A,P2
ORL A,#0x0F
MOV R6,A
MOV A,#BASE_IO
OUTL P2,A
MOV R0,#TICK
INC @R0
MOV R0,#3
MOV A,#0x3F
MOVX @R0,A
MOV A,R2
ADD A,#FRAME
MOV R0,A
MOV A,@R0
MOV R0,#1
MOVX @R0,A
MOV R0,#3
MOV A,R3
MOVX @R0,A
MOV A,R2
JZ scan_next
IN A,P2
ANL A,#0x0F
JZ scan_no_contact
MOV R5,A
MOV A,R4
JNZ scan_keep_contact
MOV A,R2
ADD A,#row_keys-1
MOVP A,@A
MOV R1,A
MOV A,R5
MOV R0,#KEY
scan_column:
RRC A
JC scan_found
INC R1
JMP scan_column
scan_found:
MOV A,R1
ADD A,#-24
JNC scan_enqueue
JB1 scan_upper_column
ADD A,#8
JMP scan_mapped
scan_upper_column:
ADD A,#16
scan_mapped:
MOV R1,A
scan_enqueue:
MOV A,R1
XRL A,#KEY_STP
JZ scan_write_key
MOV A,@R0
INC A
JNZ scan_keep_contact
scan_write_key:
MOV A,R1
MOV @R0,A
scan_keep_contact:
MOV R4,#6
JMP scan_advance
scan_next:
scan_no_contact:
MOV A,R4
JZ scan_advance
DEC R4
scan_advance:
MOV A,R2
JZ scan_wrap
DEC R2
MOV A,R3
RL A
MOV R3,A
JMP scan_exit
scan_wrap:
MOV R2,#5
MOV R3,#0xFE
scan_exit:
MOV A,R6
OUTL P2,A
XCH A,R7
RETR

; The third row has a discontinuity after numeric keys 8 and 9.
; Encode that row as 24–27 and decode them to 8, 9, 18, and 19.
row_keys:
.byte 0,4,24,14,10

reset:
SEL RB0
DIS I
DIS TCNTI
STOP TCNT
MOV A,#BASE_IO
OUTL P2,A
MOV R0,#0
MOV A,#0x0F
MOVX @R0,A
MOV R0,#3
MOV A,#0x3F
MOVX @R0,A
MOV R0,#1
CLR A
MOVX @R0,A
INC R0
MOV A,#0xFF
MOVX @R0,A
OUTL P1,A

MOV A,#EXT_IO
OUTL P2,A
MOV R0,#0
MOV A,#0x0D
MOVX @R0,A
INC R0
MOV A,#0xFF
MOVX @R0,A
MOV R0,#3
MOV A,#0x3F
MOVX @R0,A

MOV R0,#PC
MOV R1,#ENTRY-PC+5
CLR A
reset_variables:
MOV @R0,A
INC R0
DJNZ R1,reset_variables
MOV R0,#P1_LATCH
MOV @R0,#0xFF
INC R0
MOV @R0,#0xFF
INC R0
MOV @R0,#0xFF
INC R0
MOV @R0,#0x3F
MOV R0,#KEY
MOV @R0,#0xFF

MOV A,#EXT_RAM
OUTL P2,A
MOV R1,#0
MOVX A,@R1
MOV R2,A
MOV A,#0xA5
MOVX @R1,A
MOVX A,@R1
XRL A,#0xA5
JNZ reset_no_expansion
MOV A,R2
MOVX @R1,A
MOV A,#255
JMP finish_reset
reset_no_expansion:
MOV A,#127
JMP finish_reset

.org 0x100
monitor_idle:
CALL take_key
JZ monitor_idle
MOV A,R7
XRL A,#KEY_STP
JZ monitor_idle
CALL clear_error
MOV A,R7
ADD A,#-10
JC panel_special
JMP panel_digit
panel_special:
ADD A,#panel_keys & 255
JMPP @A
; Special keys 10–19 follow electrical row and column order.
panel_keys:
.targets panel_save,panel_clr,panel_pc,panel_acc,panel_load
.targets panel_step,panel_stp,panel_run,panel_out,panel_inp

panel_save:
JMP cassette_save
panel_load:
JMP cassette_load
panel_clr:
CALL clear_frame
JMP panel_stp
panel_acc:
CALL show_acc
panel_stp:
JMP monitor_idle

panel_pc:
LD DIGITS
JZ show_pc_local
XRL A,#3
JNZ wrong_digits
CALL parse_address
JC bad_entry
ST PC
show_pc_local:
JMP show_pc

panel_step:
MOV A,#1
JMP start_execution
panel_run:
LD DIGITS
XRL A,#1
JNZ panel_normal_run
LD ENTRY
XRL A,#9
JZ panel_self_test
XRL A,#1
JZ panel_reaction
panel_normal_run:
CLR A
JMP start_execution
panel_self_test:
JMP self_test
panel_reaction:
JMP reaction_test

panel_out:
LD DIGITS
JZ out_next
XRL A,#3
JZ out_selected
XRL A,#2
JNZ wrong_digits
LD ENTRY
XRL A,#9
JNZ wrong_digits
LD POINTER
MOV R6,A
MOV R7,#GLYPH_C
CALL show_address
JMP monitor_idle
out_selected:
CALL parse_address
JC bad_entry
ST POINTER
JMP show_word
out_next:
LD POINTER
MOV R6,A
CALL advance_pointer
JZ bad_entry
ST POINTER
show_word:
CALL read_word
MOV R7,#GLYPH_C
CALL show_full
JMP monitor_idle

panel_inp:
LD DIGITS
XRL A,#3
JZ inp_select
XRL A,#6
JNZ wrong_digits
MOV R0,#ENTRY
MOV R1,#2
CALL parse_digits
JC bad_entry
ADD A,#-25
JC bad_entry
ADD A,#25
MOV R4,A
MOV R1,#3
CALL parse_digits
JC bad_entry
MOV R5,A
LD POINTER
MOV R6,A
CALL write_word
CALL advance_pointer
JZ inp_display
ST POINTER
inp_display:
MOV R7,#GLYPH_E
CALL show_full
JMP monitor_idle
inp_select:
CALL parse_address
JC bad_entry
ST POINTER
MOV R7,#GLYPH_E
CALL show_address
JMP monitor_idle

; Move R6 to the next selected cell if one exists. Z marks saturation.
advance_pointer:
LD CAPACITY
XRL A,R6
JZ pointer_final
INC R6
MOV A,R6
pointer_final:
RET

wrong_digits:
MOV A,#1
JMP raise_error
bad_entry:
JMP keypad_range

panel_digit:
JMP enter_digit

.org 0x200
take_key:
MOV R0,#KEY
MOV A,#0xFF
XCH A,@R0
MOV R7,A
INC A
RET

clear_error:
CLR A
ST ERROR
RET

clear_frame:
CLR A
ST DIGITS
MOV R0,#FRAME
MOV R1,#6
clear_digit:
MOV @R0,A
INC R0
DJNZ R1,clear_digit
RET

enter_digit:
LD DIGITS
JNZ digit_not_first
CALL clear_frame
CLR A
digit_not_first:
XRL A,#5
JZ sixth_digit
XRL A,#5
MOV R2,A
ADD A,#ENTRY
MOV R0,A
MOV A,R7
MOV @R0,A
MOV R0,#DIGITS
INC @R0
MOV R0,#FRAME
MOV R1,#FRAME+1
MOV R3,#5
shift_digit:
MOV A,@R1
MOV @R0,A
INC R0
INC R1
DJNZ R3,shift_digit
MOV A,R7
MOVP3 A,@A
MOV @R0,A
JMP monitor_idle
sixth_digit:
MOV A,#1
JMP raise_error

; Consume one or more decimal digits from R0, with an 8-bit range check.
; A holds the result and R0 points after the digits.
parse_digits:
MOV R2,#0
parse_digit:
MOV A,R2
ADD A,#-26
JC parse_overflow
; Compute 10 * prefix as 2 * (4 * prefix + prefix).
MOV A,R2
RL A
RL A
ADD A,R2
RL A
ADD A,@R0
JC parse_overflow
MOV R2,A
INC R0
DJNZ R1,parse_digit
RET
parse_overflow:
; Carry remains set on an invalid result.
RET

parse_address:
MOV R0,#ENTRY
MOV R1,#3
CALL parse_digits
JC address_parse_failed
MOV R6,A
CALL check_capacity
JC address_parse_failed
MOV A,R6
CLR C
RET
address_parse_failed:
CLR C
CPL C
RET

show_pc:
LD PC
MOV R6,A
MOV R7,#GLYPH_P
CALL show_address
JMP monitor_idle

show_acc:
MOV R0,#ACCH
MOV A,@R0
MOV R4,A
INC R0
MOV A,@R0
MOV R5,A
MOV R7,#GLYPH_A
JMP show_full

show_address:
MOV R0,#DIGITS
MOV @R0,#0
MOV R0,#FRAME
MOV A,R7
MOV @R0,A
INC R0
MOV @R0,#0
INC R0
MOV @R0,#0
INC R0
MOV A,R6
JMP render_three

show_full:
MOV R0,#DIGITS
MOV @R0,#0
MOV R0,#FRAME
MOV A,R7
MOV @R0,A
INC R0
; Keep the prefix stable even when ANZ repeatedly displays the same word.
MOV A,R4
high_at_least_hundred:
ADD A,#-100
JC high_at_least_hundred
ADD A,#100
CALL render_two
MOV A,R5

render_three:
MOV R1,#0
hundreds:
ADD A,#-100
JNC hundreds_done
INC R1
JMP hundreds
hundreds_done:
ADD A,#100
MOV R2,A
MOV A,R1
CALL render_digit
MOV A,R2
render_two:
MOV R1,#0
tens:
ADD A,#-10
JNC tens_done
INC R1
JMP tens
tens_done:
ADD A,#10
MOV R2,A
MOV A,R1
CALL render_digit
MOV A,R2
render_digit:
MOVP3 A,@A
MOV @R0,A
INC R0
RET

keypad_range:
MOV A,#4
raise_error:
ST ERROR
MOV R6,A
MOV R7,#GLYPH_F
CALL show_address
error_ready:
JMP monitor_idle

.org 0x300
.byte 0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x27,0x7F,0x6F

start_execution:
ST MODE
CALL clear_frame
teaching_boundary:
CALL take_key
MOV A,R7
XRL A,#KEY_STP
JZ teaching_stop
pre_command:
LD PC
MOV R6,A
CALL check_capacity
JC teaching_range
CALL read_word
MOV A,R5
MOV R6,A
MOV A,R4
MOV R3,A
DEC A
ADD A,#-24
JC teaching_code
ADD A,#(24+command_table) & 255
JMPP @A

; These entries correspond to teaching opcodes 01 through 24.
command_table:
.targets cmd_hlt,cmd_anz,cmd_vzg,cmd_ako,cmd_memory,cmd_memory
.targets cmd_memory,cmd_memory,cmd_jump,cmd_memory,cmd_branch,cmd_memory
.targets cmd_memory,cmd_logic,cmd_memory,cmd_ports,cmd_ports,cmd_ports
.targets cmd_memory,cmd_memory,cmd_memory,cmd_ports,cmd_ports,cmd_ports

cmd_memory:
JMP memory_instruction
cmd_logic:
JMP negate
cmd_ports:
JMP port_instruction

cmd_hlt:
CLR A
ST COMPARE
LD PC
MOV R6,A
LD CAPACITY
XRL A,R6
JZ teaching_pause
INC R6
MOV A,R6
ST PC
teaching_pause:
JMP show_pc

cmd_anz:
CALL show_acc
JMP instruction_done

cmd_vzg:
MOV A,R6
CALL wait_ticks
; Include a short fixed overhead even for a zero delay.
MOV R2,#24
delay_settle:
DJNZ R2,delay_settle
JMP instruction_done

cmd_ako:
MOV A,R6
CALL store_numeric
JMP instruction_done

cmd_branch:
LD COMPARE
JZ instruction_done
cmd_jump:
JMP jump_instruction

instruction_done:
LD PC
INC A
ST PC
MOV R6,A
JZ teaching_range
CALL check_capacity
JC teaching_range
teaching_continue:
LD MODE
JZ teaching_boundary
JMP show_pc

teaching_stop:
MOV R6,#0
CALL read_word
MOV R7,#GLYPH_C
CALL show_full
JMP monitor_idle

teaching_code:
MOV A,#2
JMP raise_error
teaching_range:
MOV A,#3
JMP raise_error
teaching_value:
MOV A,#5
JMP raise_error
teaching_arithmetic:
MOV A,#6
JMP raise_error

; Wait for a modular tick deadline, with A holding the number of ticks.
wait_ticks:
JZ wait_done
MOV R0,#TICK
ADD A,@R0
MOV R2,A
delay_poll:
MOV A,@R0
XRL A,R2
JNZ delay_poll
wait_done:
RET

store_numeric:
MOV R0,#ACCL
MOV @R0,A
MOV R0,#ACCH
MOV @R0,#0
RET

.org 0x400
memory_instruction:
CALL check_capacity
JC memory_range
CALL read_word
MOV A,R3
ADD A,#-19
JC indirect_memory
ADD A,#(14+memory_table) & 255
JMPP @A
memory_table:
.targets memory_load,memory_store,memory_numeric,memory_numeric,memory_range
.targets memory_numeric,memory_range,memory_numeric,memory_numeric,memory_range
.targets memory_numeric

indirect_memory:
MOV A,R5
MOV R6,A
MOV A,R3
XRL A,#21
JZ jump_instruction
CALL check_capacity
JC memory_range
MOV A,R3
XRL A,#20
JZ memory_store
CALL read_word
memory_load:
MOV R0,#ACCH
MOV A,R4
MOV @R0,A
INC R0
MOV A,R5
MOV @R0,A
JMP instruction_done

memory_store:
MOV R0,#ACCH
MOV A,@R0
MOV R4,A
INC R0
MOV A,@R0
MOV R5,A
CALL write_word
JMP instruction_done

jump_instruction:
MOV A,R6
ST PC
CALL check_capacity
JC memory_range
JMP teaching_continue
memory_range:
JMP teaching_range

memory_numeric:
LD ACCH
ORL A,R4
JNZ memory_type
INC R0
MOV A,R3
XRL A,#7
JZ add_word
XRL A,#8
JZ and_word
; ACC + ~data sets carry for greater-than and yields 255 for equality.
MOV A,R5
CPL A
ADD A,@R0
MOV R2,A
MOV A,R3
XRL A,#8
JZ subtract_word
XRL A,#4
JZ compare_greater
XRL A,#1
JZ compare_less
MOV A,R2
INC A
JMP comparison_zero

compare_greater:
JC comparison_true
JMP comparison_false
compare_less:
JC comparison_false
MOV A,R2
INC A
JZ comparison_false
JMP comparison_true
comparison_zero:
JZ comparison_true
comparison_false:
CLR A
JMP save_comparison
comparison_true:
MOV A,#1
save_comparison:
ST COMPARE
JMP instruction_done

add_word:
MOV A,R5
ADD A,@R0
JC arithmetic_range
JMP write_numeric_result
subtract_word:
MOV A,R2
INC A
JC write_numeric_result
JNZ arithmetic_range
write_numeric_result:
MOV @R0,A
JMP instruction_done

and_word:
MOV A,@R0
ORL A,R5
ANL A,#0xFE
JNZ memory_type
MOV A,R5
ANL A,@R0
JMP write_numeric_result

negate:
LD ACCH
JNZ memory_type
INC R0
MOV A,@R0
ANL A,#0xFE
JNZ memory_type
MOV A,@R0
XRL A,#1
JMP write_numeric_result

memory_type:
JMP teaching_value
arithmetic_range:
JMP teaching_arithmetic

; The capacity check leaves R6 alone and sets carry for addresses > maximum.
check_capacity:
LD CAPACITY
CPL A
ADD A,R6
RET

; Read/write select exactly one RAM and translate a word index to a byte offset.
read_word:
CALL select_word
MOVX A,@R0
MOV R4,A
INC R0
MOVX A,@R0
MOV R5,A
RET
write_word:
CALL select_word
MOV A,R4
MOVX @R0,A
INC R0
MOV A,R5
MOVX @R0,A
RET
select_word:
MOV A,R6
JB7 word_in_expansion
MOV A,#BASE_RAM
JMP word_selected
word_in_expansion:
MOV A,#EXT_RAM
word_selected:
OUTL P2,A
MOV A,R6
RL A
ANL A,#0xFE
MOV R0,A
RET

.org 0x500
; R6 selects the line, R3 the teaching opcode. R2 holds the line bit mask
; or all eight bits for a parallel transfer.
port_instruction:
MOV A,R6
ADD A,#-9
JC invalid_port
MOV A,R6
ADD A,#port_masks & 255
MOVP A,@A
MOV R2,A
MOV A,R3
XRL A,#16
JZ p1_read
XRL A,#6
JZ p3_read
MOV A,R3
ADD A,#-16
ADD A,#port_handlers & 255
JMPP @A

port_handlers:
.targets invalid_port,p1_write,p2_write,invalid_port,invalid_port
.targets invalid_port,invalid_port,p4_write,p5_write
port_masks:
.byte 0xFF,1,2,4,8,16,32,64,128

p1_read:
LD P1_LATCH
ORL A,R2
MOV @R0,A
OUTL P1,A
IN A,P1
JMP port_sample

p3_read:
MOV A,#EXT_IO
OUTL P2,A
MOV R0,#2
MOVX A,@R0
port_sample:
ANL A,R2
MOV R2,A
MOV A,R6
JZ port_parallel_sample
MOV A,R2
JZ port_store_sample
MOV R2,#1
port_parallel_sample:
MOV A,R2
port_store_sample:
CALL store_numeric
JMP instruction_done

p1_write:
MOV R1,#P1_LATCH
CALL update_latch
OUTL P1,A
JMP instruction_done

p2_write:
MOV R1,#P2_LATCH
MOV R4,#BASE_IO
MOV R5,#2
JMP write_external_port
p4_write:
MOV R1,#P4_LATCH
MOV R4,#EXT_IO
MOV R5,#1
JMP write_external_port
p5_write:
MOV R1,#P5_LATCH
MOV R4,#EXT_IO
MOV R5,#3
write_external_port:
CALL update_latch
MOV R2,A
MOV A,R4
OUTL P2,A
MOV A,R5
MOV R0,A
MOV A,R2
MOVX @R0,A
JMP instruction_done

; R1 points to latch shadow. An individual write changes one bit.
update_latch:
LD ACCL
MOV R7,A
MOV A,R6
JZ latch_parallel
MOV A,R7
JZ latch_clear_bit
MOV A,@R1
ORL A,R2
JMP latch_clip
latch_clear_bit:
MOV A,R2
CPL A
ANL A,@R1
JMP latch_clip
latch_parallel:
MOV A,R7
latch_clip:
MOV R7,A
; Use the shadow address to identify the six-bit physical port.
MOV A,R1
XRL A,#P5_LATCH
JNZ latch_full_width
MOV A,R7
ANL A,#0x3F
JMP latch_save
latch_full_width:
MOV A,R7
latch_save:
MOV @R1,A
RET
invalid_port:
JMP teaching_value

; Cassette foreground register allocation: R1 offset, R3 bit count, R4
; byte shift register, and R5 selected 8155. The timer still scans the panel.
cassette_begin:
CALL clear_frame
MOV A,R6
ST FRAME
MOV R1,#0
MOV A,#BASE_RAM
MOV R5,A
OUTL P2,A
RET

cassette_next_byte:
; Wire order is 0, 255, 254, ..., 1 in each selected block.
DEC R1
MOV A,R1
JNZ cassette_more
LD CAPACITY
JB7 cassette_select_expansion
cassette_end:
CLR A
RET
cassette_select_expansion:
MOV A,R5
XRL A,#BASE_RAM
JNZ cassette_end
MOV A,#EXT_RAM
MOV R5,A
OUTL P2,A
cassette_more:
MOV A,#1
RET

cassette_latch:
ST P1_LATCH
OUTL P1,A
RET

cassette_status:
ST FRAME
JMP monitor_idle

cassette_stop_requested:
CALL take_key
MOV A,R7
XRL A,#KEY_STP
RET

; Elapsed whole ticks since the last receive edge, modulo 256, and current
; tick in R7. Individual waits time out before the elapsed byte can wrap.
cassette_elapsed:
LD TICK
MOV R7,A
MOV A,R6
CPL A
INC A
ADD A,R7
RET

cassette_edge:
CALL cassette_elapsed
XCH A,R7
MOV R6,A
MOV A,R7
ADD A,#-TAPE_MAX
JC cassette_edge_invalid
ADD A,#TAPE_MAX-TAPE_MIN
JNC cassette_edge_short
ADD A,#TAPE_MIN
RET
cassette_edge_short:
CPL C
cassette_edge_invalid:
RET

.org 0x600
finish_reset:
ST CAPACITY
; A write to two selected 8155s initializes both installed RAM banks.
MOV A,#0x0F
OUTL P2,A
MOV R0,#0
reset_ram_byte:
CLR A
MOVX @R0,A
INC R0
MOV A,R0
JNZ reset_ram_byte

SEL RB1
MOV R2,#5
MOV R3,#0xFE
MOV R4,#0
SEL RB0
MOV A,#BASE_IO
OUTL P2,A
MOV A,#SCAN_RELOAD
MOV T,A
STRT T
EN TCNTI
JMP show_pc

; The panel test makes all six positions follow the same decimal glyph.
self_test:
CALL clear_frame
MOV R6,#9
self_test_digit:
MOV A,R6
MOVP3 A,@A
MOV R0,#FRAME
MOV R1,#6
self_test_fill:
MOV @R0,A
INC R0
DJNZ R1,self_test_fill
MOV A,R6
JZ diagnostics_done
MOV A,#160
CALL wait_ticks
CALL take_key
DEC R6
JMP self_test_digit

reaction_test:
CALL clear_frame
; Poll in short intervals during the blank wait as well as the count.
MOV R6,#50
reaction_blank:
CALL reaction_interval
JZ diagnostics_done
DJNZ R6,reaction_blank
MOV R6,#0
reaction_count:
MOV R0,#FRAME+3
MOV A,R6
CALL render_three
MOV A,R6
INC A
JZ diagnostics_done
CALL reaction_interval
JZ diagnostics_done
INC R6
JMP reaction_count

reaction_interval:
MOV A,#10
CALL wait_ticks
CALL take_key
MOV A,R7
XRL A,#KEY_STP
RET

diagnostics_done:
JMP monitor_idle

; CAS sends the 16.5-second leader and low/high symbols on the actual latch.
cassette_save:
MOV R6,#0x23
CALL cassette_begin
LD P1_LATCH
ORL A,#TAPE_DIRECTION+TAPE_DATA
CALL cassette_latch
MOV R3,#64
save_leader:
MOV A,#230
CALL cassette_wait
JZ save_done
DJNZ R3,save_leader

save_byte:
MOVX A,@R1
MOV R4,A
MOV R3,#8
save_bit:
MOV A,R4
RRC A
MOV R4,A
MOV R6,#TAPE_SHORT
JC save_low
MOV R6,#TAPE_LONG
save_low:
LD P1_LATCH
ANL A,#0x7F
CALL cassette_latch
MOV A,R6
CALL cassette_wait
JZ save_done
LD P1_LATCH
ORL A,#TAPE_DATA
CALL cassette_latch
MOV A,R6
CPL A
ADD A,#TAPE_SHORT+TAPE_LONG+1
CALL cassette_wait
JZ save_done
DJNZ R3,save_bit
CALL cassette_next_byte
JNZ save_byte

save_done:
LD P1_LATCH
ANL A,#0x7F
CALL cassette_latch
MOV A,#0x63
JMP cassette_status

; A is the interval in display ticks. Return zero if STP was accepted.
cassette_wait:
MOV R0,#TICK
ADD A,@R0
MOV R2,A
cassette_wait_poll:
CALL cassette_stop_requested
JZ cassette_wait_return
LD TICK
XRL A,R2
JNZ cassette_wait_poll
INC A
cassette_wait_return:
RET

.org 0x700
; CAL samples the physical pin with the data latch released.
cassette_load:
MOV R6,#0x1C
CALL cassette_begin
LD P1_LATCH
ANL A,#0xBF
ORL A,#TAPE_DATA
CALL cassette_latch
load_wait_high:
CALL cassette_stop_requested
JZ load_done
IN A,P1
ANL A,#TAPE_DATA
JZ load_wait_high
load_wait_start:
CALL cassette_stop_requested
JZ load_done
IN A,P1
JB7 load_wait_start
LD TICK
MOV R6,A

load_byte:
MOV R3,#8
MOV R4,#0
load_low:
CALL cassette_stop_requested
JZ load_done
IN A,P1
JB7 load_rise
CALL cassette_elapsed
ADD A,#-TAPE_MAX
JC load_error
JMP load_low

load_rise:
CALL cassette_edge
JC load_error
MOV R2,A
load_high:
CALL cassette_stop_requested
JZ load_done
IN A,P1
JB7 load_high_wait
CALL cassette_edge
JC load_error

; A holds the high duration. Compute high minus low, with carry for a
; nonnegative result, then reject nearly equal halves.
MOV R7,A
MOV A,R2
CPL A
INC A
ADD A,R7
JC load_one
ADD A,#TAPE_SKEW-1
JC load_error
JMP load_shift
load_one:
ADD A,#-TAPE_SKEW
JNC load_error
load_shift:
MOV A,R4
RRC A
MOV R4,A
DJNZ R3,load_low

; Commit the raw byte only after all eight falling-edge closures.
MOV A,R4
MOVX @R1,A
CALL cassette_next_byte
JNZ load_byte

load_done:
MOV A,#0x5C
JMP cassette_status
load_high_wait:
CALL cassette_elapsed
ADD A,#-TAPE_MAX
JC load_error
JMP load_high
load_error:
MOV A,#7
JMP raise_error
