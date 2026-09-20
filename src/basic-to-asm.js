/**
 * basic-to-asm.js — a small BASIC compiler that emits 8086 assembly (MASM
 * dialect, which the built-in assembler speaks), so a .BAS runs on any x86
 * flavor: BASIC -> asm -> .COM -> run.
 *
 * Lives under src/ (not scripts/) so it is part of bw-board's vendorable engine
 * surface — the browser code tab (brickwright-lite) vendors it to compile BASIC
 * in-page, exactly as scripts/toolchains.mjs uses it on the CLI. Pure ES module,
 * no Node built-ins (no Buffer), so it runs unchanged in the browser bundle.
 *
 * A real (if compact) integer BASIC — variables and control flow, not just
 * constant PRINT:
 *   LET v = expr  /  v = expr        16-bit integer variables (A.. names)
 *   PRINT a; b, "text"; expr         strings and integer expressions; ';' no
 *                                    gap, ',' a tab, trailing ';'/',' no newline
 *   INPUT v                          read an integer from the keyboard
 *   IF a <relop> b THEN <line>       relop = < > <= >= = <>, jumps to a line
 *   GOTO <line>                      jump
 *   FOR v = a TO b [STEP s] .. NEXT  counted loop (constant STEP; default 1)
 *   REM / '                          comment
 *   END                             stop
 * Expressions: + - * / and parens over integer literals and variables.
 * Deliberately integer-only and single-file; enough to run real little BASIC
 * programs on the 8086/80186/80286 through the same native path asm and C use.
 *
 * @module
 */

const RELOPS = { '=': 'JE', '<>': 'JNE', '<': 'JL', '>': 'JG', '<=': 'JLE', '>=': 'JGE' };

export function basicToAsm(source) {
    const code = [], data = [];
    const vars = new Map();      // name -> data label
    const strings = [];          // literal -> label
    const forStack = [];         // open FOR loops
    let usesPrintInt = false, usesCrlf = false, usesInput = false, tmpN = 0;
    const emit = (...l) => code.push(...l.map((s) => (s.endsWith(':') ? s : '\t' + s)));
    const varLabel = (name) => { const n = name.toUpperCase(); if (!vars.has(n)) vars.set(n, `V${vars.size}`); return vars.get(n); };
    const strLabel = (text) => {
        const bytes = [...text].map((c) => c.charCodeAt(0) & 0xff);   // latin1 bytes, no Buffer (browser-safe)
        const lbl = `S${strings.length}`;
        strings.push(`${lbl}:\tDB ${bytes.length ? bytes.join(',') + ",'$'" : "'$'"}`);
        return lbl;
    };
    const newTmp = () => `T${tmpN++}`;

    // ── expression codegen: result left in AX ──────────────────────────────
    function tokenize(src) {
        return src.match(/\d+|[A-Za-z][A-Za-z0-9]*|<=|>=|<>|[-+*/()<>=]/g) || [];
    }
    function genExpr(toks) {
        let i = 0;
        const peek = () => toks[i], eat = () => toks[i++];
        function primary() {
            const t = eat();
            if (t === '(') { expr(); if (eat() !== ')') throw new Error('BASIC: unbalanced ()'); return; }
            if (/^\d+$/.test(t)) { emit(`MOV AX, ${parseInt(t, 10) & 0xffff}`); return; }
            if (/^[A-Za-z]/.test(t)) { emit(`MOV AX, [${varLabel(t)}]`); return; }
            throw new Error(`BASIC: bad token '${t}' in expression`);
        }
        function unary() { if (peek() === '-') { eat(); unary(); emit('NEG AX'); return; } if (peek() === '+') { eat(); } return primary(); }
        function term() {
            unary();
            while (peek() === '*' || peek() === '/') {
                const op = eat(); emit('PUSH AX'); unary();
                if (op === '*') { emit('MOV BX, AX', 'POP AX', 'IMUL BX'); }
                else { emit('MOV CX, AX', 'POP AX', 'CWD', 'IDIV CX'); }
            }
        }
        function expr() {
            term();
            while (peek() === '+' || peek() === '-') {
                const op = eat(); emit('PUSH AX'); term();
                emit('MOV BX, AX', 'POP AX', op === '+' ? 'ADD AX, BX' : 'SUB AX, BX');
            }
        }
        expr();
        if (i !== toks.length) throw new Error(`BASIC: trailing tokens: ${toks.slice(i).join(' ')}`);
    }
    const genExprStr = (src) => genExpr(tokenize(src));

    // ── statements ─────────────────────────────────────────────────────────
    function stmtPrint(arg) {
        // Split into items on top-level ; and , keeping the separators.
        const items = []; let buf = '', depth = 0;
        for (const ch of arg) {
            if (ch === '(') depth++; if (ch === ')') depth--;
            if ((ch === ';' || ch === ',') && depth === 0) { items.push({ text: buf.trim(), sep: ch }); buf = ''; }
            else buf += ch;
        }
        const trailing = buf.trim() === '' && items.length;   // ended on a separator
        if (buf.trim() !== '') items.push({ text: buf.trim(), sep: '' });
        for (const it of items) {
            if (it.text !== '') {
                const s = it.text.match(/^"([^"]*)"$/);
                if (s) emit(`MOV DX, OFFSET ${strLabel(s[1])}`, 'MOV AH, 9', 'INT 21H');
                else { genExprStr(it.text); emit('CALL PRINTINT'); usesPrintInt = true; }
            }
            if (it.sep === ',') { emit("MOV DL, 9", 'MOV AH, 2', 'INT 21H'); }   // tab between comma items
        }
        if (!trailing) { emit('CALL CRLF'); usesCrlf = true; }
    }

    function compileLine(line, labelFor) {
        let m;
        if ((m = line.match(/^(REM\b|').*/i))) return;
        if (/^END$/i.test(line)) { emit('MOV AX, 4C00H', 'INT 21H'); return; }
        if ((m = line.match(/^PRINT\b(.*)$/i))) return stmtPrint(m[1].trim());
        if ((m = line.match(/^GOTO\s+(\d+)$/i))) { emit(`JMP ${labelFor(m[1])}`); return; }
        if ((m = line.match(/^INPUT\s+([A-Za-z][A-Za-z0-9]*)$/i))) { emit('CALL INPUTINT', `MOV [${varLabel(m[1])}], AX`); usesInput = true; return; }
        if ((m = line.match(/^IF\s+(.+?)\s*(<=|>=|<>|[<>=])\s*(.+?)\s+THEN\s+(?:GOTO\s+)?(\d+)$/i))) {
            genExprStr(m[1]); emit('PUSH AX'); genExprStr(m[3]); emit('MOV BX, AX', 'POP AX', 'CMP AX, BX', `${RELOPS[m[2]]} ${labelFor(m[4])}`); return;
        }
        if ((m = line.match(/^FOR\s+([A-Za-z][A-Za-z0-9]*)\s*=\s*(.+?)\s+TO\s+(.+?)(?:\s+STEP\s+(-?\d+))?$/i))) {
            const v = varLabel(m[1]), step = m[4] !== undefined ? parseInt(m[4], 10) : 1;
            const limit = newTmp(); data.push(`${limit}:\tDW 0`);
            genExprStr(m[2]); emit(`MOV [${v}], AX`);
            genExprStr(m[3]); emit(`MOV [${limit}], AX`);
            const top = `FOR${forStack.length}_${tmpN}`;
            emit(`${top}:`);
            forStack.push({ v, limit, step, top, name: m[1].toUpperCase() });
            return;
        }
        if ((m = line.match(/^NEXT(?:\s+([A-Za-z][A-Za-z0-9]*))?$/i))) {
            const f = forStack.pop();
            if (!f) throw new Error('BASIC: NEXT without FOR');
            emit(`MOV AX, [${f.v}]`, `ADD AX, ${f.step & 0xffff}`, `MOV [${f.v}], AX`, `CMP AX, [${f.limit}]`, `${f.step < 0 ? 'JGE' : 'JLE'} ${f.top}`);
            return;
        }
        if ((m = line.match(/^(?:LET\s+)?([A-Za-z][A-Za-z0-9]*)\s*=\s*(.+)$/i))) { genExprStr(m[2]); emit(`MOV [${varLabel(m[1])}], AX`); return; }
        throw new Error(`BASIC: unsupported statement: ${line}`);
    }

    // ── two passes: labels for numbered lines, then codegen ────────────────
    const lines = [];
    for (const raw of source.split(/\r?\n/)) {
        const lm = raw.match(/^\s*(\d+)?\s*(.*)$/);
        const text = lm[2].trim();
        if (text) lines.push({ num: lm[1], text });
    }
    const labelFor = (num) => `L${num}`;
    for (const ln of lines) {
        if (ln.num) emit(`${labelFor(ln.num)}:`);
        compileLine(ln.text, labelFor);
    }
    emit('MOV AX, 4C00H', 'INT 21H');   // implicit END

    // ── runtime helpers ────────────────────────────────────────────────────
    const rt = [];
    if (usesPrintInt) rt.push(
        'PRINTINT:', '\tPUSH AX', '\tPUSH BX', '\tPUSH CX', '\tPUSH DX',
        '\tTEST AX, AX', '\tJNS PI_POS', '\tPUSH AX', '\tMOV DL, 45', '\tMOV AH, 2', '\tINT 21H', '\tPOP AX', '\tNEG AX',
        'PI_POS:', '\tMOV CX, 0', '\tMOV BX, 10',
        'PI_DIV:', '\tXOR DX, DX', '\tDIV BX', '\tPUSH DX', '\tINC CX', '\tTEST AX, AX', '\tJNZ PI_DIV',
        'PI_OUT:', '\tPOP DX', '\tADD DL, 48', '\tMOV AH, 2', '\tINT 21H', '\tLOOP PI_OUT',
        '\tPOP DX', '\tPOP CX', '\tPOP BX', '\tPOP AX', '\tRET');
    if (usesCrlf) rt.push('CRLF:', '\tMOV DL, 13', '\tMOV AH, 2', '\tINT 21H', '\tMOV DL, 10', '\tMOV AH, 2', '\tINT 21H', '\tRET');
    if (usesInput) {
        data.push("INBUF:\tDB 7,0,0,0,0,0,0,0,0");   // AH=0Ah buffer: max 7 chars
        rt.push(
            'INPUTINT:', '\tPUSH BX', '\tPUSH CX', '\tPUSH DX', '\tPUSH SI',
            '\tMOV DX, OFFSET INBUF', '\tMOV AH, 0AH', '\tINT 21H',        // read line (DOS echoes the CR)
            '\tMOV DL, 10', '\tMOV AH, 2', '\tINT 21H',                    // add the LF
            '\tXOR AX, AX', '\tXOR CX, CX', '\tMOV SI, OFFSET INBUF+2', '\tMOV CL, [INBUF+1]', '\tXOR BX, BX',  // BX=sign
            '\tCMP BYTE PTR [SI], 45', '\tJNE II_LOOP', '\tMOV BX, 1', '\tINC SI', '\tDEC CL',   // leading '-'
            'II_LOOP:', '\tTEST CL, CL', '\tJZ II_DONE',
            '\tMOV DX, 10', '\tPUSH DX', '\tMOV DX, AX', '\tPOP AX', '\tXCHG AX, DX', '\tMOV BP, AX', '\tMOV AX, DX', '\tMUL BP',   // ax = ax*10 (via mul)
            '\tXOR DX, DX', '\tMOV DL, [SI]', '\tSUB DL, 48', '\tADD AX, DX', '\tINC SI', '\tDEC CL', '\tJMP II_LOOP',
            'II_DONE:', '\tTEST BX, BX', '\tJZ II_RET', '\tNEG AX',
            'II_RET:', '\tPOP SI', '\tPOP DX', '\tPOP CX', '\tPOP BX', '\tRET');
    }

    const varDecls = [...vars.values()].map((l) => `${l}:\tDW 0`);
    return [...code, ...rt, ...varDecls, ...data, ...strings].join('\n') + '\n';
}
