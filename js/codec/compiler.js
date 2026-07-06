const Compiler = (function() {
// Port + extension of gfxforge/compiler.py — an AS2-subset -> AVM1 compiler.
//
// Supported: number/string/bool/null/undefined/array literals; variables;
// obj.member / obj[key]; unary - !; binary + - * / % < > <= >= == != && ||;
// compound assignment += -= *= /= %=; calls f(a,b) and methods o.m(a);
// fscommand("evt", x); assignment; if/else, while, for(;;), break, continue,
// function name(params){...}, return.
//
// Known limits: && / || are NOT short-circuit; calls are by name (or
// method); no object literals; `for` only supports the classic three-clause
// form (no for-in); parser/tokenizer errors include line/column, but errors
// raised during code generation (e.g. "break outside of a loop") do not, since
// that would require threading position info through every AST node rather
// than just tokens.

const avm1 = Avm1;
const NOT = avm1.NOT;

// --- Assembler: AVM1 code buffer with labels and backpatched branches -------
//
// Branch offsets in AVM1 are signed and measured from the byte *after* the
// 2-byte offset field, so we stash a fixup and resolve it in assemble().

const JUMP = 0x99; // ActionJump: always
const IF = 0x9d;   // ActionIf: pop bool, branch if true

class Assembler {
  constructor() {
    this.buf = [];       // array of byte values (numbers)
    this._labels = {};
    this._fixups = [];   // [offsetFieldPos, labelName]
  }

  emit(actionBytes) {
    for (const b of actionBytes) this.buf.push(b);
    return this;
  }

  label(name) {
    if (Object.prototype.hasOwnProperty.call(this._labels, name)) {
      throw new Error(`duplicate label ${JSON.stringify(name)}`);
    }
    this._labels[name] = this.buf.length;
    return this;
  }

  _branch(opcode, name) {
    this.buf.push(opcode, 2, 0);            // opcode + u16(2) little-endian
    this._fixups.push([this.buf.length, name]);
    this.buf.push(0, 0);                    // placeholder, patched in assemble()
    return this;
  }

  jump(name) {
    return this._branch(JUMP, name);
  }

  jumpIf(name) {
    return this._branch(IF, name);
  }

  jumpUnless(name) {
    this.emit(NOT);
    return this._branch(IF, name);
  }

  assemble() {
    const out = new Uint8Array(this.buf);
    const view = new DataView(out.buffer);
    for (const [pos, name] of this._fixups) {
      if (!Object.prototype.hasOwnProperty.call(this._labels, name)) {
        throw new Error(`undefined label ${JSON.stringify(name)}`);
      }
      view.setInt16(pos, this._labels[name] - (pos + 2), true);
    }
    return out;
  }
}

// --- lexer -------------------------------------------------------------------

const KEYWORDS = new Set(['if', 'else', 'while', 'for', 'break', 'continue',
  'function', 'return', 'var', 'true', 'false', 'null', 'undefined']);

// Order mirrors the Python regex alternation: whitespace/comment, number,
// string, name, operator. First match wins at each position. Compound
// assignment ops must come before the single-char class so e.g. "+=" isn't
// split into "+" then "=".
const TOKEN_RE = /(\s+|\/\/[^\n]*)|(\d+\.\d+|\d+)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_$][A-Za-z0-9_$]*)|(<=|>=|==|!=|&&|\|\||\+=|-=|\*=|\/=|%=|[-+*/%<>=!.,(){}\[\];])/y;

function unescape(s) {
  // Mirrors Python's body.replace(...).replace(...)... chain exactly: four
  // sequential global literal-substring replace passes, in this order. (Not
  // the same as a single left-to-right scan — e.g. the \\ pass runs last, so
  // an already-produced \n from the \n pass is never re-touched by it.)
  const q = s[0];
  let body = s.slice(1, -1);
  body = body.split('\\' + q).join(q);
  body = body.split('\\n').join('\n');
  body = body.split('\\t').join('\t');
  body = body.split('\\\\').join('\\');
  return body;
}

function tokenize(text) {
  const toks = [];
  let i = 0;
  let line = 1, col = 1;
  function advance(consumed) {
    for (let j = 0; j < consumed.length; j++) {
      if (consumed[j] === '\n') { line += 1; col = 1; } else { col += 1; }
    }
  }
  TOKEN_RE.lastIndex = 0;
  while (i < text.length) {
    TOKEN_RE.lastIndex = i;
    const m = TOKEN_RE.exec(text);
    if (!m || m.index !== i) {
      throw new SyntaxError(`Line ${line}, column ${col}: unrecognized text ${JSON.stringify(text.slice(i, i + 16))}`);
    }
    const startLine = line, startCol = col;
    const full = m[0];
    i = TOKEN_RE.lastIndex;
    const [, ws, num, str, name, op] = m;
    advance(full);
    if (ws !== undefined) continue;
    if (num !== undefined) {
      toks.push(['num', parseFloat(num), startLine, startCol]);
    } else if (str !== undefined) {
      toks.push(['str', unescape(str), startLine, startCol]);
    } else if (name !== undefined) {
      toks.push([KEYWORDS.has(name) ? 'kw' : 'name', name, startLine, startCol]);
    } else {
      toks.push(['op', op, startLine, startCol]);
    }
  }
  toks.push(['eof', '', line, col]);
  return toks;
}

// --- parser (recursive descent + precedence climbing) ------------------------

const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4,
  '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

class Parser {
  constructor(toks) {
    this.t = toks;
    this.i = 0;
  }

  _peek() { return this.t[this.i]; }
  _next() { const tok = this.t[this.i]; this.i += 1; return tok; }

  _at(kind, val) {
    const [k, v] = this.t[this.i];
    return k === kind && (val === undefined || v === val);
  }

  _eat(kind, val) {
    const [k, v, line, col] = this.t[this.i];
    if (k !== kind || (val !== undefined && v !== val)) {
      throw new SyntaxError(`Line ${line}, column ${col}: expected ${kind} ${JSON.stringify(val)}, got ${k} ${JSON.stringify(v)}`);
    }
    this.i += 1;
    return v;
  }

  program() {
    const out = [];
    while (!this._at('eof')) out.push(this.statement());
    return out;
  }

  block() {
    this._eat('op', '{');
    const out = [];
    while (!this._at('op', '}')) out.push(this.statement());
    this._eat('op', '}');
    return out;
  }

  statement() {
    let [k, v] = this._peek();
    if (k === 'kw' && v === 'if') return this._if();
    if (k === 'kw' && v === 'while') {
      this._next(); this._eat('op', '(');
      const c = this.expression();
      this._eat('op', ')');
      return ['while', c, this.block()];
    }
    if (k === 'kw' && v === 'for') return this._for();
    if (k === 'kw' && v === 'break') { this._next(); this._eat('op', ';'); return ['break']; }
    if (k === 'kw' && v === 'continue') { this._next(); this._eat('op', ';'); return ['continue']; }
    if (k === 'kw' && v === 'function') {
      this._next();
      const name = this._eat('name');
      this._eat('op', '(');
      const params = [];
      if (!this._at('op', ')')) {
        params.push(this._eat('name'));
        while (this._at('op', ',')) { this._next(); params.push(this._eat('name')); }
      }
      this._eat('op', ')');
      return ['func', name, params, this.block()];
    }
    if (k === 'kw' && v === 'return') {
      this._next();
      if (this._at('op', ';')) { this._next(); return ['return', null]; }
      const e = this.expression();
      this._eat('op', ';');
      return ['return', e];
    }
    if (k === 'kw' && v === 'var') {
      this._next();
      const name = this._eat('name');
      this._eat('op', '=');
      const e = this.expression();
      this._eat('op', ';');
      return ['assign', ['var', name], e];
    }
    // expression statement, assignment, or compound assignment
    const e = this.expression();
    const node = this._assignmentFrom(e);
    this._eat('op', ';');
    return node;
  }

  // Given an already-parsed expression `e`, checks for a following `=` or
  // compound-assignment operator and returns the right statement node —
  // otherwise just wraps `e` as an expression-statement. Shared by plain
  // statements and by for(...)'s init/update clauses (which don't have their
  // own trailing `;`/`)` to consume, so the caller handles that).
  _assignmentFrom(e) {
    const compound = { '+=': '+', '-=': '-', '*=': '*', '/=': '/', '%=': '%' };
    const [k, v] = this._peek();
    if (k === 'op' && v === '=') {
      this._next();
      const rhs = this.expression();
      return ['assign', e, rhs];
    }
    if (k === 'op' && Object.prototype.hasOwnProperty.call(compound, v)) {
      this._next();
      const rhs = this.expression();
      return ['assign', e, ['binop', compound[v], e, rhs]];
    }
    return ['expr', e];
  }

  _for() {
    this._eat('kw', 'for');
    this._eat('op', '(');
    let init = null;
    if (this._at('kw', 'var')) {
      this._next();
      const name = this._eat('name');
      this._eat('op', '=');
      init = ['assign', ['var', name], this.expression()];
    } else if (!this._at('op', ';')) {
      init = this._assignmentFrom(this.expression());
    }
    this._eat('op', ';');
    const cond = this._at('op', ';') ? ['bool', true] : this.expression();
    this._eat('op', ';');
    let update = null;
    if (!this._at('op', ')')) update = this._assignmentFrom(this.expression());
    this._eat('op', ')');
    const body = this.block();
    return ['for', init, cond, update, body];
  }

  _if() {
    this._eat('kw', 'if'); this._eat('op', '(');
    const c = this.expression();
    this._eat('op', ')');
    const then = this.block();
    let els = null;
    if (this._at('kw', 'else')) {
      this._next();
      els = this._at('kw', 'if') ? [this._if()] : this.block();
    }
    return ['if', c, then, els];
  }

  expression(minPrec = 1) {
    let left = this._unary();
    for (;;) {
      const [k, v] = this._peek();
      if (k === 'op' && v in PREC && PREC[v] >= minPrec) {
        this._next();
        left = ['binop', v, left, this.expression(PREC[v] + 1)];
      } else {
        return left;
      }
    }
  }

  _unary() {
    const [k, v] = this._peek();
    if (k === 'op' && (v === '-' || v === '!')) {
      this._next();
      return ['unop', v, this._unary()];
    }
    return this._postfix();
  }

  _postfix() {
    let e = this._primary();
    for (;;) {
      if (this._at('op', '.')) {
        this._next();
        e = ['member', e, this._eat('name')];
      } else if (this._at('op', '(')) {
        this._next();
        const args = [];
        if (!this._at('op', ')')) {
          args.push(this.expression());
          while (this._at('op', ',')) { this._next(); args.push(this.expression()); }
        }
        this._eat('op', ')');
        e = ['call', e, args];
      } else if (this._at('op', '[')) {
        this._next();
        const idx = this.expression();
        this._eat('op', ']');
        e = ['index', e, idx];
      } else {
        return e;
      }
    }
  }

  _primary() {
    const [k, v, line, col] = this._next();
    if (k === 'num') return ['num', v];
    if (k === 'str') return ['str', v];
    if (k === 'name') return ['var', v];
    if (k === 'kw') {
      if (v === 'true') return ['bool', true];
      if (v === 'false') return ['bool', false];
      if (v === 'null') return ['null'];
      if (v === 'undefined') return ['undef'];
    }
    if (k === 'op' && v === '(') {
      const e = this.expression();
      this._eat('op', ')');
      return e;
    }
    if (k === 'op' && v === '[') {
      const elements = [];
      if (!this._at('op', ']')) {
        elements.push(this.expression());
        while (this._at('op', ',')) { this._next(); elements.push(this.expression()); }
      }
      this._eat('op', ']');
      return ['array', elements];
    }
    throw new SyntaxError(`Line ${line}, column ${col}: unexpected ${k} ${JSON.stringify(v)}`);
  }
}

// --- code generator ----------------------------------------------------------

const BINOP = {
  '+': avm1.ADD2, '-': avm1.SUBTRACT, '*': avm1.MULTIPLY, '/': avm1.DIVIDE,
  '%': avm1.MODULO, '<': avm1.LESS2, '>': avm1.GREATER, '==': avm1.EQUALS2,
  '&&': avm1.AND, '||': avm1.OR,
};
const NULL_LIT = Uint8Array.from([0x96, 0x01, 0x00, 0x02]);
const UNDEF_LIT = Uint8Array.from([0x96, 0x01, 0x00, 0x03]);

function concatArrays(...parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

class Gen {
  constructor() {
    this.asm = new Assembler();
    this._n = 0;
    this._loopStack = []; // [{continueLabel, breakLabel}], innermost last
  }

  _label(prefix) {
    this._n += 1;
    return `${prefix}${this._n}`;
  }

  emit(b) { this.asm.emit(b); }

  block(stmts) {
    for (const s of stmts) this.statement(s);
  }

  statement(node) {
    const t = node[0];
    if (t === 'assign') {
      this._assign(node[1], node[2]);
    } else if (t === 'if') {
      this._if(node[1], node[2], node[3]);
    } else if (t === 'while') {
      this._while(node[1], node[2]);
    } else if (t === 'for') {
      this._forLoop(node[1], node[2], node[3], node[4]);
    } else if (t === 'break') {
      if (!this._loopStack.length) throw new SyntaxError('break used outside of a loop');
      this.asm.jump(this._loopStack[this._loopStack.length - 1].breakLabel);
    } else if (t === 'continue') {
      if (!this._loopStack.length) throw new SyntaxError('continue used outside of a loop');
      this.asm.jump(this._loopStack[this._loopStack.length - 1].continueLabel);
    } else if (t === 'func') {
      this.emit(avm1.defineFunction(node[1], node[2], compileBody(node[3])));
    } else if (t === 'return') {
      if (node[1] !== null) this.expression(node[1]); else this.emit(UNDEF_LIT);
      this.emit(avm1.RETURN);
    } else if (t === 'expr') {
      const n = this.expression(node[1]);
      for (let i = 0; i < n; i++) this.emit(avm1.POP);
    } else {
      throw new SyntaxError(`bad statement ${JSON.stringify(t)}`);
    }
  }

  _assign(lval, rhs) {
    if (lval[0] === 'var') {
      this.emit(avm1.push(lval[1])); this.expression(rhs); this.emit(avm1.SET_VARIABLE);
    } else if (lval[0] === 'member') {
      this.expression(lval[1]); this.emit(avm1.push(lval[2]));
      this.expression(rhs); this.emit(avm1.SET_MEMBER);
    } else if (lval[0] === 'index') {
      this.expression(lval[1]); this.expression(lval[2]);
      this.expression(rhs); this.emit(avm1.SET_MEMBER);
    } else {
      throw new SyntaxError(`cannot assign to ${JSON.stringify(lval[0])}`);
    }
  }

  _if(cond, then, els) {
    const end = this._label('endif');
    this.expression(cond);
    if (els) {
      const elsel = this._label('else');
      this.asm.jumpUnless(elsel);
      this.block(then);
      this.asm.jump(end);
      this.asm.label(elsel);
      this.block(els);
    } else {
      this.asm.jumpUnless(end);
      this.block(then);
    }
    this.asm.label(end);
  }

  _while(cond, body) {
    const top = this._label('while');
    const end = this._label('endwhile');
    this._loopStack.push({ continueLabel: top, breakLabel: end });
    this.asm.label(top);
    this.expression(cond);
    this.asm.jumpUnless(end);
    this.block(body);
    this.asm.jump(top);
    this.asm.label(end);
    this._loopStack.pop();
  }

  // for(init; cond; update) { body } — continue must run `update` before
  // re-checking `cond` (unlike a plain while), so it gets its own label
  // sitting between body and update rather than reusing while's single
  // "top" label.
  _forLoop(init, cond, update, body) {
    if (init) this.statement(init);
    const top = this._label('for');
    const cont = this._label('forcont');
    const end = this._label('endfor');
    this._loopStack.push({ continueLabel: cont, breakLabel: end });
    this.asm.label(top);
    this.expression(cond);
    this.asm.jumpUnless(end);
    this.block(body);
    this.asm.label(cont);
    if (update) this.statement(update);
    this.asm.jump(top);
    this.asm.label(end);
    this._loopStack.pop();
  }

  // Emit code leaving the value on the stack; returns values pushed (0 or 1).
  expression(node) {
    const t = node[0];
    if (t === 'num') {
      const val = node[1];
      this.emit(avm1.push(val === Math.trunc(val) ? Math.trunc(val) : val));
      return 1;
    }
    if (t === 'str' || t === 'bool') { this.emit(avm1.push(node[1])); return 1; }
    if (t === 'null') { this.emit(NULL_LIT); return 1; }
    if (t === 'undef') { this.emit(UNDEF_LIT); return 1; }
    if (t === 'var') { this.emit(avm1.var(node[1])); return 1; }
    if (t === 'member') {
      this.expression(node[1]);
      this.emit(concatArrays(avm1.push(node[2]), avm1.GET_MEMBER));
      return 1;
    }
    if (t === 'index') {
      this.expression(node[1]); this.expression(node[2]); this.emit(avm1.GET_MEMBER);
      return 1;
    }
    if (t === 'unop') {
      if (node[1] === '-') {
        this.emit(avm1.push(0)); this.expression(node[2]); this.emit(avm1.SUBTRACT);
      } else {
        this.expression(node[2]); this.emit(avm1.NOT);
      }
      return 1;
    }
    if (t === 'binop') return this._binop(node[1], node[2], node[3]);
    if (t === 'call') return this._call(node[1], node[2]);
    if (t === 'array') {
      for (const el of node[1]) this.expression(el); // push elements in source order
      this.emit(avm1.push(node[1].length));
      this.emit(avm1.INIT_ARRAY);
      return 1;
    }
    throw new SyntaxError(`bad expression ${JSON.stringify(t)}`);
  }

  _binop(op, a, b) {
    this.expression(a); this.expression(b);
    if (op in BINOP) {
      this.emit(BINOP[op]);
    } else if (op === '!=') {
      this.emit(concatArrays(avm1.EQUALS2, avm1.NOT));
    } else if (op === '<=') {
      this.emit(concatArrays(avm1.GREATER, avm1.NOT));
    } else if (op === '>=') {
      this.emit(concatArrays(avm1.LESS2, avm1.NOT));
    } else {
      throw new SyntaxError(`bad operator ${JSON.stringify(op)}`);
    }
    return 1;
  }

  _call(callee, args) {
    // fscommand("evt", value) -> GetURL2 form (pushes nothing)
    if (callee[0] === 'var' && callee[1] === 'fscommand' && args.length && args[0][0] === 'str') {
      this.emit(avm1.push('FSCommand:' + args[0][1]));
      if (args.length > 1) this.expression(args[1]); else this.emit(avm1.push(''));
      this.emit(avm1.getUrl2(0));
      return 0;
    }
    if (callee[0] === 'member') { // method call: obj.m(args)
      for (let i = args.length - 1; i >= 0; i--) this.expression(args[i]);
      this.emit(avm1.push(args.length));
      this.expression(callee[1]);
      this.emit(avm1.push(callee[2]));
      this.emit(avm1.CALL_METHOD);
      return 1;
    }
    for (let i = args.length - 1; i >= 0; i--) this.expression(args[i]); // function call by name
    this.emit(avm1.push(args.length));
    if (callee[0] === 'var') {
      this.emit(avm1.push(callee[1]));
    } else {
      this.expression(callee);
    }
    this.emit(avm1.CALL_FUNCTION);
    return 1;
  }
}

function compileBody(stmts) {
  const g = new Gen();
  g.block(stmts);
  return g.asm.assemble();
}

// --- public API --------------------------------------------------------------

function compileSource(text) {
  return compileBody(new Parser(tokenize(text)).program());
}

function compileExpression(text) {
  const p = new Parser(tokenize(text));
  const node = p.expression();
  if (!p._at('eof')) throw new SyntaxError('trailing tokens after expression');
  const g = new Gen();
  g.expression(node);
  return g.asm.assemble();
}

const api = { Assembler, tokenize, Parser, compileSource, compileExpression };

  return api;
})();
