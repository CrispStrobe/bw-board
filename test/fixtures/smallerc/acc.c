/*
 * The acceptance program for the assembler's 80186 variant.
 *
 * WHY IT IS SHAPED LIKE THIS: it is what a learner writes, not what an
 * instruction-set test writes. A global, a global array, two functions
 * called with arguments, two loops and some arithmetic -- the point is that
 * the compiler reaches for LEAVE, PUSH imm and the three-operand IMUL
 * BECAUSE OF ORDINARY C, not because anything here asked for them.
 *
 * `main` returns 146: 0+1+4+9+16+25+36+49 = 140 from the squares, plus
 * add3(1,2,3) = 6. test/i8086-asm-186.test.mjs checks that number twice --
 * once as the DOS exit code and once by reading the global out of the
 * machine's memory at the address the assembler resolved for it.
 *
 * acc.asm beside this file is `smlrc -seg16 acc.c acc.asm` output, verbatim,
 * checked in so the acceptance test needs no compiler installed. SmallerC is
 * https://github.com/alexfru/SmallerC, BSD-2-Clause, Copyright (c) 2012-2021
 * Alexey Frunze; only its OUTPUT for this file is here, none of its source.
 * The test that regenerates and diffs it runs when $SMLRC names a build.
 */
int total;
int table[8];

int add3(int a, int b, int c) { return a + b + c; }

int square(int n) { return n * n; }

int main(void)
{
    int i;
    int s;
    for (i = 0; i < 8; i++) table[i] = square(i);
    s = 0;
    for (i = 0; i < 8; i++) s = s + table[i];
    total = s + add3(1, 2, 3);
    return total;
}
