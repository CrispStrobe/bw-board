/**
 * basic.mjs — CLI/toolchain entry point for the BASIC compiler.
 *
 * The implementation lives in ../src/basic-to-asm.js so it is part of bw-board's
 * vendorable engine surface (the browser code tab vendors src/, not scripts/).
 * This module re-exports it unchanged, so scripts/toolchains.mjs and the tests
 * keep importing `basicToAsm` from here.
 *
 * @module
 */
export { basicToAsm } from '../src/basic-to-asm.js';
