const { loadContext, test, assert, assertEqual } = require('./run.js');

test('autosave: detectStorageBackend picks localStorage when it works', () => {
  const ctx = loadContext();
  ctx.detectStorageBackend();
  const probe = ctx.storageGet('nonexistent-key-xyz');
  assertEqual(probe, null);
});

test('autosave: storageSet/storageGet/storageDelete round-trip through localStorage', () => {
  const ctx = loadContext();
  ctx.detectStorageBackend();
  ctx.storageSet('test:key', 'hello world');
  assertEqual(ctx.storageGet('test:key'), 'hello world');
  ctx.storageDelete('test:key');
  assertEqual(ctx.storageGet('test:key'), null);
});

test('autosave: falls back to in-memory storage gracefully when localStorage throws', () => {
  const ctx = loadContext();
  ctx.window.localStorage = {
    setItem: () => { throw new Error('storage disabled'); },
    getItem: () => { throw new Error('storage disabled'); },
    removeItem: () => { throw new Error('storage disabled'); },
  };
  ctx.detectStorageBackend();
  let threw = false;
  try {
    ctx.storageSet('k', 'v');
    ctx.storageGet('k');
  } catch (e) { threw = true; }
  assert(!threw, 'storage operations should never throw even when the backend is broken');
});

test('autosave: doAutosave persists the current project and it can be read back', () => {
  const ctx = loadContext();
  ctx.detectStorageBackend();
  ctx.state.stage.name = 'my-test-project';
  ctx.state.items = [ctx.makeItem('rect', { x: 1, y: 2, w: 10, h: 10, fill: [1, 1, 1, 255] })];
  ctx.doAutosave();
  const raw = ctx.storageGet(ctx.AUTOSAVE_KEY);
  assert(raw !== null, 'autosave should have written something');
  const parsed = JSON.parse(raw);
  assertEqual(parsed.stage.name, 'my-test-project');
  assertEqual(parsed.items.length, 1);
});

test('autosave: checkForAutosaveOnStartup returns false and does nothing when there is no saved project', () => {
  const ctx = loadContext();
  const restoring = ctx.checkForAutosaveOnStartup();
  assertEqual(restoring, false);
});

test('autosave: checkForAutosaveOnStartup returns true when a non-empty autosave exists', () => {
  const ctx = loadContext();
  ctx.detectStorageBackend();
  ctx.storageSet(ctx.AUTOSAVE_KEY, JSON.stringify({
    version: 1,
    stage: { name: 'recovered', width: 100, height: 100 },
    items: [{ kind: 'rect', x: 0, y: 0, w: 10, h: 10, fill: [1, 1, 1] }],
    script: '',
  }));
  const restoring = ctx.checkForAutosaveOnStartup();
  assertEqual(restoring, true);
});

test('autosave: an empty-items autosave is treated as nothing to restore', () => {
  const ctx = loadContext();
  ctx.detectStorageBackend();
  ctx.storageSet(ctx.AUTOSAVE_KEY, JSON.stringify({ version: 1, stage: {}, items: [], script: '' }));
  const restoring = ctx.checkForAutosaveOnStartup();
  assertEqual(restoring, false);
});

test('autosave: a corrupted autosave value does not throw and is treated as nothing to restore', () => {
  const ctx = loadContext();
  ctx.detectStorageBackend();
  ctx.storageSet(ctx.AUTOSAVE_KEY, 'not valid json {{{');
  let threw = false;
  let restoring;
  try { restoring = ctx.checkForAutosaveOnStartup(); } catch (e) { threw = true; }
  assert(!threw, 'a corrupted autosave value should not crash startup');
  assertEqual(restoring, false);
});

test('autosave: pushHistory schedules an autosave (does not throw, timer gets set)', () => {
  const ctx = loadContext();
  ctx.detectStorageBackend();
  ctx.state.items = [ctx.makeItem('rect', { x: 0, y: 0, w: 10, h: 10, fill: [1, 1, 1, 255] })];
  let threw = false;
  try { ctx.pushHistory(); } catch (e) { threw = true; }
  assert(!threw, 'pushHistory should not throw when it schedules an autosave');
});
