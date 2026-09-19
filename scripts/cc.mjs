/**
 * cc.mjs — a small C front end that compiles to 8086 asm (MASM dialect, which the
 * built-in assembler speaks), so a .C runs on any x86 flavor: C -> asm -> .COM.
 *
 * An honest integer subset — not a full compiler, but real control flow and
 * expressions, enough to run small programs. Inside main() it understands:
 *   int a, b = expr;                 16-bit integer variables (optional init)
 *   a = expr;  a += / -= / *= / /=   assignment and compound assignment
 *   a++;  a--;                       increment / decrement
 *   printf("fmt", args...);          %d (integer), %c (char), %% and \n\t\r\\\";
 *                                    each conversion consumes one integer arg
 *   puts("literal");                 a string literal + newline
 *   if (cond) {..} [else {..}]       full conditionals
 *   while (cond) {..}                loops
 *   for (init; cond; post) {..}      counted loops
 *   return expr;                     the process exit code (low byte)
 * Expressions: + - * / % , parens, unary - and !, comparisons (< > <= >= == !=)
 * and && || (short-circuit), over integer literals, char literals and variables.
 * #include lines and /* *\/ // comments are ignored. Full C (types, pointers,
 * functions, floats) is a real DOS C compiler's job when its binary is present.
 *
 * @module
 */

/** C string-literal escapes -> bytes (DOS text mode: \n -> CRLF). */
function cStringBytes(lit) {
    const out = [];
    for (let i = 0; i < lit.length; i++) {
        const c = lit[i];
        if (c !== '\\') { out.push(c.charCodeAt(0) & 0xff); continue; }
        const e = lit[++i];
        if (e === 'n') { out.push(13, 10); continue; }
        out.push({ t: 9, r: 13, '0': 0, '\\': 92, '"': 34, "'": 39 }[e] ?? e.charCodeAt(0) & 0xff);
    }
    return out;
}

const CHAR_ESC = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34 };
const TWO = ['<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '++', '--'];

/** Tokenize C source: strings become {str}, everything else a string token. */
function tokenizeC(s) {
    const toks = [];
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === '"') {
            let j = i + 1, inner = '';
            while (j < s.length && s[j] !== '"') { if (s[j] === '\\') { inner += s[j] + s[j + 1]; j += 2; } else inner += s[j++]; }
            toks.push({ str: inner }); i = j + 1; continue;
        }
        if (c === "'") {   // char literal -> its numeric value
            let j = i + 1, val;
            if (s[j] === '\\') { val = CHAR_ESC[s[j + 1]] ?? s.charCodeAt(j + 1); j += 2; } else { val = s.charCodeAt(j); j += 1; }
            if (s[j] === "'") j++;
            toks.push(String(val)); i = j; continue;
        }
        if (/[0-9]/.test(c)) { let j = i; while (j < s.length && /[0-9]/.test(s[j])) j++; toks.push(s.slice(i, j)); i = j; continue; }
        if (/[A-Za-z_]/.test(c)) { let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++; toks.push(s.slice(i, j)); i = j; continue; }
        const t2 = s.slice(i, i + 2);
        if (TWO.includes(t2)) { toks.push(t2); i += 2; continue; }
        toks.push(c); i++;
    }
    return toks;
}

/** Compile the minimal C subset to MASM-dialect .COM assembly. */
export function cToAsm(source) {
    let src = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    src = src.replace(/^\s*#.*$/gm, ' ');
    const mm = src.match(/\bmain\s*\([^)]*\)\s*\{([\s\S]*)\}/);
    if (!mm) throw new Error('C: no main() { ... } found');

    let toks = tokenizeC(mm[1]);
    let i = 0;
    const code = [], data = [], strings = [];
    const vars = new Map();
    let usesPrintInt = false, usesCrlf = false, lblN = 0;
    const emit = (...a) => code.push(...a.map((s) => (s.endsWith(':') ? s : '\t' + s)));
    const lbl = () => `_L${lblN++}`;
    const varLabel = (n) => { if (!vars.has(n)) vars.set(n, `V${vars.size}`); return vars.get(n); };
    const strLabel = (bytes) => { const l = `s${strings.length}`; strings.push(`${l}:\tDB ${bytes.length ? bytes.join(',') + ",'$'" : "'$'"}`); return l; };
    const peek = () => toks[i], next = () => toks[i++];
    const isId = (t) => typeof t === 'string' && /^[A-Za-z_]\w*$/.test(t);
    const isStr = (t) => t && typeof t === 'object' && t.str !== undefined;
    const expect = (t) => { if (toks[i] !== t) throw new Error(`C: expected '${t}', got '${JSON.stringify(toks[i]) ?? 'EOF'}'`); return toks[i++]; };
    const KW = new Set(['int', 'if', 'else', 'while', 'for', 'return', 'printf', 'puts']);

    // ── expression codegen: result in AX ───────────────────────────────────
    function primary() {
        const t = next();
        if (t === '(') { orExpr(); expect(')'); return; }
        if (t === '-') { primary(); emit('NEG AX'); return; }
        if (t === '!') { primary(); const L = lbl(); emit('CMP AX, 0', 'MOV AX, 0', `JNE ${L}`, 'MOV AX, 1', `${L}:`); return; }
        if (t === '+') { primary(); return; }
        if (typeof t === 'string' && /^\d+$/.test(t)) { emit(`MOV AX, ${parseInt(t, 10) & 0xffff}`); return; }
        if (isId(t) && !KW.has(t)) { emit(`MOV AX, [${varLabel(t)}]`); return; }
        throw new Error(`C: bad token '${JSON.stringify(t)}' in expression`);
    }
    function mul() {
        primary();
        while (peek() === '*' || peek() === '/' || peek() === '%') {
            const op = next(); emit('PUSH AX'); primary();
            if (op === '*') emit('MOV BX, AX', 'POP AX', 'IMUL BX');
            else { emit('MOV CX, AX', 'POP AX', 'CWD', 'IDIV CX'); if (op === '%') emit('MOV AX, DX'); }
        }
    }
    function add() {
        mul();
        while (peek() === '+' || peek() === '-') { const op = next(); emit('PUSH AX'); mul(); emit('MOV BX, AX', 'POP AX', op === '+' ? 'ADD AX, BX' : 'SUB AX, BX'); }
    }
    function rel() {
        add();
        while (['<', '>', '<=', '>='].includes(peek())) {
            const op = next(); emit('PUSH AX'); add(); emit('MOV BX, AX', 'POP AX', 'CMP AX, BX');
            const L = lbl(); const j = { '<': 'JGE', '>': 'JLE', '<=': 'JG', '>=': 'JL' }[op];
            emit('MOV AX, 0', `${j} ${L}`, 'MOV AX, 1', `${L}:`);
        }
    }
    function eq() {
        rel();
        while (peek() === '==' || peek() === '!=') {
            const op = next(); emit('PUSH AX'); rel(); emit('MOV BX, AX', 'POP AX', 'CMP AX, BX');
            const L = lbl(); emit('MOV AX, 0', `${op === '==' ? 'JNE' : 'JE'} ${L}`, 'MOV AX, 1', `${L}:`);
        }
    }
    function andExpr() {
        eq(); if (peek() !== '&&') return;
        const Lf = lbl(), Le = lbl(); emit('CMP AX, 0', `JE ${Lf}`);
        while (peek() === '&&') { next(); eq(); emit('CMP AX, 0', `JE ${Lf}`); }
        emit('MOV AX, 1', `JMP ${Le}`, `${Lf}:`, 'MOV AX, 0', `${Le}:`);
    }
    function orExpr() {
        andExpr(); if (peek() !== '||') return;
        const Lt = lbl(), Le = lbl(); emit('CMP AX, 0', `JNE ${Lt}`);
        while (peek() === '||') { next(); andExpr(); emit('CMP AX, 0', `JNE ${Lt}`); }
        emit('MOV AX, 0', `JMP ${Le}`, `${Lt}:`, 'MOV AX, 1', `${Le}:`);
    }
    /** Codegen an argument captured as its own token slice. */
    function genSlice(slice) {
        const st = toks, si = i; toks = slice; i = 0;
        orExpr();
        if (i !== toks.length) throw new Error('C: bad expression in argument');
        toks = st; i = si;
    }

    // ── printf / puts ──────────────────────────────────────────────────────
    function callStmt() {
        const fn = next();                 // 'printf' | 'puts'
        expect('(');
        const litTok = next();
        if (!isStr(litTok)) throw new Error(`C: ${fn} needs a string-literal format`);
        const lit = litTok.str;
        const argSlices = [];
        while (peek() === ',') {
            next(); const slice = []; let depth = 0;
            while (i < toks.length) {
                const tk = peek();
                if (depth === 0 && (tk === ',' || tk === ')')) break;
                if (tk === '(') depth++; else if (tk === ')') depth--;
                slice.push(next());
            }
            argSlices.push(slice);
        }
        expect(')');
        if (fn === 'puts') { const b = cStringBytes(lit); b.push(13, 10); const l = strLabel(b); emit(`MOV DX, OFFSET ${l}`, 'MOV AH, 9', 'INT 21H'); return; }
        // printf: walk the format, flushing literal runs and consuming an arg per conversion.
        let buf = [], ai = 0;
        const flush = () => { if (buf.length) { const l = strLabel(buf); emit(`MOV DX, OFFSET ${l}`, 'MOV AH, 9', 'INT 21H'); buf = []; } };
        for (let k = 0; k < lit.length; k++) {
            const c = lit[k];
            if (c === '\\') { const e = lit[++k]; if (e === 'n') buf.push(13, 10); else buf.push(CHAR_ESC[e] ?? e.charCodeAt(0) & 0xff); continue; }
            if (c === '%') {
                const s = lit[++k];
                if (s === '%') { buf.push(37); continue; }
                flush();
                if (ai >= argSlices.length) throw new Error(`C: printf: not enough arguments for "%${s}"`);
                if (s === 'd') { genSlice(argSlices[ai++]); emit('CALL PRINTINT'); usesPrintInt = true; }
                else if (s === 'c') { genSlice(argSlices[ai++]); emit('MOV DL, AL', 'MOV AH, 2', 'INT 21H'); }
                else throw new Error(`C: unsupported printf conversion %${s}`);
                continue;
            }
            buf.push(c.charCodeAt(0) & 0xff);
        }
        flush();
    }

    // ── statements ─────────────────────────────────────────────────────────
    function block() { expect('{'); while (peek() !== '}' && i < toks.length) statement(); expect('}'); }

    function exprStatement() {
        if (isId(peek()) && !KW.has(peek()) && (toks[i + 1] === '++' || toks[i + 1] === '--')) {
            const name = next(), op = next(), lab = varLabel(name);
            emit(`MOV AX, [${lab}]`, op === '++' ? 'INC AX' : 'DEC AX', `MOV [${lab}], AX`); return;
        }
        if (isId(peek()) && !KW.has(peek()) && ['=', '+=', '-=', '*=', '/='].includes(toks[i + 1])) {
            const name = next(), op = next(), lab = varLabel(name);
            if (op === '=') { orExpr(); emit(`MOV [${lab}], AX`); return; }
            orExpr(); emit('MOV BX, AX', `MOV AX, [${lab}]`);
            if (op === '+=') emit('ADD AX, BX'); else if (op === '-=') emit('SUB AX, BX');
            else if (op === '*=') emit('IMUL BX'); else emit('MOV CX, BX', 'CWD', 'IDIV CX');
            emit(`MOV [${lab}], AX`); return;
        }
        if (peek() === 'printf' || peek() === 'puts') { callStmt(); return; }
        orExpr();   // bare expression, value discarded
    }

    function statement() {
        const t = peek();
        if (t === '{') { block(); return; }
        if (t === ';') { next(); return; }
        if (t === 'int') {
            next();
            do {
                const name = next(); const lab = varLabel(name);
                if (peek() === '=') { next(); orExpr(); emit(`MOV [${lab}], AX`); }
            } while (peek() === ',' && next());
            expect(';'); return;
        }
        if (t === 'if') {
            next(); expect('('); orExpr(); expect(')');
            const Lelse = lbl(); emit('CMP AX, 0', `JE ${Lelse}`); statement();
            if (peek() === 'else') { next(); const Lend = lbl(); emit(`JMP ${Lend}`, `${Lelse}:`); statement(); emit(`${Lend}:`); }
            else emit(`${Lelse}:`);
            return;
        }
        if (t === 'while') {
            next(); const Ltop = lbl(), Lend = lbl(); emit(`${Ltop}:`);
            expect('('); orExpr(); expect(')'); emit('CMP AX, 0', `JE ${Lend}`);
            statement(); emit(`JMP ${Ltop}`, `${Lend}:`); return;
        }
        if (t === 'for') {
            next(); expect('(');
            if (peek() !== ';') exprStatement(); expect(';');
            const Ltop = lbl(), Lend = lbl(); emit(`${Ltop}:`);
            if (peek() !== ';') { orExpr(); emit('CMP AX, 0', `JE ${Lend}`); } expect(';');
            // capture the post-expression tokens to emit after the body
            const post = []; let depth = 0;
            while (i < toks.length) { const tk = peek(); if (depth === 0 && tk === ')') break; if (tk === '(') depth++; else if (tk === ')') depth--; post.push(next()); }
            expect(')');
            statement();
            if (post.length) { const st = toks, si = i; toks = post; i = 0; exprStatement(); toks = st; i = si; }
            emit(`JMP ${Ltop}`, `${Lend}:`); return;
        }
        if (t === 'return') {
            next();
            if (peek() === ';') emit('MOV AX, 4C00H', 'INT 21H'); else { orExpr(); emit('MOV AH, 4CH', 'INT 21H'); }
            expect(';'); return;
        }
        exprStatement(); expect(';');
    }

    while (i < toks.length) statement();
    emit('MOV AX, 4C00H', 'INT 21H');   // fall-through exit

    // ── runtime: signed print-integer (matches BASIC's) ────────────────────
    const rt = [];
    if (usesPrintInt) rt.push(
        'PRINTINT:', '\tPUSH AX', '\tPUSH BX', '\tPUSH CX', '\tPUSH DX',
        '\tTEST AX, AX', '\tJNS CI_POS', '\tPUSH AX', '\tMOV DL, 45', '\tMOV AH, 2', '\tINT 21H', '\tPOP AX', '\tNEG AX',
        'CI_POS:', '\tMOV CX, 0', '\tMOV BX, 10',
        'CI_DIV:', '\tXOR DX, DX', '\tDIV BX', '\tPUSH DX', '\tINC CX', '\tTEST AX, AX', '\tJNZ CI_DIV',
        'CI_OUT:', '\tPOP DX', '\tADD DL, 48', '\tMOV AH, 2', '\tINT 21H', '\tLOOP CI_OUT',
        '\tPOP DX', '\tPOP CX', '\tPOP BX', '\tPOP AX', '\tRET');
    if (usesCrlf) rt.push('CRLF:', '\tMOV DL, 13', '\tMOV AH, 2', '\tINT 21H', '\tMOV DL, 10', '\tMOV AH, 2', '\tINT 21H', '\tRET');

    const varDecls = [...vars.values()].map((l) => `${l}:\tDW 0`);
    return [...code, ...rt, ...varDecls, ...data, ...strings].join('\n') + '\n';
}
