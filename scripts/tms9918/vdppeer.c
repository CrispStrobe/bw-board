/*
 * vdppeer — vrEmuTms9918 (MIT, visrealm) as a frame oracle.
 *
 * stdin:  8 register bytes, then 16384 VRAM bytes.
 * stdout: 192 scanlines x 256 palette-index bytes (their ScanLine API).
 *
 * Build (sibling clone at ~/code/vrEmuTms9918):
 *   cc -O2 -I ~/code/vrEmuTms9918/src -o vdppeer vdppeer.c \
 *      ~/code/vrEmuTms9918/src/vrEmuTms9918.c
 */
#include <stdio.h>
#include <stdlib.h>
#include "vrEmuTms9918.h"

int main(void) {
  unsigned char regs[8], vram[0x4000], line[TMS9918_PIXELS_X];
  if (fread(regs, 1, 8, stdin) != 8) return 2;
  if (fread(vram, 1, sizeof vram, stdin) != sizeof vram) return 2;

  VrEmuTms9918 *tms = vrEmuTms9918New();
  if (!tms) return 3;
  for (int r = 0; r < 8; r++) vrEmuTms9918WriteRegValue(tms, (vrEmuTms9918Register)r, regs[r]);
  vrEmuTms9918WriteAddr(tms, 0x00);
  vrEmuTms9918WriteAddr(tms, 0x40);           /* VRAM write address 0 */
  for (int i = 0; i < 0x4000; i++) vrEmuTms9918WriteData(tms, vram[i]);

  for (int y = 0; y < 192; y++) {
    vrEmuTms9918ScanLine(tms, (unsigned char)y, line);
    fwrite(line, 1, sizeof line, stdout);
  }
  return 0;
}
