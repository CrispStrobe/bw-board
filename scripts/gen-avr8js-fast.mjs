import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'node_modules/avr8js/dist/cjs/cpu/instruction.js');
const src = readFileSync(SRC, 'utf8');

// Isolate the function body.
const fnStart = src.indexOf('function avrInstruction(cpu) {');
if (fnStart < 0) throw new Error('avrInstruction not found');
let i = src.indexOf('{', fnStart) + 1;
// Grab the opcode-fetch line.
const opcodeLineM = src.slice(i).match(/^\s*const opcode = cpu\.progMem\[cpu\.pc\];/m);
if (!opcodeLineM) throw new Error('opcode fetch line not found');

// Walk the if/else-if chain. Each block: optional 'else ', then 'if', '(' cond ')', '{' body '}'.
let p = src.indexOf('const opcode', i);
p = src.indexOf(';', p) + 1;
const blocks = [];
const matchBalanced = (str, start, open, close) => {
  // str[start] must be `open`
  let depth = 0, j = start, inStr = null, esc = false;
  for (; j < str.length; j++) {
    const c = str[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return j; }
  }
  throw new Error('unbalanced from '+start);
};
while (true) {
  // find next 'if' keyword (as `if (` possibly preceded by `else `)
  const rest = src.slice(p);
  const m = rest.match(/(?:else\s+)?if\s*\(/);
  if (!m) break;
  const kwAt = p + m.index;
  // ensure we haven't run past the chain (the tail 'cpu.pc = (cpu.pc + 1)' comes after)
  const tailAt = src.indexOf('cpu.pc = (cpu.pc + 1) % cpu.progMem.length', p);
  if (tailAt >= 0 && kwAt > tailAt) break;
  const parenOpen = src.indexOf('(', kwAt);
  const parenClose = matchBalanced(src, parenOpen, '(', ')');
  const cond = src.slice(parenOpen + 1, parenClose).trim();
  const braceOpen = src.indexOf('{', parenClose);
  const braceClose = matchBalanced(src, braceOpen, '{', '}');
  const body = src.slice(braceOpen + 1, braceClose);
  blocks.push({ cond, body });
  p = braceClose + 1;
}
// tail
const tail = 'cpu.pc = (cpu.pc + 1) % cpu.progMem.length;\n    cpu.cycles++;';

// For each block, determine matching top nibbles from the FIRST (opcode & M) === P (or opcode === P).
const nibblesFor = (cond) => {
  let M, P;
  const maskM = cond.match(/opcode\s*&\s*(0x[0-9a-fA-F]+)\)\s*===\s*(0x[0-9a-fA-F]+|\d+)/);
  const exactM = cond.match(/opcode\s*===\s*(0x[0-9a-fA-F]+|\d+)/);
  if (maskM) { M = parseInt(maskM[1]); P = parseInt(maskM[2]); }
  else if (exactM) { M = 0xffff; P = parseInt(exactM[1]); }
  else throw new Error('cannot parse condition: '+cond);
  const out = [];
  for (let N = 0; N < 16; N++) if ((((N<<12) ^ P) & M & 0xf000) === 0) out.push(N);
  return out;
};

const buckets = Array.from({length:16},()=>[]);
let total = 0;
for (const b of blocks) { for (const N of nibblesFor(b.cond)) buckets[N].push(b); total++; }
console.error(`parsed ${blocks.length} blocks; bucket sizes: ${buckets.map(b=>b.length).join(',')}`);

// Emit.
let out = `// GENERATED from avr8js instruction.js by gen-avr-fast.mjs — DO NOT EDIT BY HAND.\n`;
out += `// Switch-dispatch fork of avr8js's linear 99-branch AVR decoder. Bodies\n`;
out += `// are copied VERBATIM; only the dispatch is restructured (switch on opcode>>12).\n`;
out += `// Behavior-identical, gated by an exhaustive stock-vs-fork differential.\n`;
out += `function isTwoWordInstruction(opcode) {\n    return (\n    (opcode & 0xfe0f) === 0x9000 ||\n        (opcode & 0xfe0f) === 0x9200 ||\n        (opcode & 0xfe0e) === 0x940e ||\n        (opcode & 0xfe0e) === 0x940c);\n}\n\nexport function fastAvrInstruction(cpu) {\n    const opcode = cpu.progMem[cpu.pc];\n    switch (opcode >> 12) {\n`;
for (let N = 0; N < 16; N++) {
  out += `    case 0x${N.toString(16)}: {\n`;
  const bs = buckets[N];
  for (let k = 0; k < bs.length; k++) {
    out += `        ${k===0?'if':'else if'} (${bs[k].cond}) {${bs[k].body}}\n`;
  }
  out += `        break;\n    }\n`;
}
out += `    }\n    ${tail}\n}\n\nexport default fastAvrInstruction;\n`;
const OUT = join(ROOT, 'src/vendor/avr8js-fast/instruction.js');
mkdirSync(join(ROOT, 'src/vendor/avr8js-fast'), {recursive:true}); writeFileSync(OUT, out); console.error('wrote '+OUT+' ('+out.length+' bytes)');
