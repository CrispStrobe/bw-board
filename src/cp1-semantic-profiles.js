// SPDX-License-Identifier: MIT
/**
 * Data-only semantic observations, keyed to the complete user-supplied ROM.
 * No firmware or reference-emulator source is included or interpreted here.
 * See docs/CP1-SEMANTIC-DEBUG.md for the observations and their limits.
 */
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};

export const CP1_SEMANTIC_PROFILES = freeze([
  {
    version: 1,
    id: 'cp1-2716-observed-v1',
    romSha1: 'ff4befcf82a664950186d3af1843fdef70d2209f',
    evidence: 'docs/CP1-SEMANTIC-DEBUG.md',
    registers: {pc: 0x38, accumulator: {opcode: 0x36, operand: 0x37},
      comparison: {address: 0x3a, mask: 0x20, label: 'Comparison condition is true'}},
    commandBoundary: 0x627,
    monitorBoundary: 0x086,
    haltOpcodes: [1],
    errorDisplay: {
      indicatorAddress: 0x20,
      indicatorValue: 0x71,
      digitAddresses: [0x23, 0x24, 0x25],
      // Decimal seven-segment masks in the firmware's settled display buffer.
      digitMasks: [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x27, 0x7f, 0x6f],
    },
  },
]);
