/*
 * Twin-run peer: vrEmu6502 (MIT, github.com/visrealm/vrEmu6502) on a flat
 * 64K RAM, emitting one 8-byte binary record per instruction on stdout:
 *   pc_lo pc_hi a x y s p cycles
 * (state AFTER the instruction; cycles = that instruction's cost).
 *
 * The JS side (twinrun-6502.mjs) runs our own W65C02 over the same image
 * and compares record-for-record. Any 6502 binary becomes a CPU
 * differential this way, whatever machine it was written for: unmapped
 * I/O is plain RAM on both sides, identically.
 *
 *   vrpeer <image> <startPC-hex> <maxSteps>
 *
 * Build (vrEmu6502 cloned beside ~/code):
 *   cc -O2 -I ~/code/vrEmu6502/src -o vrpeer vrpeer.c ~/code/vrEmu6502/src/vrEmu6502.c
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "vrEmu6502.h"

static uint8_t mem[0x10000];

static uint8_t memRead(uint16_t addr, bool isDbg) { (void)isDbg; return mem[addr]; }
static void memWrite(uint16_t addr, uint8_t val) { mem[addr] = val; }

int main(int argc, char **argv)
{
    if (argc != 4) { fprintf(stderr, "usage: vrpeer <image> <startPC-hex> <maxSteps>\n"); return 2; }
    FILE *f = fopen(argv[1], "rb");
    if (!f) { perror(argv[1]); return 2; }
    fread(mem, 1, sizeof mem, f);
    fclose(f);
    unsigned start = (unsigned)strtoul(argv[2], NULL, 16);
    long maxSteps = strtol(argv[3], NULL, 10);

    /* Route reset through the vector so both sides begin identically. */
    mem[0xfffc] = start & 0xff;
    mem[0xfffd] = (start >> 8) & 0xff;

    VrEmu6502 *cpu = vrEmu6502New(CPU_W65C02, memRead, memWrite);
    vrEmu6502Reset(cpu);

    uint8_t rec[8];
    /* Record 0: post-reset state, BEFORE any instruction. S and P after
     * reset are implementation lore (real silicon: undefined-ish); the JS
     * side adopts this record so the comparison starts aligned and any
     * LATER stack/flag divergence is a real one. */
    {
        uint16_t pc = vrEmu6502GetPC(cpu);
        rec[0] = pc & 0xff; rec[1] = pc >> 8;
        rec[2] = vrEmu6502GetAcc(cpu); rec[3] = vrEmu6502GetX(cpu);
        rec[4] = vrEmu6502GetY(cpu); rec[5] = vrEmu6502GetStackPointer(cpu);
        rec[6] = vrEmu6502GetStatus(cpu); rec[7] = 0;
        fwrite(rec, 1, 8, stdout);
    }
    uint16_t prevPc = 0xffff;
    for (long i = 0; i < maxSteps; i++) {
        uint8_t cycles = vrEmu6502InstCycle(cpu);
        uint16_t pc = vrEmu6502GetPC(cpu);
        rec[0] = pc & 0xff; rec[1] = pc >> 8;
        rec[2] = vrEmu6502GetAcc(cpu); rec[3] = vrEmu6502GetX(cpu);
        rec[4] = vrEmu6502GetY(cpu); rec[5] = vrEmu6502GetStackPointer(cpu);
        rec[6] = vrEmu6502GetStatus(cpu); rec[7] = cycles;
        fwrite(rec, 1, 8, stdout);
        if (pc == prevPc) break;   /* trap: JMP * — both sides stop here */
        prevPc = pc;
    }
    fflush(stdout);
    vrEmu6502Destroy(cpu);
    return 0;
}
