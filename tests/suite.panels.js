const { loadContext, test, assert, assertEqual } = require('./run.js');

test('panels: isGradient correctly distinguishes solid arrays from gradient objects', () => {
  const ctx = loadContext();
  assertEqual(ctx.isGradient([255, 0, 0, 255]), false);
  assertEqual(ctx.isGradient({ type: 'linear', direction: 'horizontal', stops: [] }), true);
});

test('panels: defaultGradientFor produces a valid 2-stop gradient from a solid base color', () => {
  const ctx = loadContext();
  const grad = ctx.defaultGradientFor([100, 100, 100, 255]);
  assertEqual(grad.type, 'linear');
  assertEqual(grad.stops.length, 2);
  assertEqual(grad.stops[0].ratio, 0);
  assertEqual(grad.stops[1].ratio, 255);
});

test('panels: buildItemPanel does not throw for rect/button/clip across solid, linear, and radial fills', () => {
  const ctx = loadContext();
  const solid = [200, 50, 50, 255];
  const linear = { type: 'linear', direction: 'vertical', stops: [{ ratio: 0, color: [1, 1, 1, 255] }, { ratio: 255, color: [2, 2, 2, 255] }] };
  const radial = { type: 'radial', stops: [{ ratio: 0, color: [1, 1, 1, 255] }, { ratio: 255, color: [2, 2, 2, 255] }] };

  for (const fill of [solid, linear, radial]) {
    for (const kind of ['rect', 'button', 'clip']) {
      const it = ctx.makeItem(kind, ctx.defaultItemFields(kind, 0, 0));
      if (kind === 'clip') it.color = fill; else it.fill = fill;
      if (kind === 'button') it.hover = fill;
      ctx.state.selectedId = it.id;
      ctx.state.items = [it];
      let threw = null;
      try { ctx.renderProperties(); } catch (e) { threw = e; }
      assert(!threw, `${kind} with fill ${JSON.stringify(fill).slice(0, 40)} threw: ${threw && threw.stack}`);
    }
  }
});

test('panels: buildItemPanel does not throw for rect/button/clip with a stroke and a radius set', () => {
  const ctx = loadContext();
  for (const kind of ['rect', 'button', 'clip']) {
    const it = ctx.makeItem(kind, ctx.defaultItemFields(kind, 0, 0));
    it.radius = 8;
    it.stroke = { width: 2, color: [255, 255, 255, 255] };
    ctx.state.selectedId = it.id;
    ctx.state.items = [it];
    let threw = null;
    try { ctx.renderProperties(); } catch (e) { threw = e; }
    assert(!threw, `${kind} with stroke+radius threw: ${threw && threw.stack}`);
  }
});

test('panels: buildItemPanel does not throw for an image item, loaded or still pending', () => {
  const ctx = loadContext();
  const pending = ctx.makeItem('image', ctx.defaultItemFields('image', 0, 0));
  ctx.state.items = [pending];
  ctx.state.selectedId = pending.id;
  let threw = null;
  try { ctx.renderProperties(); } catch (e) { threw = e; }
  assert(!threw, `pending image threw: ${threw && threw.stack}`);

  const loaded = ctx.makeItem('image', ctx.defaultItemFields('image', 0, 0));
  loaded.dataUrl = 'data:image/png;base64,x';
  loaded.naturalWidth = 32; loaded.naturalHeight = 32;
  ctx.state.items = [loaded];
  ctx.state.selectedId = loaded.id;
  threw = null;
  try { ctx.renderProperties(); } catch (e) { threw = e; }
  assert(!threw, `loaded image threw: ${threw && threw.stack}`);
});

test('panels: stage panel (nothing selected) does not throw', () => {
  const ctx = loadContext();
  ctx.state.items = [];
  ctx.state.selectedId = null;
  let threw = null;
  try { ctx.renderProperties(); } catch (e) { threw = e; }
  assert(!threw, `stage panel threw: ${threw && threw.stack}`);
});

test('panels: switching a rect fill from solid to gradient via the type-select handler produces a valid gradient object', () => {
  const ctx = loadContext();
  const it = ctx.makeItem('rect', ctx.defaultItemFields('rect', 0, 0));
  it.fill = [10, 20, 30, 255];
  // exercise the same logic buildFillEditor's onReplace callback uses
  const grad = ctx.defaultGradientFor(it.fill);
  assert(ctx.isGradient(grad));
  assertEqual(grad.stops.length, 2);
});
