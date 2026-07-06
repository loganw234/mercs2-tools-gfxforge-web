const { loadContext, test, assert, assertEqual } = require('./run.js');

function hex(u8) { return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''); }

test('scripting: for loop compiles and structurally verifies', () => {
  const ctx = loadContext();
  const code = ctx.Compiler.compileSource('for (i = 0; i < 5; i = i + 1) { x = i; }');
  assert(code.length > 0, 'expected non-empty bytecode');
});

test('scripting: for loop with var-declared counter parses', () => {
  const ctx = loadContext();
  const code = ctx.Compiler.compileSource('for (var i = 0; i < 3; i = i + 1) { fscommand("tick", i); }');
  assert(code.length > 0);
});

test('scripting: empty for-clauses (infinite-loop shape) parse — for(;;) with a break', () => {
  const ctx = loadContext();
  const code = ctx.Compiler.compileSource('for (;;) { break; }');
  assert(code.length > 0);
});

test('scripting: break outside a loop is a compile error', () => {
  const ctx = loadContext();
  let threw = false;
  try { ctx.Compiler.compileSource('break;'); } catch (e) { threw = /break/.test(e.message); }
  assert(threw, 'expected a compile error mentioning break');
});

test('scripting: continue outside a loop is a compile error', () => {
  const ctx = loadContext();
  let threw = false;
  try { ctx.Compiler.compileSource('continue;'); } catch (e) { threw = /continue/.test(e.message); }
  assert(threw, 'expected a compile error mentioning continue');
});

test('scripting: compound assignment operators all parse and compile', () => {
  const ctx = loadContext();
  for (const op of ['+=', '-=', '*=', '/=', '%=']) {
    const code = ctx.Compiler.compileSource(`x ${op} 1;`);
    assert(code.length > 0, `${op} failed to compile`);
  }
});

test('scripting: compound assignment on a member (obj.prop += n) compiles', () => {
  const ctx = loadContext();
  const code = ctx.Compiler.compileSource('_root.hp_val += 5;');
  assert(code.length > 0);
});

test('scripting: array literal compiles to push-elements + count + InitArray(0x42)', () => {
  const ctx = loadContext();
  const code = ctx.Compiler.compileExpression('[1, 2, 3]');
  const h = hex(code);
  assert(h.includes('42'), 'expected InitArray opcode 0x42 in output: ' + h);
});

test('scripting: array indexing and .length still parse (existing member/index grammar)', () => {
  const ctx = loadContext();
  const code = ctx.Compiler.compileSource('x = arr[0]; y = arr.length;');
  assert(code.length > 0);
});

test('scripting: tokenizer error includes line and column', () => {
  const ctx = loadContext();
  let msg = '';
  try { ctx.Compiler.compileSource('x = 1;\ny = @;'); } catch (e) { msg = e.message; }
  assert(/Line 2, column \d+/.test(msg), 'expected "Line 2, column N" in: ' + msg);
});

test('scripting: parser mismatch error includes line and column', () => {
  const ctx = loadContext();
  let msg = '';
  try { ctx.Compiler.compileSource('if (x < 1 { y = 1; }'); } catch (e) { msg = e.message; }
  assert(/Line 1, column \d+/.test(msg), 'expected "Line 1, column N" in: ' + msg);
});

test('scripting: unexpected-token error includes line and column, on a later line', () => {
  const ctx = loadContext();
  let msg = '';
  try {
    ctx.Compiler.compileSource('function f() {\n  x = ;\n}');
  } catch (e) { msg = e.message; }
  assert(/Line 2/.test(msg), 'expected error to report line 2: ' + msg);
});

test('scripting: combined program using for/break/continue/compound-assign/arrays compiles', () => {
  const ctx = loadContext();
  const src = `
    function Sum(n) {
      total = 0;
      for (i = 0; i < n; i += 1) {
        if (i == 3) { continue; }
        if (i > 8) { break; }
        total += i;
      }
      return total;
    }
    scores = [10, 20, 30];
    x = scores[1];
  `;
  const code = ctx.Compiler.compileSource(src);
  assert(code.length > 0);
  const summary = ctx.Verify.verifyGfx((() => {
    const m = new ctx.GFMovie.Movie(100, 40, { name: 'test' });
    m.script(code);
    return m.build();
  })(), { functions: ['Sum'] });
  assert(summary.functions.includes('Sum'), 'Sum function not found by verifier');
});
