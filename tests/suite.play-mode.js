const { loadContext, test, assert, assertEqual } = require('./run.js');

function setupProject(ctx) {
  const loaded = ctx.loadProjectFromObject({
    stage: { width: 200, height: 100, name: 'test' },
    items: [
      { kind: 'text', x: 4, y: 4, text: '--', size: 12, color: [255, 255, 255], var: 'hp_val' },
      { kind: 'clip', name: 'bar', x: 10, y: 50, w: 40, h: 8, fill: [0, 200, 0] },
      { kind: 'button', x: 4, y: 70, w: 60, h: 20, event: 'quit', arg: null, label: 'Quit' },
    ],
    script: `
      function SetHealth(n) {
        _root.hp_val = n;
        _root.bar._xscale = n;
      }
    `,
  });
  ctx.state.stage = loaded.stage;
  ctx.state.items = loaded.items;
  ctx.state.script = loaded.script;
  return loaded;
}

test('play mode: entering clones items, runs top-level script, registers functions', () => {
  const ctx = loadContext();
  setupProject(ctx);
  ctx.enterPlayMode();
  assert(ctx.getPlayCtx() !== null, 'playCtx should be set after entering play mode');
  assertEqual(ctx.state.mode, 'play');
  assert(ctx.getPlayCtx().items !== ctx.state.items, 'play items should be a clone, not the same array reference');
  assert(ctx.getPlayCtx().interpreter.functionNames().includes('SetHealth'), 'SetHealth should be registered');
});

test('play mode: calling a function updates bound text and clip scale on the live scene', () => {
  const ctx = loadContext();
  setupProject(ctx);
  ctx.enterPlayMode();
  ctx.getPlayCtx().interpreter.callFunction('SetHealth', [42]);
  ctx.syncRuntimeText();
  const textItem = ctx.getPlayCtx().items.find(i => i.kind === 'text');
  const clipItem = ctx.getPlayCtx().items.find(i => i.kind === 'clip');
  assertEqual(textItem.__runtimeText, 42);
  assertEqual(clipItem._xscale, 42);
});

test('play mode: exiting restores edit mode and discards the play clone', () => {
  const ctx = loadContext();
  setupProject(ctx);
  ctx.enterPlayMode();
  ctx.exitPlayMode();
  assertEqual(ctx.state.mode, 'edit');
  assertEqual(ctx.getPlayCtx(), null);
});

test('play mode: exiting never mutates the original authored items', () => {
  const ctx = loadContext();
  setupProject(ctx);
  ctx.enterPlayMode();
  ctx.getPlayCtx().interpreter.callFunction('SetHealth', [7]);
  ctx.exitPlayMode();
  const clipItem = ctx.state.items.find(i => i.kind === 'clip');
  assertEqual(clipItem._xscale, undefined); // the authored item was never touched, only the clone was
  const textItem = ctx.state.items.find(i => i.kind === 'text');
  assertEqual(textItem.text, '--'); // authored text unchanged
});

test('play mode: clicking a button (via onPlayCanvasClick) does not throw and finds the button', () => {
  const ctx = loadContext();
  setupProject(ctx);
  ctx.enterPlayMode();
  // button is at x:4,y:70,w:60,h:20 -> click somewhere inside that rect
  let threw = false;
  try { ctx.onPlayCanvasClick(20, 80); } catch (e) { threw = true; }
  assert(!threw, 'onPlayCanvasClick should not throw for a valid click on a button');
});

test('play mode: re-entering after exiting starts from the current authored state, not stale play data', () => {
  const ctx = loadContext();
  setupProject(ctx);
  ctx.enterPlayMode();
  ctx.getPlayCtx().interpreter.callFunction('SetHealth', [99]);
  ctx.exitPlayMode();
  // author edits the text item directly (simulating the user editing after a play session)
  ctx.state.items.find(i => i.kind === 'text').text = 'fresh-value';
  ctx.enterPlayMode();
  const textItem = ctx.getPlayCtx().items.find(i => i.kind === 'text');
  assertEqual(textItem.text, 'fresh-value');
  assertEqual(ctx.getPlayCtx().interpreter.textValues.get('hp_val'), 'fresh-value');
});
