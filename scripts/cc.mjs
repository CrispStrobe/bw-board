/**
 * cc.mjs — a small C front end that compiles to 8086 asm (MASM dialect, which the
 * built-in assembler speaks), so a .C runs on any x86 flavor: C -> asm -> .COM.
 *
 * An honest integer subset — not a full compiler, but real control flow,
 * expressions, and user-defined functions, enough to run small programs:
 *   int f(int a, int b) { ... }      multiple functions; params + a return value
 *   int a, b = expr;                 16-bit integer variables (locals in a frame)
 *   int a[n];  a[i]                  integer arrays (word each; element read/write) [global]
 *   int *p;  &x / &a[i];  *p         pointers: address-of and dereference (read and write)
 *   a = expr;  a += / -= / *= / /=   assignment and compound assignment
 *   a++;  a--;                       increment / decrement
 *   printf("fmt", args...);          %d (integer), %c (char), %% and \n\t\r\\\";
 *   puts("literal");                 a string literal + newline
 *   if (cond) {..} [else {..}]  while (cond) {..}  for (init; cond; post) {..}
 *   f(args)                          calls (cdecl: args pushed right-to-left, result in AX)
 *   return expr;                     from a function; main's return is the exit code
 * Expressions: + - * / % , parens, unary - ! * &, comparisons (< > <= >= == !=),
 * && || (short-circuit), over integer/char literals, variables, array elements,
 * pointer derefs and function calls. Calling convention: PUSH BP / MOV BP,SP;
 * params at [BP+4+2k], locals at [BP-2-2k]; arrays are global (word data).
 * #include lines and /* *\/ // comments are ignored. Full C (structs, floats,
 * the standard library) is a real DOS C compiler's job when its binary is present.
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

/** Compile the C subset to MASM-dialect .COM assembly. */
export function cToAsm(source) {
    let src = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    src = src.replace(/^\s*#.*$/gm, ' ');

    let toks = tokenizeC(src);
    let i = 0;
    const code = [], data = [], strings = [];
    const vars = new Map();          // global scalars: name -> label
    const arrays = new Map();        // global arrays: name -> { label, size }
    const funcs = new Set();         // defined function names
    const calls = new Set();         // called function names (validated at the end)
    let usesPrintInt = false, usesCrlf = false, lblN = 0;
    let curScope = null;             // { params: Map, locals: Map, epi: label } inside a function

    const emit = (...a) => code.push(...a.map((s) => (s.endsWith(':') ? s : '\t' + s)));
    const lbl = () => `_L${lblN++}`;
    const strLabel = (bytes) => { const l = `s${strings.length}`; strings.push(`${l}:\tDB ${bytes.length ? bytes.join(',') + ",'$'" : "'$'"}`); return l; };
    const arrLabel = (n) => { const a = arrays.get(n); if (!a) throw new Error(`C: array '${n}' used before declaration`); return a.label; };
    const peek = () => toks[i], next = () => toks[i++];
    const isId = (t) => typeof t === 'string' && /^[A-Za-z_]\w*$/.test(t);
    const isStr = (t) => t && typeof t === 'object' && t.str !== undefined;
    const expect = (t) => { if (toks[i] !== t) throw new Error(`C: expected '${t}', got '${JSON.stringify(toks[i]) ?? 'EOF'}'`); return toks[i++]; };
    const KW = new Set(['int', 'void', 'if', 'else', 'while', 'for', 'return', 'printf', 'puts']);
    const fnLabel = (n) => `C_${n.toUpperCase()}`;

    // A variable's memory operand: a frame slot in the current function, else a
    // (lazily created) global. Params sit above the saved BP/return address,
    // locals below.
    const varRef = (name) => {
        if (curScope) {
            if (curScope.params.has(name)) return `[BP+${4 + 2 * curScope.params.get(name)}]`;
            if (curScope.locals.has(name)) return `[BP-${2 + 2 * curScope.locals.get(name)}]`;
        }
        if (!vars.has(name)) vars.set(name, `V${vars.size}`);
        return `[${vars.get(name)}]`;
    };
    // Emit the ADDRESS of a variable into AX.
    const varAddrEmit = (name) => {
        if (curScope) {
            if (curScope.params.has(name)) { emit('MOV AX, BP', `ADD AX, ${4 + 2 * curScope.params.get(name)}`); return; }
            if (curScope.locals.has(name)) { emit('MOV AX, BP', `SUB AX, ${2 + 2 * curScope.locals.get(name)}`); return; }
        }
        if (!vars.has(name)) vars.set(name, `V${vars.size}`);
        emit(`MOV AX, OFFSET ${vars.get(name)}`);
    };

    // ── expression codegen: result left in AX ───────────────────────────────
    function primary() {
        const t = next();
        if (t === '(') { orExpr(); expect(')'); return; }
        if (t === '-') { primary(); emit('NEG AX'); return; }
        if (t === '!') { primary(); const L = lbl(); emit('CMP AX, 0', 'MOV AX, 0', `JNE ${L}`, 'MOV AX, 1', `${L}:`); return; }
        if (t === '+') { primary(); return; }
        if (t === '*') { primary(); emit('MOV BX, AX', 'MOV AX, [BX]'); return; }   // *p — dereference read
        if (t === '&') {                                                            // &x / &a[i] — address-of
            const nm = next();
            if (!isId(nm) || KW.has(nm)) throw new Error(`C: & needs a variable, got '${JSON.stringify(nm)}'`);
            if (peek() === '[') { next(); orExpr(); expect(']'); emit('SHL AX, 1', `MOV BX, OFFSET ${arrLabel(nm)}`, 'ADD AX, BX'); return; }
            varAddrEmit(nm); return;
        }
        if (typeof t === 'string' && /^\d+$/.test(t)) { emit(`MOV AX, ${parseInt(t, 10) & 0xffff}`); return; }
        if (isId(t) && !KW.has(t)) {
            if (peek() === '[') {   // array element read: a[i]
                next(); orExpr(); expect(']');
                emit('SHL AX, 1', `MOV BX, OFFSET ${arrLabel(t)}`, 'ADD BX, AX', 'MOV AX, [BX]'); return;
            }
            if (peek() === '(') { emitCall(t); return; }   // function call
            emit(`MOV AX, ${varRef(t)}`); return;
        }
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
    /** Codegen an argument/expression captured as its own token slice. */
    function genSlice(slice) {
        const st = toks, si = i; toks = slice; i = 0;
        orExpr();
        if (i !== toks.length) throw new Error('C: bad expression in argument');
        toks = st; i = si;
    }
    /** A call: gather args (balanced), push right-to-left (cdecl), CALL, clean up. */
    function emitCall(name) {
        expect('(');
        const args = [];
        if (peek() !== ')') {
            do {
                const slice = []; let d = 0;
                while (i < toks.length) { const tk = peek(); if (d === 0 && (tk === ',' || tk === ')')) break; if (tk === '(') d++; else if (tk === ')') d--; slice.push(next()); }
                args.push(slice);
            } while (peek() === ',' && next());
        }
        expect(')');
        for (let a = args.length - 1; a >= 0; a--) { genSlice(args[a]); emit('PUSH AX'); }
        calls.add(name);
        emit(`CALL ${fnLabel(name)}`);
        if (args.length) emit(`ADD SP, ${2 * args.length}`);
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
        if (peek() === '*') {   // pointer deref write: *p = expr
            next(); primary();                           // pointer address -> AX
            emit('MOV BX, AX', 'PUSH BX');
            const op = next();
            if (op !== '=') throw new Error(`C: pointer deref supports '=' only, got '${JSON.stringify(op)}'`);
            orExpr(); emit('POP BX', 'MOV [BX], AX'); return;
        }
        if (isId(peek()) && !KW.has(peek()) && toks[i + 1] === '[') {   // array element write: a[i] = expr
            const name = next(); next();                 // name, '['
            orExpr(); expect(']');                       // index -> AX
            const op = next();
            if (op !== '=') throw new Error(`C: array elements support '=' only, got '${JSON.stringify(op)}'`);
            emit('SHL AX, 1', `MOV BX, OFFSET ${arrLabel(name)}`, 'ADD BX, AX', 'PUSH BX');
            orExpr(); emit('POP BX', 'MOV [BX], AX'); return;
        }
        if (isId(peek()) && !KW.has(peek()) && (toks[i + 1] === '++' || toks[i + 1] === '--')) {
            const name = next(), op = next(), ref = varRef(name);
            emit(`MOV AX, ${ref}`, op === '++' ? 'INC AX' : 'DEC AX', `MOV ${ref}, AX`); return;
        }
        if (isId(peek()) && !KW.has(peek()) && ['=', '+=', '-=', '*=', '/='].includes(toks[i + 1])) {
            const name = next(), op = next(), ref = varRef(name);
            if (op === '=') { orExpr(); emit(`MOV ${ref}, AX`); return; }
            orExpr(); emit('MOV BX, AX', `MOV AX, ${ref}`);
            if (op === '+=') emit('ADD AX, BX'); else if (op === '-=') emit('SUB AX, BX');
            else if (op === '*=') emit('IMUL BX'); else emit('MOV CX, BX', 'CWD', 'IDIV CX');
            emit(`MOV ${ref}, AX`); return;
        }
        if (peek() === 'printf' || peek() === 'puts') { callStmt(); return; }
        orExpr();   // bare expression (e.g. a function call), value discarded
    }

    function statement() {
        const t = peek();
        if (t === '{') { block(); return; }
        if (t === ';') { next(); return; }
        if (t === 'int') {
            next();
            do {
                if (peek() === '*') next();               // pointer declarator: int *p;
                const name = next();
                if (peek() === '[') {                     // array declaration (global): int a[n];
                    next(); const sz = next(); expect(']');
                    if (typeof sz !== 'string' || !/^\d+$/.test(sz)) throw new Error(`C: array size must be an integer literal, got '${JSON.stringify(sz)}'`);
                    if (!arrays.has(name)) { const label = `A${arrays.size}`; const n = parseInt(sz, 10); arrays.set(name, { label, size: n }); data.push(`${label}:\tDW ${Array(n).fill(0).join(',')}`); }
                    continue;
                }
                if (peek() === '=') { next(); orExpr(); emit(`MOV ${varRef(name)}, AX`); }   // local slot pre-assigned
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
            const post = []; let depth = 0;
            while (i < toks.length) { const tk = peek(); if (depth === 0 && tk === ')') break; if (tk === '(') depth++; else if (tk === ')') depth--; post.push(next()); }
            expect(')');
            statement();
            if (post.length) { const st = toks, si = i; toks = post; i = 0; exprStatement(); toks = st; i = si; }
            emit(`JMP ${Ltop}`, `${Lend}:`); return;
        }
        if (t === 'return') {
            next();
            if (peek() !== ';') orExpr();   // value in AX; a bare `return;` leaves AX as-is
            emit(`JMP ${curScope.epi}`);
            expect(';'); return;
        }
        exprStatement(); expect(';');
    }

    // ── function-scoped local collection (pre-pass to size the frame) ────────
    function collectLocals(bts, paramSet) {
        const locals = new Map();
        for (let k = 0; k < bts.length; k++) {
            if (bts[k] !== 'int') continue;
            let j = k + 1;
            while (j < bts.length && bts[j] !== ';') {
                if (bts[j] === '*') j++;
                const nm = bts[j];
                if (isId(nm) && !KW.has(nm)) {
                    if (bts[j + 1] === '[') { while (j < bts.length && bts[j] !== ']') j++; }   // array -> global
                    else if (!paramSet.has(nm) && !locals.has(nm)) locals.set(nm, locals.size);
                }
                while (j < bts.length && bts[j] !== ',' && bts[j] !== ';') j++;
                if (bts[j] === ',') j++;
            }
            k = j;
        }
        return locals;
    }

    function parseFunction() {
        const rt = next();
        if (rt !== 'int' && rt !== 'void') throw new Error(`C: expected a function return type (int/void), got '${JSON.stringify(rt)}'`);
        const name = next();
        if (!isId(name) || KW.has(name)) throw new Error(`C: expected a function name, got '${JSON.stringify(name)}'`);
        expect('(');
        const params = new Map();
        if (peek() === 'void' && toks[i + 1] === ')') next();   // (void)
        else if (peek() !== ')') {
            do {
                if (peek() === 'int') next();     // optional type
                if (peek() === '*') next();       // pointer param
                const pn = next();
                if (!isId(pn)) throw new Error(`C: bad parameter '${JSON.stringify(pn)}'`);
                params.set(pn, params.size);
            } while (peek() === ',' && next());
        }
        expect(')');
        expect('{');
        const body = []; let depth = 1;
        while (i < toks.length) {
            const tk = next();
            if (tk === '{') depth++;
            else if (tk === '}') { depth--; if (depth === 0) break; }
            body.push(tk);
        }
        const locals = collectLocals(body, new Set(params.keys()));
        const epi = lbl();
        code.push(`${fnLabel(name)}:`);
        emit('PUSH BP', 'MOV BP, SP');
        if (locals.size) emit(`SUB SP, ${2 * locals.size}`);
        const savedToks = toks, savedI = i, savedScope = curScope;
        toks = body; i = 0; curScope = { params, locals, epi };
        while (i < toks.length) statement();
        toks = savedToks; i = savedI; curScope = savedScope;
        code.push(`${epi}:`);
        emit('MOV SP, BP', 'POP BP', 'RET');
        funcs.add(name);
    }

    // ── driver: entry calls main, then every function, then the runtime ─────
    emit(`CALL ${fnLabel('main')}`, 'MOV AH, 4CH', 'INT 21H');   // main's return -> exit code (AL)
    while (i < toks.length) parseFunction();
    if (!funcs.has('main')) throw new Error('C: no main() function found');
    for (const c of calls) if (!funcs.has(c)) throw new Error(`C: call to undefined function '${c}'`);

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
