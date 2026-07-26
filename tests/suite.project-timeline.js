const { loadContext, test, assert, assertEqual } = require('./run.js');

// Round-trip coverage for the timeline/placement fields added to the project
// schema. The editor's own load path is the only way these reach a build, so
// a field that serializes but doesn't load (or vice versa) is silently useless.

function loadProject(ctx, obj) {
  return ctx.loadProjectFromObject(obj);
}

test('project: frames declared on the stage survive load', () => {
  const ctx = loadContext();
  const p = loadProject(ctx, {
    stage: { width: 100, height: 50, frames: ['idle', 'alert'] },
    items: [],
  });
  assertEqual(p.stage.frames.length, 2);
  assertEqual(p.stage.frames[0], 'idle');
  assertEqual(p.stage.frames[1], 'alert');
});

test('project: a project with no frames key still loads as single-frame', () => {
  const ctx = loadContext();
  const p = loadProject(ctx, { stage: { width: 100, height: 50 }, items: [] });
  assertEqual(p.stage.frames.length, 0);
});

test('project: per-item frame membership loads and clamps to the declared range', () => {
  const ctx = loadContext();
  const p = loadProject(ctx, {
    stage: { width: 100, height: 50, frames: ['a', 'b'] },
    items: [
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10, frames: [0] },
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10, frames: [1, 7] },   // 7 is out of range
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },                   // no frames -> all
    ],
  });
  assertEqual(JSON.stringify(p.items[0].frames), '[0]');
  assertEqual(JSON.stringify(p.items[1].frames), '[1]', 'out-of-range indices are dropped');
  assertEqual(p.items[2].frames, null, 'absent means every frame');
});

test('project: clip event handlers load, and are rejected on non-clip items', () => {
  const ctx = loadContext();
  const p = loadProject(ctx, {
    stage: { width: 100, height: 50 },
    items: [
      { kind: 'clip', name: 'btn', x: 0, y: 0, w: 20, h: 10, events: { release: 'fscommand("go", 1);' } },
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10, events: { release: 'x = 1;' } },
    ],
  });
  assert(p.items[0].events && p.items[0].events.release, 'clip keeps its handler');
  assertEqual(p.items[1].events, null, 'rect does not');
  assert(p.warnings.some(w => w.indexOf('event handlers') >= 0), 'and the caller is told why');
});

test('project: alpha, export and scale9 load with sane defaults', () => {
  const ctx = loadContext();
  const p = loadProject(ctx, {
    stage: { width: 100, height: 50 },
    items: [
      { kind: 'clip', name: 'panel', x: 0, y: 0, w: 40, h: 20, alpha: 0.5,
        export: 'Panel', scale9: { left: 4, top: 4, right: 36, bottom: 16 } },
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10, alpha: 1 },        // fully opaque = no transform
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10, scale9: { left: 9, top: 0, right: 2, bottom: 5 } },
    ],
  });
  assertEqual(p.items[0].alpha, 0.5);
  assertEqual(p.items[0].exportAs, 'Panel');
  assertEqual(p.items[0].scale9.right, 36);
  assertEqual(p.items[1].alpha, null, 'alpha 1 means no colour transform');
  assertEqual(p.items[2].scale9, null, 'an inside-out grid is rejected');
});

test('project: text flags load from snake_case keys', () => {
  const ctx = loadContext();
  const p = loadProject(ctx, {
    stage: { width: 100, height: 50 },
    items: [{ kind: 'text', x: 0, y: 0, text: 'hi', multiline: true, word_wrap: true, align: 'center', max_length: 20 }],
  });
  const t = p.items[0].textOptions;
  assert(t, 'text options should be present');
  assertEqual(t.multiline, true);
  assertEqual(t.wordWrap, true);
  assertEqual(t.align, 'center');
  assertEqual(t.maxLength, 20);
});

test('project: an unknown align value is ignored rather than emitted', () => {
  const ctx = loadContext();
  const p = loadProject(ctx, {
    stage: { width: 100, height: 50 },
    items: [{ kind: 'text', x: 0, y: 0, text: 'hi', align: 'sideways' }],
  });
  assert(!p.items[0].textOptions || p.items[0].textOptions.align === undefined,
    'a bogus alignment must not reach the encoder');
});

test('project: the new fields survive a serialize/load round trip', () => {
  const ctx = loadContext();
  const original = {
    version: 1,
    stage: { width: 200, height: 80, fps: 30, name: 'hud', frames: ['idle', 'alert'] },
    items: [
      { kind: 'clip', name: 'bar', x: 2, y: 2, w: 40, h: 8, fill: [0, 200, 0],
        frames: [1], alpha: 0.5, export: 'Bar', events: { release: 'fscommand("hit", 1);' } },
      { kind: 'text', x: 4, y: 20, text: 'HP', size: 13, color: [255, 255, 255],
        multiline: true, align: 'right' },
    ],
    script: '',
  };
  const loaded = loadProject(ctx, original);
  // serializeItem/serializeProject read from the module-level `state`, so
  // drive them through the same shape the editor would hold
  ctx.state.stage = loaded.stage;
  ctx.state.items = loaded.items;
  ctx.state.script = loaded.script;
  const out = ctx.serializeProject();

  assertEqual(JSON.stringify(out.stage.frames), JSON.stringify(['idle', 'alert']));
  const clip = out.items[0];
  assertEqual(JSON.stringify(clip.frames), '[1]');
  assertEqual(clip.alpha, 0.5);
  assertEqual(clip.export, 'Bar');
  assert(clip.events && clip.events.release, 'handlers survive');
  const text = out.items[1];
  assertEqual(text.multiline, true);
  assertEqual(text.align, 'right');

  // and loading the serialized form again must be stable
  const again = loadProject(ctx, out);
  assertEqual(JSON.stringify(again.items[0].frames), '[1]');
  assertEqual(again.items[0].alpha, 0.5);
  assertEqual(again.items[1].textOptions.align, 'right');
});

test('project: a single-frame project serializes without any timeline keys', () => {
  const ctx = loadContext();
  const loaded = loadProject(ctx, {
    stage: { width: 100, height: 50 },
    items: [{ kind: 'rect', x: 0, y: 0, w: 10, h: 10, fill: [1, 2, 3] }],
  });
  ctx.state.stage = loaded.stage;
  ctx.state.items = loaded.items;
  ctx.state.script = '';
  const out = ctx.serializeProject();
  assertEqual(out.stage.frames, undefined, 'no frames key on a single-frame project');
  assertEqual(out.items[0].frames, undefined);
  assertEqual(out.items[0].alpha, undefined);
  assertEqual(out.items[0].events, undefined);
});

test('project: a loaded multi-frame project builds a real timeline', () => {
  const ctx = loadContext();
  const loaded = loadProject(ctx, {
    stage: { width: 200, height: 80, name: 'states', frames: ['idle', 'alert'] },
    items: [
      { kind: 'rect', x: 0, y: 0, w: 200, h: 20, fill: [20, 20, 20] },
      { kind: 'text', x: 4, y: 2, text: 'IDLE', frames: [0] },
      { kind: 'text', x: 4, y: 2, text: 'ALERT', frames: [1] },
    ],
    script: 'function Show(s) { gotoAndStop(s); }',
  });
  ctx.state.stage = loaded.stage;
  ctx.state.items = loaded.items;
  ctx.state.script = loaded.script;
  const movie = ctx.buildMovieFromState();
  const summary = ctx.Verify.verifyMovie(movie, { functions: ['Show'] });
  assertEqual(summary.tags['1'], 2, 'two ShowFrame tags');
  assertEqual(summary.tags['43'], 2, 'two FrameLabel tags');
  assertEqual(summary.tags['28'], 1, 'the frame-0 text is removed entering frame 1');
});
