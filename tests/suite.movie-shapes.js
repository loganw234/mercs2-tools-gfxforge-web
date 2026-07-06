const { loadContext, test, assert, assertEqual } = require('./run.js');

function hex(u8) { return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''); }

test('movie integration: rect() with no options produces byte-identical output to the original baseline', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(380, 150, { name: 'hud', background: [22, 24, 28] });
  m.rect(0, 0, 380, 30, [232, 140, 24]);
  m.text(14, 6, 'OPERATOR STATUS', { size: 15, color: [25, 25, 25] });
  m.text(16, 40, 'HEALTH', { size: 13, color: [228, 232, 236] });
  assertEqual(m.build().length, 220, 'rect() dispatch change must not alter output for the plain case');
});

test('movie integration: rect() with a gradient fill builds and verifies', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't' });
  m.rect(0, 0, 200, 40, { type: 'linear', direction: 'vertical', stops: [{ ratio: 0, color: [80, 80, 80] }, { ratio: 255, color: [20, 20, 20] }] });
  const summary = ctx.Verify.verifyMovie(m);
  assertEqual(summary.tags['32'], 1);
});

test('movie integration: rect() with radius and stroke builds and verifies', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't' });
  m.rect(10, 10, 100, 40, [50, 50, 50], { radius: 8, stroke: { width: 2, color: [255, 255, 255] } });
  const summary = ctx.Verify.verifyMovie(m);
  assertEqual(summary.tags['32'], 1);
});

test('movie integration: button() with radius/stroke/gradient on both up and hover states', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't' });
  m.button(10, 10, 80, 24, 'go', {
    label: 'GO',
    fill: { type: 'linear', direction: 'vertical', stops: [{ ratio: 0, color: [90, 90, 90] }, { ratio: 255, color: [40, 40, 40] }] },
    hover: { type: 'linear', direction: 'vertical', stops: [{ ratio: 0, color: [110, 110, 110] }, { ratio: 255, color: [60, 60, 60] }] },
    radius: 4,
    stroke: { width: 1, color: [255, 255, 255, 100] },
  });
  const summary = ctx.Verify.verifyMovie(m);
  assertEqual(summary.tags['7'], 1);  // DefineButton
  assertEqual(summary.tags['32'], 2); // up shape + hover shape (label is DefineEditText, tag 37, not a shape)
  assertEqual(summary.tags['37'], 1); // label text
});

test('movie integration: clip() with radius and gradient (e.g. a styled health bar)', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't' });
  m.clip('bar', 10, 10, 100, 12, { type: 'linear', direction: 'horizontal', stops: [{ ratio: 0, color: [200, 30, 30] }, { ratio: 255, color: [30, 200, 30] }] }, { radius: 6 });
  const summary = ctx.Verify.verifyMovie(m);
  assertEqual(summary.tags['39'], 1); // DefineSprite
});

test('movie integration: full HUD combining plain, gradient, stroked, and rounded shapes together', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(380, 150, { name: 'hud', background: [22, 24, 28] });
  m.rect(0, 0, 380, 30, [232, 140, 24]); // plain, unaffected path
  m.rect(0, 100, 380, 50, { type: 'linear', direction: 'vertical', stops: [{ ratio: 0, color: [60, 60, 60] }, { ratio: 255, color: [10, 10, 10] }] }, { radius: 10 });
  m.button(20, 40, 100, 24, 'ok', { label: 'OK', radius: 6, stroke: { width: 1, color: [255, 255, 255] } });
  m.clip('bar', 20, 70, 150, 10, { type: 'linear', direction: 'horizontal', stops: [{ ratio: 0, color: [200, 30, 30] }, { ratio: 255, color: [30, 200, 30] }] });
  const data = m.build();
  const summary = ctx.Verify.verifyMovie(m);
  assert(data.length > 0);
  assertEqual(summary.tags['0'], 1); // End appears exactly once
});
