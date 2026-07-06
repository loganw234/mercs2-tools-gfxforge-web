// .gfx importer (decode.js) — round-trips an authored movie back into editable
// items, and rejects non-movie input.
const { loadContext, test, assert, assertEqual } = require('./run.js');

test('decode: round-trips an authored movie into editable items', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 'dec', background: [10, 10, 10] });
  m.rect(0, 0, 200, 20, [232, 140, 24]);
  m.text(8, 4, 'HELLO', { size: 13, color: [255, 255, 255], varName: 'v' });
  m.clip('bar', 8, 40, 100, 8, [0, 200, 0]);
  m.button(8, 60, 80, 20, 'go', { label: 'GO' });

  const { project, notes } = ctx.Decode.decodeGfx(m.build());
  assertEqual(project.stage.width, 200, 'stage width');
  assertEqual(project.stage.height, 100, 'stage height');
  assertEqual(project.stage.name, 'dec', 'name');

  const header = project.items.find(i => i.kind === 'rect' && i.y === 0);
  assert(header, 'recovered the header rect');
  assertEqual(header.w, 200, 'header width');
  assertEqual(header.h, 20, 'header height');
  assertEqual(header.fill[0], 232, 'header fill r');

  const txt = project.items.find(i => i.kind === 'text' && i.var === 'v');
  assert(txt, 'recovered the variable-bound text');
  assertEqual(txt.text, 'HELLO', 'text content');

  const clip = project.items.find(i => i.kind === 'clip');
  assert(clip, 'recovered the named clip');
  assertEqual(clip.name, 'bar', 'clip name');

  const btn = project.items.find(i => i.kind === 'button');
  assert(btn, 'recovered the button');
  assertEqual(btn.event, 'go', 'button event (from its fscommand)');
});

test('decode: rejects non-movie input', () => {
  const ctx = loadContext();
  let threw = false;
  try { ctx.Decode.decodeGfx(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])); } catch (e) { threw = true; }
  assert(threw, 'should reject input without a GFX/FWS magic');
});
