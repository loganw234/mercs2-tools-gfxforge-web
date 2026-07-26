const { loadContext, test, assert, assertEqual } = require('./run.js');

// Behavioural tests for the extended AS2 surface. These go through the real
// compiler and the real interpreter, so they exercise both encode and decode of
// every opcode the compiler learned to emit.

function run(ctx, src, items) {
  const trace = [];
  const rt = ctx.Avm1Interp.createInterpreter(items || [], { onTrace: (m) => trace.push(m) });
  rt.runTopLevel(ctx.Compiler.compileSource(src));
  return { rt, trace, get: (n) => rt.getRootProperty(n) };
}

function compiles(ctx, src) {
  try { ctx.Compiler.compileSource(src); return true; } catch (e) { return e.message; }
}

// --- semantics fixes ---------------------------------------------------------

test('as2: && and || short-circuit instead of evaluating both sides', () => {
  const ctx = loadContext();
  // `calls` counts how many times the right-hand side actually ran
  const r = run(ctx, `
    calls = 0;
    function bump() { _root.calls = _root.calls + 1; return true; }
    a = false && bump();
    b = true || bump();
  `);
  assertEqual(r.get('calls'), 0, 'neither right-hand side should have run');
  const r2 = run(ctx, `
    calls = 0;
    function bump() { _root.calls = _root.calls + 1; return true; }
    a = true && bump();
    b = false || bump();
  `);
  assertEqual(r2.get('calls'), 2, 'both right-hand sides should have run');
});

test('as2: && and || yield the operand value, not a coerced boolean', () => {
  const ctx = loadContext();
  const r = run(ctx, 'a = 0 || "fallback"; b = "set" && "second"; c = "" || 0;');
  assertEqual(r.get('a'), 'fallback');
  assertEqual(r.get('b'), 'second');
  assertEqual(r.get('c'), 0);
});

test('as2: var inside a function stays local instead of leaking to _root', () => {
  const ctx = loadContext();
  const r = run(ctx, `
    leaked = "untouched";
    function f() { var leaked = "local"; return leaked; }
    result = f();
  `);
  assertEqual(r.get('result'), 'local', 'the local should be visible inside the function');
  assertEqual(r.get('leaked'), 'untouched', 'the _root variable must not have been overwritten');
});

test('as2: compound assignment evaluates its target exactly once', () => {
  const ctx = loadContext();
  const r = run(ctx, `
    calls = 0;
    arr = [10, 20, 30];
    function idx() { _root.calls = _root.calls + 1; return 1; }
    arr[idx()] += 5;
  `);
  assertEqual(r.get('calls'), 1, 'the index expression must run once, not twice');
  assertEqual(r.get('arr')[1], 25);
});

// --- operators ---------------------------------------------------------------

test('as2: strict equality distinguishes types', () => {
  const ctx = loadContext();
  const r = run(ctx, 'a = (1 === 1); b = ("1" === 1); c = ("1" !== 1); d = (1 == "1");');
  assertEqual(r.get('a'), true);
  assertEqual(r.get('b'), false);
  assertEqual(r.get('c'), true);
  assertEqual(r.get('d'), true, 'loose == should still coerce');
});

test('as2: bitwise and shift operators', () => {
  const ctx = loadContext();
  const r = run(ctx, 'a = 12 & 10; b = 12 | 3; c = 12 ^ 10; d = 1 << 4; e = -16 >> 2; f = 8 >>> 1; g = ~5;');
  assertEqual(r.get('a'), 8);
  assertEqual(r.get('b'), 15);
  assertEqual(r.get('c'), 6);
  assertEqual(r.get('d'), 16);
  assertEqual(r.get('e'), -4);
  assertEqual(r.get('f'), 4);
  assertEqual(r.get('g'), -6);
});

test('as2: increment and decrement in both fixities', () => {
  const ctx = loadContext();
  const r = run(ctx, 'i = 5; a = i++; b = i; c = ++i; d = i; j = 5; e = j--; f = --j;');
  assertEqual(r.get('a'), 5, 'postfix yields the old value');
  assertEqual(r.get('b'), 6);
  assertEqual(r.get('c'), 7, 'prefix yields the new value');
  assertEqual(r.get('d'), 7);
  assertEqual(r.get('e'), 5);
  assertEqual(r.get('f'), 3);
});

test('as2: ++ drives a for loop', () => {
  const ctx = loadContext();
  const r = run(ctx, 'total = 0; for (var i = 0; i < 5; i++) { total = total + i; }');
  assertEqual(r.get('total'), 10);
});

test('as2: ternary picks a branch and does not evaluate the other', () => {
  const ctx = loadContext();
  const r = run(ctx, `
    calls = 0;
    function side() { _root.calls = _root.calls + 1; return "no"; }
    a = (1 < 2) ? "yes" : side();
    b = (1 > 2) ? "no" : "else";
  `);
  assertEqual(r.get('a'), 'yes');
  assertEqual(r.get('b'), 'else');
  assertEqual(r.get('calls'), 0);
});

test('as2: typeof reports AVM1 type names', () => {
  const ctx = loadContext();
  const r = run(ctx, 'a = typeof 1; b = typeof "s"; c = typeof true; d = typeof undefined; e = typeof {};');
  assertEqual(r.get('a'), 'number');
  assertEqual(r.get('b'), 'string');
  assertEqual(r.get('c'), 'boolean');
  assertEqual(r.get('d'), 'undefined');
  assertEqual(r.get('e'), 'object');
});

test('as2: compound assignment covers the bitwise forms too', () => {
  const ctx = loadContext();
  const r = run(ctx, 'a = 12; a &= 10; b = 1; b |= 6; c = 1; c <<= 3; d = 10; d -= 4; e = 3; e *= 3;');
  assertEqual(r.get('a'), 8);
  assertEqual(r.get('b'), 7);
  assertEqual(r.get('c'), 8);
  assertEqual(r.get('d'), 6);
  assertEqual(r.get('e'), 9);
});

// --- statements --------------------------------------------------------------

test('as2: do/while always runs its body at least once', () => {
  const ctx = loadContext();
  const r = run(ctx, 'n = 0; do { n = n + 1; } while (n < 0);');
  assertEqual(r.get('n'), 1);
  const r2 = run(ctx, 'n = 0; do { n = n + 1; } while (n < 5);');
  assertEqual(r2.get('n'), 5);
});

test('as2: switch matches, falls through, and honours default', () => {
  const ctx = loadContext();
  const r = run(ctx, 'x = 2; switch (x) { case 1: a = "one"; break; case 2: a = "two"; break; default: a = "other"; }');
  assertEqual(r.get('a'), 'two');
  const r2 = run(ctx, 'x = 9; switch (x) { case 1: a = "one"; break; default: a = "other"; }');
  assertEqual(r2.get('a'), 'other');
  // no break on case 1 -> falls through into case 2
  const r3 = run(ctx, 'hits = ""; switch (1) { case 1: hits = hits + "a"; case 2: hits = hits + "b"; break; case 3: hits = hits + "c"; }');
  assertEqual(r3.get('hits'), 'ab');
});

test('as2: switch uses strict comparison, so "1" does not match 1', () => {
  const ctx = loadContext();
  const r = run(ctx, 'a = "none"; switch ("1") { case 1: a = "number"; break; default: a = "default"; }');
  assertEqual(r.get('a'), 'default');
});

test('as2: continue inside a switch targets the enclosing loop', () => {
  const ctx = loadContext();
  const r = run(ctx, `
    total = 0;
    for (var i = 0; i < 5; i++) {
      switch (i) {
        case 2: continue;
        default: total = total + 1;
      }
    }
  `);
  assertEqual(r.get('total'), 4, 'i == 2 should have been skipped');
});

test('as2: for-in walks object members', () => {
  const ctx = loadContext();
  const r = run(ctx, 'o = {a: 1, b: 2, c: 3}; sum = 0; for (var k in o) { sum = sum + o[k]; }');
  assertEqual(r.get('sum'), 6);
});

test('as2: braceless if/while bodies parse', () => {
  const ctx = loadContext();
  const r = run(ctx, 'x = 0; if (1 < 2) x = 5; else x = 9; n = 0; while (n < 3) n = n + 1;');
  assertEqual(r.get('x'), 5);
  assertEqual(r.get('n'), 3);
});

test('as2: multiple declarators in one var statement', () => {
  const ctx = loadContext();
  const r = run(ctx, 'function f() { var a = 1, b = 2, c; return a + b; } out = f();');
  assertEqual(r.get('out'), 3);
});

// --- literals and expressions -------------------------------------------------

test('as2: object literals build real objects', () => {
  const ctx = loadContext();
  const r = run(ctx, 'o = {x: 10, y: 20, name: "hud"}; a = o.x + o.y; b = o.name;');
  assertEqual(r.get('a'), 30);
  assertEqual(r.get('b'), 'hud');
});

test('as2: nested object and array literals', () => {
  const ctx = loadContext();
  const r = run(ctx, 'o = {pos: {x: 3}, list: [1, 2, 3]}; a = o.pos.x; b = o.list[2];');
  assertEqual(r.get('a'), 3);
  assertEqual(r.get('b'), 3);
});

test('as2: new constructs script-defined classes', () => {
  const ctx = loadContext();
  const r = run(ctx, `
    function Point(x, y) { this.x = x; this.y = y; }
    p = new Point(4, 7);
    sum = p.x + p.y;
  `);
  assertEqual(r.get('sum'), 11);
});

test('as2: function expressions can be stored and called', () => {
  const ctx = loadContext();
  const r = run(ctx, 'double = function (n) { return n * 2; }; out = double(21);');
  assertEqual(r.get('out'), 42);
});

test('as2: hex literals and block comments', () => {
  const ctx = loadContext();
  const r = run(ctx, '/* leading\n   comment */ a = 0xFF; b = 0x10; // trailing\nc = 1;');
  assertEqual(r.get('a'), 255);
  assertEqual(r.get('b'), 16);
  assertEqual(r.get('c'), 1);
});

test('as2: extended string escapes', () => {
  const ctx = loadContext();
  const r = run(ctx, 'a = "tab\\there"; b = "cr\\r"; c = "hex\\x41"; d = "quote\\"q";');
  assertEqual(r.get('a'), 'tab\there');
  assertEqual(r.get('b'), 'cr\r');
  assertEqual(r.get('c'), 'hexA');
  assertEqual(r.get('d'), 'quote"q');
});

test('as2: trace() lowers to the Trace opcode and reaches the log', () => {
  const ctx = loadContext();
  const { trace } = run(ctx, 'trace("hello from the hud");');
  assert(trace.some(l => l.indexOf('hello from the hud') >= 0),
    'trace output should appear in the log, got: ' + JSON.stringify(trace));
});

test('as2: Math and other builtins resolve', () => {
  const ctx = loadContext();
  const r = run(ctx, 'a = Math.floor(3.7); b = Math.max(2, 9); c = Math.abs(-4);');
  assertEqual(r.get('a'), 3);
  assertEqual(r.get('b'), 9);
  assertEqual(r.get('c'), 4);
});

test('as2: a movie variable shadows a builtin of the same name', () => {
  const ctx = loadContext();
  const r = run(ctx, 'Key = "my own value"; out = Key;');
  assertEqual(r.get('out'), 'my own value');
});

// --- structural validity ------------------------------------------------------

test('as2: every new construct produces a well-formed action stream', () => {
  const ctx = loadContext();
  // verify.js's walkAvm1 is an independent reader — written from the action
  // record format rather than by inverting the assembler — so walking cleanly
  // means the framing, nested function bodies and branch targets all hold up
  // under something that doesn't share the encoder's assumptions.
  const programs = {
    'short-circuit': 'a = x && y; b = x || y;',
    ternary: 'a = c ? 1 : 2;',
    'nested ternary': 'a = c ? (d ? 1 : 2) : 3;',
    switch: 'switch (x) { case 1: a = 1; break; case 2: a = 2; break; default: a = 3; }',
    'do-while': 'do { n = n + 1; } while (n < 5);',
    'for-in': 'for (var k in o) { total = total + o[k]; }',
    'nested loops with break': 'for (var i = 0; i < 3; i++) { while (j < 2) { if (j == 1) { break; } j++; } }',
    'object literal': 'o = {a: 1, b: {c: 2}};',
    new: 'p = new Point(1, 2);',
    'function expression': 'f = function (n) { return n * 2; };',
    'nested functions': 'function outer(a) { function inner(b) { return b + 1; } return inner(a); }',
    'compound member': 'o.count += 1;',
    'compound impure index': 'arr[f()] += 1;',
    'update operators': 'i++; --j; a = k++;',
    bitwise: 'a = (x & y) | (z ^ w); b = p << 2; c = q >>> 1;',
    'delete and typeof': 'delete o.p; t = typeof o;',
    'deep nesting': 'if (a) { for (var i = 0; i < 2; i++) { switch (i) { case 0: while (b) { c++; } break; } } }',
  };
  for (const [label, src] of Object.entries(programs)) {
    const code = ctx.Compiler.compileSource(src);
    const found = [];
    try {
      ctx.Verify._walkAvm1(code, label, found);
    } catch (e) {
      assert(false, `${label}: ${e.message}\n  src: ${src}`);
    }
  }
});

test('as2: a compiled script survives a full movie build and verify', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(320, 200, { name: 'features' });
  m.text(10, 10, 'HP', { varName: 'hp' });
  m.script(ctx.Compiler.compileSource(`
    function SetHealth(n) {
      var pct = n / 100;
      _root.hp = (pct > 0.5) ? "OK" : "LOW";
      for (var i = 0; i < 3; i++) { trace("tick " + i); }
    }
  `));
  const summary = ctx.Verify.verifyMovie(m, { functions: ['SetHealth'] });
  assert(summary.functions.indexOf('SetHealth') >= 0, 'SetHealth should be discoverable in the built movie');
});

// --- deliberate omissions -----------------------------------------------------

test('as2: try/catch is rejected rather than silently emitted', () => {
  const ctx = loadContext();
  // GFx 2.1.57 routes opcode 0x8F to its "Unsupported opcode" branch, so a
  // movie using try/catch would load but skip the handler. Better to fail at
  // compile time than to ship something that silently misbehaves in-engine.
  const res = compiles(ctx, 'try { x = 1; } catch (e) { x = 2; }');
  assert(res !== true, 'try/catch should not compile');
});

test('as2: assigning to a non-lvalue is a clear error', () => {
  const ctx = loadContext();
  const res = compiles(ctx, '1 + 2 = 3;');
  assert(res !== true, 'should reject assignment to an expression');
});
