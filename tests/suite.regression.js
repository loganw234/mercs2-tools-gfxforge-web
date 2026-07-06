const { loadContext, test, assert, assertEqual } = require('./run.js');

function hex(u8) { return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''); }
function concat(...parts) {
  let len = 0; for (const p of parts) len += p.length;
  const out = new Uint8Array(len); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

test('codec: readme quickstart movie builds to the known-good byte count', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(380, 150, { name: 'hud', background: [22, 24, 28] });
  m.rect(0, 0, 380, 30, [232, 140, 24]);
  m.text(14, 6, 'OPERATOR STATUS', { size: 15, color: [25, 25, 25] });
  m.text(16, 40, 'HEALTH', { size: 13, color: [228, 232, 236] });
  assertEqual(m.build().length, 220, 'byte length regressed from Python-verified baseline');
});

test('codec: live text + compiled script + menu all verify correctly', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(220, 170, { name: 't' });
  m.rect(0, 0, 220, 20, [50, 50, 50]);
  m.text(4, 26, '--', { size: 12, color: [255, 200, 0], varName: 'v' });
  m.clip('bar', 4, 44, 100, 8, [0, 200, 0]);
  m.button(4, 60, 80, 20, 'go', { label: 'GO' });
  m.menu(120, 40, ['A', 'B', 'C'], { width: 80 });
  m.script(ctx.Compiler.compileSource('function Set(n) { v = n; if (n < 1) { fscommand("z", n); } }'));
  const summary = ctx.Verify.verifyMovie(m, { functions: ['Set', 'SetSelected'] });
  assert(summary.functions.includes('Set') && summary.functions.includes('SetSelected'), 'expected functions missing');
});

test('project-io: menu shorthand expands and round-trips through serialize/load', () => {
  const ctx = loadContext();
  const projectJson = {
    stage: { width: 380, height: 150, name: 'hud' },
    items: [
      { kind: 'rect', x: 0, y: 0, w: 380, h: 30, fill: [232, 140, 24] },
      { kind: 'menu', x: 20, y: 20, options: ['New Game', 'Options', 'Quit'] },
    ],
    script: '',
  };
  const loaded = ctx.loadProjectFromObject(projectJson);
  assertEqual(loaded.items.length, 5, 'expected 1 rect + 3 menu buttons + 1 highlight clip');
});

test('project-io: locks round-trip and hitHandle refuses size-locked items', () => {
  const ctx = loadContext();
  const loaded = ctx.loadProjectFromObject({
    stage: { width: 100, height: 100 },
    items: [{ kind: 'rect', x: 0, y: 0, w: 20, h: 20, fill: [1, 2, 3], lock_size: true }],
  });
  assert(loaded.items[0].sizeLocked === true, 'lock_size did not parse');
  assert(ctx.hitHandle(loaded.items[0], 0, 0) === null, 'hitHandle should refuse a size-locked item');
});

test('init: buildHelpBody does not throw and produces non-empty content', () => {
  const ctx = loadContext();
  let threw = false;
  try { ctx.buildHelpBody(); } catch (e) { threw = true; console.error(e); }
  assert(!threw, 'buildHelpBody should not throw');
});
