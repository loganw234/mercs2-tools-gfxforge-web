const { loadContext, test, assert, assertEqual } = require('./run.js');
const { decodeShape3Body } = require('./shape-decoder.js');

// Extracts the body of a tag from a raw byte stream at a known offset,
// given the tag starts there (short or long form).
function tagBodyAt(bytes, offset) {
  const header = bytes[offset] | (bytes[offset + 1] << 8);
  const code = header >> 6;
  let len = header & 0x3f;
  let bodyStart = offset + 2;
  if (len === 0x3f) {
    len = bytes[bodyStart] | (bytes[bodyStart + 1] << 8) | (bytes[bodyStart + 2] << 16) | (bytes[bodyStart + 3] << 24);
    bodyStart += 4;
  }
  return { code, body: bytes.subarray(bodyStart, bodyStart + len), end: bodyStart + len };
}

test('shapeEx: plain rect (no stroke, no radius) decodes to the same path as defineShape3', () => {
  const ctx = loadContext();
  const a = ctx.Swf.defineShape3(2, 0, 0, 50, 20, [232, 140, 24]);
  const b = ctx.Swf.defineShapeEx(2, 0, 0, 50, 20, { fill: [232, 140, 24] });
  const da = decodeShape3Body(tagBodyAt(a, 0).body);
  const db = decodeShape3Body(tagBodyAt(b, 0).body);
  assertEqual(da.path, db.path, 'paths should be identical for the plain solid-fill case');
  assertEqual(da.fillStyles, db.fillStyles);
  assertEqual(da.numFillBits, db.numFillBits);
  assertEqual(da.numLineBits, db.numLineBits);
});

test('shapeEx: rounded rect path starts at (x1+r, y1), closes, and stays within stroke-padded bounds', () => {
  const ctx = loadContext();
  const tagBytes = ctx.Swf.defineShapeEx(3, 10, 10, 60, 40, { fill: [200, 50, 50], radius: 5 });
  const d = decodeShape3Body(tagBodyAt(tagBytes, 0).body);
  const X1 = ctx.Bitio.px(10), Y1 = ctx.Bitio.px(10), X2 = ctx.Bitio.px(60), Y2 = ctx.Bitio.px(40);
  const R = ctx.Bitio.px(5);
  assertEqual(d.path[0], { type: 'move', x: X1 + R, y: Y1 });
  const last = d.path[d.path.length - 1];
  assertEqual([last.x, last.y], [X1 + R, Y1], 'path should close back to the starting point');
  assertEqual(d.path.filter(p => p.type === 'line').length, 4);
  assertEqual(d.path.filter(p => p.type === 'curve').length, 4);
  for (const p of d.path) {
    assert(p.x >= X1 - 1 && p.x <= X2 + 1, `x ${p.x} out of [${X1},${X2}]`);
    assert(p.y >= Y1 - 1 && p.y <= Y2 + 1, `y ${p.y} out of [${Y1},${Y2}]`);
  }
});

test('shapeEx: corner curve control points sit exactly at the sharp rectangle corners', () => {
  const ctx = loadContext();
  const tagBytes = ctx.Swf.defineShapeEx(4, 0, 0, 100, 50, { fill: [1, 2, 3], radius: 10 });
  const d = decodeShape3Body(tagBodyAt(tagBytes, 0).body);
  const X1 = 0, Y1 = 0, X2 = ctx.Bitio.px(100), Y2 = ctx.Bitio.px(50);
  const curves = d.path.filter(p => p.type === 'curve');
  const corners = curves.map(c => [c.controlX, c.controlY]);
  const expectedCorners = [[X2, Y1], [X2, Y2], [X1, Y2], [X1, Y1]];
  assertEqual(corners, expectedCorners);
});

test('shapeEx: radius is clamped so it can never exceed half the shorter side', () => {
  const ctx = loadContext();
  const tagBytes = ctx.Swf.defineShapeEx(5, 0, 0, 20, 10, { fill: [1, 1, 1], radius: 100 });
  const d = decodeShape3Body(tagBodyAt(tagBytes, 0).body);
  const move = d.path[0];
  const X1 = 0;
  const expectedR = ctx.Bitio.px(5); // clamped to half of the 10px height
  assertEqual(move.x, X1 + expectedR);
});

test('shapeEx: stroke declares exactly one line style with the right width and color, selected on every edge', () => {
  const ctx = loadContext();
  const tagBytes = ctx.Swf.defineShapeEx(6, 0, 0, 40, 20, { fill: [10, 20, 30], stroke: { width: 2, color: [255, 0, 0, 255] } });
  const d = decodeShape3Body(tagBodyAt(tagBytes, 0).body);
  assertEqual(d.lineStyles.length, 1);
  assertEqual(d.lineStyles[0].width, ctx.Bitio.px(2));
  assertEqual(d.lineStyles[0].color, [255, 0, 0, 255]);
  assertEqual(d.lineStyle, 1);
  assert(d.numLineBits >= 1, 'numLineBits should be at least 1 when a stroke is present');
});

test('shapeEx: no stroke means zero line styles and zero line bits', () => {
  const ctx = loadContext();
  const tagBytes = ctx.Swf.defineShapeEx(7, 0, 0, 40, 20, { fill: [10, 20, 30] });
  const d = decodeShape3Body(tagBodyAt(tagBytes, 0).body);
  assertEqual(d.lineStyles.length, 0);
  assertEqual(d.numLineBits, 0);
});

test('shapeEx: stroke bounding rect is padded by half the stroke width on every side', () => {
  const ctx = loadContext();
  const tagBytes = ctx.Swf.defineShapeEx(8, 10, 10, 30, 20, { fill: [1, 1, 1], stroke: { width: 4, color: [0, 0, 0, 255] } });
  const d = decodeShape3Body(tagBodyAt(tagBytes, 0).body);
  const strokeW = ctx.Bitio.px(4);
  assertEqual(d.rect.xmin, ctx.Bitio.px(10) - strokeW / 2);
  assertEqual(d.rect.xmax, ctx.Bitio.px(30) + strokeW / 2);
});

test('shapeEx: horizontal linear gradient — ratio 0 at left edge, ratio 255 at right edge, no rotation', () => {
  const ctx = loadContext();
  const fill = { type: 'linear', direction: 'horizontal', stops: [{ ratio: 0, color: [255, 0, 0, 255] }, { ratio: 255, color: [0, 0, 255, 255] }] };
  const tagBytes = ctx.Swf.defineShapeEx(9, 0, 0, 100, 50, { fill });
  const d = decodeShape3Body(tagBodyAt(tagBytes, 0).body);
  const fs = d.fillStyles[0];
  assertEqual(fs.type, 'linear');
  assertEqual(fs.stops, [{ ratio: 0, color: [255, 0, 0, 255] }, { ratio: 255, color: [0, 0, 255, 255] }]);
  const X1 = 0, X2 = ctx.Bitio.px(100);
  assert(Math.abs(fs.matrix.rotateSkew0) < 1e-6 && Math.abs(fs.matrix.rotateSkew1) < 1e-6, 'horizontal gradient should have no rotation');
  assert(Math.abs(fs.matrix.scaleX - (X2 - X1) / 32768) < 1e-3, `scaleX mismatch: ${fs.matrix.scaleX}`);
  assert(Math.abs(fs.matrix.translateX - (X1 + X2) / 2) < 1, `translateX mismatch: ${fs.matrix.translateX}`);
  const leftEdgeX = fs.matrix.scaleX * -16384 + fs.matrix.rotateSkew1 * 0 + fs.matrix.translateX;
  const rightEdgeX = fs.matrix.scaleX * 16384 + fs.matrix.rotateSkew1 * 0 + fs.matrix.translateX;
  assert(Math.abs(leftEdgeX - X1) < 2, `ratio=0 should land at the left edge, got ${leftEdgeX} vs X1=${X1}`);
  assert(Math.abs(rightEdgeX - X2) < 2, `ratio=255 should land at the right edge, got ${rightEdgeX} vs X2=${X2}`);
});

test('shapeEx: vertical linear gradient — ratio 0 at top edge, ratio 255 at bottom edge', () => {
  const ctx = loadContext();
  const fill = { type: 'linear', direction: 'vertical', stops: [{ ratio: 0, color: [255, 255, 255, 255] }, { ratio: 255, color: [0, 0, 0, 255] }] };
  const tagBytes = ctx.Swf.defineShapeEx(10, 0, 0, 100, 50, { fill });
  const d = decodeShape3Body(tagBodyAt(tagBytes, 0).body);
  const fs = d.fillStyles[0];
  const Y1 = 0, Y2 = ctx.Bitio.px(50);
  assert(Math.abs(fs.matrix.scaleX) < 1e-6 && Math.abs(fs.matrix.scaleY) < 1e-6, 'vertical gradient should route the ramp through rotateSkew, not scale');
  const topY = fs.matrix.rotateSkew0 * -16384 + fs.matrix.scaleY * 0 + fs.matrix.translateY;
  const bottomY = fs.matrix.rotateSkew0 * 16384 + fs.matrix.scaleY * 0 + fs.matrix.translateY;
  assert(Math.abs(topY - Y1) < 2, `ratio=0 should land at the top, got ${topY} vs Y1=${Y1}`);
  assert(Math.abs(bottomY - Y2) < 2, `ratio=255 should land at the bottom, got ${bottomY} vs Y2=${Y2}`);
});

test('shapeEx: radial gradient uses fill type 0x12 and a centered, non-rotated matrix', () => {
  const ctx = loadContext();
  const fill = { type: 'radial', stops: [{ ratio: 0, color: [255, 255, 255, 255] }, { ratio: 255, color: [0, 0, 0, 128] }] };
  const tagBytes = ctx.Swf.defineShapeEx(11, 0, 0, 60, 60, { fill });
  const d = decodeShape3Body(tagBodyAt(tagBytes, 0).body);
  const fs = d.fillStyles[0];
  assertEqual(fs.type, 'radial');
  assertEqual(fs.stops[1].color, [0, 0, 0, 128]);
  assert(Math.abs(fs.matrix.rotateSkew0) < 1e-6 && Math.abs(fs.matrix.rotateSkew1) < 1e-6);
  assert(Math.abs(fs.matrix.translateX - ctx.Bitio.px(30)) < 1);
});

test('shapeEx: three-stop gradient round-trips all stops in order', () => {
  const ctx = loadContext();
  const fill = { type: 'linear', direction: 'horizontal', stops: [
    { ratio: 0, color: [255, 0, 0, 255] }, { ratio: 128, color: [0, 255, 0, 255] }, { ratio: 255, color: [0, 0, 255, 255] },
  ] };
  const tagBytes = ctx.Swf.defineShapeEx(12, 0, 0, 100, 20, { fill });
  const d = decodeShape3Body(tagBodyAt(tagBytes, 0).body);
  assertEqual(d.fillStyles[0].stops.map(s => s.ratio), [0, 128, 255]);
  assertEqual(d.fillStyles[0].stops.map(s => s.color), [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]);
});

test('shapeEx: tiny 1px shape with both stroke and radius does not corrupt the bit-packing (nb>=2 clamp)', () => {
  const ctx = loadContext();
  const tagBytes = ctx.Swf.defineShapeEx(13, 0, 0, 1, 1, { fill: [1, 1, 1], radius: 1, stroke: { width: 1, color: [2, 2, 2, 255] } });
  const d = decodeShape3Body(tagBodyAt(tagBytes, 0).body);
  const last = d.path[d.path.length - 1];
  const first = d.path[0];
  assertEqual([last.x, last.y], [first.x, first.y], 'even a degenerate tiny shape must still close its path');
});

test('shapeEx: a movie built with rounded/stroked/gradient shapes still verifies structurally end to end', () => {
  const ctx = loadContext();
  const parts = [
    ctx.Swf.exporterInfo('shapes'),
    ctx.Swf.fileAttributes(),
    ctx.Swf.setBackgroundColor([0, 0, 0]),
    ctx.Swf.defineShapeEx(2, 0, 0, 100, 40, {
      fill: { type: 'linear', direction: 'vertical', stops: [{ ratio: 0, color: [80, 80, 80, 255] }, { ratio: 255, color: [20, 20, 20, 255] }] },
      radius: 6,
      stroke: { width: 1, color: [255, 255, 255, 128] },
    }),
    ctx.Swf.placeObject(2, 1),
    ctx.Swf.SHOW_FRAME,
    ctx.Swf.END,
  ];
  let total = new Uint8Array(0);
  for (const p of parts) {
    const merged = new Uint8Array(total.length + p.length);
    merged.set(total, 0); merged.set(p, total.length);
    total = merged;
  }
  const built = ctx.Swf.buildGfx(200, 100, 30, total);
  const summary = ctx.Verify.verifyGfx(built);
  assertEqual(summary.tags['32'], 1);
  assertEqual(summary.tags['26'], 1);
});
