const { loadContext, test, assert, assertEqual } = require('./run.js');

// Helper: build a runtime against a fresh set of items, compile+run a script,
// and return {rt, trace} for assertions.
function runScript(ctx, items, src) {
  const trace = [];
  const code = ctx.Compiler.compileSource(src);
  const rt = ctx.Avm1Interp.createInterpreter(items, { onTrace: (m) => trace.push(m) });
  rt.runTopLevel(code);
  return { rt, trace };
}

test('interpreter: basic variable get/set and arithmetic', () => {
  const ctx = loadContext();
  const { rt } = runScript(ctx, [], 'x = 2 + 3 * 4;');
  assertEqual(rt.getRootProperty('x'), 14);
});

test('interpreter: string concatenation via +', () => {
  const ctx = loadContext();
  const { rt } = runScript(ctx, [], 'x = "a" + "b" + 1;');
  assertEqual(rt.getRootProperty('x'), 'ab1');
});

test('interpreter: comparisons and equality', () => {
  const ctx = loadContext();
  const { rt } = runScript(ctx, [], 'a = 1 < 2; b = 2 > 1; c = 3 == 3; d = 3 != 4; e = 2 <= 2; f = 2 >= 3;');
  assertEqual(rt.getRootProperty('a'), true);
  assertEqual(rt.getRootProperty('b'), true);
  assertEqual(rt.getRootProperty('c'), true);
  assertEqual(rt.getRootProperty('d'), true);
  assertEqual(rt.getRootProperty('e'), true);
  assertEqual(rt.getRootProperty('f'), false);
});

test('interpreter: boolean and/or/not', () => {
  const ctx = loadContext();
  const { rt } = runScript(ctx, [], 'a = true && false; b = true || false; c = !false;');
  assertEqual(rt.getRootProperty('a'), false);
  assertEqual(rt.getRootProperty('b'), true);
  assertEqual(rt.getRootProperty('c'), true);
});

test('interpreter: if/else branching picks the right side', () => {
  const ctx = loadContext();
  const { rt } = runScript(ctx, [], 'x = 10; if (x > 5) { y = "big"; } else { y = "small"; }');
  assertEqual(rt.getRootProperty('y'), 'big');
  const { rt: rt2 } = runScript(ctx, [], 'x = 1; if (x > 5) { y = "big"; } else { y = "small"; }');
  assertEqual(rt2.getRootProperty('y'), 'small');
});

test('interpreter: while loop accumulates correctly', () => {
  const ctx = loadContext();
  const { rt } = runScript(ctx, [], 'i = 0; total = 0; while (i < 5) { total = total + i; i = i + 1; }');
  assertEqual(rt.getRootProperty('total'), 10); // 0+1+2+3+4
  assertEqual(rt.getRootProperty('i'), 5);
});

test('interpreter: for loop with break and continue behaves like JS would', () => {
  const ctx = loadContext();
  // sum of 0..9 skipping 3, stopping before 7 (i.e. 0+1+2+4+5+6 = 18)
  const { rt } = runScript(ctx, [], `
    total = 0;
    for (i = 0; i < 10; i = i + 1) {
      if (i == 3) { continue; }
      if (i == 7) { break; }
      total = total + i;
    }
  `);
  assertEqual(rt.getRootProperty('total'), 18);
});

test('interpreter: continue in a for-loop still runs the update clause', () => {
  const ctx = loadContext();
  // if continue skipped the update clause this would infinite-loop and hit
  // the instruction budget instead of finishing cleanly.
  const { rt, trace } = runScript(ctx, [], `
    count = 0;
    for (i = 0; i < 20; i = i + 1) {
      if (i < 15) { continue; }
      count = count + 1;
    }
  `);
  assertEqual(rt.getRootProperty('count'), 5); // i = 15..19
  assert(!trace.some(t => t.includes('possible infinite loop')), 'should not have hit the safety cap');
});

test('interpreter: function definition, call with params, and return value', () => {
  const ctx = loadContext();
  const { rt } = runScript(ctx, [], `
    function Add(a, b) { return a + b; }
    x = Add(3, 4);
  `);
  assertEqual(rt.getRootProperty('x'), 7);
});

test('interpreter: callFunction() invokes a previously-defined function on demand', () => {
  const ctx = loadContext();
  const items = [{ kind: 'text', id: 't1', x: 0, y: 0, w: 50, size: 12, text: '--', color: [255, 255, 255, 255], varName: 'hp_val' }];
  const code = ctx.Compiler.compileSource(`
    function SetHealth(n) { _root.hp_val = n; }
  `);
  const rt = ctx.Avm1Interp.createInterpreter(items, {});
  rt.runTopLevel(code);
  assertEqual(rt.functionNames(), ['SetHealth']);
  rt.callFunction('SetHealth', [75]);
  assertEqual(rt.textValues.get('hp_val'), 75);
});

test('interpreter: parameters shadow same-named root/global variables', () => {
  const ctx = loadContext();
  const { rt } = runScript(ctx, [], `
    n = 999;
    function F(n) { return n + 1; }
    result = F(5);
  `);
  assertEqual(rt.getRootProperty('result'), 6); // uses the parameter, not the global n=999
  assertEqual(rt.getRootProperty('n'), 999);    // global untouched
});

test('interpreter: nested function calls work', () => {
  const ctx = loadContext();
  const { rt } = runScript(ctx, [], `
    function Square(x) { return x * x; }
    function SumOfSquares(a, b) { return Square(a) + Square(b); }
    result = SumOfSquares(3, 4);
  `);
  assertEqual(rt.getRootProperty('result'), 25);
});

test('interpreter: _root.member get/set on a bound text variable updates textValues', () => {
  const ctx = loadContext();
  const items = [{ kind: 'text', id: 't1', x: 0, y: 0, w: 50, size: 12, text: 'start', color: [1, 1, 1, 255], varName: 'hp_val' }];
  const { rt } = (() => {
    const code = ctx.Compiler.compileSource('_root.hp_val = "changed";');
    const rt = ctx.Avm1Interp.createInterpreter(items, {});
    rt.runTopLevel(code);
    return { rt };
  })();
  assertEqual(rt.textValues.get('hp_val'), 'changed');
});

test('interpreter: _root.clipname._y moves the actual clip item (menu highlight pattern)', () => {
  const ctx = loadContext();
  const items = [{ kind: 'clip', id: 'c1', x: 20, y: 20, w: 6, h: 22, name: 'sel', color: [1, 1, 1, 255] }];
  const code = ctx.Compiler.compileSource(`
    function SetSelected(i) { _root.sel._y = 20 + (i * 24); }
  `);
  const rt = ctx.Avm1Interp.createInterpreter(items, {});
  rt.runTopLevel(code);
  rt.callFunction('SetSelected', [2]);
  assertEqual(items[0].y, 20 + 2 * 24);
});

test('interpreter: clip _xscale/_alpha/_visible/_rotation all settable via ClipProxy', () => {
  const ctx = loadContext();
  const items = [{ kind: 'clip', id: 'c1', x: 0, y: 0, w: 10, h: 10, name: 'bar', color: [1, 1, 1, 255] }];
  const code = ctx.Compiler.compileSource(`
    _root.bar._xscale = 50;
    _root.bar._alpha = 30;
    _root.bar._visible = false;
    _root.bar._rotation = 45;
  `);
  const rt = ctx.Avm1Interp.createInterpreter(items, {});
  rt.runTopLevel(code);
  assertEqual(items[0]._xscale, 50);
  assertEqual(items[0]._alpha, 30);
  assertEqual(items[0]._visible, false);
  assertEqual(items[0]._rotation, 45);
});

test('interpreter: fscommand fires onFsCommand with the right command and value', () => {
  const ctx = loadContext();
  const fired = [];
  const code = ctx.Compiler.compileSource('fscommand("menuClick", 2);');
  const rt = ctx.Avm1Interp.createInterpreter([], { onFsCommand: (cmd, val) => fired.push([cmd, val]) });
  rt.runTopLevel(code);
  assertEqual(fired, [['menuClick', 2]]);
});

test('interpreter: fscommand with no second argument sends an empty string, matching the compiler', () => {
  const ctx = loadContext();
  const fired = [];
  const code = ctx.Compiler.compileSource('fscommand("ping");');
  const rt = ctx.Avm1Interp.createInterpreter([], { onFsCommand: (cmd, val) => fired.push([cmd, val]) });
  rt.runTopLevel(code);
  assertEqual(fired, [['ping', '']]);
});

test('interpreter: array literal, indexing, length, and push()/pop() all work', () => {
  const ctx = loadContext();
  const { rt } = runScript(ctx, [], `
    arr = [10, 20, 30];
    first = arr[0];
    len1 = arr.length;
    arr.push(40);
    len2 = arr.length;
    last = arr.pop();
  `);
  assertEqual(rt.getRootProperty('first'), 10);
  assertEqual(rt.getRootProperty('len1'), 3);
  assertEqual(rt.getRootProperty('len2'), 4);
  assertEqual(rt.getRootProperty('last'), 40);
  assertEqual(rt.getRootProperty('arr'), [10, 20, 30]);
});

test('interpreter: array element assignment via index works', () => {
  const ctx = loadContext();
  const { rt } = runScript(ctx, [], 'arr = [1, 2, 3]; arr[1] = 99;');
  assertEqual(rt.getRootProperty('arr'), [1, 99, 3]);
});

test('interpreter: compound assignment (+=, -=, etc.) actually mutates', () => {
  const ctx = loadContext();
  const { rt } = runScript(ctx, [], 'x = 10; x += 5; x -= 2; x *= 3; x /= 2; x %= 4;');
  // ((10+5-2)*3)/2 %4 = (13*3)/2 %4 = 39/2=19.5 %4 = 3.5
  assertEqual(rt.getRootProperty('x'), 3.5);
});

test('interpreter: infinite while loop is caught by the instruction budget, not a browser hang', () => {
  const ctx = loadContext();
  const trace = [];
  const code = ctx.Compiler.compileSource('x = 0; while (true) { x = x + 1; }');
  const rt = ctx.Avm1Interp.createInterpreter([], { onTrace: (m) => trace.push(m) });
  const start = Date.now();
  rt.runTopLevel(code);
  const elapsed = Date.now() - start;
  assert(trace.some(t => t.includes('possible infinite loop')), 'expected a safety-cap trace message');
  assert(elapsed < 5000, `should abort quickly, took ${elapsed}ms`);
});

test('interpreter: unbounded recursion is caught gracefully (no crash, no hang)', () => {
  const ctx = loadContext();
  const trace = [];
  const code = ctx.Compiler.compileSource(`
    function Recurse(n) { return Recurse(n + 1); }
  `);
  const rt = ctx.Avm1Interp.createInterpreter([], { onTrace: (m) => trace.push(m) });
  rt.runTopLevel(code);
  // Should not throw out of callFunction — errors are caught and traced.
  let threw = false;
  try { rt.callFunction('Recurse', [0]); } catch (e) { threw = true; }
  assert(!threw, 'callFunction should catch runaway recursion internally, not throw');
});

test('interpreter: calling an undefined function traces a warning instead of crashing', () => {
  const ctx = loadContext();
  const trace = [];
  const rt = ctx.Avm1Interp.createInterpreter([], { onTrace: (m) => trace.push(m) });
  const result = rt.callFunction('NoSuchFunction', [1, 2]);
  assertEqual(result, undefined);
  assert(trace.some(t => t.includes('not a defined function')), 'expected a warning trace');
});
