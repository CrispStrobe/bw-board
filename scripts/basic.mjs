/**
 * basic.mjs — a tiny BASIC front end that transpiles to 8086 assembly (MASM
 * dialect, which the built-in assembler speaks), so a .BAS runs on any x86
 * flavor through the native toolchain: BASIC -> asm -> .COM -> run.
 *
 * Deliberately a small, honest subset — the "hello, print some things" core:
 *   PRINT "text"                a string literal, then CRLF
 *   PRINT <integer expression>  a constant integer expression (+ - * / and
 *                               parens), folded at compile time, then CRLF
 *   PRINT                       a blank line
 *   PRINT ... ;                 a trailing ';' suppresses the CRLF
 *   REM ... / ' ...             a comment
 *   END                        stop (an implicit END is added)
 * Optional leading line numbers are accepted and ignored. Variables, INPUT and
 * control flow are out of scope; a constant PRINT is enough to run BASIC on the
 * 8086/80186/80286 through the same path assembly uses.
 *
 * @module
 */

/** Evaluate a constant integer expression (+ - * / and parens), 16-bit. */
function evalConstExpr(src) {
    const toks = src.match(/\d+|[-+*/()]/g);
    if (!toks) throw new Error(`BASIC: not a constant integer expression: ${src.trim()}`);
    let i = 0;
    const peek = () => toks[i];
    const eat = () => toks[i++];
    const primary = () => {
        if (peek() === '(') { eat(); const v = expr(); if (eat() !== ')') throw new Error('BASIC: unbalanced ()'); return v; }
        const t = eat();
        if (!/^\d+$/.test(t)) throw new Error(`BASIC: unexpected '${t}' in expression`);
        return parseInt(t, 10);
    };
    const unary = () => { if (peek() === '-') { eat(); return -unary(); } if (peek() === '+') { eat(); return unary(); } return primary(); };
    const term = () => { let v = unary(); while (peek() === '*' || peek() === '/') { const op = eat(); const r = unary(); v = op === '*' ? v * r : Math.trunc(v / r); } return v; };
    function expr() { let v = term(); while (peek() === '+' || peek() === '-') { const op = eat(); const r = term(); v = op === '+' ? v + r : v - r; } return v; }
    const v = expr();
    if (i !== toks.length) throw new Error(`BASIC: trailing tokens in expression: ${src.trim()}`);
    return ((v % 65536) + 65536) % 65536;   // 16-bit wrap, as BASIC integers do
}

/** Turn BASIC source into MASM-dialect .COM assembly. */
export function basicToAsm(source) {
    const prints = [];   // { text: string, crlf: bool } — the resolved output pieces
    for (const raw of source.split(/\r?\n/)) {
        let line = raw.replace(/^\s*\d+\s*/, '').trim();   // drop an optional line number
        if (!line) continue;
        if (/^(REM\b|')/i.test(line)) continue;
        if (/^END$/i.test(line)) break;
        const m = line.match(/^PRINT\b(.*)$/i);
        if (!m) throw new Error(`BASIC: unsupported statement: ${line}`);
        let arg = m[1].trim();
        const crlf = !arg.endsWith(';');
        if (arg.endsWith(';')) arg = arg.slice(0, -1).trim();
        if (arg === '') { prints.push({ text: '', crlf }); continue; }
        const str = arg.match(/^"([^"]*)"$/);
        prints.push({ text: str ? str[1] : String(evalConstExpr(arg)), crlf });
    }

    // Emit: for each piece, print its string via INT 21h AH=09h; then exit.
    const code = [], data = [];
    prints.forEach((p, n) => {
        const bytes = [...Buffer.from(p.text, 'latin1'), ...(p.crlf ? [13, 10] : [])];
        if (!bytes.length) return;                     // nothing to print (blank, no CRLF)
        data.push(`s${n}:\tDB ${bytes.map((b) => b).join(',')},'$'`);
        code.push('\tMOV DX, OFFSET s' + n, '\tMOV AH, 9', '\tINT 21H');
    });
    code.push('\tMOV AX, 4C00H', '\tINT 21H');
    return [...code, ...data].join('\n') + '\n';
}
