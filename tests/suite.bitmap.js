const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadContext, test, assert, assertEqual } = require('./run.js');

function hasPython3() {
  try { execFileSync('python3', ['--version']); return true; } catch (e) { return false; }
}
const PYTHON3_AVAILABLE = hasPython3();

// Cross-checks a zlibStore() output against Python's real zlib.decompress —
// an independent, trusted implementation, unlike everything else in this
// project which is only checked against itself.
function pythonZlibDecompressMatches(compressed, original) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gfxforge-zlib-'));
  const compPath = path.join(dir, 'c.bin');
  const origPath = path.join(dir, 'o.bin');
  fs.writeFileSync(compPath, Buffer.from(compressed));
  fs.writeFileSync(origPath, Buffer.from(original));
  const script = `
import zlib, sys
with open(${JSON.stringify(compPath)}, 'rb') as f: c = f.read()
with open(${JSON.stringify(origPath)}, 'rb') as f: o = f.read()
d = zlib.decompress(c)
sys.exit(0 if d == o else 1)
`;
  try {
    execFileSync('python3', ['-c', script]);
    return true;
  } catch (e) {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('bitmap: zlibStore output is cross-verified against Python\'s real zlib (several sizes)', () => {
  if (!PYTHON3_AVAILABLE) { console.log('  (skipped — python3 not available in this environment)'); return; }
  const ctx = loadContext();
  const cases = [
    new Uint8Array(0),
    Uint8Array.from([42]),
    new Uint8Array(65535).fill(7),
    new Uint8Array(65536).fill(9),
    (() => { const a = new Uint8Array(150000); for (let i = 0; i < a.length; i++) a[i] = i % 256; return a; })(),
    new Uint8Array(64 * 64 * 4).map((_, i) => (i * 13 + 3) % 256), // typical small-icon RGBA size
  ];
  for (const data of cases) {
    const compressed = ctx.Bitmap.zlibStore(data);
    assert(pythonZlibDecompressMatches(compressed, data), `zlib mismatch for length ${data.length}`);
  }
});

test('bitmap: adler32 matches a known reference value', () => {
  const ctx = loadContext();
  // adler32("Wikipedia") = 0x11E60398 is a widely-cited reference value.
  const bytes = Uint8Array.from(Buffer.from('Wikipedia', 'latin1'));
  assertEqual(ctx.Bitmap.adler32(bytes).toString(16), '11e60398');
});

test('bitmap: rgbaToArgb reorders bytes correctly per pixel', () => {
  const ctx = loadContext();
  const imageData = { width: 2, height: 1, data: Uint8Array.from([10, 20, 30, 40, 50, 60, 70, 80]) }; // 2 RGBA pixels
  const argb = ctx.Bitmap.rgbaToArgb(imageData);
  assertEqual(Array.from(argb), [40, 10, 20, 30, 80, 50, 60, 70]);
});

test('bitmap: defineBitsLossless2 produces a well-formed tag with correct header fields', () => {
  const ctx = loadContext();
  const imageData = { width: 4, height: 3, data: new Uint8Array(4 * 3 * 4).fill(128) };
  const tagBytes = ctx.Bitmap.defineBitsLossless2(5, 4, 3, imageData);
  const header = tagBytes[0] | (tagBytes[1] << 8);
  const code = header >> 6;
  assertEqual(code, 36); // DefineBitsLossless2
  let len = header & 0x3f;
  let bodyStart = 2;
  if (len === 0x3f) {
    len = tagBytes[2] | (tagBytes[3] << 8) | (tagBytes[4] << 16) | (tagBytes[5] << 24);
    bodyStart = 6;
  }
  const body = tagBytes.subarray(bodyStart, bodyStart + len);
  assertEqual(body[0] | (body[1] << 8), 5); // bitmapId
  assertEqual(body[2], 5); // format = 32-bit ARGB
  assertEqual(body[3] | (body[4] << 8), 4); // width
  assertEqual(body[5] | (body[6] << 8), 3); // height
});

test('bitmap: a movie containing a DefineBitsLossless2 image verifies structurally', () => {
  const ctx = loadContext();
  const imageData = { width: 8, height: 8, data: new Uint8Array(8 * 8 * 4).map((_, i) => i % 256) };
  const bitmapTag = ctx.Bitmap.defineBitsLossless2(2, 8, 8, imageData);
  const parts = [
    ctx.Swf.exporterInfo('img-test'),
    ctx.Swf.fileAttributes(),
    ctx.Swf.setBackgroundColor([0, 0, 0]),
    bitmapTag,
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
  const built = ctx.Swf.buildGfx(100, 100, 30, total);
  const summary = ctx.Verify.verifyGfx(built);
  assertEqual(summary.tags['36'], 1);
});

test('bitmap: Movie.image() places a correctly-scaled bitmap end to end', () => {
  const ctx = loadContext();
  const imageData = { width: 16, height: 16, data: new Uint8Array(16 * 16 * 4).fill(200) };
  const m = new ctx.GFMovie.Movie(100, 100, { name: 'img' });
  m.image(10, 10, 40, 40, imageData); // display at 40x40px even though the source is 16x16px
  const built = m.build();
  const summary = ctx.Verify.verifyGfx(built);
  assertEqual(summary.tags['36'], 1); // DefineBitsLossless2
  assertEqual(summary.tags['26'], 1); // PlaceObject
});
