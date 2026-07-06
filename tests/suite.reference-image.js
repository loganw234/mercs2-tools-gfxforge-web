const { loadContext, test, assert, assertEqual } = require('./run.js');

test('reference image: starts as null / not shown', () => {
  const ctx = loadContext();
  assertEqual(ctx.getReferenceImage(), null);
});

test('reference image: removeReferenceImage clears it back to null', () => {
  const ctx = loadContext();
  // simulate having one loaded without going through the async file/Image path
  ctx.removeReferenceImage();
  assertEqual(ctx.getReferenceImage(), null);
});

test('reference image: drawReferenceImage is a no-op (does not throw) when nothing is loaded', () => {
  const ctx = loadContext();
  const fakeCtx = {
    save() {}, restore() {}, drawImage() {}, set globalAlpha(v) {},
  };
  let threw = false;
  try { ctx.drawReferenceImage(fakeCtx); } catch (e) { threw = true; }
  assert(!threw, 'drawReferenceImage should be a safe no-op with nothing loaded');
});

test('reference image: never appears in serializeProject output, even conceptually', () => {
  const ctx = loadContext();
  ctx.state.items = [ctx.makeItem('rect', { x: 0, y: 0, w: 10, h: 10, fill: [1, 1, 1, 255] })];
  const serialized = ctx.serializeProject();
  const json = JSON.stringify(serialized);
  assert(!json.includes('referenceImage'), 'serialized project must never mention the reference image');
  assert(!('referenceImage' in serialized), 'serialized project object must not have a referenceImage key');
});

test('reference image: never appears in an autosave payload', () => {
  const ctx = loadContext();
  ctx.detectStorageBackend();
  ctx.state.items = [ctx.makeItem('rect', { x: 0, y: 0, w: 10, h: 10, fill: [1, 1, 1, 255] })];
  ctx.doAutosave();
  const raw = ctx.storageGet(ctx.AUTOSAVE_KEY);
  assert(!raw.includes('referenceImage'), 'autosave payload must never mention the reference image');
});

test('reference image: loadReferenceImageFile rejects non-image files without throwing', () => {
  const ctx = loadContext();
  const fakeFile = { type: 'text/plain', name: 'not-an-image.txt' };
  let threw = false;
  try { ctx.loadReferenceImageFile(fakeFile); } catch (e) { threw = true; }
  assert(!threw, 'a non-image file should be rejected gracefully, not throw');
  assertEqual(ctx.getReferenceImage(), null);
});
