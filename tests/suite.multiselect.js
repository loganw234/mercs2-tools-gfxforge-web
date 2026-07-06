const { loadContext, test, assert, assertEqual } = require('./run.js');

function setupItems(ctx, specs) {
  ctx.state.items = specs.map(s => ctx.makeItem('rect', { x: s.x, y: s.y, w: s.w, h: s.h, fill: [1, 1, 1, 255] }));
  return ctx.state.items;
}

test('selection: selectOnly/toggleSelection/clearSelection manage the selectedIds set correctly', () => {
  const ctx = loadContext();
  const items = setupItems(ctx, [{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }]);
  ctx.selectOnly(items[0].id);
  assertEqual(Array.from(ctx.state.selectedIds), [items[0].id]);
  ctx.toggleSelection(items[1].id);
  assertEqual(new Set(ctx.state.selectedIds), new Set([items[0].id, items[1].id]));
  ctx.toggleSelection(items[0].id);
  assertEqual(Array.from(ctx.state.selectedIds), [items[1].id]);
  ctx.clearSelection();
  assertEqual(ctx.state.selectedIds.size, 0);
});

test('selection: getSelected() returns an item only when exactly one is selected', () => {
  const ctx = loadContext();
  const items = setupItems(ctx, [{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }]);
  assertEqual(ctx.getSelected(), null); // none selected
  ctx.selectOnly(items[0].id);
  assertEqual(ctx.getSelected().id, items[0].id);
  ctx.toggleSelection(items[1].id);
  assertEqual(ctx.getSelected(), null); // two selected -> ambiguous, null
});

test('selection: getMultiSelection returns all currently-selected items regardless of count', () => {
  const ctx = loadContext();
  const items = setupItems(ctx, [{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }, { x: 40, y: 0, w: 10, h: 10 }]);
  ctx.state.selectedIds = new Set([items[0].id, items[2].id]);
  const multi = ctx.getMultiSelection();
  assertEqual(multi.map(i => i.id).sort(), [items[0].id, items[2].id].sort());
});

test('align: left/right/top/bottom move every selected item to the shared bounding-box edge', () => {
  const ctx = loadContext();
  const items = setupItems(ctx, [{ x: 10, y: 5, w: 20, h: 10 }, { x: 50, y: 30, w: 10, h: 10 }, { x: 30, y: 60, w: 40, h: 10 }]);
  ctx.state.selectedIds = new Set(items.map(i => i.id));

  ctx.alignSelection('left');
  assertEqual(items.map(i => i.x), [10, 10, 10]);

  // re-setup fresh positions for the next check (align mutates in place)
  items[0].x = 10; items[0].w = 20;
  items[1].x = 50; items[1].w = 10;
  items[2].x = 30; items[2].w = 40;
  ctx.alignSelection('right');
  const maxRight = Math.max(10 + 20, 50 + 10, 30 + 40); // = 70
  assertEqual(items.map(i => i.x + i.w), [maxRight, maxRight, maxRight]);
});

test('align: center-h aligns every item\'s horizontal center to the selection bounding-box center', () => {
  const ctx = loadContext();
  const items = setupItems(ctx, [{ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 0, w: 20, h: 10 }]);
  ctx.state.selectedIds = new Set(items.map(i => i.id));
  ctx.alignSelection('center-h');
  const bboxCenter = (0 + 120) / 2; // min x=0, max right=120
  for (const it of items) {
    assert(Math.abs((it.x + it.w / 2) - bboxCenter) < 1, `item center ${it.x + it.w / 2} not near bbox center ${bboxCenter}`);
  }
});

test('align: with fewer than 2 items selected, does nothing (no crash)', () => {
  const ctx = loadContext();
  const items = setupItems(ctx, [{ x: 5, y: 5, w: 10, h: 10 }]);
  ctx.state.selectedIds = new Set([items[0].id]);
  ctx.alignSelection('left');
  assertEqual(items[0].x, 5); // unchanged
});

test('distribute: keeps first and last fixed, spaces the middle items with equal gaps', () => {
  const ctx = loadContext();
  const items = setupItems(ctx, [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 15, y: 0, w: 10, h: 10 },
    { x: 90, y: 0, w: 10, h: 10 }, // bunched near the start, then a big gap to the last one
    { x: 100, y: 0, w: 10, h: 10 },
  ]);
  ctx.state.selectedIds = new Set(items.map(i => i.id));
  const firstXBefore = items[0].x, lastXBefore = items[3].x;
  ctx.distributeSelection('horizontal');
  assertEqual(items[0].x, firstXBefore, 'first item should stay fixed');
  assertEqual(items[3].x, lastXBefore, 'last item should stay fixed');
  // gaps between consecutive items (edge to edge) should now be equal
  const sorted = items.slice().sort((a, b) => a.x - b.x);
  const gaps = [];
  for (let i = 0; i < sorted.length - 1; i++) gaps.push(sorted[i + 1].x - (sorted[i].x + sorted[i].w));
  for (const g of gaps) assert(Math.abs(g - gaps[0]) <= 1, `gaps should be equal within 1px rounding slop: ${gaps}`);
});

test('distribute: with fewer than 3 items selected, does nothing', () => {
  const ctx = loadContext();
  const items = setupItems(ctx, [{ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 0, w: 10, h: 10 }]);
  ctx.state.selectedIds = new Set(items.map(i => i.id));
  ctx.distributeSelection('horizontal');
  assertEqual([items[0].x, items[1].x], [0, 50]); // unchanged
});

test('bulk: bulkToggle("hidden") turns hidden on for all when any are off, then off for all', () => {
  const ctx = loadContext();
  const items = setupItems(ctx, [{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }]);
  items[0].hidden = true; items[1].hidden = false;
  ctx.state.selectedIds = new Set(items.map(i => i.id));
  ctx.bulkToggle('hidden');
  assertEqual(items.map(i => i.hidden), [true, true]);
  ctx.bulkToggle('hidden');
  assertEqual(items.map(i => i.hidden), [false, false]);
});

test('bulk: deleteSelected removes every selected item at once', () => {
  const ctx = loadContext();
  const items = setupItems(ctx, [{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }, { x: 40, y: 0, w: 10, h: 10 }]);
  ctx.state.selectedIds = new Set([items[0].id, items[2].id]);
  ctx.deleteSelected();
  assertEqual(ctx.state.items.map(i => i.id), [items[1].id]);
  assertEqual(ctx.state.selectedIds.size, 0);
});

test('bulk: duplicateSelected duplicates every selected item and selects the new copies', () => {
  const ctx = loadContext();
  const items = setupItems(ctx, [{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 }]);
  const originalIds = items.map(i => i.id); // captured before duplicating — state.items is mutated in place by push()
  ctx.state.selectedIds = new Set(originalIds);
  ctx.duplicateSelected();
  assertEqual(ctx.state.items.length, 4);
  assertEqual(ctx.state.selectedIds.size, 2);
  for (const id of ctx.state.selectedIds) {
    assert(!originalIds.includes(id), 'selection after duplicate should point at the new copies, not the originals');
  }
});
