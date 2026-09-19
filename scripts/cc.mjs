/**
 * cc.mjs — a minimal C front end that transpiles to 8086 asm (MASM dialect), so
 * a .C runs on any x86 flavor through the built-in assembler: C -> asm -> .COM.
 *
 * An honest small subset — enough to run hello-world-class C, not a real
 * compiler. Inside main() it understands:
 *   printf("literal");   / puts("literal");   — a string literal (C escapes
 *                          \n \t \r \\ \" and %% are handled; format args are
 *                          NOT — a %-with-args literal is refused)
 *   return <int const>;  — the process exit code (constant expression)
 * #include lines and /* *\/ and // comments are ignored. No variables, types,
 * expressions with args, or control flow — that is a real compiler's job; a
 * DOS Turbo C / MSC toolchain covers full C when its binary is present.
 *
 * @module
 */

/** C string-literal escapes -> bytes. */
function cStringBytes(lit) {
    const out = [];
    for (let i = 0; i < lit.length; i++) {
        const c = lit[i];
        if (c !== '\\') { out.push(c.charCodeAt(0) & 0xff); continue; }
        const e = lit[++i];
        if (e === 'n') { out.push(13, 10); continue; }   // DOS text mode: \n -> CRLF
        out.push({ t: 9, r: 13, '0': 0, '\\': 92, '"': 34, "'": 39 }[e] ?? e.charCodeAt(0) & 0xff);
    }
    return out;
}

/** Turn minimal C into MASM-dialect .COM assembly. */
export function cToAsm(source) {
    // Strip comments, then #include / #define lines.
    let src = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    src = src.replace(/^\s*#.*$/gm, ' ');
    const body = src.match(/\bmain\s*\([^)]*\)\s*\{([\s\S]*)\}/);
    if (!body) throw new Error('C: no main() { ... } found');

    const code = [], data = [];
    let exit = 0, nStr = 0;
    // Walk statements terminated by ';'.
    for (let stmt of body[1].split(';')) {
        stmt = stmt.trim();
        if (!stmt) continue;
        const pr = stmt.match(/^(printf|puts)\s*\(\s*"((?:[^"\\]|\\.)*)"\s*\)$/);
        if (pr) {
            const raw = pr[2];
            if (/%[^%]/.test(raw)) throw new Error(`C: printf format arguments are not supported in this subset: "${raw}"`);
            const bytes = cStringBytes(raw.replace(/%%/g, '%'));
            if (pr[1] === 'puts') bytes.push(13, 10);   // puts appends a newline
            data.push(`s${nStr}:\tDB ${bytes.join(',')},'$'`);
            code.push(`\tMOV DX, OFFSET s${nStr}`, '\tMOV AH, 9', '\tINT 21H');
            nStr++;
            continue;
        }
        const ret = stmt.match(/^return\s+(-?\d+)$/) || stmt.match(/^return$/);
        if (ret) { exit = ret[1] !== undefined ? (parseInt(ret[1], 10) & 0xff) : 0; continue; }
        throw new Error(`C: unsupported statement: ${stmt}`);
    }
    code.push(`\tMOV AX, 4C00H`, '\tINT 21H');
    // Fold the exit code into the AH=4Ch call.
    if (exit) code[code.length - 2] = `\tMOV AX, 4C${exit.toString(16).padStart(2, '0').toUpperCase()}H`;
    return [...code, ...data].join('\n') + '\n';
}
