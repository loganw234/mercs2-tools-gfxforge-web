const { loadContext, test, assert, assertEqual } = require('./run.js');

function hex(u8) { return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''); }

// Independent tag walker — reads the built container from the format rather
// than by inverting the writer, so it can be trusted to report what a movie
// actually contains.
function walk(bytes) {
  const tags = [];
  let bit = 0, p = 8;
  const rd = (n) => { let v = 0; for (let i = 0; i < n; i++) { v = (v << 1) | ((bytes[p] >> (7 - bit)) & 1); if (++bit === 8) { bit = 0; p++; } } return v; };
  const nb = rd(5); rd(nb); rd(nb); rd(nb); rd(nb);
  if (bit) { bit = 0; p++; }
  const fps = bytes[p] | (bytes[p + 1] << 8); p += 2;
  const frameCount = bytes[p] | (bytes[p + 1] << 8); p += 2;
  while (p + 2 <= bytes.length) {
    const rh = bytes[p] | (bytes[p + 1] << 8); p += 2;
    const code = rh >> 6; let len = rh & 0x3f;
    if (len === 0x3f) { len = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24); p += 4; }
    tags.push({ code, body: bytes.subarray(p, p + len) });
    p += len;
    if (code === 0) break;
  }
  return { tags, frameCount, fps };
}

const codes = (r) => r.tags.map(t => t.code);
const count = (r, code) => r.tags.filter(t => t.code === code).length;

function cstrAt(body, o) {
  let e = o;
  while (e < body.length && body[e] !== 0) e++;
  return { s: String.fromCharCode(...body.subarray(o, e)), next: e + 1 };
}

// --- single-frame movies are unchanged ---------------------------------------

test('timeline: a movie with no declared frames still has exactly one frame', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't' });
  m.rect(0, 0, 50, 50, [255, 0, 0]);
  const r = walk(m.build());
  assertEqual(r.frameCount, 1);
  assertEqual(count(r, 1), 1, 'exactly one ShowFrame');
  assertEqual(count(r, 43), 0, 'no FrameLabel');
  assertEqual(count(r, 28), 0, 'no RemoveObject2');
});

test('timeline: a single-frame movie gets no implicit stop()', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't' });
  m.rect(0, 0, 50, 50, [255, 0, 0]);
  assertEqual(count(walk(m.build()), 12), 0, 'no DoAction should be emitted');
});

// --- multi-frame timelines ----------------------------------------------------

test('timeline: declared frames produce that many ShowFrames and a matching header count', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't', frames: ['idle', 'alert', 'dead'] });
  m.rect(0, 0, 50, 50, [255, 0, 0]);
  const r = walk(m.build());
  assertEqual(r.frameCount, 3, 'header frame count');
  assertEqual(count(r, 1), 3, 'three ShowFrame tags');
});

test('timeline: frame labels are emitted, in order, with their names', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't', frames: ['idle', 'alert'] });
  m.rect(0, 0, 10, 10, [1, 2, 3]);
  const r = walk(m.build());
  const labels = r.tags.filter(t => t.code === 43).map(t => cstrAt(t.body, 0).s);
  assertEqual(labels.length, 2);
  assertEqual(labels[0], 'idle');
  assertEqual(labels[1], 'alert');
});

test('timeline: content present on one frame and absent on the next is removed', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't', frames: ['a', 'b'] });
  m.rect(0, 0, 10, 10, [1, 2, 3], { frames: [0] });      // only on frame 0
  m.rect(20, 0, 10, 10, [4, 5, 6], { frames: [1] });     // only on frame 1
  const r = walk(m.build());
  assertEqual(count(r, 28), 1, 'the frame-0-only rect must be removed entering frame 1');
  assertEqual(count(r, 26), 2, 'each rect is placed once');
});

test('timeline: an item on every frame is placed once, never removed', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't', frames: ['a', 'b', 'c'] });
  m.rect(0, 0, 10, 10, [1, 2, 3]);   // no frames -> all frames
  const r = walk(m.build());
  assertEqual(count(r, 26), 1, 'placed once and left alone');
  assertEqual(count(r, 28), 0, 'never removed');
});

test('timeline: an item returning on a later frame is re-placed at the same depth', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't', frames: ['a', 'b', 'c'] });
  m.rect(0, 0, 10, 10, [1, 2, 3], { frames: [0, 2] });   // present, gone, present
  const r = walk(m.build());
  assertEqual(count(r, 28), 1, 'removed entering frame 1');
  assertEqual(count(r, 26), 2, 'placed on frame 0 and again on frame 2');
  const places = r.tags.filter(t => t.code === 26);
  const depthOf = (t) => t.body[1] | (t.body[2] << 8);
  assertEqual(depthOf(places[0]), depthOf(places[1]), 'both placements target the same depth');
  const removed = r.tags.find(t => t.code === 28);
  assertEqual(removed.body[0] | (removed.body[1] << 8), depthOf(places[0]), 'the removal targets that depth too');
});

test('timeline: a multi-frame movie stops on frame 1 by default', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't', frames: ['a', 'b'] });
  m.rect(0, 0, 10, 10, [1, 2, 3]);
  const r = walk(m.build());
  const doAction = r.tags.find(t => t.code === 12);
  assert(doAction, 'a DoAction should carry the implicit stop');
  assertEqual(doAction.body[0], 0x07, 'first action should be ActionStop (0x07)');
});

test('timeline: stopAtStart:false leaves a multi-frame movie looping', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't', frames: ['a', 'b'], stopAtStart: false });
  m.rect(0, 0, 10, 10, [1, 2, 3]);
  assertEqual(count(walk(m.build()), 12), 0, 'no DoAction at all');
});

test('timeline: per-frame scripts land on their own frame', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't', frames: ['a', 'b'] });
  m.rect(0, 0, 10, 10, [1, 2, 3]);
  m.script(ctx.Compiler.compileSource('x = 1;'), 1);
  const r = walk(m.build());
  assertEqual(count(r, 12), 2, 'one DoAction per frame that has actions');
  // frame 1's DoAction must come after the second ShowFrame boundary
  const seq = codes(r);
  const firstShow = seq.indexOf(1);
  const lastDo = seq.lastIndexOf(12);
  assert(lastDo > firstShow, 'the frame-1 script must be emitted after frame 0 ends');
});

test('timeline: a built multi-frame movie still passes structural verification', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(320, 200, { name: 'states', frames: ['idle', 'alert'] });
  m.rect(0, 0, 320, 30, [20, 20, 20]);
  m.text(8, 6, 'STATUS', { varName: 'status', frames: [0] });
  m.text(8, 6, 'ALERT', { frames: [1] });
  m.script(ctx.Compiler.compileSource('function Show(s) { gotoAndStop(s); }'));
  const summary = ctx.Verify.verifyMovie(m, { functions: ['Show'] });
  assert(summary.bytes > 0);
});

// --- exported symbols ---------------------------------------------------------

test('timeline: exportAs emits ExportAssets naming the clip sprite', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't' });
  m.clip('bar', 0, 0, 40, 8, [0, 200, 0]).exportAs('HealthBar');
  const r = walk(m.build());
  const ex = r.tags.find(t => t.code === 56);
  assert(ex, 'ExportAssets (56) should be present');
  assertEqual(ex.body[0] | (ex.body[1] << 8), 1, 'one exported symbol');
  assertEqual(cstrAt(ex.body, 4).s, 'HealthBar');
});

// --- clip event handlers -------------------------------------------------------

test('timeline: clip events produce a PlaceObject2 carrying ClipActions', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't' });
  m.clip('btn', 10, 10, 60, 20, [40, 44, 52], {
    events: { release: 'fscommand("fire", 1);', rollOver: 'trace("over");' },
  });
  const r = walk(m.build());
  const place = r.tags.filter(t => t.code === 26).pop();
  assert((place.body[0] & 0x01) !== 0, 'PlaceFlagHasClipActions should be set');
  assert((place.body[0] & 0x20) !== 0, 'the clip should still be named');
});

test('timeline: ClipActions framing matches what the player parses', () => {
  const ctx = loadContext();
  const S = ctx.Swf;
  const actions = ctx.Avm1.push(1);
  const ca = S.clipActions([{ events: ['release'], actions }]);
  // reserved(2) + allFlags(4) + [flags(4) + length(4) + actions + End] + terminator(4)
  assertEqual(ca[0] | (ca[1] << 8), 0, 'reserved must be zero');
  const allFlags = ca[2] | (ca[3] << 8) | (ca[4] << 16) | (ca[5] << 24);
  assertEqual(allFlags, S.CLIP_EVENT.release, 'allFlags is the OR of every handler');
  const thisFlags = ca[6] | (ca[7] << 8) | (ca[8] << 16) | (ca[9] << 24);
  assertEqual(thisFlags, S.CLIP_EVENT.release);
  const len = ca[10] | (ca[11] << 8) | (ca[12] << 16) | (ca[13] << 24);
  assertEqual(len, actions.length + 1, 'length covers the actions plus their End byte');
  const tail = ca.subarray(ca.length - 4);
  assertEqual(tail[0] | tail[1] | tail[2] | tail[3], 0, 'terminated with a zero flag word');
});

test('timeline: keyPress handlers carry their key code inside the measured length', () => {
  const ctx = loadContext();
  const S = ctx.Swf;
  const actions = ctx.Avm1.push(1);
  const ca = S.clipActions([{ events: ['keyPress'], actions, keyCode: 32 }]);
  const len = ca[10] | (ca[11] << 8) | (ca[12] << 16) | (ca[13] << 24);
  assertEqual(len, actions.length + 2, 'key code byte is part of the length');
  assertEqual(ca[14], 32, 'key code precedes the actions');
});

// --- colour transform ----------------------------------------------------------

test('timeline: alpha lowers to a CXFORM with multiply terms over 256', () => {
  const ctx = loadContext();
  const cx = ctx.Swf.alphaCxform(0.5);
  // hasAdd(1)=0, hasMult(1)=1, nbits(4), then 4 signed mult terms.
  // 0.5 * 256 = 128, and 1.0 * 256 = 256 -> needs 10 bits signed.
  const first = cx[0];
  assertEqual((first >> 7) & 1, 0, 'hasAdd is the first bit and should be clear');
  assertEqual((first >> 6) & 1, 1, 'hasMult should be set');
  const nbits = ((first & 0x3f) << 0) >> 2;
  assert(nbits >= 10, `nbits should hold 256, got ${nbits}`);
});

test('timeline: an item with alpha places via PlaceObject2 with the cxform flag', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 't' });
  m.rect(0, 0, 10, 10, [1, 2, 3], { alpha: 0.5 });
  const place = walk(m.build()).tags.find(t => t.code === 26);
  assert((place.body[0] & 0x08) !== 0, 'PlaceFlagHasColorTransform should be set');
});

// --- text flags -----------------------------------------------------------------

test('timeline: default text output is byte-identical to the original flags', () => {
  const ctx = loadContext();
  const a = ctx.Swf.defineEditText(5, 0, 0, 100, 20, 1, 13, 'hi', [255, 255, 255, 255], '');
  // the two flag bytes follow the char id and the bounds rect
  const withOpts = ctx.Swf.defineEditText(5, 0, 0, 100, 20, 1, 13, 'hi', [255, 255, 255, 255], '', {});
  assertEqual(hex(a), hex(withOpts), 'passing an empty options object must change nothing');
  assert(hex(a).indexOf('8d11') > 0, 'the original 0x8d,0x11 flag pair should still be what defaults produce');
});

// Locate the two DefineEditText flag bytes: the tag body starts after a short
// (2-byte) or long (6-byte) record header, then char id (2) then the bounds
// RECT, whose length is derived from its own leading 5-bit width field.
function editTextFlags(tagBytes) {
  const short = (tagBytes[0] | (tagBytes[1] << 8)) & 0x3f;
  const body = tagBytes.subarray(short === 0x3f ? 6 : 2);
  const nb = body[2] >> 3;                       // RECT starts right after char id
  const rectBits = 5 + 4 * nb;
  const o = 2 + Math.ceil(rectBits / 8);
  return { f0: body[o], f1: body[o + 1] };
}

test('timeline: multiline/wordWrap/html/border set their flag bits', () => {
  const ctx = loadContext();
  const F0 = ctx.Swf.EDIT_FLAGS0, F1 = ctx.Swf.EDIT_FLAGS1;
  const t = ctx.Swf.defineEditText(5, 0, 0, 100, 60, 1, 13, 'hi', [255, 255, 255, 255], '',
    { multiline: true, wordWrap: true, html: true, border: true, selectable: true });
  const { f0, f1 } = editTextFlags(t);
  assert((f0 & F0.MULTILINE) !== 0, 'multiline bit');
  assert((f0 & F0.WORD_WRAP) !== 0, 'wordWrap bit');
  assert((f1 & F1.HTML) !== 0, 'html bit');
  assert((f1 & F1.BORDER) !== 0, 'border bit');
  assert((f1 & F1.NO_SELECT) === 0, 'selectable:true must clear NoSelect');
  // and the field must still read back through the project's own decoder
  assertEqual(ctx.Decode._internal.decodeEditText(t.subarray(2)).text, 'hi');
});

test('timeline: the default flag pair is exactly the historical 0x8d/0x11', () => {
  const ctx = loadContext();
  const { f0, f1 } = editTextFlags(
    ctx.Swf.defineEditText(5, 0, 0, 100, 20, 1, 13, 'hi', [255, 255, 255, 255], '')
  );
  assertEqual(f0, 0x8d);
  assertEqual(f1, 0x11);
});

// --- importer round trip --------------------------------------------------------

test('timeline: the importer survives a movie using colour transforms and clip actions', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 'roundtrip' });
  m.rect(0, 0, 200, 20, [30, 30, 30]);
  m.clip('faded', 10, 30, 60, 20, [0, 180, 90], {
    alpha: 0.5, events: { release: 'fscommand("hit", 1);' },
  });
  const { project } = ctx.Decode.decodeGfx(m.build());
  const clip = project.items.find(it => it.kind === 'clip');
  assert(clip, 'the named clip should come back as a clip item');
  assertEqual(clip.name, 'faded', 'the instance name must survive the colour transform');
  assertEqual(clip.x, 10, 'and its position should still be right');
  assertEqual(clip.y, 30);
});

test('timeline: the importer reads a CXFORM carrying BOTH add and multiply terms', () => {
  const ctx = loadContext();
  // The specific shape the old reader got wrong: it looked for a separate
  // bit-width field per term group, where the format has one Nbits shared by
  // both. With add terms present that desynchronises the record and swallows
  // the instance name and everything after it.
  //
  // This movie's own encoder only ever emits multiply terms (alpha), and the
  // old reader coincidentally survived that case — so the placement here is
  // hand-assembled with both groups, the way a tinted foreign .gfx would be.
  const S = ctx.Swf;
  const cx = S.encodeCxform({ r: 0.5, g: 0.5, b: 0.5, a: 0.5 }, { r: 40, g: -20, b: 10, a: 0 });
  const place = S.placeObject2({
    charId: 2, depth: 1, matrix: S.IDENTITY_MATRIX, name: 'tinted', cxform: cx,
  });
  // Strip the tag header, then read it back through the importer's own decoder.
  const short = (place[0] | (place[1] << 8)) & 0x3f;
  const body = place.subarray(short === 0x3f ? 6 : 2);
  const decoded = ctx.Decode._internal.decodePlace(body);
  assertEqual(decoded.name, 'tinted', 'the name must survive an add+multiply colour transform');
  assertEqual(decoded.charId, 2);
  assertEqual(decoded.depth, 1);
  assertEqual(decoded.alpha, 0.5, 'and the alpha multiplier should be recovered');
});

test('timeline: the importer reads a multi-frame movie without losing frame-0 content', () => {
  const ctx = loadContext();
  const m = new ctx.GFMovie.Movie(200, 100, { name: 'frames', frames: ['a', 'b'] });
  m.rect(0, 0, 200, 20, [30, 30, 30]);
  m.text(4, 2, 'ONE', { frames: [0] });
  m.text(4, 2, 'TWO', { frames: [1] });
  const { project } = ctx.Decode.decodeGfx(m.build());
  // The importer flattens the display list rather than reconstructing frames,
  // so both text fields come back; what matters is that it doesn't throw and
  // doesn't drop the geometry.
  assert(project.items.length >= 2, `expected the flattened items, got ${project.items.length}`);
  assertEqual(project.stage.width, 200);
});

test('timeline: alignment forces a layout record and survives decoding', () => {
  const ctx = loadContext();
  const t = ctx.Swf.defineEditText(5, 0, 0, 100, 20, 1, 13, 'centered', [255, 255, 255, 255], 'v',
    { align: 'center' });
  const dec = ctx.Decode._internal.decodeEditText(t.subarray(2));
  assertEqual(dec.text, 'centered', 'the layout record must be skipped correctly when reading back');
  assertEqual(dec.varName, 'v');
});
